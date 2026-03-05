const { chromium } = require('playwright');

async function testFilter() {
    console.log('Launching browser...');
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();

    console.log('Navigating to login...');
    await page.goto('https://fluxmls.immoflux.ro/login');

    console.log('Logging in...');
    await page.waitForSelector('#inputEmail', { timeout: 10000 });
    await page.type('#inputEmail', 'r.vlad@renet.ro');
    await page.type('#inputPassword', 'renet123');
    await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle' }),
        page.click('button[type="submit"]')
    ]);

    console.log('Logged in. Setting Judet filter to Timis (38) via POST...');

    // Execute POST fetch in the browser context to set the session filter
    const searchResponse = await page.evaluate(async () => {
        const formData = new FormData();
        formData.append('filter_county_id__eq', '38');
        // Might need CSRF token, let's see if the page has one
        const csrfToken = document.querySelector('meta[name="csrf-token"]')?.getAttribute('content');

        const headers = { 'X-Requested-With': 'XMLHttpRequest' };
        if (csrfToken) headers['X-CSRF-TOKEN'] = csrfToken;

        const res = await fetch('https://fluxmls.immoflux.ro/search', {
            method: 'POST',
            body: formData,
            headers: headers
        });
        return { status: res.status, url: res.url };
    });

    console.log('Search POST response:', searchResponse);

    console.log('Navigating to properties...');
    await page.goto('https://fluxmls.immoflux.ro/properties');
    await page.waitForTimeout(3000);

    // Extract total properties text to verify it's filtered
    const totalProps = await page.evaluate(() => {
        const span = document.querySelector('.pagination-info, .dataTables_info, span.text-muted');
        const text = span ? span.innerText : document.body.innerText.substring(0, 500);

        // Let's also grab the first property's city/zone to be sure
        const firstZone = document.querySelector('.property-show-zone')?.innerText || 'None';
        return { text, firstZone };
    });

    console.log('--- Verification ---');
    console.log('Summary Text:', totalProps.text);
    console.log('First Property Zone:', totalProps.firstZone);

    await browser.close();
}

testFilter().catch(console.error);
