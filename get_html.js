const { chromium } = require('playwright');
const fs = require('fs');
const creds = JSON.parse(fs.readFileSync('.immoflux_creds.json', 'utf8'));

(async () => {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
        await page.goto('https://blitz.immoflux.ro/approperties', { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('#inputEmail');
        await page.type('#inputEmail', creds.u);
        await page.type('#inputPassword', creds.p);
        await Promise.all([
            page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
            page.click('button[type="submit"]')
        ]);
        await page.goto('https://blitz.immoflux.ro/ap/slidepanel/913729', { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(3000); // 3 seconds for slidepanel content
        const html = await page.content();
        fs.writeFileSync('immoflux_slidepanel.html', html);
        console.log('Saved HTML successfully.');
    } catch (e) { console.error(e); } finally { await browser.close(); }
})();
