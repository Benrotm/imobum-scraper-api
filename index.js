const express = require('express');
const cors = require('cors');
const { chromium } = require('playwright');
const { createWorker } = require('tesseract.js');
const { Jimp } = require('jimp');

const app = express();
app.use(cors());
app.use(express.json());

const { createClient } = require('@supabase/supabase-js');

// Initialize Supabase if env vars are present (passed by Render)
const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase = (supabaseUrl && supabaseKey) ? createClient(supabaseUrl, supabaseKey) : null;

// Sleep utility
const delay = ms => new Promise(res => setTimeout(res, ms));

// === OLX Detail Page Extraction ===
async function extractOlxDetailData(detailPage, logLive) {
        const result = { phone: null, location: null };

        try {
                // Dismiss cookie/consent overlays
                try {
                        const consentBtn = detailPage.locator('#onetrust-accept-btn-handler, button[id*="accept"]');
                        if (await consentBtn.isVisible({ timeout: 3000 })) await consentBtn.click();
                } catch (e) { }

                await detailPage.evaluate(() => {
                        document.querySelectorAll('[id*="onetrust"], [id*="consent"], [class*="cookie"]').forEach(el => el.remove());
                        document.body.style.overflow = 'auto';
                });

                // Extract all data from the page
                const data = await detailPage.evaluate(() => {
                        const extracted = {
                                county: '', city: '', area: '', address: '',
                                latitude: null, longitude: null,
                                olxParams: {}
                        };

                        // 1. Get lat/lng from Google Maps link
                        const mapLinks = document.querySelectorAll('a[href*="maps.google.com"]');
                        for (const link of mapLinks) {
                                const match = link.href.match(/ll=([0-9.-]+),([0-9.-]+)/);
                                if (match) {
                                        extracted.latitude = parseFloat(match[1]);
                                        extracted.longitude = parseFloat(match[2]);
                                        break;
                                }
                        }

                        // 2. Get location from the LOCALITATE section on the page
                        // OLX DOM structure:
                        // <div class="css-154h6ve"> LOCALITATE
                        //   <div class="css-1pckxcn">
                        //     <p class="css-9pna1a">Mangalia 7A</p>
                        //     Timisoara
                        //   </div>
                        // </div>

                        // Strategy 1: Find LOCALITATE section directly
                        const allDivs = document.querySelectorAll('div');
                        for (const div of allDivs) {
                                const directText = Array.from(div.childNodes)
                                        .filter(n => n.nodeType === 3)
                                        .map(n => n.textContent?.trim())
                                        .filter(Boolean)
                                        .join('');
                                if (directText === 'LOCALITATE') {
                                        // Found the LOCALITATE heading div - look for address inside
                                        const innerDiv = div.querySelector('div');
                                        if (innerDiv) {
                                                // Get the <p> tag for street address
                                                const streetP = innerDiv.querySelector('p');
                                                if (streetP) extracted.area = streetP.textContent?.trim() || '';

                                                // Get the city text (it's a direct text node in innerDiv, not in <p>)
                                                const childNodes = Array.from(innerDiv.childNodes);
                                                for (const node of childNodes) {
                                                        if (node.nodeType === 3) {
                                                                const txt = node.textContent?.trim();
                                                                if (txt && txt.length > 1) {
                                                                        extracted.city = txt;
                                                                }
                                                        }
                                                }
                                        }
                                        break;
                                }
                        }

                        // Strategy 2: Try data-testid selectors
                        if (!extracted.city) {
                                const locEl = document.querySelector('[data-testid="map-link-text"]');
                                if (locEl) {
                                        const locText = locEl.textContent?.trim() || '';
                                        const locParts = locText.split(/[,\-]/).map(s => s.trim()).filter(s => s);
                                        if (locParts.length >= 1) extracted.city = locParts[0];
                                        if (locParts.length >= 2) extracted.county = locParts[1];
                                }
                        }

                        // Strategy 3: Breadcrumbs (last resort, skip category words)
                        if (!extracted.city && !extracted.county) {
                                const categoryWords = ['imobiliare', 'apartamente', 'garsoniere', 'case', 'terenuri',
                                        'spatii', 'birouri', 'comerciale', 'de vanzare', 'de inchiriat',
                                        'vanzare', 'inchiriere', 'camere', 'camera', 'camer', 'pagina principala'];
                                const breadcrumbs = [];
                                document.querySelectorAll('li[data-testid="breadcrumb-item"] a, ol li a').forEach(a => {
                                        const text = a.textContent?.trim();
                                        if (text && text !== 'OLX') breadcrumbs.push(text);
                                });
                                const locationCandidates = breadcrumbs.filter(bc => {
                                        const lower = bc.toLowerCase();
                                        return !categoryWords.some(cw => lower.includes(cw))
                                                && !lower.match(/^\d+/)
                                                && bc.length > 2 && bc.length < 40;
                                });
                                // Breadcrumbs: ..."3 camere - Timis" / "3 camere - Timisoara"
                                // After filtering, we might get items like "Timis", "Timisoara"
                                for (const lc of locationCandidates) {
                                        // Try to extract county/city from "X camere - County" pattern
                                        const dashParts = lc.split('-').map(s => s.trim());
                                        const cleanPart = dashParts[dashParts.length - 1]; // Take the part after dash
                                        if (cleanPart && cleanPart.length > 2) {
                                                if (!extracted.county) extracted.county = cleanPart;
                                                else if (!extracted.city && cleanPart !== extracted.county) extracted.city = cleanPart;
                                        }
                                }
                        }

                        extracted.address = [extracted.area, extracted.city, extracted.county].filter(Boolean).join(', ');

                        // 3. Get params (Suprafata utila, Etaj, Compartimentare, An constructie)
                        const params = {};
                        document.querySelectorAll('p, li').forEach(el => {
                                const text = el.textContent?.trim() || '';
                                if (text.startsWith('Suprafata utila')) {
                                        const m = text.match(/([0-9]+)/);
                                        if (m) params.area_usable = m[1];
                                }
                                if (text.startsWith('Etaj')) {
                                        const m = text.match(/([0-9]+)/);
                                        if (m) params.floor = m[1];
                                }
                                if (text.startsWith('Compartimentare')) {
                                        params.partitioning = text.replace('Compartimentare:', '').replace('Compartimentare', '').trim();
                                }
                                if (text.startsWith('An constructie') || text.startsWith('An construcție')) {
                                        const m = text.match(/(\d{4})/);
                                        if (m) params.year_built = m[1];
                                        // Handle ranges like "Dupa 2000"
                                        if (!m && text.includes('Dupa')) {
                                                const r = text.match(/(\d{4})/);
                                                if (r) params.year_built = r[1];
                                        }
                                }
                                if (text.startsWith('Nr. camere') || text.match(/^\d+ camer/)) {
                                        const m = text.match(/([0-9]+)/);
                                        if (m) params.rooms = m[1];
                                }
                        });
                        extracted.olxParams = params;

                        // 4. Get rooms from breadcrumb text if not found in params
                        if (!params.rooms) {
                                document.querySelectorAll('li[data-testid="breadcrumb-item"] a, ol li a').forEach(a => {
                                        const text = a.textContent?.trim() || '';
                                        const m = text.match(/(\d+)\s*camer/);
                                        if (m && !params.rooms) params.rooms = m[1];
                                });
                        }

                        return extracted;
                });

                result.location = data;

                if (data.latitude && data.longitude) {
                        await logLive(`OLX Coords: ${data.latitude}, ${data.longitude}`, 'success');
                }
                if (data.address) {
                        await logLive(`OLX Location: ${data.address}`, 'success');
                }

                // 5. Try to extract phone: click "Suna vanzatorul" button, then read tel: link
                try {
                        // OLX phone button has data-cy="ad-contact-phone" or text "Suna vanzatorul"
                        const phoneBtn = detailPage.locator('[data-cy="ad-contact-phone"], [data-testid="ad-contact-phone"], button:has-text("Suna vanzatorul"), button:has-text("Suna Vanzatorul")').first();
                        if (await phoneBtn.isVisible({ timeout: 5000 })) {
                                await phoneBtn.click();
                                // Wait for phone number to appear (OLX reveals it after click)
                                await detailPage.waitForTimeout(3000);
                                // After click, phone number might appear as text
                                result.phone = await detailPage.evaluate(() => {
                                        // Look for phone links
                                        const phoneLinks = document.querySelectorAll('a[href^="tel:"]');
                                        for (const a of phoneLinks) {
                                                const num = a.href.replace('tel:', '').replace(/\D/g, '');
                                                if (num.length >= 9) return num;
                                        }
                                        // Look for text that looks like a phone number
                                        const allText = document.body.innerText;
                                        const phoneMatch = allText.match(/(?:07|\+407)\d{8}/);
                                        if (phoneMatch) return phoneMatch[0].replace(/\D/g, '');
                                        return null;
                                });
                        }
                } catch (phoneErr) {
                        await logLive(`OLX phone extraction failed: ${phoneErr.message}`, 'warn');
                }

        } catch (err) {
                await logLive(`OLX detail extraction error: ${err.message}`, 'warn');
        }

        return result;
}

