require('dotenv').config({ path: '../../.env.local' });
const { createClient } = require('@supabase/supabase-js');

async function checkLogs() {
    const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL,
        process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    const { data, error } = await supabase
        .from('scraper_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(20);

    if (error) {
        console.error('Error:', error);
    } else {
        data.forEach(log => console.log(`[${new Date(log.created_at).toISOString()}] ${log.message}`));
    }
}

checkLogs().catch(console.error);
