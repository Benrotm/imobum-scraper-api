const { chromium } = require('playwright');
const cheerio = require('cheerio'); // Just for getText helper if needed, but we can do browser side context

(async () => {
    // Launch browser
    const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled'] });
    const context = await browser.newContext({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36' });
    const page = await context.newPage();

    console.log('Logging in...');
    await page.goto('https://blitz.immoflux.ro/login', { waitUntil: 'load', timeout: 45000 });
    await page.type('#inputEmail', 'benoni.silion@blitz-timisoara.ro');
    await page.type('#inputPassword', 'EDwohI#6Oi');
    await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle', timeout: 30000 }).catch(() => {}),
        page.click('button[type="submit"]')
    ]);

    console.log('Navigating to properties...');
    await page.goto('https://blitz.immoflux.ro/approperties?page=1&filter_stadiu_like=Pierduta+-+Lost', { waitUntil: 'networkidle' });

    // Open first property
    console.log('Clicking first property...');
    await page.waitForSelector('.property-info a.property-title');
    const firstUrl = await page.getAttribute('.property-info a.property-title', 'href');
    console.log('Found URL:', firstUrl);

    if (firstUrl) {
        const detailPage = await context.newPage();
        await detailPage.goto(firstUrl, { waitUntil: 'load' });
        
        await detailPage.waitForSelector('img');
        
        const popupData = await detailPage.evaluate(() => {
            const root = document;
            function getText(el) {
                if (!el) return '';
                let t = el.innerText || el.textContent || '';
                return t.replace(/\s+/g, ' ').trim();
            }

            const data = {};
            const labels = Array.from(root.querySelectorAll('strong'));
            labels.forEach(strong => {
                const labelText = strong.textContent.trim();
                const parentText = strong.parentElement ? strong.parentElement.innerText : '';
                const val = parentText.replace(labelText, '').trim();
                if (labelText.includes('Zile in piata:')) {
                    data.days_on_market = val;
                }
            });

            // Images logic from sold_immoflux.js
            const imgs = Array.from(root.querySelectorAll('img'))
                .map(img => img.src)
                .filter(src => src && (src.includes('approperties') || src.includes('property') || src.includes('imobum') || src.includes('storage')) && !src.includes('base64'));

             const rawImgs = Array.from(root.querySelectorAll('img')).map(img => ({ src: img.src, dataSrc: img.getAttribute('data-src') }));
                
            return { data, imgs, rawImgs };
        });

        console.log('\n--- EXTRACTED DATA ---');
        console.log('Days on Market RAW String:', popupData.data.days_on_market);
        console.log('Extracted Valid Images:', JSON.stringify(popupData.imgs, null, 2));
        console.log('First 5 Raw DOM Images:', JSON.stringify(popupData.rawImgs.slice(0,5), null, 2));
        
        await detailPage.close();
    }
    
    await browser.close();
})();