app.post('/api/run-bulk-scrape', async (req, res) => {
        const { categoryUrl, webhookUrl, jobId, pageNum = 1, delayMin = 5, delayMax = 15, mode = 'history', proxyConfig, supabaseUrl: reqSupabaseUrl, supabaseKey: reqSupabaseKey } = req.body;

        const dynamicSupabaseUrl = reqSupabaseUrl || supabaseUrl;
        const dynamicSupabaseKey = reqSupabaseKey || supabaseKey;
        const activeSupabase = (dynamicSupabaseUrl && dynamicSupabaseKey) ? createClient(dynamicSupabaseUrl, dynamicSupabaseKey) : null;

        res.json({ message: 'Bulk scrape started. Processing in background.', categoryUrl, jobId });

        if (!categoryUrl || !webhookUrl) {
                console.error('Missing categoryUrl or webhookUrl');
                return;
        }

        // Helper to log to Supabase
        const logLive = async (message, level = 'info') => {
                console.log(`[Job ${jobId}] [${level}] ${message}`);
                if (activeSupabase && jobId) {
                        try {
                                await activeSupabase.from('scrape_logs').insert({ job_id: jobId, message, log_level: level });
                        } catch (e) {
                                console.error('Failed to write log to supabase:', e.message);
                        }
                }
        };

        // Helper to check if job is user-stopped
        const isJobStopped = async () => {
                if (!activeSupabase || !jobId) return false;
                try {
                        const { data } = await activeSupabase.from('scrape_jobs').select('status').eq('id', jobId).single();
                        return data?.status === 'stopped';
                } catch (e) {
                        return false;
                }
        };

        try {
                await logLive(`Starting Bulk Crawler on: ${categoryUrl}`);
                await logLive(`Target Page: ${pageNum} | Mode: ${mode} | Delay: ${delayMin}-${delayMax}s`);

                const launchOptions = {
                        headless: true,
                        args: ['--disable-blink-features=AutomationControlled', '--no-sandbox', '--disable-setuid-sandbox']
                };

                if (proxyConfig && proxyConfig.is_active && proxyConfig.host && proxyConfig.port) {
                        await logLive(`[PROXY CONNECT] Routing via ${proxyConfig.host}:${proxyConfig.port}`, 'info');
                        launchOptions.proxy = {
                                server: `http://${proxyConfig.host}:${proxyConfig.port}`
                        };
                        if (proxyConfig.username && proxyConfig.password) {
                                launchOptions.proxy.username = proxyConfig.username;
                                launchOptions.proxy.password = proxyConfig.password;
                        }
                }

                const browser = await chromium.launch(launchOptions);
                const context = await browser.newContext({
                        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                });

                // BANDWIDTH OPTIMIZATION: Block heavy media
                await context.route('**/*', (route) => {
                        const request = route.request();
                        const type = request.resourceType();
                        if (['image', 'media', 'font', 'stylesheet'].includes(type)) {
                                if (request.url().includes('PhoneNumberImages') || request.url().includes('Telefon')) {
                                        return route.continue();
                                }
                                return route.abort();
                        }
                        return route.continue();
                });

                // Detect which site we're scraping
                const isOlx = categoryUrl.includes('olx.ro');
                const isPubli24 = categoryUrl.includes('publi24.ro');
                await logLive(`Site detected: ${isOlx ? 'OLX.ro' : isPubli24 ? 'Publi24.ro' : 'Unknown'}`);

                let totalProcessed = 0;
                let totalSkipped = 0;
                let watcherAborted = false;

                // Process exactly ONE page per execution
                for (let run = 0; run < 1; run++) {
                        if (await isJobStopped()) {
                                await logLive('Job was stopped by user. Aborting crawler.', 'warn');
                                break;
                        }

                        const page = await context.newPage();
                        // Handle pagination per site
                        const targetUrl = new URL(categoryUrl);
                        if (pageNum > 1) {
                                if (isOlx) targetUrl.searchParams.set('page', pageNum.toString());
                                else targetUrl.searchParams.set('pag', pageNum.toString());
                        }

                        await logLive(`Crawling Page ${pageNum}: ${targetUrl.toString()}`);
                        await page.goto(targetUrl.toString(), { waitUntil: 'load', timeout: 30000 });
                        await page.waitForTimeout(2000); // Let JS render listings

                        // Extract all property links (site-specific strategy)
                        let hrefs;
                        if (isOlx) {
                                // OLX mixes native OLX listings + Storia.ro partner ads in the grid
                                // Use the card selector [data-cy="l-card"] to find ALL listing cards
                                try {
                                        await page.waitForSelector('[data-cy="l-card"]', { timeout: 10000 });
                                } catch (e) {
                                        await logLive('Warning: Could not find OLX card elements', 'warn');
                                }

                                // OLX lazy-loads listings: scroll down to ensure all cards are rendered
                                await logLive('Scrolling to load all OLX listings...');
                                let prevHeight = 0;
                                for (let scrollAttempt = 0; scrollAttempt < 10; scrollAttempt++) {
                                        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
                                        await page.waitForTimeout(1500);
                                        const newHeight = await page.evaluate(() => document.body.scrollHeight);
                                        if (newHeight === prevHeight) break;
                                        prevHeight = newHeight;
                                }
                                await page.evaluate(() => window.scrollTo(0, 0));
                                await page.waitForTimeout(500);

                                hrefs = await page.evaluate(() => {
                                        const links = [];
                                        // Get ALL listing cards (native OLX + Storia.ro partner ads)
                                        const cards = document.querySelectorAll('[data-cy="l-card"]');
                                        for (const card of cards) {
                                                // Grab the first link in each card (the listing URL)
                                                const link = card.querySelector('a');
                                                if (link && link.href && (link.href.includes('/d/') || link.href.includes('storia.ro'))) {
                                                        links.push(link.href);
                                                }
                                        }
                                        return links;
                                });
                        } else {
                                // Publi24: use the existing href pattern selector
                                hrefs = await page.evaluate(() => {
                                        return Array.from(document.querySelectorAll('a[href*="/anunt/"]')).map(a => a.href);
                                });
                        }

                        const uniqueUrls = [...new Set(hrefs)];
                        await logLive(`Found ${uniqueUrls.length} links on Page ${pageNum}. Filtering duplicates...`);

                        await page.close();

                        // Filter against Supabase
                        const newUrls = [];
                        if (activeSupabase) {
                                for (const url of uniqueUrls) {
                                        const { data, error } = await activeSupabase
                                                .from('scraped_urls')
                                                .select('url')
                                                .eq('url', url)
                                                .single();

                                        if (!data && !error) {
                                                newUrls.push(url);
                                        } else if (error && error.code === 'PGRST116') {
                                                newUrls.push(url);
                                        } else {
                                                totalSkipped++;
                                                if (mode === 'watcher') {
                                                        watcherAborted = true;
                                                        await logLive(`Watcher: Found existing property ${url}. Early aborting page.`, 'warn');
                                                        break;
                                                }
                                        }
                                }
                        } else {
                                newUrls.push(...uniqueUrls);
                        }

                        if (watcherAborted) {
                                break; // Break the outer loop
                        }

                        await logLive(`Filtered down to ${newUrls.length} NEW properties to inject.`);

                        // Loop and send to Webhook (with phone + location extraction)
                        for (const url of newUrls) {
                                if (await isJobStopped()) {
                                        await logLive('Job was stopped by user mid-page. Aborting.', 'warn');
                                        break;
                                }

                                await logLive(`Extracting phone & location from ${url}...`);
                                let extractedPhone = null;
                                let extractedLocation = null;

                                if (isOlx) {
                                        // === OLX.RO + STORIA.RO EXTRACTION ===
                                        // Both OLX native and Storia partner listings use similar DOM
                                        try {
                                                const detailPage = await context.newPage();
                                                await detailPage.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

                                                const olxData = await extractOlxDetailData(detailPage, logLive);
                                                extractedLocation = olxData.location;
                                                extractedPhone = olxData.phone;

                                                await detailPage.close();
                                                if (extractedPhone) {
                                                        await logLive(`Phone extracted: ${extractedPhone}`, 'success');
                                                } else {
                                                        await logLive(`No phone found for listing`, 'warn');
                                                }
                                        } catch (olxErr) {
                                                await logLive(`Detail extraction error: ${olxErr.message}`, 'warn');
                                        }
                                } else {
                                        // === PUBLI24 EXTRACTION (unchanged) ===
                                        try {
                                                const detailPage = await context.newPage();
                                                let phoneImageBuffer = null;

                                                detailPage.on('response', async (response) => {
                                                        if (response.url().includes('PhoneNumberImages') || response.url().includes('Telefon')) {
                                                                const contentType = response.headers()['content-type'] || '';
                                                                try {
                                                                        const buffer = await response.body();
                                                                        if (contentType.includes('json')) { /* ignore */ }
                                                                        else if (contentType.includes('html') || contentType.includes('text')) {
                                                                                const htmlStr = buffer.toString('utf8').trim();
                                                                                if (htmlStr.startsWith('iVBOR')) {
                                                                                        phoneImageBuffer = Buffer.from(htmlStr, 'base64');
                                                                                }
                                                                        } else {
                                                                                phoneImageBuffer = buffer;
                                                                        }
                                                                } catch (e) { }
                                                        }
                                                });

                                                await detailPage.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

                                                // Dismiss cookie overlay
                                                try {
                                                        const cookieBtn = detailPage.locator('#didomi-notice-agree-button');
                                                        if (await cookieBtn.isVisible({ timeout: 3000 })) await cookieBtn.click();
                                                } catch (e) { }
                                                await detailPage.evaluate(() => {
                                                        document.querySelectorAll('[id^="didomi"]').forEach(el => el.remove());
                                                        document.body.style.overflow = 'auto';
                                                });

                                                // === LOCATION EXTRACTION ===
                                                try {
                                                        extractedLocation = await detailPage.evaluate(() => {
                                                                const result = { county: '', city: '', area: '', address: '', latitude: null, longitude: null };

                                                                const showMapLink = document.querySelector('a#showMap');
                                                                if (showMapLink) {
                                                                        const parentP = showMapLink.parentElement;
                                                                        if (parentP) {
                                                                                const locationLinks = parentP.querySelectorAll('a.maincolor');
                                                                                const parts = [];
                                                                                locationLinks.forEach(link => {
                                                                                        const text = link.textContent ? link.textContent.trim() : '';
                                                                                        if (text) parts.push(text);
                                                                                });

                                                                                if (parts.length >= 1) result.county = parts[0];
                                                                                if (parts.length >= 2) result.city = parts[1];
                                                                                if (parts.length >= 3) result.area = parts[2];
                                                                                result.address = parts.join(', ');
                                                                        }
                                                                }

                                                                // Extract lat/lng from Publi24's embedded JavaScript variables
                                                                const scripts = document.querySelectorAll('script');
                                                                for (const script of scripts) {
                                                                        const text = script.textContent || '';
                                                                        const latMatch = text.match(/var\s+lat\s*=\s*([0-9.-]+)/);
                                                                        const lngMatch = text.match(/var\s+lng\s*=\s*([0-9.-]+)/);
                                                                        if (latMatch && lngMatch) {
                                                                                result.latitude = parseFloat(latMatch[1]);
                                                                                result.longitude = parseFloat(lngMatch[1]);
                                                                                break;
                                                                        }
                                                                }

                                                                return result;
                                                        });

                                                        if (extractedLocation && extractedLocation.address) {
                                                                let logMsg = `Location found: ${extractedLocation.address}`;
                                                                if (extractedLocation.latitude && extractedLocation.longitude) {
                                                                        logMsg += ` | Coords: ${extractedLocation.latitude}, ${extractedLocation.longitude}`;
                                                                }
                                                                await logLive(logMsg, 'success');
                                                        } else {
                                                                await logLive(`Could not extract location from page`, 'warn');
                                                        }
                                                } catch (locErr) {
                                                        await logLive(`Location extraction error: ${locErr.message}`, 'warn');
                                                }

                                                // === PHONE EXTRACTION ===
                                                const plainPhone = await detailPage.evaluate(() => {
                                                        const btn = document.querySelector('.show-phone-number button[data-action="phone"], button.btn-show-phone, #showPhone, #showPhoneBottom');
                                                        if (btn && btn.innerText.match(/\d{9,}/)) return btn.innerText.trim();
                                                        return null;
                                                });

                                                if (plainPhone) {
                                                        extractedPhone = plainPhone.replace(/\D/g, '');
                                                } else {
                                                        try {
                                                                const btn = detailPage.locator('.show-phone-number button[data-action="phone"], button.btn-show-phone, #showPhone, #showPhoneBottom');
                                                                if (await btn.isVisible({ timeout: 5000 })) {
                                                                        await btn.click({ force: true });
                                                                        await detailPage.waitForTimeout(3000);

                                                                        if (phoneImageBuffer) {
                                                                                try {
                                                                                        const image = await Jimp.read(phoneImageBuffer);
                                                                                        image.resize({ w: image.bitmap.width * 3 });
                                                                                        image.invert();
                                                                                        const processedBuffer = await image.getBuffer('image/png');
                                                                                        const worker = await createWorker('eng');
                                                                                        const { data: { text } } = await worker.recognize(processedBuffer);
                                                                                        await worker.terminate();
                                                                                        extractedPhone = text.replace(/\D/g, '');
                                                                                } catch (ocrErr) {
                                                                                        await logLive(`OCR error: ${ocrErr.message}`, 'warn');
                                                                                }
                                                                        }

                                                                        if (!extractedPhone || extractedPhone.length < 9) {
                                                                                const postClickPhone = await detailPage.evaluate(() => {
                                                                                        const btn = document.querySelector('.show-phone-number button[data-action="phone"], button.btn-show-phone, #showPhone, #showPhoneBottom');
                                                                                        return btn ? btn.innerText.replace(/\D/g, '') : null;
                                                                                });
                                                                                if (postClickPhone && postClickPhone.length >= 9) extractedPhone = postClickPhone;
                                                                        }
                                                                }
                                                        } catch (e) { }
                                                }

                                                await detailPage.close();
                                                if (extractedPhone) {
                                                        await logLive(`Phone extracted: ${extractedPhone}`, 'success');
                                                } else {
                                                        await logLive(`No phone found for this listing`, 'warn');
                                                }
                                        } catch (phoneErr) {
                                                await logLive(`Phone/Location extraction error: ${phoneErr.message}`, 'warn');
                                        }
                                } // end Publi24 extraction

                                await logLive(`Dispatching ${url} to MLS Webhook...`);
                                try {
                                        const res = await fetch(webhookUrl, {
                                                method: 'POST',
                                                headers: { 'Content-Type': 'application/json' },
                                                body: JSON.stringify({ url, phoneNumber: extractedPhone, location: extractedLocation })
                                        });

                                        const result = await res.json();
                                        if (res.ok && result.id) {
                                                await logLive(`Success! Webhook stored DB Row ${result.id}`, 'success');
                                                totalProcessed++;
                                        } else if (result.status === 'skipped') {
                                                await logLive(`Webhook ignored: URL already scraped successfully`, 'warn');
                                                totalSkipped++;
                                        } else {
                                                await logLive(`Webhook Failed: ${result.error || 'Unknown Error'}`, 'error');
                                        }

                                        // Safe delay to protect against IP bans
                                        const actualDelayMs = Math.floor(Math.random() * (delayMax - delayMin + 1) + delayMin) * 1000;
                                        await logLive(`Sleeping for ${actualDelayMs / 1000}s to avoid IP ban...`);
                                        await delay(actualDelayMs);
                                } catch (err) {
                                        await logLive(`Failed to dispatch ${url}: ${err.message}`, 'error');
                                }
                        }
                }

                await browser.close();

                let finalStatus = 'completed';
                if (await isJobStopped()) finalStatus = 'stopped';

                await logLive(`Crawler finished. Processed: ${totalProcessed} | Skipped: ${totalSkipped}. Status: ${finalStatus}`, 'info');

                // Mark job as completed
                if (supabase && jobId && finalStatus === 'completed') {
                        await supabase.from('scrape_jobs').update({ status: 'completed', completed_at: new Date() }).eq('id', jobId);
                }

        } catch (e) {
                console.error('Bulk Scrape Error:', e);
                if (supabase && jobId) {
                        await supabase.from('scrape_logs').insert({ job_id: jobId, message: `Fatal Error: ${e.message}`, log_level: 'error' });
                        await supabase.from('scrape_jobs').update({ status: 'failed', completed_at: new Date() }).eq('id', jobId);
                }
        }
});

