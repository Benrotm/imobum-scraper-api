const { chromium } = require('playwright');

async function findEndpoint() {
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

    // Scrape all script src and inline scripts to find where county filter is sent
    const results = await page.evaluate(() => {
        let textFound = [];
        const scripts = document.querySelectorAll('script');
        scripts.forEach(s => {
            if (s.innerText && (s.innerText.includes('filter_county_id__eq') || s.innerText.includes('ajax') || s.innerText.includes('POST'))) {
                let text = s.innerText;
                const match = text.match(/url\s*:\s*['"]?([^'",\s]+)['"]?/gi);
                if (match) {
                    textFound = textFound.concat(match);
                }
            }
        });

        // Also look at form actions if they exist
        const forms = document.querySelectorAll('form');
        forms.forEach(f => {
            if (f.outerHTML.includes('filter')) {
                textFound.push("FORM METHOD: " + f.method + " ACTION: " + f.action);
            }
        });

        return [...new Set(textFound)];
    });

    console.log('Endpoints Found:', results);

    await browser.close();
}

findEndpoint().catch(console.error);
