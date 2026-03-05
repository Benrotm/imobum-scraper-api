const { chromium } = require('playwright');
const fs = require('fs');

async function dumpFluxMls() {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();

    console.log('Logging in to fluxmls.immoflux.ro/login...');
    await page.goto('https://fluxmls.immoflux.ro/login');

    try {
        await page.fill('#inputEmail', 'alexandru.nanu@remax.ro');
        await page.fill('#inputPassword', 'uZY5CeALTRV5heH');
        await Promise.all([
            page.waitForNavigation({ waitUntil: 'networkidle' }),
            page.click('button[type="submit"]')
        ]);
        console.log('Logged in successfully. URL:', page.url());
    } catch (e) {
        console.error('Login failed:', e);
        await browser.close();
        return;
    }

    console.log('Navigating to properties...');
    await page.goto('https://fluxmls.immoflux.ro/properties', { waitUntil: 'networkidle' });

    let rawHtml = await page.content();
    fs.writeFileSync('fluxmls_properties.html', rawHtml);
    console.log('Saved raw HTML to fluxmls_properties.html');

    console.log('Extracting forms...');
    const result = await page.evaluate(() => {
        return Array.from(document.forms).map(form => {
            const inputs = Array.from(form.querySelectorAll('input, select, textarea')).map(el => ({
                name: el.name,
                type: el.type || el.tagName,
                value: el.value,
                id: el.id
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

dumpFluxMls().catch(console.error);
