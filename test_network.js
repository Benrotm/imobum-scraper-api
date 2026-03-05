const { chromium } = require('playwright');

async function spyNetwork() {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();

    let interceptedRequest = null;
    let interceptedPostData = null;

    page.on('request', request => {
        if (request.method() === 'POST' || request.url().includes('search') || request.url().includes('ilter')) {
            console.log('Detected request:', request.method(), request.url());
            if (request.method() === 'POST') {
                interceptedRequest = request.url();
                interceptedPostData = request.postData();
            }
        }
    });

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

    console.log('Trying to click the Select2 input box...');
    try {
        await page.click('.select2-selection--single'); // Click to open dropdown
        await page.waitForTimeout(1000);
        await page.keyboard.type('Timis');
        await page.waitForTimeout(500);
        await page.keyboard.press('Enter');
        console.log('Selected Timis. Waiting 3 seconds for network requests...');
        await page.waitForTimeout(3000);
    } catch (e) {
        console.log('Could not find select2:', e.message);
    }

    console.log('\n--- RESULTS ---');
    console.log('Intercepted POST URL:', interceptedRequest);
    console.log('Intercepted POST Data:', interceptedPostData);

    await browser.close();
}

spyNetwork().catch(console.error);
