const { chromium } = require('playwright');

async function debugFilter() {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();

    console.log('Logging in...');
    await page.goto('https://fluxmls.immoflux.ro/login');
    await page.fill('#inputEmail', 'alexandru.nanu@remax.ro');
    await page.fill('#inputPassword', '12345678'); // User's password from the settings UI screenshot
    await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle' }),
        page.click('button[type="submit"]')
    ]);

    console.log('Logged in. Navigating to properties...');
    await page.goto('https://fluxmls.immoflux.ro/properties', { waitUntil: 'networkidle' });

    console.log('Applying filter via evaluate...');
    const result = await page.evaluate(async () => {
        const formData = new FormData();
        formData.append('filter_county_id__eq', '38');

        const csrfToken = document.querySelector('meta[name="csrf-token"]')?.getAttribute('content');
        const headers = { 'X-Requested-With': 'XMLHttpRequest' };
        if (csrfToken) headers['X-CSRF-TOKEN'] = csrfToken;

        try {
            const res = await fetch('https://fluxmls.immoflux.ro/search', {
                method: 'POST',
                body: formData,
                headers: headers
            });
            const text = await res.text();

            // Re-fetch the layout to see if it changed
            const res2 = await fetch('https://fluxmls.immoflux.ro/properties', { headers });
            const html = await res2.text();

            return {
                status: res.status,
                responseTextHeader: text.substring(0, 500),
                propertiesHtmlCheck: html.includes('Mamaia') ? 'Still contains Mamaia' : (html.includes('Timis') ? 'Filtered successfully' : 'Unknown results')
            };
        } catch (e) {
            return { error: e.message };
        }
    });

    console.log('Filter application result:', result);

    await browser.close();
}

debugFilter().catch(console.error);
