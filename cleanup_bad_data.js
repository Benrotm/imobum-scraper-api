const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '../.env.local' });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function cleanupBadData() {
    console.log('Cleaning up "bad" scraped records (generic title or null price)...');
    
    // Identify problematic URLs in market_insights
    const { data: badInsights, error: insightError } = await supabase
        .from('market_insights')
        .select('original_url')
        .or('title.ilike.Proprietate - P%,price.is.null');

    if (insightError) {
        console.error('Error fetching bad insights:', insightError);
        return;
    }

    const urlsToDelete = badInsights.map(i => i.original_url).filter(Boolean);
    console.log(`Found ${urlsToDelete.length} bad records in market_insights.`);

    if (urlsToDelete.length === 0) {
        console.log('No bad records found. Cleanup complete.');
        return;
    }

    // 1. Delete from market_insights
    const { error: delInsightError } = await supabase
        .from('market_insights')
        .delete()
        .in('original_url', urlsToDelete);

    if (delInsightError) {
        console.error('Error deleting from market_insights:', delInsightError);
    } else {
        console.log('Successfully deleted bad records from market_insights.');
    }

    // 2. Delete from scraped_urls to allow re-scraped
    const { error: delScrapedError } = await supabase
        .from('scraped_urls')
        .delete()
        .in('url', urlsToDelete);

    if (delScrapedError) {
        console.error('Error deleting from scraped_urls:', delScrapedError);
    } else {
        console.log('Successfully deleted records from scraped_urls to allow re-scraping.');
    }
}

cleanupBadData();
