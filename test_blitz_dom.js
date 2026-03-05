const { chromium } = require('playwright');

async function testBlitzDom() {
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

    console.log('Navigating to approperties...');
    await page.goto('https://blitz.immoflux.ro/approperties', { waitUntil: 'networkidle' });

    console.log('Dumping DOM selects...');
    const results = await page.evaluate(() => {
        const selects = Array.from(document.querySelectorAll('select')).map(s => ({
            name: s.name,
            id: s.id,
            className: s.className,
            options: Array.from(s.options).map(o => `${o.value}: ${o.text}`).join(', ').substring(0, 100)
        }));

        return selects;
    });

    console.log('Selects:', JSON.stringify(results, null, 2));

    await browser.close();
}

testBlitzDom().catch(console.error);
