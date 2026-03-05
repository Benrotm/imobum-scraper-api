const { chromium } = require('playwright');

async function testBlitzPost() {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();

    console.log('Logging in to blitz.immoflux.ro/login...');
    await page.goto('https://blitz.immoflux.ro/login');

    // Fill credentials
    try {
        await page.fill('#inputEmail', 'benoni.silion@blitz-timisoara.ro');
        await page.fill('#inputPassword', 'EDwohI#6Oi');
        await Promise.all([
            page.waitForNavigation({ waitUntil: 'networkidle' }),
            page.click('button[type="submit"]')
        ]);
        console.log('Logged in successfully. Current URL:', page.url());
    } catch (e) {
        console.error('Failed to login:', e.message);
        await browser.close();
        return;
    }

    console.log('Navigating to approperties...');
    await page.goto('https://blitz.immoflux.ro/approperties', { waitUntil: 'networkidle' });

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
            form.action = 'https://blitz.immoflux.ro/approperties?page=1';

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
            filterInput.value = '38'; // Timis directly
            form.appendChild(filterInput);

            document.body.appendChild(form);
            form.submit();
        })
    ]);

    console.log('Form submitted. URL:', page.url());
    rawHtml = await page.content();
    console.log('Contains Bucuresti?', rawHtml.includes('Bucuresti'));
    console.log('Contains Timis?', rawHtml.includes('Timis'));

    // Check if there are any listings
    const numCards = await page.evaluate(() => document.querySelectorAll('.avatar-ap').length);
    console.log('Cards found:', numCards);

    await browser.close();
}

testBlitzPost().catch(console.error);
