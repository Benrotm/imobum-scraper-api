require('dotenv').config({ path: '../.env.local' });
const { createClient } = require('@supabase/supabase-js');

(async () => {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if(!supabaseUrl) { console.log('No Supabase URL found'); return; }
    
    const supabase = createClient(supabaseUrl, supabaseKey);
    const { data: prop, error: err1 } = await supabase
        .from('properties')
        .select('*')
        .eq('id', '62c8ed55-221f-412f-9584-7d44cccbc417')
        .single();
    
    if(prop) {
        console.log('Found in properties table:', prop.title);
        const { data: hist } = await supabase.from('property_sold_history').select('*').eq('property_id', prop.id);
        console.log('Sold history entries:', hist?.length);
    } else {
        console.log('Not in properties table');
        const { data: mi } = await supabase.from('market_insights').select('*').limit(5).order('created_at', { ascending: false });
        console.log('Recent market_insights:', mi.map(m => m.id));
    }
})();
