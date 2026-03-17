const { chromium } = require('playwright');
require('dotenv').config({ path: '../.env.local' });

(async () => {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();
    
    // Login
    await page.goto('https://immoflux.ro/login');
    await page.fill('input[type="email"]', process.env.NEXT_PUBLIC_IMMOFLUX_EMAIL);
    await page.fill('input[type="password"]', process.env.NEXT_PUBLIC_IMMOFLUX_PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForTimeout(3000);

    // Go to the first URL from our recent list
    const url = "https://blitz.immoflux.ro/properties/163466/slidepanel"; // or any
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.waitForTimeout(5000);

    const extracted = await page.evaluate(() => {
        const getText = (el) => el ? el.textContent.trim().replace(/\s+/g, ' ') : '';
        const allElems = Array.from(document.querySelectorAll('*'));
        
        let found = [];
        for (let el of allElems) {
            const txt = el.textContent || '';
            if (txt.toLowerCase().includes('zile') && txt.toLowerCase().includes('piat')) {
                found.push({
                    tag: el.tagName,
                    text: getText(el),
                    html: el.outerHTML.substring(0, 100)
                });
            }
        }
        return found;
    });

    console.log("Extracted elements related to 'zile piata':", extracted);
    await browser.close();
})();
