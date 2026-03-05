const { chromium } = require('playwright');

async function testQueryParam() {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();

    console.log('Logging in...');
    await page.goto('https://fluxmls.immoflux.ro/login');
    await page.fill('#inputEmail', 'alexandru.nanu@remax.ro');
    await page.fill('#inputPassword', '12345678');
    await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle' }),
        page.click('button[type="submit"]')
    ]);

    const targetUrl = 'https://fluxmls.immoflux.ro/properties?filter_county_id__eq=38';
    console.log('Navigating directly to:', targetUrl);

    await page.goto(targetUrl, { waitUntil: 'networkidle' });

    // Check if properties from other regions exist
    const results = await page.evaluate(() => {
        const text = document.body.innerText;
        return {
            hasBucuresti: text.includes('Bucuresti'),
            hasMamaia: text.includes('Mamaia'),
            hasTimis: text.includes('Timis'),
            htmlSample: text.substring(0, 300)
        };
    });

    console.log('Filter Evaluation Result:', results);

    await browser.close();
}

testQueryParam().catch(console.error);
