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

                        // 2. Get location from breadcrumbs or location text
                        const breadcrumbs = [];
                        document.querySelectorAll('li[data-testid="breadcrumb-item"] a, ol li a').forEach(a => {
                                const text = a.textContent?.trim();
                                if (text && text !== 'Pagina principala' && text !== 'OLX') breadcrumbs.push(text);
                        });
                        // Breadcrumbs pattern: ["Imobiliare", "Apartamente...", "2 camere", "Timis", "Timisoara"]
                        for (const bc of breadcrumbs) {
                                if (bc.match(/^[A-Z][a-z]+$/)) {
                                        if (!extracted.county) extracted.county = bc;
                                        else if (!extracted.city) extracted.city = bc;
                                }
                        }

                        // Also try the location line in the page
                        const locEl = document.querySelector('[data-testid="map-link-text"], .css-1cju8pu');
                        if (locEl) {
                                const locText = locEl.textContent?.trim() || '';
                                // Format: "Timisoara, Timis" or similar
                                const locParts = locText.split(',').map(s => s.trim());
                                if (locParts.length >= 1 && !extracted.city) extracted.city = locParts[0];
                                if (locParts.length >= 2 && !extracted.county) extracted.county = locParts[1];
                        }

                        extracted.address = [extracted.city, extracted.county].filter(Boolean).join(', ');

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

                        // 4. Get rooms from breadcrumb if not found in params
                        if (!params.rooms) {
                                for (const bc of breadcrumbs) {
                                        const m = bc.match(/(\d+)\s*camer/);
                                        if (m) { params.rooms = m[1]; break; }
                                }
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

                // 5. Try to extract phone number
                try {
                        const phoneBtn = detailPage.locator('button:has-text("Afișează"), button:has-text("Arata"), a[data-testid*="phone"], button[data-testid*="phone"]');
                        if (await phoneBtn.isVisible({ timeout: 3000 })) {
                                await phoneBtn.click();
                                await detailPage.waitForTimeout(2000);
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
        const { categoryUrl, webhookUrl, jobId, pagesToScrape = 1, delayMs = 12000, supabaseUrl: reqSupabaseUrl, supabaseKey: reqSupabaseKey } = req.body;

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
                await logLive(`Pages to Scrape: ${pagesToScrape} | Delay between hits: ${delayMs}ms`);

                const browser = await chromium.launch({
                        headless: true,
                        args: ['--disable-blink-features=AutomationControlled', '--no-sandbox', '--disable-setuid-sandbox']
                });
                const context = await browser.newContext({
                        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                });

                // Detect which site we're scraping
                const isOlx = categoryUrl.includes('olx.ro');
                const isPubli24 = categoryUrl.includes('publi24.ro');
                await logLive(`Site detected: ${isOlx ? 'OLX.ro' : isPubli24 ? 'Publi24.ro' : 'Unknown'}`);

                let totalProcessed = 0;
                let totalSkipped = 0;

                for (let pageNum = 1; pageNum <= pagesToScrape; pageNum++) {
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

                        // Extract all property links (site-specific selectors)
                        const linkSelector = isOlx ? 'a[href*="/d/oferta/"]' : 'a[href*="/anunt/"]';
                        const hrefs = await page.evaluate((sel) => {
                                return Array.from(document.querySelectorAll(sel)).map(a => a.href);
                        }, linkSelector);

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
                                        }
                                }
                        } else {
                                newUrls.push(...uniqueUrls);
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
                                        // === OLX.RO EXTRACTION ===
                                        try {
                                                const detailPage = await context.newPage();
                                                await detailPage.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

                                                const olxData = await extractOlxDetailData(detailPage, logLive);
                                                extractedLocation = olxData.location;
                                                extractedPhone = olxData.phone;

                                                await detailPage.close();
                                                if (extractedPhone) {
                                                        await logLive(`OLX Phone extracted: ${extractedPhone}`, 'success');
                                                } else {
                                                        await logLive(`No phone found for OLX listing`, 'warn');
                                                }
                                        } catch (olxErr) {
                                                await logLive(`OLX extraction error: ${olxErr.message}`, 'warn');
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
                                        await logLive(`Sleeping for ${delayMs / 1000}s to avoid IP ban...`);
                                        await delay(delayMs);
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

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
        console.log(`Scraper API listening on port ${PORT}`);
});
