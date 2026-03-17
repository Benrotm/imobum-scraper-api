require('dotenv').config({ path: '../.env.local' });
const { createClient } = require('@supabase/supabase-js');

(async () => {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    
    if(!supabaseUrl) { console.log('No Supabase URL found in .env.local'); return }
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    const { data, error } = await supabase.from('admin_settings').select('*');
    if(error) { console.error(error); return; }
    console.log(JSON.stringify(data, null, 2));
})();
