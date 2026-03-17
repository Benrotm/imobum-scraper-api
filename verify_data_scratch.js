const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '../.env.local' });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function verifyData() {
    console.log('Fetching last 10 records from market_insights...');
    const { data, error } = await supabase
        .from('market_insights')
        .select('*')
        .order('id', { ascending: false })
        .limit(10);

    if (error) {
        console.error('Error fetching data:', error);
        return;
    }

    if (data && data.length > 0) {
        console.log('Sample Raw Record Keys:', Object.keys(data[0]));
    }

    data.forEach(item => {
        const status = (item.title && !item.title.startsWith('Proprietate - P') && (item.price > 0 || item.price_raw)) ? '[OK]' : '[BAD]';
        console.log(`${status} [ID:${item.id}] ${item.title} - Price: ${item.price} | PriceRaw: ${item.price_raw} (${item.original_url})`);
    });
}

verifyData();
