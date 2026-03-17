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
            args: ['--disable-blink-features=AutomationControlled', '--no-sandbox', '--disable-setuid-sandbox', '--window-size=1920,1080']
        };

        if (proxyConfig && proxyConfig.is_active && proxyConfig.host && proxyConfig.port) {
            await logLive(`[PROXY] Routing via ${proxyConfig.host}:${proxyConfig.port}`, 'info');
            launchOptions.proxy = { server: `http://${proxyConfig.host}:${proxyConfig.port}` };
            if (proxyConfig.username && proxyConfig.password) {
                launchOptions.proxy.username = proxyConfig.username;
                launchOptions.proxy.password = proxyConfig.password;
            }
        }

        browser = await chromium.launch(launchOptions);
        const context = await browser.newContext({
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            viewport: { width: 1920, height: 1080 }
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

        await logLive(`Authenticating at blitz.immoflux.ro/login with user ${immofluxUser}`);
        await page.goto('https://blitz.immoflux.ro/login', { waitUntil: 'load', timeout: 30000 });
        
        // Handle Cookie Consent if exists
        try {
            const cookieBtn = page.locator('#onetrust-accept-btn-handler');
            if (await cookieBtn.isVisible({ timeout: 2000 })) await cookieBtn.click();
        } catch (e) { }

        await page.locator('input[name="email"], #inputEmail').fill(immofluxUser);
        await page.locator('input[name="password"], #inputPassword').fill(immofluxPass);
        
        await Promise.all([
            page.waitForNavigation({ waitUntil: 'networkidle' }),
            page.locator('button[type="submit"]').click()
        ]);
        await logLive('Login successful.');

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
        await page.goto(targetUrl, { waitUntil: 'networkidle', timeout: 45000 });
        await page.waitForTimeout(2000);

        // Apply Filters via UI
        await logLive('Opening filter wrapper...');
        // Open filter panel if not open
        await logLive('Checking filter panel state...');
        try {
            const filterWrapper = page.locator('#filter-wrapper');
            // Look for any reasonable filter toggle button
            const filterBtn = page.locator('a[href="#filter-wrapper"], a[data-type="filterbutton"], .ti-filter, i.ti-filter').first();
            
            let isOpen = false;
            // Try up to 3 times to ensure it's open
            for (let i = 0; i < 3; i++) {
                const box = await filterWrapper.boundingBox();
                if (box && box.height > 10) {
                    isOpen = true;
                    await logLive('Filter panel confirmed open.');
                    break;
                }
                await logLive(`Clicking filter toggle (attempt ${i+1})...`);
                await filterBtn.click({ force: true });
                await page.waitForTimeout(2000); // Wait for transition
            }
            
            if (!isOpen) {
                await logLive('Warning: Filter panel height check failed, but proceeding...', 'warn');
            }
        } catch(e) {
            await logLive(`Notice: Problem toggling filter panel: ${e.message}`, 'info');
        }

        const applySelectizeFilter = async (selectorOrLabel, values, isId = false) => {
            if (!values || values.length === 0) return;
            
            for (const val of values) {
                if (!val) continue;
                await logLive(`Attempting to set filter [${selectorOrLabel}]: ${val}`);
                
                try {
                    let controlSelector;
                    if (isId) {
                        // More robust selector for Selectize: target both possible patterns
                        controlSelector = `${selectorOrLabel} ~ .selectize-control .selectize-input, ${selectorOrLabel} + .selectize-control .selectize-input`;
                    } else {
                        // Fallback to label search
                        controlSelector = `//label[contains(text(), "${selectorOrLabel}")]/following-sibling::div//div[contains(@class, "selectize-input")]`;
                        // Or if directly in a div.col
                        if (await page.locator(`xpath=${controlSelector}`).count() === 0) {
                            controlSelector = `//label[contains(text(), "${selectorOrLabel}")]/parent::div//div[contains(@class, "selectize-input")]`;
                        }
                    }

                    const inputLoc = isId ? page.locator(controlSelector).first() : page.locator(`xpath=${controlSelector}`).first();
                    
                    // Force it to be visible by scrolling if needed
                    await inputLoc.scrollIntoViewIfNeeded();

                    if (await inputLoc.count() === 0 && !isId) {
                        // Try another label variant if first fails
                        await logLive(`Label [${selectorOrLabel}] not found, trying with comma variant...`);
                        const altPath = `//label[contains(text(), "${selectorOrLabel.replace('t', 'ț')}")]/following-sibling::div//div[contains(@class, "selectize-input")]`;
                        const altLoc = page.locator(`xpath=${altPath}`);
                        if (await altLoc.count() > 0) {
                            await altLoc.click();
                        } else {
                            throw new Error(`Control for ${selectorOrLabel} not found`);
                        }
                    } else {
                        // Check visibility but don't strictly wait if it's there
                        await inputLoc.click({ force: true });
                    }

                    await page.waitForTimeout(500);
                    
                    // Clear existing if any (programmatically for selectize)
                    await page.keyboard.press('Control+A');
                    await page.keyboard.press('Backspace');
                    
                    await page.keyboard.type(val, { delay: 150 });
                    await page.waitForTimeout(2000); // Wait longer for dropdown results
                    
                    // Listen for filter response
                    const filterResponsePromise = page.waitForResponse(r => 
                        r.url().includes('properties/filter') && r.status() === 200,
                        { timeout: 10000 }
                    ).catch(() => null);

                    await page.keyboard.press('Enter');
                    await filterResponsePromise;
                    await page.waitForTimeout(3000); // Wait for list to update
                    await logLive(`Filter applied successfully: ${val}`);

                } catch(e) {
                    await logLive(`Could not set filter ${val}: ${e.message}`, 'warn');
                    // Take screenshot on failure for debugging
                    try {
                        const shotPath = `filter_error_${selectorOrLabel}_${Date.now()}.png`;
                        await page.screenshot({ path: shotPath });
                        await logLive(`Screenshot saved as ${shotPath}`, 'info');
                    } catch(ss) {}
                }
            }
        };

        // Stadiu filter - The site allows only ONE stadiu at a time.
        // If user provided multiple, we'll only use the FIRST one for this page run.
        if (config.stadiu_filter && config.stadiu_filter.length > 0) {
            // Try both 'select#status' (blitz timely) and 'select#filter-status-eq' (older immoflux)
            try {
                if (await page.locator('select#status').count() > 0) {
                    await applySelectizeFilter('select#status', [config.stadiu_filter[0]], true);
                } else {
                    await applySelectizeFilter('select#filter-status-eq', [config.stadiu_filter[0]], true);
                }
            } catch(e) {
                await logLive(`Notice: Failed to set Stadiu filter with ID selectors: ${e.message}. Trying literal label "Stadiu"...`, 'info');
                await applySelectizeFilter('Stadiu', [config.stadiu_filter[0]], false);
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
                // Check if this property is already in Market Insights
                const { data: alreadyInInsights } = await activeSupabase
                    .from('market_insights')
                    .select('id')
                    .eq('original_url', url)
                    .maybeSingle();

                if (alreadyInInsights) {
                    totalSkipped++;
                    if (mode === 'watcher') {
                        await logLive('Watcher mode found existing Market Insight. Aborting batch.');
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
                    const root = panel || document;

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
                    result['usable_area'] = findFeature('Suprafata utila') || findFeature('Suprafata utilă') || findFeature('Suprafata teren') || findFeature('Suprafata');
                    result['year_built'] = findFeature('An constructie') || findFeature('Anul');

                    result['price'] = findValue('Pret tranzactionare') || findValue('Pret') || findValue('Preț final');
                    
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
                    result['description'] = getText(root.querySelector('.description, #description, .details-desc, .property-description, #notes'));

                    // Extract all images
                    const imgs = Array.from(root.querySelectorAll('img'))
                        .map(img => img.src)
                        .filter(src => src && (src.includes('approperties') || src.includes('property') || src.includes('imobum')) && !src.includes('base64'));
                    
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
                                usable_area: parseFloat(data.usable_area?.replace(',', '.')) || 0,
                                year_built: parseInt(data.year_built) || 0,
                                city: data.city,
                                area: data.area,
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
