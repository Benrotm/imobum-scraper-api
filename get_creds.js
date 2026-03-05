const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '../.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function get_creds() {
    const { data, error } = await supabase.from('admin_settings').select('value').eq('key', 'fluxmls_integration').single();
    if (error) {
        console.error("Error:", error);
    } else {
        console.log("FluxMLS CREDS:", {
            user: data.value.username,
            pass: data.value.password
        });
    }

    const { data: data2 } = await supabase.from('admin_settings').select('value').eq('key', 'immoflux_integration').single();
    if (data2) {
        console.log("Immoflux CREDS:", {
            user: data2.value.username,
            pass: data2.value.password
        });
    }
}

get_creds();