app.post('/api/scrape-advanced', async (req, res) => {
        const { url } = req.body;

        if (!url) {
                return res.status(400).json({ error: 'URL is required' });
        }

        try {
                console.log(`Starting Advanced Scrape for ${url}`);

                if (!url.includes('publi24.ro')) {
                        return res.json({ message: 'URL not supported by advanced scraper' });
                }

                console.log('Launch Playwright for advanced extraction...');
                const browser = await chromium.launch({
                        headless: true,
                        args: [
                                '--disable-blink-features=AutomationControlled',
                                '--no-sandbox',
                                '--disable-setuid-sandbox'
                        ]
                });

                const context = await browser.newContext({
                        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                });

                // BANDWIDTH OPTIMIZATION: Block heavy media
                await context.route('**/*', (route) => {
                        const request = route.request();
                        const type = request.resourceType();
                        if (['image', 'media', 'font', 'stylesheet'].includes(type)) {
                                if (request.url().includes('PhoneNumberImages') || request.url().includes('Telefon')) {
                                        return route.continue();
                                }
                                return route.abort();
                        }
                        return route.continue();
                });

                const page = await context.newPage();

                let phoneImageBuffer = null;

                page.on('response', async (response) => {
                        if (response.url().includes('PhoneNumberImages') || response.url().includes('Telefon')) {
                                const contentType = response.headers()['content-type'] || '';
                                try {
                                        const buffer = await response.body();
                                        if (contentType.includes('json')) {
                                                // ignore
                                        } else if (contentType.includes('html') || contentType.includes('text')) {
                                                const htmlStr = buffer.toString('utf8').trim();
                                                if (htmlStr.startsWith('iVBOR')) {
                                                        phoneImageBuffer = Buffer.from(htmlStr, 'base64');
                                                }
                                        } else {
                                                phoneImageBuffer = buffer;
                                        }
                                } catch (e) { }
                        }
                });

                await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

                try {
                        const cookieButton = page.locator('#didomi-notice-agree-button');
                        if (await cookieButton.isVisible({ timeout: 5000 })) {
                                await cookieButton.click();
                        }
                } catch (e) { }

                // Forcefully remove any lingering cookie overlays that might intercept clicks
                await page.evaluate(() => {
                        const elements = document.querySelectorAll('[id^="didomi"]');
                        for (let el of elements) {
                                el.remove();
                        }
                        document.body.style.overflow = 'auto';
                });

                const buttonSelector = '.show-phone-number button[data-action="phone"], button.btn-show-phone, #showPhone, #showPhoneBottom';

                const phoneText = await page.evaluate(() => {
                        const btn = document.querySelector('.show-phone-number button[data-action="phone"], button.btn-show-phone, #showPhone, #showPhoneBottom');
                        if (btn && btn.innerText.match(/\d{9,}/)) {
                                return btn.innerText.trim();
                        }
                        return null;
                });

                if (phoneText) {
                        await browser.close();
                        return res.json({ phoneNumber: phoneText.replace(/\D/g, '') });
                }

                try {
                        await page.waitForSelector(buttonSelector, { timeout: 10000 });
                        await page.click(buttonSelector, { force: true });
                } catch (e) { }

                await page.waitForTimeout(3000);

                let finalPhone = null;

                if (phoneImageBuffer) {
                        const image = await Jimp.read(phoneImageBuffer);
                        image.resize({ w: image.bitmap.width * 3 });
                        image.invert();
                        const processedBuffer = await image.getBuffer('image/png');

                        const worker = await createWorker('eng');
                        const { data: { text } } = await worker.recognize(processedBuffer);
                        await worker.terminate();

                        finalPhone = text.replace(/\D/g, '');
                } else {
                        finalPhone = await page.evaluate(() => {
                                const btn = document.querySelector('.show-phone-number button[data-action="phone"], button.btn-show-phone, #showPhone, #showPhoneBottom');
                                return btn ? btn.innerText.replace(/\D/g, '') : null;
                        });
                }

                await browser.close();

                if (finalPhone && finalPhone.length >= 9) {
                        return res.json({ phoneNumber: finalPhone });
                } else {
                        return res.json({ error: 'Could not extract phone number' });
                }
        } catch (error) {
                return res.status(500).json({ error: error.message });
        }
});

