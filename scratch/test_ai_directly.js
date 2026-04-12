const https = require('https');
const fs = require('fs');
const path = require('path');

async function testAI() {
    // Load .env.local manually
    const envPath = path.join(process.cwd(), '.env.local');
    const env = fs.readFileSync(envPath, 'utf8');
    const apiKey = env.match(/GOOGLE_API_KEY=(.*)/)?.[1]?.replace(/["']/g, '');

    if (!apiKey) {
        console.error("API Key not found in .env.local");
        return;
    }

    const prompt = "Analyze this data: HRV is 50ms, RHR is 50bpm. Provide a health insight (2 sentences). Ensure it is complete.";
    const model = 'gemini-flash-latest';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    const payload = JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 1.0, maxOutputTokens: 500 }
    });

    console.log("Hitting Gemini API...");

    return new Promise((resolve, reject) => {
        const req = https.request(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        }, (res) => {
            let body = '';
            res.on('data', d => body += d);
            res.on('end', () => {
                const json = JSON.parse(body);
                fs.writeFileSync('scratch/ai_raw_response.json', JSON.stringify(json, null, 2));
                if (json.candidates?.[0]) {
                    console.log("Success! Full text:", json.candidates[0].content.parts[0].text);
                } else {
                    console.log("Failed. Error:", body);
                }
                resolve();
            });
        });

        req.on('error', reject);
        req.write(payload);
        req.end();
    });
}

testAI();
