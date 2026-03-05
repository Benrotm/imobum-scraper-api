const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '../.env.local' });
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function updateDb() {
    console.log('Fetching fluxmls_integration config...');
    const { data: qData, error: qErr } = await supabase.from('admin_settings').select('*').eq('key', 'fluxmls_integration').single();
    if (qErr) {
        console.error('Error fetching config:', qErr);
        return;
    }

    let config = qData.value;
    console.log('Current config:', config.mapping);

    config.mapping = {
        title: 'h1',
        price: '.property-show-price',
        rooms: 'li:contains("Nr. camere") span',
        area: 'li:contains("S. utila:") span',
        location_area: '.property-show-zone',
        location_city: '.property-show-zone',
        description: '.promowindow:has(h4:contains("Descriere")) div',
        owner_phone: 'span.missing',
    };

    console.log('Updating to new config:', config.mapping);
    const { data: uData, error: uErr } = await supabase.from('admin_settings').update({ value: config }).eq('key', 'fluxmls_integration');
    if (uErr) {
        console.error('Error updating config:', uErr);
    } else {
        console.log('Database updated successfully.');
    }
}
updateDb().catch(console.error);
