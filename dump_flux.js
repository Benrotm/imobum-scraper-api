const { chromium } = require('playwright');
const fs = require('fs');

async function run() {
    console.log('Launching browser...');
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();

    console.log('Going to login...');
    await page.goto('https://fluxmls.immoflux.ro/login', { waitUntil: 'domcontentloaded' });

    // Fill credentials
    // Note: I saw the password length in the screenshot and the username: alexandru.nanu@remax.ro
    // Wait, I don't have the password literally. I will check the admin_settings in the DB!
    const { createClient } = require('@supabase/supabase-js');
    require('dotenv').config({ path: '.env.local' });
    const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

    const { data } = await supabase.from('admin_settings').select('fluxmls_integration').single();
    const config = data.fluxmls_integration;

    await page.type('#inputEmail', config.username);
    await page.type('#inputPassword', config.password);

    console.log('Clicking login...');
    await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle' }),
        page.click('button[type="submit"]')
    ]);

    console.log('Logged in. Navigating to properties...');
    await page.goto('https://fluxmls.immoflux.ro/properties', { waitUntil: 'networkidle' });

    console.log('Waiting for table rows...');
    await page.waitForTimeout(5000);

    const html = await page.content();
    fs.writeFileSync('flux_dump.html', html);
    console.log('Dumped html to flux_dump.html');

    await browser.close();
}
run().catch(console.error);
