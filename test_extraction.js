const { chromium } = require('playwright');
(async () => {
    // Launch browser
    const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled'] });
    const context = await browser.newContext({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36' });
    const page = await context.newPage();

    await page.goto('https://blitz.immoflux.ro/login', { waitUntil: 'load', timeout: 45000 });
    await page.type('#inputEmail', 'benoni.silion@blitz-timisoara.ro');
    await page.type('#inputPassword', 'EDwohI#6Oi');
    await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle', timeout: 30000 }).catch(() => {}),
        page.click('button[type="submit"]')
    ]);

    await page.goto('https://blitz.immoflux.ro/approperties?page=1&filter_stadiu_like=Pierduta+-+Lost', { waitUntil: 'networkidle' });
    await page.waitForTimeout(4000);
    
    // Find the first URL
    const links = await page.$$eval('a', els => els.map(a => a.href));
    const propUrl = links.find(l => l.includes('/properties/') && l.includes('slidepanel'));
    
    if (propUrl) {
        console.log('Navigating to slidepanel:', propUrl);
        const detailPage = await context.newPage();
        await detailPage.goto(propUrl, { waitUntil: 'load' });
        await detailPage.waitForTimeout(4000);
        
        const popupData = await detailPage.evaluate(() => {
            const root = document;
            const data = {};
            
            // Find any element containing "Zile in piata"
            const allEls = Array.from(root.querySelectorAll('*'));
            const zileEls = allEls.filter(el => el.childNodes.length === 1 && el.textContent.includes('piata'));
            
            data.zile_elements = zileEls.map(el => ({
               tagName: el.tagName,
               textContent: el.textContent.trim(),
               parentHTML: el.parentElement ? el.parentElement.innerHTML.substring(0, 150) : null
            }));
            
            return { data };
        });

        console.log(JSON.stringify(popupData.data, null, 2));
        await detailPage.close();
    } else {
        console.log('Slidepanel not found. All /properties/ links:', links.filter(l => l.includes('/properties/')));
    }
    
    await browser.close();
})();
