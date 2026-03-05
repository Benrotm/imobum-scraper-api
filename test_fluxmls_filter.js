const { chromium } = require('playwright');
const fs = require('fs');

async function testFilterEndpoint() {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();

    console.log('Logging in to fluxmls.immoflux.ro...');
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

    // Test the filter endpoint using GET
    console.log('GET to /properties/filter...');
    await page.goto('https://fluxmls.immoflux.ro/properties/filter?filter_county_id__eq=38&page=1', { waitUntil: 'networkidle' });

    let rawHtml = await page.content();
    fs.writeFileSync('fluxmls_filter_get.html', rawHtml);
    console.log(`GET Method - Timis found? ${rawHtml.includes('Timisoara') || rawHtml.includes('Timis')}`);
    console.log(`GET Method - Bucuresti found? ${rawHtml.includes('Bucuresti')}`);

    await browser.close();
}

testFilterEndpoint().catch(console.error);
