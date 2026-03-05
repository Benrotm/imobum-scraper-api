const { chromium } = require('playwright');

async function checkURL() {
    console.log('Launching browser...');
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();

    console.log('Navigating to login...');
    await page.goto('https://fluxmls.immoflux.ro/login');

    console.log('Logging in...');
    await page.fill('input[type="email"]', 'r.vlad@renet.ro');
    await page.fill('input[type="password"]', 'renet123');
    await page.click('button[type="submit"]');

    console.log('Waiting for properties page...');
    await page.waitForTimeout(5000); // Wait 5 seconds instead of networkidle
    console.log('Current URL:', page.url());

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
                const label = s.parentElement?.innerText?.toLowerCase();
                if (label && label.includes('jude')) {
                    judetHTML = s.outerHTML;
                    break;
                }
            }

            // Try to find the specific select by name if known from similar forms
            if (!judetHTML) {
                const byName = document.querySelector('select[name="CountyId"], select[name="county"], select[name="judet"]');
                if (byName) judetHTML = byName.outerHTML;
            }

            // Also check current query params if any
            const params = window.location.search;
            return { judetHTML, params };
        });

        console.log('--- URL Query Params ---\n', filtersHTML.params);
        console.log('--- Judet Select HTML ---\n', filtersHTML.judetHTML ? filtersHTML.judetHTML.substring(0, 1500) : 'Not found');
    } catch (e) {
        console.log('Error evaluating:', e.message);
    }

    await browser.close();
}

checkURL().catch(console.error);
