require('dotenv').config({ path: '../.env.local' });
const { createClient } = require('@supabase/supabase-js');

(async () => {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    // Find scraped histories
    const { data: hist } = await supabase.from('property_sold_history')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(20);
        
    const scrapedHists = hist.filter(h => h.source === 'scraped' || !h.source || h.days_on_market === null);
    console.log(`Found ${scrapedHists.length} bad histories`);
    
    for (const h of scrapedHists) {
        console.log(`Deleting ${h.property_id}`);
        await supabase.from('property_sold_history').delete().eq('property_id', h.property_id);
        await supabase.from('properties').delete().eq('id', h.property_id);
    }
    
    await supabase.from('scraped_urls').delete().gte('id', 0); // clear all to reset scraper
    console.log("Cleanup complete!");
})();