// === DYNAMIC PARTNER AUTO-SCRAPER ===
app.post('/api/run-dynamic-scrape', async (req, res) => {
        const {
                categoryUrl, jobId, pageNum, delayMin, delayMax, mode, linkSelector, extractSelectors, proxyConfig,
                supabaseUrl: reqSupabaseUrl, supabaseKey: reqSupabaseKey, webhookBaseUrl,
                immofluxUser, immofluxPass
        } = req.body;

        if (!categoryUrl || !linkSelector || !extractSelectors) {
                return res.status(400).json({ error: 'Missing required dynamic parameters (categoryUrl, linkSelector, extractSelectors)' });
        }

        const currentSupabase = (reqSupabaseUrl && reqSupabaseKey) ? createClient(reqSupabaseUrl, reqSupabaseKey) : supabase;

        async function logLive(msg, level = 'info') {
                console.log(`[DYNAMIC-JOB ${jobId}] ${msg}`);
                if (currentSupabase && jobId) {
                        try {
                                await currentSupabase.from('scrape_logs').insert({ job_id: jobId, message: msg, log_level: level });
                        } catch (e) { console.error('Failed to save log to Supabase', e); }
                }
        }

        async function isJobStopped() {
                if (!currentSupabase || !jobId) return false;
                try {
                        const { data } = await currentSupabase.from('scrape_jobs').select('status').eq('id', jobId).single();
                        return data?.status === 'stopped';
                } catch (e) { return false; }
        }

        // Send early 200 to NextJS caller
        res.status(200).json({ status: 'Processing started in background' });

        try {
                // Construct target URL with pageNum
                const targetUrl = categoryUrl.includes('?') ? `${categoryUrl}&page=${pageNum}` : `${categoryUrl}?page=${pageNum}`;
                await logLive(`Booting Chrome cluster... Target: ${targetUrl}`, 'info');

                if (await isJobStopped()) {
                        await logLive('Job stopped before browser launch.', 'warn');
                        return;
                }

                const launchOptions = {
                        headless: true,
                        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled']
                };

                if (proxyConfig && proxyConfig.is_active && proxyConfig.host && proxyConfig.port) {
                        await logLive(`[PROXY CONNECT] Routing via ${proxyConfig.host}:${proxyConfig.port}`, 'info');
                        launchOptions.proxy = {
                                server: `http://${proxyConfig.host}:${proxyConfig.port}`
                        };
                        if (proxyConfig.username && proxyConfig.password) {
                                launchOptions.proxy.username = proxyConfig.username;
                                launchOptions.proxy.password = proxyConfig.password;
                        }
                }

                const browser = await chromium.launch(launchOptions);

                const context = await browser.newContext({
                        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                });

                // BANDWIDTH OPTIMIZATION: Block heavy media
                await context.route('**/*', (route) => {
                        const request = route.request();
                        const type = request.resourceType();
                        if (['image', 'media', 'font', 'stylesheet'].includes(type)) {
                                if (request.url().includes('PhoneNumberImages') || request.url().includes('Telefon')) {
                                        return route.continue();
                                }
                                return route.abort();
                        }
                        return route.continue();
                });

                const page = await context.newPage();

                await logLive('Navigating to Dynamic Partner Index...', 'info');
                await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });

                // Immoflux Auto-Login Interceptor
                if (page.url().includes('login') && immofluxUser && immofluxPass) {
                        await logLive(`Intercepted Login Firewall. Authenticating as ${immofluxUser}...`, 'info');
                        try {
                                await page.waitForSelector('#inputEmail', { timeout: 10000 });
                                await page.type('#inputEmail', immofluxUser);
                                await page.type('#inputPassword', immofluxPass);
                                await Promise.all([
                                        page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 30000 }),
                                        page.click('button[type="submit"]')
                                ]);
                                await logLive('Authentication successful.', 'success');
                                await logLive('Returning to target page after login...', 'info');
                                await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
                        } catch (authErr) {
                                await logLive(`Auto-login failed: ${authErr.message}`, 'error');
                        }
                }

                // Try to wait for the links to appear
                try {
                        await page.waitForSelector(linkSelector, { timeout: 10000 });
                } catch (e) {
                        await logLive(`WARNING: Link selector ${linkSelector} not found on page.`, 'warn');
                }

                const propertyUrls = await page.evaluate((selector) => {
                        const links = Array.from(document.querySelectorAll(selector));
                        let validHrefs = links.map(a => a.href).filter(href => href && href.startsWith('http'));

                        if (window.location.href.includes('immoflux.ro')) {
                                // Exclude all navigation, sidebar, internal logic, and pagination links
                                validHrefs = validHrefs.filter(href =>
                                        !href.includes('/auth/') &&
                                        !href.includes('/journal') &&
                                        !href.includes('/leads') &&
                                        !href.includes('/contacts') &&
                                        !href.includes('/reports') &&
                                        !href.includes('/settings') &&
                                        !href.includes('/frontnotifications') &&
                                        !href.includes('/pins') &&
                                        !href.includes('/agents/') &&
                                        !href.includes('/ansambluri') &&
                                        !href.includes('/cereri') &&
                                        !href.includes('/dashboard') &&
                                        !href.match(/\?page=\d+/) // exclude pagination
                                );
                        }

                        return Array.from(new Set(validHrefs));
                }, linkSelector);

                await browser.close();

                await logLive(`Discovered ${propertyUrls.length} links on page limit.`, 'info');

                if (propertyUrls.length === 0) {
                        await logLive(`Extraction halted. No listings found on page ${pageNum}.`, 'warn');
                        if (currentSupabase && jobId) {
                                await currentSupabase.from('scrape_jobs').update({ status: 'completed', completed_at: new Date() }).eq('id', jobId);
                        }
                        return;
                }

                let totalProcessed = 0;
                let totalSkipped = 0;

                for (let i = 0; i < propertyUrls.length; i++) {
                        if (await isJobStopped()) break;

                        const propUrl = propertyUrls[i];

                        // WATCHER FILTER LOGIC
                        if (currentSupabase) {
                                const { data: existingURL } = await currentSupabase
                                        .from('scraped_urls')
                                        .select('url')
                                        .eq('url', propUrl)
                                        .single();

                                if (existingURL) {
                                        totalSkipped++;
                                        if (mode === 'watcher') {
                                                await logLive(`[WATCHER MODE] Found existing URL (${propUrl}). Aborting cycle early!`, 'success');
                                                break; // Abort entire run!
                                        }
                                        await logLive(`Skipping duplicate URL ${i + 1}/${propertyUrls.length}`, 'warn');
                                        continue;
                                }
                        }

                        // Parse the actual property internally via NextJS 'scrape.ts' emulator
                        try {
                                const apiUrl = (reqSupabaseUrl || 'http://localhost:3000').replace('supabase.co', 'vercel.app'); // Heuristic guess

                                await logLive(`Parsing HTML for ${propUrl}...`, 'info');

                                // Call a new lightweight Next.js api endpoint we are about to create specifically for this bridge:
                                // POST /api/admin/headless-dynamic-import
                                const nextjsBase = webhookBaseUrl || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'; // Need actual host
                                const parseReq = await fetch(`${nextjsBase}/api/admin/headless-dynamic-import`, {
                                        method: 'POST',
                                        headers: { 'Content-Type': 'application/json' },
                                        body: JSON.stringify({
                                                url: propUrl,
                                                selectors: extractSelectors
                                        })
                                });

                                const parseRes = await parseReq.json();

                                if (parseRes && parseRes.success) {
                                        await logLive(`Successfully extracted and saved property: ${parseRes.title || propUrl}`, 'success');
                                        totalProcessed++;
                                } else {
                                        await logLive(`Failed processing ${propUrl}: ${parseRes?.error || 'Unknown'}`, 'error');
                                }

                                // Random Delay Anti-Ban
                                const dMin = parseInt(delayMin) || 5;
                                const dMax = parseInt(delayMax) || 15;
                                const actualDelayMs = Math.floor(Math.random() * (dMax - dMin + 1) + dMin) * 1000;
                                await logLive(`Rate Limit Shield: Sleeping ${actualDelayMs / 1000}s...`, 'info');
                                await delay(actualDelayMs);

                        } catch (err) {
                                await logLive(`Failed processing ${propUrl}: ${err.message}`, 'error');
                        }
                } // End loop

                let finalStatus = 'completed';
                if (await isJobStopped()) finalStatus = 'stopped';

                await logLive(`Dynamic Crawler finished. Processed: ${totalProcessed} | Skipped: ${totalSkipped}. Status: ${finalStatus}`, 'info');

                if (currentSupabase && jobId && finalStatus === 'completed') {
                        await currentSupabase.from('scrape_jobs').update({ status: 'completed', completed_at: new Date() }).eq('id', jobId);
                }

        } catch (e) {
                console.error('Dynamic Scrape Error:', e);
                await logLive(`Fatal Error: ${e.message}`, 'error');
                if (currentSupabase && jobId) {
                        await currentSupabase.from('scrape_jobs').update({ status: 'failed', completed_at: new Date() }).eq('id', jobId);
                }
        }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
        console.log(`Scraper API listening on port ${PORT}`);
});
