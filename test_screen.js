const { chromium } = require('playwright');
const fs = require('fs');

async function takeScreenshot() {
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

    await page.goto('https://fluxmls.immoflux.ro/properties', { waitUntil: 'networkidle' });
    console.log('Taking screenshot...');
    await page.screenshot({ path: 'flux_props.png', fullPage: true });

    let html = await page.content();
    fs.writeFileSync('flux_props.html', html);
    console.log('Done');
    await browser.close();
}

takeScreenshot().catch(console.error);
