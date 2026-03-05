const { chromium } = require('playwright');

async function extractAllForms() {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();

    console.log('Logging in to blitz.immoflux.ro/login...');
    await page.goto('https://blitz.immoflux.ro/login');

    try {
        await page.fill('#inputEmail', 'benoni.silion@blitz-timisoara.ro');
        await page.fill('#inputPassword', 'EDwohI#6Oi');
        await Promise.all([
            page.waitForNavigation({ waitUntil: 'networkidle' }),
            page.click('button[type="submit"]')
        ]);
    } catch (e) { }

    await page.goto('https://blitz.immoflux.ro/approperties', { waitUntil: 'networkidle' });

    const result = await page.evaluate(() => {
        return Array.from(document.forms).map(form => {
            const inputs = Array.from(form.querySelectorAll('input, select, textarea')).map(el => ({
                name: el.name,
                type: el.type || el.tagName,
                value: el.value
            }));
            return {
                action: form.action,
                method: form.method,
                id: form.id,
                className: form.className,
                inputsCount: inputs.length,
                inputs: inputs
            };
        });
    });

    console.log(JSON.stringify(result, null, 2));
    await browser.close();
}

extractAllForms().catch(console.error);
