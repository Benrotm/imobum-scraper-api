const { chromium } = require('playwright');
const fs = require('fs');

async function dump() {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const creds = JSON.parse(fs.readFileSync('.immoflux_creds.json'));
    
    await page.goto('https://blitz.immoflux.ro/login');
    await page.fill('input[name="email"]', creds.u);
    await page.fill('input[name="password"]', creds.p);
    await page.click('button[type="submit"]');
    await page.waitForNavigation();
    
    await page.goto('https://blitz.immoflux.ro/properties');
    await page.waitForSelector('a[href="#filter-wrapper"]');
    
    // Open filter if needed
    const filterWrapper = page.locator('#filter-wrapper');
    const box = await filterWrapper.boundingBox();
    if (!box || box.height < 10) {
        await page.click('a[href="#filter-wrapper"]');
        await page.waitForTimeout(2000);
    }
    
    const html = await page.evaluate(() => document.querySelector('#filter-wrapper').outerHTML);
    fs.writeFileSync('filter_wrapper_dump.html', html);
    console.log('Dumped to filter_wrapper_dump.html');
    
    await browser.close();
}

dump().catch(console.error);
