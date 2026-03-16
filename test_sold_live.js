const { runSoldImmofluxScrape } = require('./sold_immoflux.js');

const req = {
    body: {
        jobId: 'debug-' + Date.now(),
        pageNum: 1,
        config: {
            url: 'https://blitz.immoflux.ro/properties',
            status_filter: 'Pierduta - Lost'
        },
        mode: 'history',
        immofluxUser: 'benoni.silion@blitz-timisoara.ro',
        immofluxPass: 'EDwohI#6Oi',
        supabaseUrl: null,
        supabaseKey: null
    }
};

const res = {
    status: (code) => ({ json: (data) => console.log(`HTTP ${code}:`, data) }),
    json: (data) => console.log('HTTP 200:', data)
};

console.log('Starting local debug scrape run...');
runSoldImmofluxScrape(req, res).then(() => {
    console.log('Local debug scrape finished.');
}).catch(err => {
    console.error('Error in local run:', err);
});
