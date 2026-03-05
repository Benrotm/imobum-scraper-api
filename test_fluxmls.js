const { chromium } = require('playwright');

async function testFluxMls() {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();

    console.log('Logging in to fluxmls.immoflux.ro/login...');
    await page.goto('https://fluxmls.immoflux.ro/login');

    try {
        await page.fill('#inputEmail', 'alexandru.nanu@remax.ro');
        await page.fill('#inputPassword', '12345678');
        await Promise.all([
            page.waitForNavigation({ waitUntil: 'networkidle' }),
            page.click('button[type="submit"]')
        ]);
        console.log('Logged in successfully. URL:', page.url());
    } catch (e) {
        console.error('Login failed');
        await browser.close();
        return;
    }

    // Try GET request with filter_county_id__eq
    console.log('Testing GET parameter on Properties index...');
    await page.goto('https://fluxmls.immoflux.ro/properties?filter_county_id__eq=38&page=1&mode=list&firstload=1', { waitUntil: 'networkidle' });

    let rawHtml = await page.content();
    let numCards = await page.evaluate(() => document.querySelectorAll('tr').length);
    console.log(`GET Method - Contains Bucuresti? ${rawHtml.includes('Bucuresti')} | Contains Timis? ${rawHtml.includes('Timis')} | Rows: ${numCards}`);

    // Let's try to extract the form on the properties page
    await page.goto('https://fluxmls.immoflux.ro/properties', { waitUntil: 'networkidle' });
    const result = await page.evaluate(() => {
        const filterInput = document.querySelector('[name="filter_county_id__eq"]');
        if (!filterInput) return { error: 'filter_county_id__eq input NOT FOUND' };

        let form = filterInput.closest('form');
        if (!form) return { error: 'Input is not inside a form component.' };

        const inputs = Array.from(form.querySelectorAll('input, select, textarea')).map(el => ({
            name: el.name,
            type: el.type || el.tagName,
            value: el.value
        }));

        return {
            action: form.action,
            method: form.method,
            inputsCount: inputs.length
        };
    });

    console.log('Form details on page:', result);

    await browser.close();
}

testFluxMls().catch(console.error);
