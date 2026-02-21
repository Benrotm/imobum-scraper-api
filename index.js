const express = require('express');
const cors = require('cors');
const { chromium } = require('playwright');
const { createWorker } = require('tesseract.js');
const { Jimp } = require('jimp');

const app = express();
app.use(cors());
app.use(express.json());

app.post('/api/scrape-advanced', async (req, res) => {
    const { url } = req.body;

    if (!url) {
        return res.status(400).json({ error: 'URL is required' });
    }

    try {
        console.log(`Starting Advanced Scrape for ${url}`);

        // Only run for publi24 currently as that's where the encrypted phone numbers live
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
                        // ignore json
                    } else if (contentType.includes('html') || contentType.includes('text')) {
                        const htmlStr = buffer.toString('utf8').trim();
                        if (htmlStr.startsWith('iVBOR')) {
                            phoneImageBuffer = Buffer.from(htmlStr, 'base64');
                        }
                    } else {
                        phoneImageBuffer = buffer;
                    }
                } catch (e) {
                    console.error('Failed to read image buffer:', e);
                }
            }
        });

        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

        const buttonSelector = '.show-phone-number button[data-action="phone"], button.btn-show-phone, #showPhone, #showPhoneBottom';
        const button = await page.$(buttonSelector);

        let owner_phone = null;

        if (button) {
            console.log('Found phone button, clicking...');
            await button.click();
            await page.waitForTimeout(2000);

            if (phoneImageBuffer) {
                console.log('Intercepted phone number PNG payload. Pre-processing image with Jimp...');
                const image = await Jimp.read(phoneImageBuffer);
                image.resize({ w: image.bitmap.width * 3 });
                image.invert();
                const processedBuffer = await image.getBuffer('image/png');

                console.log('Running Tesseract OCR...');
                const worker = await createWorker('eng');

                await worker.setParameters({
                    tessedit_char_whitelist: '0123456789',
                });

                const { data: { text } } = await worker.recognize(processedBuffer);
                await worker.terminate();

                const extractedDigits = text.replace(/[^0-9]/g, '');
                console.log('OCR Raw Text:', text.trim(), '| Digits:', extractedDigits);

                if (extractedDigits.length >= 8) {
                    if (extractedDigits.length === 8) {
                        owner_phone = '07' + extractedDigits;
                    } else {
                        owner_phone = extractedDigits;
                    }
                }
            }
        }

        await browser.close();

        res.json({ owner_phone });

    } catch (error) {
        console.error('Advanced Scraping Error:', error);
        res.status(500).json({ error: error.message });
    }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Scraper Microservice listening on port ${PORT}`);
});
