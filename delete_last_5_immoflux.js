require('dotenv').config({ path: '../.env.local' });
const { createClient } = require('@supabase/supabase-js');

(async () => {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    // Delete the incomplete market_insights
    const ids = ['1c04c051-93f3-4d0e-9d5f-28cf45831544', '40d49ebb-01f5-4102-8294-befb12bccc41'];
    await supabase.from('market_insights').delete().in('id', ids);
    console.log('Deleted market_insights');
    
    // Delete the tracking to allow rescrape
    const urls = [
        'https://blitz.immoflux.ro/properties/159710/slidepanel',
        'https://blitz.immoflux.ro/properties/165749/slidepanel'
    ];
    await supabase.from('scraped_urls').delete().in('url', urls);
    console.log('Deleted scraped_urls');
})();
