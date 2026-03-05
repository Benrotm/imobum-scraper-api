require('dotenv').config({ path: '../.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkRecent() {
    console.log('Querying top 3 most recent properties from Supabase for features...');
    const { data, error } = await supabase
        .from('properties')
        .select('id, title, features, created_at')
        .order('created_at', { ascending: false })
        .limit(3);

    if (error) {
        console.error(error);
        return;
    }
    console.log(JSON.stringify(data, null, 2));
}

checkRecent();
