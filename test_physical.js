const { chromium } = require('playwright');

async function testPhysicalForm() {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();

    let interceptedRequest = null;
    page.on('request', request => {
        if (request.method() === 'POST' && request.url().includes('properties')) {
            interceptedRequest = request.postData();
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

    console.log('Injecting and submitting physical form...');
    await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle' }),
        page.evaluate(() => {
            const form = document.createElement('form');
            form.method = 'POST';
            form.action = window.location.href.split('?')[0];

            const csrfToken = document.querySelector('meta[name="csrf-token"]')?.getAttribute('content');
            if (csrfToken) {
                const csrfInput = document.createElement('input');
                csrfInput.type = 'hidden';
                csrfInput.name = '_token';
                csrfInput.value = csrfToken;
                form.appendChild(csrfInput);
            }

            const filterInput = document.createElement('input');
            filterInput.type = 'hidden';
            filterInput.name = 'filter_county_id__eq';
            filterInput.value = '38'; // Timis
            form.appendChild(filterInput);

            document.body.appendChild(form);
            form.submit();
        })
    ]);

    console.log('Form submitted. Target URL is now:', page.url());
    console.log('Intercepted POST Data:', interceptedRequest);

    let html = await page.content();
    console.log('PAGE 1 Contains Bucuresti?', html.includes('Bucuresti'));
    console.log('PAGE 1 Contains Mamaia?', html.includes('Mamaia'));
    console.log('PAGE 1 Contains Timis?', html.includes('Timis'));

    console.log('Navigating to Page 2...');
    await page.goto('https://fluxmls.immoflux.ro/properties?page=2', { waitUntil: 'networkidle' });

    html = await page.content();
    console.log('PAGE 2 Contains Bucuresti?', html.includes('Bucuresti'));
    console.log('PAGE 2 Contains Mamaia?', html.includes('Mamaia'));
    console.log('PAGE 2 Contains Timis?', html.includes('Timis'));

    await browser.close();
}

testPhysicalForm().catch(console.error);
