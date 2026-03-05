const puppeteer = require('puppeteer');

(async () => {
    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();
    console.log("Navigating to login...");
    await page.goto('https://blitz.immoflux.ro/login');
    await page.type('input[name="email"]', 'benoni.silion@blitz-timisoara.ro');
    await page.type('input[name="password"]', 'EDwohI#6Oi');
    await Promise.all([
        page.click('button[type="submit"]'),
        page.waitForNavigation({ waitUntil: 'networkidle0' })
    ]);

    console.log("Navigating to approperties...");
    await page.goto('https://blitz.immoflux.ro/approperties?page=1', { waitUntil: 'networkidle2' });

    const propertyUrls = await page.evaluate(() => {
        const links = Array.from(document.querySelectorAll('a'));
        let validUrls = [];
        for (const el of links) {
            // Crucial fix: data-url MUST take priority over href
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
    });

    console.log(`Found ${propertyUrls.length} links:`, propertyUrls);
    await browser.close();
})();
