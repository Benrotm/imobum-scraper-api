require('dotenv').config({ path: '../.env.local' });
const { createClient } = require('@supabase/supabase-js');

(async () => {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    // Attempt an insert without committing, or just fetch one row to see columns
    const { data: cols, error } = await supabase.from('property_sold_history').select('*').limit(1);
    
    if(error){
        console.error("Error reading property_sold_history:", error);
    } else {
        console.log("Columns in property_sold_history:", Object.keys(cols[0] || {}).join(', '));
    }
})();
