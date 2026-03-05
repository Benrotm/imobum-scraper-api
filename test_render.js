const fetch = require('node-fetch'); // Use native fetch if Node 18+

async function testRender() {
    const res = await fetch('https://imobum-scraper-api.onrender.com/api/run-dynamic-scrape', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            categoryUrl: 'https://fluxmls.immoflux.ro/properties',
            jobId: 'test-job-999',
            pageNum: 1,
            linkSelector: 'a',
            extractSelectors: {},
            immofluxUser: 'alexandru.nanu@remax.ro',
            immofluxPass: '12345678', // Fake pass just to see if it reaches the filter code
            regionFilter: 'Timis'
        })
    });
    const text = await res.text();
    console.log('Response:', text);
}

testRender().catch(console.error);
