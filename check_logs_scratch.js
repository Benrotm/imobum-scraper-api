const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '../.env.local' });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function checkLogs() {
    console.log('Fetching last 20 logs from scrape_logs...');
    const { data, error } = await supabase
        .from('scrape_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(30);

    if (error) {
        console.error('Error fetching logs:', error);
        return;
    }

    console.log('\nChecking if any properties are in market_insights for some of the skipped URLs...');
    const urlsToCheck = [
        "https://blitz.immoflux.ro/properties/159710/slidepanel",
        "https://blitz.immoflux.ro/properties/162867/slidepanel",
        "https://blitz.immoflux.ro/properties/145347/slidepanel"
    ];

    for (const url of urlsToCheck) {
        const { data: insight } = await supabase
            .from('market_insights')
            .select('id, title, price')
            .eq('original_url', url)
            .maybeSingle();

        const { data: scraped } = await supabase
            .from('scraped_urls')
            .select('url')
            .eq('url', url)
            .maybeSingle();

        if (insight) {
            console.log(`[INSIGHT] ${url}: ${insight.title} - €${insight.price}`);
        } else {
            console.log(`[NO INSIGHT] ${url}`);
        }

        if (scraped) {
            console.log(`[SCRAPED_URLS] ${url}: Found`);
        } else {
            console.log(`[SCRAPED_URLS] ${url}: Not Found`);
        }
    }
}

checkLogs();
