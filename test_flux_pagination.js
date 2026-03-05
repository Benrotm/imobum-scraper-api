const { chromium } = require('playwright');
require('dotenv').config({ path: '../.env.local' });

(async () => {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });
    const page = await context.newPage();

    let immofluxUser = 'alexandru.nanu@remax.ro';
    let immofluxPass = 'uZY5CeALTRV5heH';

    await page.goto('https://fluxmls.immoflux.ro/login', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#inputEmail', { timeout: 10000 });
    await page.type('#inputEmail', immofluxUser);
    await page.type('#inputPassword', immofluxPass);

    await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle' }).catch(() => { }),
        page.click('button[type="submit"]')
    ]);

    await page.goto('https://fluxmls.immoflux.ro/properties', { waitUntil: 'networkidle' });

    await page.click('a.btn-icon.btn-primary.btn-outline[href="#filter-wrapper"]');
    await page.waitForSelector('select#filter-county-id-eq + .selectize-control .selectize-input input');
    await page.click('select#filter-county-id-eq + .selectize-control .selectize-input input');
    await page.waitForTimeout(1000);
    await page.keyboard.type('timis', { delay: 100 });
    await page.waitForTimeout(1000);

    let responsePromise = page.waitForResponse(r => r.url().includes('properties/filter') && r.status() === 200, { timeout: 15000 }).catch(() => null);
    await page.keyboard.press('Enter');
    await responsePromise;
    await page.waitForTimeout(1500);

    // TEST DYNAMIC PAGINATION MUTATION TO PAGE 15
    console.log("Mutating a pagination link to fetch page 15...");
    const page15Promise = page.waitForResponse(r => r.url().includes('properties/filter') && r.status() === 200, { timeout: 15000 }).catch(() => null);

    await page.evaluate(() => {
        const link = document.querySelector('.pagination li a');
        if (link) {
            link.setAttribute('href', 'https://fluxmls.immoflux.ro/properties/filter?page=15');
            link.click();
        }
    });

    await page15Promise;
    await page.waitForTimeout(2000);

    // See if the URL stayed on properties (good) or crashed to properties/filter (bad)
    console.log("URL AFTER MUTATION: ", page.url());

    // Dump actual active elements
    const pg = await page.evaluate(() => {
        const active = document.querySelector('li.active');
        const firstRow = document.querySelector('tbody tr td:nth-child(2)');
        return {
            active_html: active ? active.innerHTML : 'No .active class found on li',
            first_property_id: firstRow ? firstRow.innerText.trim() : 'No properties found'
        }
    });
    console.log("POST-MUTATION DOM:", pg);

    await browser.close();
})();
