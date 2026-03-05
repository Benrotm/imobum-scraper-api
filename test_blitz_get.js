const { chromium } = require('playwright');
const fs = require('fs');

async function testBlitzGet() {
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
        console.log('Logged in successfully.');
    } catch (e) {
        console.error('Failed to login:', e.message);
        await browser.close();
        return;
    }

    console.log('Navigating directly with GET parameters...');
    // Add firstload=1 and mode=list as found in the hidden form
    await page.goto('https://blitz.immoflux.ro/approperties?filter_county_id__eq=38&page=1&mode=list&firstload=1', { waitUntil: 'networkidle' });

    console.log('Page loaded. URL:', page.url());
    let rawHtml = await page.content();
    console.log('Contains Bucuresti?', rawHtml.includes('Bucuresti'));
    console.log('Contains Timis?', rawHtml.includes('Timis'));

    // Check if there are any listings
    const numCards = await page.evaluate(() => document.querySelectorAll('.avatar-ap').length);
    console.log('Cards found:', numCards);

    await browser.close();
}

testBlitzGet().catch(console.error);
