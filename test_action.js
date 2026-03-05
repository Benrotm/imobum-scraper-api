const { chromium } = require('playwright');

async function testDropdown() {
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

    console.log('Navigating to properties...');
    await page.goto('https://fluxmls.immoflux.ro/properties', { waitUntil: 'networkidle' });

    // Attempt clicking 'Timis' via UI strictly to see the Next URL it reloads to:
    console.log('Finding form actions...');
    const result = await page.evaluate(() => {
        const select = document.querySelector('select[name="filter_county_id__eq"]');
        if (!select) return 'No select';

        return {
            formAction: select.form ? select.form.action : 'No form',
            formMethod: select.form ? select.form.method : 'No method',
            allForms: Array.from(document.forms).map(f => ({ action: f.action, method: f.method, id: f.id }))
        };
    });

    console.log('Form details = ', result);

    await browser.close();
}

testDropdown().catch(console.error);
