const { chromium } = require('playwright');
const fs = require('fs');

async function checkURL() {
    console.log('Launching browser...');
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();

    console.log('Navigating to login...');
    await page.goto('https://fluxmls.immoflux.ro/login');

    console.log('Logging in...');
    await page.fill('input[type="email"]', 'r.vlad@renet.ro');
    await page.fill('input[type="password"]', 'renet123'); // From past knowledge
    await page.click('button[type="submit"]');

    await page.waitForNavigation({ waitUntil: 'networkidle' });
    console.log('Logged in. Current URL:', page.url());

    if (!page.url().includes('properties')) {
        await page.goto('https://fluxmls.immoflux.ro/properties');
    }

    console.log('Waiting for properties page...');
    await page.waitForSelector('body', { timeout: 10000 });

    // Dump HTML of the Judet filter
    try {
        // Wait for the judet dropdown or select
        // On immoflux it's usually a select2 or similar, but the hidden <select> should be there
        const judetSelectHTML = await page.evaluate(() => {
            const selects = Array.from(document.querySelectorAll('select'));
            for (const s of selects) {
                if (s.outerHTML.toLowerCase().includes('judet') ||
                    s.outerHTML.toLowerCase().includes('county')) {
                    return s.outerHTML;
                }
                const label = s.parentElement?.innerText?.toLowerCase();
                if (label && label.includes('judet')) {
                    return s.outerHTML;
                }
            }
            return null;
        });

        console.log('--- Judet Select HTML ---');
        console.log(judetSelectHTML ? judetSelectHTML.substring(0, 500) + '...' : 'Not found');

        // Also look at any form action or inputs
        const formAction = await page.evaluate(() => {
            const form = document.querySelector('form');
            return form ? form.action : 'No form';
        });
        console.log('Form Action:', formAction);

    } catch (e) {
        console.log('Error evaluating:', e.message);
    }

    await browser.close();
}

checkURL().catch(console.error);
