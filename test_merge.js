const fetch = require('node-fetch');

async function test_api_route() {
    const extraAgentData = {
        features: ['Open to Collaboration']
    };

    console.log(`[DEBUG] Sending property to NextJS API with extraData:`, JSON.stringify(extraAgentData));

    // We can simulate what NextJS will do natively
    const dataToSave = {
        title: "Test Property",
        features: ["Balcony", "Parking"]
    };

    if (extraAgentData.features && Array.isArray(extraAgentData.features)) {
        const existingFeatures = Array.isArray(dataToSave.features) ? dataToSave.features : [];
        dataToSave.features = Array.from(new Set([...existingFeatures, ...extraAgentData.features]));
        delete extraAgentData.features;
    }
    Object.assign(dataToSave, extraAgentData);

    console.log("NextJS Processed Output:", JSON.stringify(dataToSave, null, 2));
}

test_api_route();
