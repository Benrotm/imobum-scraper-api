const { chromium } = require('playwright');

async function findGetUrl() {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();

    let redirectedUrl = '';

    page.on('response', response => {
        // If the server returns a 302/301 redirect after a POST, log it
        if ([301, 302, 303, 307, 308].includes(response.status())) {
            const location = response.headers()['location'];
            if (location && location.includes('properties')) {
                redirectedUrl = location;
            }
        }
    });

    console.log('Logging in...');
    await page.goto('https://fluxmls.immoflux.ro/login');
    await page.fill('#inputEmail', 'alexandru.nanu@remax.ro');
    await page.fill('#inputPassword', '12345678');
    await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle' }),
        page.click('button[type="submit"]')
    ]);

    await page.goto('https://fluxmls.immoflux.ro/properties', { waitUntil: 'networkidle' });

    console.log('Using evaluate to submit the physical form on the page...');
    const formSubmitUrl = await page.evaluate(async () => {
        let select = document.querySelector('select[name="filter_county_id__eq"]');
        if (!select) return 'No Select Found';

        select.value = '38'; // Set Timis

        // Find the form and trigger a submit programmatically
        if (select.form) {
            const btn = select.form.querySelector('button[type="submit"]') || select.form.querySelector('input[type="submit"]');
            if (btn) btn.click();
            else select.form.submit();
            return 'Form submitted';
        }
        return 'No form wrapper';
    });

    console.log('Evaluate result:', formSubmitUrl);

    // Wait for the resulting navigation
    try {
        await page.waitForNavigation({ waitUntil: 'networkidle', timeout: 8000 });
    } catch (e) { }

    console.log('Active browser URL after submit:', page.url());
    console.log('302 Redirect Location Header:', redirectedUrl);

    await browser.close();
}

findGetUrl().catch(console.error);
