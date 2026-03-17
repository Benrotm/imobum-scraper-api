require('dotenv').config({ path: '../.env.local' });
const { createClient } = require('@supabase/supabase-js');

(async () => {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    // Check property_sold_history
    const { data: hist } = await supabase.from('property_sold_history').select('*').order('created_at', { ascending: false }).limit(5);
    console.log("History rows:");
    hist.forEach(h => console.log(`ID: ${h.property_id}, Price: ${h.sold_price}, DOM: ${h.days_on_market}`));

    // Check properties
    const propIds = hist.map(h => h.property_id);
    const { data: props } = await supabase.from('properties').select('id, title, status').in('id', propIds);
    console.log("\nProperties rows:");
    props.forEach(p => console.log(`ID: ${p.id}, Title: ${p.title}, Status: ${p.status}`));

    // Check scraped_urls for duplication issue
    const { data: urls } = await supabase.from('scraped_urls').select('*').order('created_at', { ascending: false }).limit(5);
    console.log("\nRecent scraped URLs:");
    urls.forEach(u => console.log(`URL: ${u.url}`));

})();
