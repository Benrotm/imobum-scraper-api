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

                let totalProcessed = 0;
                let totalSkipped = 0;

                for (let pageNum = 1; pageNum <= pagesToScrape; pageNum++) {
                        if (await isJobStopped()) {
                                await logLive('Job was stopped by user. Aborting crawler.', 'warn');
                                break;
                        }

                        const page = await context.newPage();
                        // Handle publi24 pagination query
                        const targetUrl = new URL(categoryUrl);
                        if (pageNum > 1) targetUrl.searchParams.set('pag', pageNum.toString());

                        await logLive(`Crawling Page ${pageNum}: ${targetUrl.toString()}`);
                        await page.goto(targetUrl.toString(), { waitUntil: 'load', timeout: 30000 });
                        await page.waitForTimeout(2000); // Let JS render listings

                        // Extract all property links
                        const hrefs = await page.evaluate(() => {
                                return Array.from(document.querySelectorAll('a[href*="/anunt/"]')).map(a => a.href);
                        });

                        const uniqueUrls = [...new Set(hrefs)];
                        await logLive(`Found ${uniqueUrls.length} links on Page ${pageNum}. Filtering duplicates...`);

                        await page.close();

                        // Filter against Supabase
                        const newUrls = [];
                        if (supabase) {
                                for (const url of uniqueUrls) {
                                        const { data, error } = await supabase
                                                .from('scraped_urls')
                                                .select('url')
                                                .eq('url', url)
                                                .single();

                                        if (!data && !error) { // Postgres handles empty result as error 'No rows found' sometimes, but just in case
                                                newUrls.push(url);
                                        } else if (error && error.code === 'PGRST116') { // Postgres "No rows found" error code
                                                newUrls.push(url);
                                        } else {
                                                totalSkipped++;
                                        }
                                }
                        } else {
                                newUrls.push(...uniqueUrls);
                        }

                        await logLive(`Filtered down to ${newUrls.length} NEW properties to inject.`);

                        // Loop and send to Webhook (with phone extraction)
                        for (const url of newUrls) {
                                if (await isJobStopped()) {
                                        await logLive('Job was stopped by user mid-page. Aborting.', 'warn');
                                        break;
                                }

                                await logLive(`Extracting phone from ${url}...`);
                                let extractedPhone = null;
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

                                        // Check if phone is already visible in plain text
                                        const plainPhone = await detailPage.evaluate(() => {
                                                const btn = document.querySelector('.show-phone-number button[data-action="phone"], button.btn-show-phone, #showPhone, #showPhoneBottom');
                                                if (btn && btn.innerText.match(/\d{9,}/)) return btn.innerText.trim();
                                                return null;
                                        });

                                        if (plainPhone) {
                                                extractedPhone = plainPhone.replace(/\D/g, '');
                                        } else {
                                                // Click the "show phone" button to trigger the encrypted image load
                                                try {
                                                        const btnSelector = '.show-phone-number button[data-action="phone"], button.btn-show-phone, #showPhone, #showPhoneBottom';
                                                        await detailPage.waitForSelector(btnSelector, { timeout: 5000 });
                                                        await detailPage.click(btnSelector, { force: true });
                                                } catch (e) { }

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
                                                                const digits = text.replace(/\D/g, '');
                                                                if (digits.length >= 9) extractedPhone = digits;
                                                        } catch (ocrErr) {
                                                                await logLive(`OCR failed for ${url}: ${ocrErr.message}`, 'warn');
                                                        }
                                                } else {
                                                        // Fallback: check button text after click
                                                        const postClickPhone = await detailPage.evaluate(() => {
                                                                const btn = document.querySelector('.show-phone-number button[data-action="phone"], button.btn-show-phone, #showPhone, #showPhoneBottom');
                                                                return btn ? btn.innerText.replace(/\D/g, '') : null;
                                                        });
                                                        if (postClickPhone && postClickPhone.length >= 9) extractedPhone = postClickPhone;
                                                }
                                        }

                                        await detailPage.close();
                                        if (extractedPhone) {
                                                await logLive(`Phone extracted: ${extractedPhone}`, 'success');
                                        } else {
                                                await logLive(`No phone found for this listing`, 'warn');
                                        }
                                } catch (phoneErr) {
                                        await logLive(`Phone extraction error: ${phoneErr.message}`, 'warn');
                                }

                                await logLive(`Dispatching ${url} to MLS Webhook...`);
                                try {
                                        const res = await fetch(webhookUrl, {
                                                method: 'POST',
                                                headers: { 'Content-Type': 'application/json' },
                                                body: JSON.stringify({ url, phoneNumber: extractedPhone })
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
