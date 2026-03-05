const { chromium } = require('playwright');

async function dumpForm() {
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

    console.log('Dumping DOM around the county filter...');
    const html = await page.evaluate(() => {
        const select = document.querySelector('select[name="filter_county_id__eq"]');
        if (!select) return 'NOT FOUND';

        let parent = select.parentElement;
        for (let i = 0; i < 3; i++) {
            if (parent && parent.parentElement) parent = parent.parentElement;
        }

        return parent.outerHTML;
    });

    console.log('HTML:\n', html);
    await browser.close();
}

dumpForm().catch(console.error);
