require('dotenv').config({ path: '../.env.local' });
const { createClient } = require('@supabase/supabase-js');

(async () => {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if(!supabaseUrl) { console.log('No Supabase URL found'); return; }
    
    const supabase = createClient(supabaseUrl, supabaseKey);
    const { data, error } = await supabase
        .from('market_insights')
        .select('*')
        .order('scraped_at', { ascending: false })
        .limit(3);
        
    if(error) {
        console.error(error);
    } else {
        console.log("Raw DB Rows:");
        data.forEach(r => console.log(`ID: ${r.id}, original_url: ${r.original_url}, days_on_market: ${r.days_on_market}, images: ${r.images?.length}`));
    }
})();
