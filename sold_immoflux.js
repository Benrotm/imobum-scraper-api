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
        const filterBtn = 'a[href="#filter-wrapper"]';
        try {
            if (await page.locator(filterBtn).isVisible()) {
                 await page.click(filterBtn);
                 await page.waitForTimeout(1000);
            }
        } catch(e) {}

        const applySelectizeFilter = async (labelName, valuesToType) => {
            if (!valuesToType || valuesToType.length === 0) return;
            
            await logLive(`Applying filter for [${labelName}]: ${valuesToType.join(', ')}`);
            for (const val of valuesToType) {
                if (!val) continue;
                // Find label with exact text, then find the selectize input after it
                const selectizeInputPath = `//label[contains(text(), "${labelName}")]/following-sibling::div//div[contains(@class, "selectize-input")]/input`;
                
                try {
                    await page.click(selectizeInputPath);
                    await page.waitForTimeout(500);
                    
                    await page.keyboard.type(val, { delay: 50 });
                    await page.waitForTimeout(1000); // Wait for dropdown to populate
                    
                    // The site reloads via AJAX heavily. We intercept the network requests if needed, but Enter usually handles it.
                    await page.keyboard.press('Enter');
                    await page.waitForTimeout(2000); // Wait for the AJAX filter response
                } catch(e) {
                    await logLive(`Could not set filter ${val} for ${labelName}: ${e.message}`, 'warn');
                }
            }
        };

        if (config.stadiu_filter && config.stadiu_filter.length > 0) {
            await applySelectizeFilter('Stadiu', config.stadiu_filter);
        }
        if (config.region_filter) {
            await applySelectizeFilter('Judet', [config.region_filter]);
        }
        if (config.city_filter) {
            await applySelectizeFilter('Localitate', [config.city_filter]);
        }
        if (config.zone_filter) {
            await applySelectizeFilter('Zona', [config.zone_filter]);
        }

        await logLive(`Filters applied. Extracting listings on Page ${pageNum}...`);
        
        // Give time for list to rerender
        await page.waitForTimeout(3000);

        // Extract native listings from table
        // Tranzactionata / Pierduta might be greyed out, but they should be in the table
        const propertyLinks = await page.evaluate(() => {
            const links = document.querySelectorAll('tr.model-item[data-url], a.title-link[data-url], td.title-td[data-url]');
            const urls = [];
            for (const el of links) {
                const url = el.getAttribute('data-url') || el.href;
                if (url && url.includes('/approperties/') || url.includes('/property/')) {
                    const fullUrl = new URL(url, window.location.href).href;
                    urls.push(fullUrl);
                }
            }
            return [...new Set(urls)];
        });

        await logLive(`Found ${propertyLinks.length} URLs on the page.`);

        // Now, we need to extract from the POPUP by clicking them or direct navigation
        for (const url of propertyLinks) {
            if (await isJobStopped()) break;

            const existingCheck = await activeSupabase.from('scraped_urls').select('url').eq('url', url).maybeSingle();
            if (existingCheck.data) {
                totalSkipped++;
                if (mode === 'watcher') {
                    await logLive('Watcher mode found existing URL. Aborting batch.');
                    break;
                }
                continue;
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

                // Try to extract mapping fields
                popupData = await detailPage.evaluate((mapConfig) => {
                    const result = {};
                    // We iterate through every label-value pair in the standard Immoflux view
                    // Immoflux layouts: <dt>Label</dt><dd>Value</dd> OR <label>Label</label><span>Value</span> OR <th>Label</th><td>Value</td>
                    const allNodes = document.querySelectorAll('dt, label, th, td.text-muted, p, span.text-muted');
                    
                    const getText = (el) => el ? el.textContent.trim().replace(/\s+/g, ' ') : '';
                    
                    for (const node of allNodes) {
                        const labelText = getText(node);
                        if (!labelText) continue;

                        Object.keys(mapConfig).forEach(destKey => {
                            const expectedLabel = mapConfig[destKey];
                            if (expectedLabel && labelText.toLowerCase().includes(expectedLabel.toLowerCase())) {
                                // Find the subsequent value container depending on layout
                                let nextNode = node.nextElementSibling;
                                if (node.tagName === 'TH') {
                                    result[destKey] = getText(nextNode);
                                } else if (node.tagName === 'DT') {
                                    result[destKey] = getText(nextNode);
                                } else {
                                     // Might be parent's next sibling or direct next sibling
                                     const container = node.parentElement;
                                     if (container) {
                                         const valNode = node.nextElementSibling || container.querySelector('span:not(.text-muted), strong, p:not(.text-muted), div:not(.text-muted)');
                                         if (valNode) result[destKey] = getText(valNode);
                                     }
                                }
                            }
                        });
                        
                        // Special Hardcoded rules
                        if (labelText.toLowerCase().includes('zile pe piata') || labelText.toLowerCase().includes('days on market')) {
                            const valNode = node.nextElementSibling || node.parentElement.querySelector('strong, span, div:not([class])');
                            if (valNode) daysOnMarket = getText(valNode);
                        }
                    }

                    // Look for Days On Market specifically anywhere in DOM if not found
                    if (!result['days_on_market']) {
                         const match = document.body.innerText.match(/(\d+)\s*(zile pe piata|days on market)/i);
                         if (match) result['days_on_market'] = match[1];
                    }

                    // Extract all images from carousel
                    const imgs = Array.from(document.querySelectorAll('.owl-carousel img, .gallery img, .fotorama img')).map(img => img.src);
                    
                    // Title and Description
                    result['title'] = document.querySelector('h1, h2.title')?.textContent?.trim();
                    result['description'] = document.querySelector('.description, #description, .details-desc')?.textContent?.trim();
                    result['price'] = document.querySelector('.price, .text-price, .h3 span')?.textContent?.trim();

                    return { data: result, images: imgs };
                }, config.mapping || {});

                await detailPage.close();

                if (popupData) {
                    const { data, images: imgList } = popupData;
                    
                    // Transmit to NextJS webhook to store in Market Insights
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
                                title: data.title,
                                priceRaw: data.price,
                                description: data.description,
                                days_on_market: data.days_on_market,
                                status: 'Sold' // Marked for market insights explicitly
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
