const { chromium } = require('playwright');

(async () => {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();

    console.log("Logging in...");
    await page.goto('https://blitz.immoflux.ro/login');
    await page.type('input[name="email"]', 'benoni.silion@blitz-timisoara.ro');
    await page.type('input[name="password"]', 'EDwohI#6Oi');
    await Promise.all([
        page.click('button[type="submit"]'),
        page.waitForNavigation({ waitUntil: 'networkidle' })
    ]);

    console.log("Accessing ?page=1...");
    const response = await page.goto('https://blitz.immoflux.ro/approperties?page=1', { waitUntil: 'networkidle' });
    console.log("Status:", response.status());

    const links = await page.evaluate(() => {
        const els = Array.from(document.querySelectorAll('.avatar-ap, a'));
        let rawUrls = [];
        let validUrls = [];
        for (const el of els) {
            let urlStr = el.getAttribute('data-url') || el.href || el.getAttribute('href');
            if (urlStr) rawUrls.push(urlStr);
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
        return { totalQuery: els.length, rawUrls: rawUrls.length, filtered: Array.from(new Set(validHrefs)).length };
    });

    console.log(`Results: `, links);
    await browser.close();
})();
