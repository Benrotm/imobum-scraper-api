const { chromium } = require('playwright');

(async () => {
    const targetUrl = 'https://blitz.immoflux.ro/approperties';
    console.log(`Booting Chrome cluster... Target: ${targetUrl}`);

    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();

    // await context.route('**/*', (route) => {
    //     const type = route.request().resourceType();
    //     if (['image', 'media', 'font', 'stylesheet'].includes(type) && !route.request().url().includes('PhoneNumberImages')) {
    //         return route.abort();
    //     }
    //     return route.continue();
    // });

    const page = await context.newPage();
    console.log('Navigating to login...');
    await page.goto('https://blitz.immoflux.ro/login');
    await page.type('input[name="email"]', 'benoni.silion@blitz-timisoara.ro');
    await page.type('input[name="password"]', 'EDwohI#6Oi');
    await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle' }),
        page.click('button[type="submit"]')
    ]);

    console.log(`Navigating to target ${targetUrl}...`);
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });

    // DEBUG: What does the page actually look like?
    await page.screenshot({ path: 'immoflux_debug.png', fullPage: true });
    console.log("Screenshot saved.");

    const effectiveSelector = '.avatar-ap, a';
    console.log(`Extracting using selector: ${effectiveSelector}`);

    try {
        await page.waitForSelector(effectiveSelector, { timeout: 10000 });
    } catch (e) { console.log('Timeout waiting for selector'); }

    const propertyUrls = await page.evaluate((selector) => {
        const links = Array.from(document.querySelectorAll(selector || 'a'));
        let validUrls = [];
        for (const el of links) {
            let urlStr = el.getAttribute('data-url') || el.href || el.getAttribute('href');
            if (!urlStr || urlStr.includes('javascript:')) continue;
            try {
                const resolved = new URL(urlStr, window.location.href).href;
                validUrls.push(resolved);
            } catch (e) { }
        }
        let validHrefs = validUrls.filter(href => href && href.startsWith('http'));

        validHrefs = validHrefs.filter(href =>
            (href.includes('/ap/slidepanel/') || href.includes('/approperties/')) &&
            !href.match(/\?page=\d+/)
        );
        return Array.from(new Set(validHrefs));
    }, effectiveSelector);

    console.log(`Discovered ${propertyUrls.length} links on page.`);
    console.log(propertyUrls);

    await browser.close();
})();
