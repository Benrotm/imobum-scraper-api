const { chromium } = require('playwright');
const { createClient } = require('@supabase/supabase-js');

// Sleep utility
const delay = ms => new Promise(res => setTimeout(res, ms));

async function runSoldImmofluxScrape(req, res) {
    const {
        jobId, pageNum, config, mode, proxyConfig, webhookBaseUrl,
        adminId, immofluxUser, immofluxPass,
        supabaseUrl, supabaseKey
    } = req.body;

    if (!jobId || !config || !config.url) {
        return res.status(400).json({ error: 'Missing required parameters' });
    }

    const activeSupabase = (supabaseUrl && supabaseKey) ? createClient(supabaseUrl, supabaseKey) : null;

    res.json({ message: 'Sold Immoflux Scrape execution started in background.', jobId, mode });

    async function logLive(msg, level = 'info') {
        console.log(`[SOLD-JOB ${jobId}] ${msg}`);
        if (activeSupabase && jobId) {
            try {
                await activeSupabase.from('scrape_logs').insert({ job_id: jobId, message: msg, log_level: level });
            } catch (e) { console.error('Failed to log to Supabase', e); }
        }
    }

    async function isJobStopped() {
        if (!activeSupabase || !jobId) return false;
        try {
            const { data } = await activeSupabase.from('scrape_jobs').select('status').eq('id', jobId).single();
            return data?.status === 'stopped';
        } catch (e) { return false; }
    }

    let totalProcessed = 0;
    let totalSkipped = 0;
    let browser = null;

    try {
        await logLive(`Initializing Sold Immoflux Scraper - Mode: ${mode}`);

        const launchOptions = {
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled']
        };

        browser = await chromium.launch(launchOptions);
        const context = await browser.newContext({
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
        });

        // Mask automation
        await context.addInitScript(() => { Object.defineProperty(navigator, 'webdriver', { get: () => false }); });

        // Block heavy media
        await context.route('**/*', (route) => {
            const type = route.request().resourceType();
            if (['image', 'media', 'font'].includes(type) && !route.request().url().includes('PhoneNumberImages')) {
                return route.abort();
            }
            return route.continue();
        });

        const page = await context.newPage();

        const loginUrl = config.url.includes('fluxmls.immoflux.ro') ? 'https://fluxmls.immoflux.ro/login' :
            config.url.includes('blitz.immoflux.ro') ? 'https://blitz.immoflux.ro/login' : 'https://immoflux.ro/login';
        await logLive(`Authenticating at ${loginUrl} with user ${immofluxUser}`);
        await page.goto(loginUrl, { waitUntil: 'load', timeout: 45000 });
        
        // Handle Cookie Consent if exists
        try {
            const cookieBtn = page.locator('#onetrust-accept-btn-handler');
            if (await cookieBtn.isVisible({ timeout: 2000 })) await cookieBtn.click();
        } catch (e) { }

        await logLive(`Typing credentials for ${immofluxUser}...`, 'info');
        try {
            await page.waitForSelector('#inputEmail', { timeout: 10000 });
            await page.type('#inputEmail', immofluxUser);
            await page.type('#inputPassword', immofluxPass);
            await Promise.all([
                page.waitForNavigation({ waitUntil: 'networkidle', timeout: 30000 }).catch(() => null),
                page.click('button[type="submit"]')
            ]);
            await logLive('Authentication successful.', 'success');
        } catch(authErr) {
            await logLive(`Login input failed: ${authErr.message}`, 'error');
            throw authErr;
        }
        
        // Check for login errors
        const errorAlert = page.locator('.alert-danger, .error-message, .help-block-error');
        if (await errorAlert.count() > 0 && await errorAlert.first().isVisible()) {
            const errText = await errorAlert.first().innerText();
            await logLive(`Login failed: ${errText}`, 'error');
            throw new Error(`Authentication failed: ${errText}`);
        }

        // VERIFY LOGIN
        const loggedInMarker = page.locator('.user-menu, a[href*="logout"], .ti-user, div.member-card');
        let isAuthenticated = false;
        try {
            await loggedInMarker.first().waitFor({ state: 'attached', timeout: 10000 });
            isAuthenticated = true;
            await logLive(`Login verified. Welcome, ${await page.locator('.user-display-name, .member-name').first().innerText().catch(() => 'User')}`);
        } catch(e) {
            await logLive('Warning: Logged-in marker not found. Checking current URL...', 'warn');
            if (page.url().includes('/login')) {
                throw new Error('Authentication failed: Still on login page after submission.');
            }
        }

        if (await isJobStopped()) {
            await logLive('Job was stopped. Aborting.', 'warn');
            throw new Error('Stopped by User');
        }

        // Navigate to Properties List
        let targetUrl = config.url;
        if (pageNum > 1) {
            targetUrl += (targetUrl.includes('?') ? '&' : '?') + `page=${pageNum}`;
        }

        await logLive(`Navigating to ${targetUrl}`);
        // Use a more robust goto that handles potential redirections
        for (let i = 0; i < 2; i++) {
            await page.goto(targetUrl, { waitUntil: 'networkidle', timeout: 45000 });
            await page.waitForTimeout(2000);
            
            if (!page.url().includes('/login')) break;
            await logLive(`Redirected to /login (attempt ${i+1}). Retrying navigation...`, 'warn');
            await page.waitForTimeout(3000);
        }

        if (page.url().includes('/login')) {
            throw new Error('Redirected to login page. Session might be invalid or bot protection triggered.');
        }
        await page.waitForTimeout(2000);

        await logLive(`Current URL: ${page.url()}`);
        await logLive(`Page Title: ${await page.title()}`);
        await logLive('Ensuring page is stable (networkidle)...');
        try {
            await page.waitForLoadState('networkidle', { timeout: 30000 });
        } catch(e) {
            await logLive(`Notice: networkidle timeout (${e.message}), proceeding anyway...`, 'info');
        }

        // Diagnostic: Dump top-level IDs if we fear missing elements
        const allIds = await page.evaluate(() => {
            return Array.from(document.querySelectorAll('[id]')).map(el => el.id).filter(id => id.length > 0).slice(0, 50);
        });
        await logLive(`Found first 50 IDs: ${allIds.join(', ')}`, 'info');

        await logLive('Opening filter wrapper...');
        // Open filter panel if not open
        await logLive('Checking filter panel state...');
        try {
            // Wait for ANY evidence of a filter wrapper in the DOM
            // Using a broader selector and longer timeout
            const wrapperSelector = '#filter-wrapper, div.panel.collapse, #filter';
            await logLive(`Waiting for selector: ${wrapperSelector}...`);
            
            try {
                await page.waitForSelector(wrapperSelector, { state: 'attached', timeout: 45000 });
            } catch(te) {
                const bodyContent = await page.evaluate(() => document.body.innerText.substring(0, 500));
                await logLive(`FATAL: Filter wrapper NOT attached after 45s. URL: ${page.url()}. Body start: ${bodyContent}`, 'error');
                throw te;
            }
            
            const filterWrapper = page.locator(wrapperSelector).first();
            // Look for any reasonable filter toggle button
            const filterBtn = page.locator('a[href="#filter-wrapper"], a[data-type="filterbutton"], .ti-filter, i.ti-filter, .btn-primary.btn-outline.btn-round i.ti-filter').first();
            
            let isOpen = false;
            // Try up to 4 times to ensure it's open
            for (let i = 0; i < 4; i++) {
                const box = await filterWrapper.boundingBox();
                const classes = await filterWrapper.getAttribute('class') || '';
                
                if ((box && box.height > 10) || classes.includes('in')) {
                    isOpen = true;
                    await logLive(`Filter panel confirmed open (Height: ${box?.height || 'N/A'}, Classes: ${classes})`);
                    break;
                }
                
                await logLive(`Clicking filter toggle (attempt ${i+1})...`);
                await filterBtn.click({ force: true });
                await page.waitForTimeout(4000); // Give it plenty of time
            }
            
            if (!isOpen) {
                await logLive('Warning: Header filter panel expansion not detected via height/class, but elements might be present...', 'warn');
            }
        } catch(e) {
            await logLive(`Notice: Problem toggling filter panel: ${e.message}`, 'error');
        }

        const applySelectizeFilter = async (selectorOrLabel, values, isId = false) => {
            if (!values || values.length === 0) return;
            
            for (const val of values) {
                if (!val) continue;
                await logLive(`Attempting to apply selectize filter [${selectorOrLabel}]: ${val}`);
                
                try {
                    let inputSelector;
                    if (isId) {
                        // Target the actual underlying input element inside the selectize control
                        inputSelector = `${selectorOrLabel} ~ .selectize-control .selectize-input input, ${selectorOrLabel} + .selectize-control .selectize-input input`;
                    } else {
                        // Fallback to label search, targeting the inner input
                        inputSelector = `//label[contains(text(), "${selectorOrLabel}")]/following-sibling::div//div[contains(@class, "selectize-input")]//input`;
                        if (await page.locator(`xpath=${inputSelector}`).count() === 0) {
                            inputSelector = `//label[contains(text(), "${selectorOrLabel}")]/parent::div//div[contains(@class, "selectize-input")]//input`;
                        }
                    }

                    const inputLoc = isId ? page.locator(inputSelector).first() : page.locator(`xpath=${inputSelector}`).first();
                    
                    // Force it to be visible by scrolling if needed
                    await inputLoc.scrollIntoViewIfNeeded();

                    if (await inputLoc.count() === 0 && !isId) {
                        // Try another label variant if first fails
                        const altPath = `//label[contains(text(), "${selectorOrLabel.replace('t', 'ț')}")]/following-sibling::div//div[contains(@class, "selectize-input")]//input`;
                        const altLoc = page.locator(`xpath=${altPath}`);
                        if (await altLoc.count() > 0) {
                            await altLoc.click({ force: true });
                        } else {
                            throw new Error(`Control for ${selectorOrLabel} not found`);
                        }
                    } else {
                        await inputLoc.click({ force: true });
                    }

                    await page.waitForTimeout(1000);
                    
                    // Clear existing if any (programmatically for selectize)
                    await page.keyboard.press('Control+A');
                    await page.keyboard.press('Backspace');
                    
                    // Keyboard typing approach (robust, same as regular Immoflux scraper)
                    await page.keyboard.type(val, { delay: 100 });
                    await page.waitForTimeout(1000); // Wait for dropdown results to render
                    
                    // Listen for filter response
                    const filterResponsePromise = page.waitForResponse(r => 
                        r.url().includes('properties/filter') && r.status() === 200,
                        { timeout: 15000 }
                    ).catch(() => null);

                    await page.keyboard.press('Enter');
                    
                    const ajaxRes = await filterResponsePromise;
                    if (ajaxRes) {
                        await logLive(`Filter AJAX refresh confirmed for ${val}.`, 'success');
                    } else {
                        await logLive(`AJAX refresh not detected. Assuming native state transition.`, 'info');
                    }
                    
                    await page.waitForTimeout(2000); // Wait for list to update in DOM

                } catch(e) {
                    await logLive(`Could not set filter ${val}: ${e.message}`, 'warn');
                    // Take screenshot on failure for debugging
                    try {
                        const shotPath = `filter_error_${selectorOrLabel.replace(/[^a-zA-Z0-9]/g, '')}_${Date.now()}.png`;
                        await page.screenshot({ path: shotPath });
                        await logLive(`Screenshot saved as ${shotPath}`, 'info');
                    } catch(ss) {}
                }
            }
        };
        // Stadiu filter - The site allows only ONE stadiu at a time.
        // If user provided multiple, we'll only use the FIRST one for this page run.
        if (config.stadiu_filter && config.stadiu_filter.length > 0) {
            const val = config.stadiu_filter[0];
            await logLive(`Attempting to apply Stadiu filter: ${val}`);
            
            // Comprehensive selector set for Stadiu
            const selectors = [
                'select#status',
                'select[name="status[]"]',
                'select#filter-status-eq',
                'select[name="filter_status__eq"]'
            ];

            let applied = false;
            for (const sel of selectors) {
                try {
                    if (await page.locator(sel).count() > 0) {
                        await logLive(`Using selector: ${sel}`);
                        await applySelectizeFilter(sel, [val], true);
                        applied = true;
                        break;
                    }
                } catch(e) {
                    await logLive(`Notice: Failed with selector ${sel}: ${e.message}`, 'info');
                }
            }

            if (!applied) {
                await logLive('Defaulting to label-based search for "Stadiu"...', 'info');
                try {
                    await applySelectizeFilter('Stadiu', [val], false);
                } catch(e) {
                    await logLive(`Error applying Stadiu filter: ${e.message}`, 'error');
                }
            }
        }

        // Region / Oras / Zona
        if (config.region_filter) {
            // Check if it's "select#filter-county-id-eq" or labeled "Judet"
            await applySelectizeFilter('select#filter-county-id-eq', [config.region_filter], true);
        }
        if (config.city_filter) {
            await applySelectizeFilter('select#filter-city-id-eq', [config.city_filter], true);
        }
        if (config.zone_filter) {
            await applySelectizeFilter('select#select-city-zones', [config.zone_filter], true);
        }

        await logLive(`Filters processed. Extracting listings on Page ${pageNum}...`);
        
        // Wait for results to appear
        try {
            await page.waitForSelector('tr.model-item', { timeout: 10000 });
        } catch(e) {
            await logLive('No property rows found or timeout waiting.', 'warn');
        }

        // Extract native listings from table
        // Tranzactionata / Pierduta might be greyed out, but they should be in the table
        const extractionResult = await page.evaluate(() => {
            const rowElements = document.querySelectorAll('tr.model-item');
            const links = document.querySelectorAll('tr.model-item[data-url], a.title-link[data-url], td.title-td[data-url]');
            const rawUrlsFound = [];
            const urls = [];
            
            for (const el of links) {
                const url = el.getAttribute('data-url') || el.href;
                if (url) {
                    rawUrlsFound.push(url);
                    // Extremely permissive matching: just check if 'propert' is in the string 
                    // (handles /properties, properties/, property, /approperties)
                    if (url.toLowerCase().includes('propert')) {
                        const fullUrl = new URL(url, window.location.href).href;
                        urls.push(fullUrl);
                    }
                }
            }
            return {
                rowCount: rowElements.length,
                rawSample: rawUrlsFound.slice(0, 3), // Grab up to 3 raw URLs for debugging
                urls: [...new Set(urls)]
            };
        });

        const propertyLinks = extractionResult.urls;
        await logLive(`DOM Scan: Found ${extractionResult.rowCount} rows. Extracted ${propertyLinks.length} URLs. Raw Sample: ${JSON.stringify(extractionResult.rawSample)}`);

        // Now, we need to extract from the POPUP by clicking them or direct navigation
        for (const url of propertyLinks) {
            if (await isJobStopped()) break;

            if (activeSupabase) {
                // Check if this property is already scraped
                const { data: alreadyScraped } = await activeSupabase
                    .from('scraped_urls')
                    .select('id')
                    .eq('url', url)
                    .maybeSingle();

                if (alreadyScraped) {
                    totalSkipped++;
                    if (mode === 'watcher') {
                        await logLive('Watcher mode found existing scraped property. Aborting batch.');
                        break;
                    }
                    continue;
                }
            }

            await logLive(`Processing [Sold Property]: ${url}`);
            
            let popupData = null;
            let images = [];
            let daysOnMarket = null;
            let referenceId = url.split('/').pop();

            try {
                // We navigate directly to the detail url, since Immoflux supports direct navigation to /approperties/id 
                // which opens a full page view or a modal if we use the specific route.
                const detailPage = await context.newPage();
                await detailPage.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
                
                // Wait for any content to be visible
                try {
                    await detailPage.waitForSelector('h3, .slidePanel-header, h1', { timeout: 15000 });
                } catch(e) {}

                // Try to extract mapping fields
                popupData = await detailPage.evaluate(() => {
                    const result = {};
                    const getText = (el) => el ? el.textContent.trim().replace(/\s+/g, ' ') : '';
                    
                    // 1. Root container (Slide Panel or Full Page)
                    const panel = document.querySelector('.slidePanel');
                    const root = panel || document.body; // CRITICAL FIX: Use document.body instead of document so textContent actually works

                    // Title extraction - Improved
                    const h1Title = root.querySelector('h1')?.textContent || '';
                    let bestTitle = h1Title;
                    
                    const allH3 = Array.from(root.querySelectorAll('h3'));
                    for (const h3 of allH3) {
                        const t = getText(h3);
                        // If it's descriptive (not meta-text)
                        if (t && !t.toLowerCase().includes('pret') && !t.toLowerCase().includes('proprietate') && t.length > 5) {
                            bestTitle = t;
                            break;
                        }
                    }
                    
                    result['title'] = bestTitle;

                    // All potential label elements
                    const labels = Array.from(root.querySelectorAll('span, label, dt, th, p, strong, div, h3, h4'));
                    
                    const findValue = (textMatch) => {
                        const labelEl = labels.find(l => {
                            const t = getText(l);
                            const lowerT = t.toLowerCase();
                            const lowerMatch = textMatch.toLowerCase();
                            return lowerT === lowerMatch || lowerT === (lowerMatch + ':');
                        });
                        
                        if (!labelEl) return null;
                        
                        const parent = labelEl.parentElement;
                        if (parent) {
                            const strong = parent.querySelector('strong');
                            if (strong) return getText(strong);
                        }
                        
                        if (labelEl.nextElementSibling) {
                            return getText(labelEl.nextElementSibling);
                        }
                        
                        return null;
                    };

                    const findFeature = (labelPart) => {
                        const allElems = Array.from(root.querySelectorAll('div, span, td, h4, label'));
                        const match = allElems.find(d => {
                            const t = getText(d);
                            // Avoid matching the title itself if it contains the label
                            return t.toLowerCase().includes(labelPart.toLowerCase()) && t.length < labelPart.length + 30;
                        });
                        if (match) {
                            const strong = match.querySelector('strong');
                            if (strong) return getText(strong);
                            
                            const t = getText(match);
                            const valMatch = t.match(/:\s*([\d.,]+)/) || t.match(/([\d.,]+)\s*(?:m|km|€|camere)/i);
                            if (valMatch) return valMatch[1];
                        }
                        return null;
                    };

                    result['rooms'] = findFeature('Camere');
                    result['bedrooms'] = findFeature('Dormitoare');
                    result['bathrooms'] = findFeature('Bai');
                    result['usable_area'] = findFeature('Suprafata utila') || findFeature('Suprafata utilă') || findFeature('Suprafata');
                    result['land_area'] = findFeature('Suprafata teren');
                    result['year_built'] = findFeature('An constructie') || findFeature('Anul');
                    result['comfort'] = findValue('Confort');
                    result['floor'] = findValue('Etaj');

                    result['price'] = findFeature('Pret tranzactionare') || findValue('Pret tranzactionare') || findValue('Pret') || findValue('Preț final');
                    
                    if (!result['price'] || result['price'] === '0' || result['price'] === '') {
                        const priceSpan = root.querySelector('span.blue-600');
                        const priceStrong = root.querySelector('strong span.blue-600');
                        const priceH3 = Array.from(root.querySelectorAll('h3')).find(h => getText(h).toLowerCase().includes('pret'));
                        
                        if (priceH3) {
                            result['price'] = getText(priceH3).replace(/Pret:\s*/i, '');
                        } else if (priceStrong) {
                            result['price'] = getText(priceStrong);
                        } else if (priceSpan) {
                            result['price'] = getText(priceSpan);
                        }
                    }
                    
                    const addressRaw = findValue('Adresa');
                    if (addressRaw) {
                        const parts = addressRaw.split(',').map(s => s.trim());
                        result['city'] = parts[0];
                        result['area'] = parts[1];
                    }

                    // Description
                    const fullText = root.textContent || '';
                    const domMatch = fullText.match(/Zile(?: in | pe | )pia[tț][aă][:\s]+(\d+)/i);
                    
                    if (domMatch && domMatch[1]) {
                        result['days_on_market'] = domMatch[1];
                    } else {
                        result['days_on_market'] = findValue('Zile in piata') || findValue('Zile pe piata') || findValue('Zile in piață') || findValue('Zile pe piață');
                    }
                    
                    // Extract Adresa
                    const addressMatch = fullText.match(/Adresa(?:\s*imobil)?\s*:\s*(.+)/i) || fullText.match(/Adresa\s*:?\s*(.+)/i);
                    if (addressMatch && addressMatch[1]) {
                        result['address'] = addressMatch[1].trim();
                    }

                    // Robust Description extraction mimicking index.js logic
                    // We look for "Descriere" and stop at common footer headers. 
                    // We use negative lookahead for "cheie" to avoid cutting off "Caracteristici cheie"
                    const descMatch = fullText.match(/Descriere\s*:?\s*([\s\S]+?)(?:\r?\n\s*(?:(?:CARACTERISTICI(?! cheie)|Detalii suplimentare|Dotari|Zona|Memo privat|Comentarii|Documente|Istoric|Activitate|Similare))|$)/i);
                    let finalDesc = '';
                    if (descMatch && descMatch[1]) {
                        finalDesc = descMatch[1].trim();
                    } else {
                        // Fallback to simpler regex if structured one fails
                        const simplerMatch = fullText.match(/Descriere\s*:?\s*([\s\S]+?)(?:\s+Memo privat|\s+Comentarii|\s+Documente|$)/i);
                        if (simplerMatch && simplerMatch[1]) {
                            finalDesc = simplerMatch[1].trim();
                        } else {
                            finalDesc = getText(root.querySelector('.description, #description, .details-desc, .property-description, #notes'));
                        }
                    }
                    
                    // Filter Descriere keyword
                    finalDesc = finalDesc.replace(/^\s*Descriere\s*/i, '').trim();
                    result['description'] = finalDesc;

                    // Property Type and Category extraction - IMPROVED PRIORITY
                    const rawType = (findValue('Tip') || '').toLowerCase();
                    const tLower = (bestTitle).toLowerCase();
                    const fullLower = (bestTitle + ' ' + fullText).toLowerCase();
                    
                    if (rawType.includes('apartament') || rawType.includes('garsoniera') || tLower.includes('apartament') || tLower.includes('garsoniera')) {
                        result['property_type'] = 'Apartment';
                    } else if (rawType.includes('casa') || rawType.includes('vila') || tLower.includes('casa') || tLower.includes('vila')) {
                        result['property_type'] = 'House/Villa';
                    } else if (rawType.includes('teren') || tLower.includes('teren')) {
                        result['property_type'] = 'Land';
                    } else if (rawType.includes('spatiu') || rawType.includes('birou') || rawType.includes('hala') || tLower.includes('spatiu') || tLower.includes('comercial')) {
                        result['property_type'] = 'Commercial';
                    } else {
                        // Fallback to searching the whole text if not found in specific areas
                        if (fullLower.includes('apartament')) result['property_type'] = 'Apartment';
                        else if (fullLower.includes('casa') || fullLower.includes('vila')) result['property_type'] = 'House/Villa';
                        else if (fullLower.includes('teren')) result['property_type'] = 'Land';
                        else if (fullLower.includes('spatiu comercial')) result['property_type'] = 'Commercial';
                    }

                    // Extract Agent Info for the Private Information panel
                    const phoneMatch = fullText.match(/Telefon\s*:?\s*([+]*[\s\d]{8,20})/i);
                    if (phoneMatch && phoneMatch[1]) {
                        const cleanedPhone = phoneMatch[1].trim().replace(/\s/g, '');
                        if (cleanedPhone.length >= 10) result['owner_phone'] = cleanedPhone;
                    }

                    // Owner Name extraction (usually near phone)
                    const agentNameMatch = fullText.match(/Agent(?:\s*imobiliar)?\s*(?:[:|-]?)\s*([A-Za-zĂăÂâÎîȘșȚț\s]{3,30})/i);
                    if (agentNameMatch && agentNameMatch[1] && !agentNameMatch[1].toLowerCase().includes('telefon')) {
                        result['owner_name'] = agentNameMatch[1].trim();
                    }

                    result['private_notes'] = `Agent name: ${result['owner_name'] || 'Unknown'} | Extracted implicitly by Scraper API.`;

                    // Extract all images
                    const imgs = Array.from(root.querySelectorAll('img'))
                        .map(img => img.src || img.getAttribute('data-src'))
                        .filter(src => src && typeof src === 'string' && !src.includes('base64') && !src.includes('logo') && !src.includes('avatar') && !src.includes('icon'));
                    
                    return { data: result, images: imgs };
                });

                await detailPage.close();

                if (popupData && popupData.data) {
                    const { data, images: imgList } = popupData;
                    
                    // Clean Price - handle cases like "178.000€ (2.373€/mp)"
                    let cleanPrice = 0;
                    if (data.price) {
                        // Take everything before the first '('
                        const mainPart = data.price.split('(')[0];
                        const pMatch = mainPart.replace(/[^\d]/g, '');
                        cleanPrice = parseInt(pMatch) || 0;
                    }

                    // Transmit to NextJS webhook
                    const transmitRes = await fetch(`${webhookBaseUrl}/api/admin/headless-dynamic-import-sold`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            url: url,
                            adminId: adminId,
                            extraData: {
                                is_sold_insight: true,
                                raw_extracted_data: data,
                                images: imgList,
                                title: data.title || `Proprietate - ${referenceId}`,
                                priceRaw: cleanPrice,
                                description: data.description,
                                rooms: parseInt(data.rooms) || 0,
                                bedrooms: parseInt(data.bedrooms) || 0,
                                bathrooms: parseInt(data.bathrooms) || 0,
                                comfort: data.comfort,
                                floor: data.floor,
                                usable_area: parseFloat(data.usable_area?.replace(',', '.')) || 0,
                                year_built: parseInt(data.year_built) || 0,
                                city: data.city,
                                area: data.area,
                                address: data.address,
                                property_type: data.property_type,
                                owner_name: data.owner_name,
                                owner_phone: data.owner_phone,
                                private_notes: data.private_notes,
                                land_area: parseFloat(data.land_area?.replace(',', '.')) || 0,
                                days_on_market: data.days_on_market || null,
                                status: 'Sold'
                            }
                        })
                    });

                    const tData = await transmitRes.json();
                    if (tData.success) {
                        await logLive(`Successfully stored ${url} in Market Insights.`);
                        totalProcessed++;
                        // Also record in scraped_urls to prevent duplication
                        await activeSupabase.from('scraped_urls').insert({ url: url, admin_id: adminId });
                    } else {
                        await logLive(`Failed storing insight: ${tData.error}`, 'error');
                    }
                }

                // Delay
                const dMin = parseInt(config.delay_min) || 3;
                const dMax = parseInt(config.delay_max) || 8;
                const actualDelayMs = Math.floor(Math.random() * (dMax - dMin + 1) + dMin) * 1000;
                await logLive(`Delay: Sleeping ${actualDelayMs / 1000}s...`);
                await delay(actualDelayMs);

            } catch (propErr) {
                await logLive(`Error extracting ${url}: ${propErr.message}`, 'error');
            }
        }

        let finalStatus = 'completed';
        if (await isJobStopped()) finalStatus = 'stopped';

        await logLive(`Crawler finished. Processed: ${totalProcessed} | Skipped: ${totalSkipped}. Status: ${finalStatus}`, 'info');

        if (activeSupabase && jobId && finalStatus === 'completed') {
            await activeSupabase.from('scrape_jobs').update({ status: 'completed', completed_at: new Date() }).eq('id', jobId);
        }

    } catch (e) {
        console.error('Scrape Error:', e);
        if (activeSupabase && jobId) {
            await activeSupabase.from('scrape_logs').insert({ job_id: jobId, message: `Fatal Error: ${e.message}`, log_level: 'error' });
            await activeSupabase.from('scrape_jobs').update({ status: 'failed', completed_at: new Date() }).eq('id', jobId);
        }
    } finally {
        if (browser) await browser.close();
    }
}

module.exports = { runSoldImmofluxScrape };
