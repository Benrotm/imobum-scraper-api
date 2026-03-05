const { chromium } = require('playwright');

async function testImmofluxPost() {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();

    console.log('Logging in to immoflux.ro...');
    await page.goto('https://immoflux.ro/login');

    // Check if what page we are actually on
    console.log('Current URL:', page.url());

    // Fill credentials
    try {
        await page.fill('#inputEmail', 'alexandru.nanu@remax.ro');
        await page.fill('#inputPassword', '12345678');
        await Promise.all([
            page.waitForNavigation({ waitUntil: 'networkidle' }),
            page.click('button[type="submit"]')
        ]);
        console.log('Logged in successfully.');
    } catch (e) {
        console.error('Failed to login:', e.message);
        const html = await page.content();
        console.log(html.substring(0, 500));
        await browser.close();
        return;
    }

    console.log('Navigating to properties...');
    await page.goto('https://immoflux.ro/properties', { waitUntil: 'networkidle' });

    console.log('Properties loaded. URL:', page.url());
    let rawHtml = await page.content();
    console.log('Contains Bucuresti?', rawHtml.includes('Bucuresti'));
    console.log('Contains Timis?', rawHtml.includes('Timis'));

    console.log('Injecting POST Form for Timis (ID: 38)...');
    await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle' }),
        page.evaluate(() => {
            const form = document.createElement('form');
            form.method = 'POST';
            form.action = 'https://immoflux.ro/properties?page=1';

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

    console.log('Form submitted. URL:', page.url());
    rawHtml = await page.content();
    console.log('Contains Bucuresti?', rawHtml.includes('Bucuresti'));
    console.log('Contains Timis?', rawHtml.includes('Timis'));

    // Check if there are any tr rows
    const numRows = await page.evaluate(() => document.querySelectorAll('tr').length);
    const numCards = await page.evaluate(() => document.querySelectorAll('.avatar-ap').length);
    console.log('Rows found:', numRows);
    console.log('Cards found:', numCards);

    await browser.close();
}

testImmofluxPost().catch(console.error);
