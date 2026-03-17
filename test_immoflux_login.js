const { chromium } = require('playwright');
(async () => {
    const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled'] });
    const context = await browser.newContext({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36' });
    const page = await context.newPage();
    try {
        await page.goto('https://blitz.immoflux.ro/login', { waitUntil: 'load' });
        await page.type('#inputEmail', 'benoni.silion@blitz-timisoara.ro');
        await page.type('#inputPassword', 'EDwohI#6Oi');
        await Promise.all([
            page.waitForNavigation({ waitUntil: 'networkidle', timeout: 15000 }).catch(() => {}),
            page.click('button[type="submit"]')
        ]);
        
        const err = await page.locator('.alert-danger, .error-message').innerText({ timeout: 5000 }).catch(() => null);
        if(err) {
            console.log('Login explicitly failed with message:', err);
        } else {
            console.log('No error message found. URL is now:', page.url());
        }
        await page.screenshot({ path: 'test_login.png' });
    } catch(e) {
        console.error('Error:', e);
    } finally {
        await browser.close();
    }
})();
