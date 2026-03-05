const { chromium } = require('playwright');

async function testFluxSessionMutation() {
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

    console.log('Navigating to properties to acquire CSRF...');
    await page.goto('https://fluxmls.immoflux.ro/properties', { waitUntil: 'networkidle' });

    console.log('Injecting session mutation fetch to /properties/filter ...');
    // First let's try pushing it to /properties
    await page.evaluate(async () => {
        const formData = new FormData();
        formData.append('filter_county_id__eq', '38');
        formData.append('_token', document.querySelector('meta[name="csrf-token"]').getAttribute('content'));

        const headers = { 'X-Requested-With': 'XMLHttpRequest' };

        await fetch('https://fluxmls.immoflux.ro/properties/filter', {
            method: 'POST',
            body: formData,
            headers
        });
    });

    console.log('Waiting 2 seconds for Laravel session update...');
    await new Promise(r => setTimeout(r, 2000));

    console.log('Reloading properties natively...');
    await page.goto('https://fluxmls.immoflux.ro/properties', { waitUntil: 'networkidle' });

    let rawHtml = await page.content();
    console.log(`Contains Timis? ${rawHtml.includes('Timisoara') || rawHtml.includes('Timis')}`);
    console.log(`Contains Bucuresti? ${rawHtml.includes('Bucuresti')}`);
    const numCards = await page.evaluate(() => document.querySelectorAll('tr').length);
    console.log(`Rows: ${numCards}`);

    await browser.close();
}

testFluxSessionMutation().catch(console.error);
