const { chromium } = require('playwright');
const fs = require('fs');

async function testNativeSubmit() {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();

    console.log('Logging in to fluxmls.immoflux.ro...');
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

    await page.goto('https://fluxmls.immoflux.ro/properties', { waitUntil: 'networkidle' });

    console.log('Mutating the native filter form...');
    await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle' }),
        page.evaluate(() => {
            const select = document.getElementById('filter-county-id-eq');
            if (select) {
                const opt = document.createElement('option');
                opt.value = '38';
                opt.text = 'Timis';
                opt.selected = true;
                select.appendChild(opt);
                select.value = '38';
            }

            const form = document.getElementById('filter');
            if (form) form.submit();
        })
    ]);

    console.log('Form submitted. URL:', page.url());
    let rawHtml = await page.content();
    fs.writeFileSync('fluxmls_native_submit.html', rawHtml);

    console.log(`Contains Timis? ${rawHtml.includes('Timisoara') || rawHtml.includes('Timis')}`);
    console.log(`Contains Bucuresti? ${rawHtml.includes('Bucuresti')}`);
    const numCards = await page.evaluate(() => document.querySelectorAll('tr').length);
    console.log(`Rows: ${numCards}`);

    await browser.close();
}

testNativeSubmit().catch(console.error);
