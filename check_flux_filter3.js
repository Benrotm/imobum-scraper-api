const { chromium } = require('playwright');

async function checkURL() {
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

    console.log('Logged in. Current URL:', page.url());

    if (!page.url().includes('properties')) {
        await page.goto('https://fluxmls.immoflux.ro/properties');
        await page.waitForTimeout(3000);
    }

    try {
        const filtersHTML = await page.evaluate(() => {
            const selects = Array.from(document.querySelectorAll('select'));
            let judetHTML = '';
            for (const s of selects) {
                if (s.outerHTML.toLowerCase().includes('judet') ||
                    s.outerHTML.toLowerCase().includes('county')) {
                    judetHTML = s.outerHTML;
                    break;
                }
            }
            return { judetHTML, url: window.location.href };
        });

        console.log('--- Current URL ---\n', filtersHTML.url);
        console.log('--- Judet Select HTML ---\n', filtersHTML.judetHTML ? filtersHTML.judetHTML.substring(0, 1500) : 'Not found');
    } catch (e) {
        console.log('Error evaluating:', e.message);
    }

    await browser.close();
}

checkURL().catch(console.error);
