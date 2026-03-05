require('dotenv').config({ path: '../.env.local' });
const { createClient } = require('@supabase/supabase-js');

async function getCreds() {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    console.log('Connecting to', supabaseUrl);

    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data, error } = await supabase
        .from('admin_settings')
        .select('*')
        .eq('key', 'fluxmls_integration')
        .single();

    if (error) {
        console.error(error);
        return;
    }

    let val = data.value;
    if (typeof val === 'string') val = JSON.parse(val);
    console.log('FluxMLS Config:', val.username, val.password);
}

getCreds().catch(console.error);
