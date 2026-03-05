const { chromium } = require('playwright');
const fs = require('fs');

async function testHeadlessClick() {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();

    console.log('Logging in to fluxmls...');
    await page.goto('https://fluxmls.immoflux.ro/login');

    try {
        await page.fill('#inputEmail', 'alexandru.nanu@remax.ro');
        await page.fill('#inputPassword', 'uZY5CeALTRV5heH');
        await Promise.all([
            page.waitForNavigation({ waitUntil: 'networkidle' }),
            page.click('button[type="submit"]')
        ]);
        console.log('Logged in.');
    } catch (e) { }

    console.log('Navigating to properties...');
    await page.goto('https://fluxmls.immoflux.ro/properties', { waitUntil: 'networkidle' });

    console.log('Opening filter wrapper...');
    const filterBtn = 'a.btn-icon.btn-primary.btn-outline[href="#filter-wrapper"]';
    await page.waitForSelector(filterBtn);
    await page.click(filterBtn);

    console.log('Clicking Judet Selectize...');
    const countySelectize = 'select#filter-county-id-eq + .selectize-control .selectize-input';
    await page.waitForSelector(countySelectize);
    await Promise.all([
        page.click(countySelectize),
        page.waitForSelector('.selectize-dropdown-content')
    ]);

    console.log('Typing Timis and pressing Enter...');
    // We will listen for the /properties/filter AJAX response
    const filterResponsePromise = page.waitForResponse(response =>
        response.url().includes('properties/filter') && response.status() === 200
    );

    await page.keyboard.type('Timis', { delay: 100 });
    await page.waitForTimeout(500); // Wait for dropdown to filter
    await page.keyboard.press('Enter');

    console.log('Waiting for AJAX filter to resolve...');
    await filterResponsePromise;

    console.log('AJAX completed. Evaluating results...');

    let rawHtml = await page.content();
    console.log(`Contains Timis? ${rawHtml.includes('TM Sanandrei') || rawHtml.includes('TM Timisoara')}`);
    console.log(`Contains Bucuresti? ${rawHtml.includes('Bucuresti')}`);
    const numCards = await page.evaluate(() => document.querySelectorAll('tr.model-item').length);
    console.log(`Rows: ${numCards}`);

    await browser.close();
}

testHeadlessClick().catch(console.error);
