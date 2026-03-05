const { chromium } = require('playwright');

async function dumpImmofluxForm() {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();

    console.log('Logging in...');
    await page.goto('https://immoflux.ro/login');
    await page.fill('#inputEmail', 'alexandru.nanu@remax.ro');
    await page.fill('#inputPassword', '12345678');
    await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle' }),
        page.click('button[type="submit"]')
    ]);

    console.log('Navigating to properties...');
    await page.goto('https://immoflux.ro/properties', { waitUntil: 'networkidle' });

    console.log('Dumping DOM around the county filter...');
    const results = await page.evaluate(() => {
        // Find ALL selects
        const selects = Array.from(document.querySelectorAll('select')).map(s => ({
            name: s.name,
            id: s.id,
            options: Array.from(s.options).map(o => o.text).join(', ').substring(0, 50)
        }));

        let countySelect = document.querySelector('select[name="filter_county_id__eq"]');
        let outerHTML = countySelect ? countySelect.outerHTML : 'county filter missing';

        // Find forms
        const form = document.querySelector('form.filter-form, form#filterForm') || document.forms[0];
        let formAction = form ? form.action : 'no form';

        return {
            selects,
            outerHTML,
            formAction,
            bodySample: document.body.innerText.substring(0, 200)
        };
    });

    console.log('Results:', results);

    await browser.close();
}

dumpImmofluxForm().catch(console.error);
