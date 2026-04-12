const fs = require('fs');
const https = require('https');

function getEnvKey() {
    try {
        const paths = ['.env.local', '.env'];
        for (const p of paths) {
            if (fs.existsSync(p)) {
                console.log(`Checking ${p}...`);
                const content = fs.readFileSync(p, 'utf8');
                const match = content.match(/GOOGLE_API_KEY=(.*)/);
                if (match) {
                    const raw = match[1];
                    const cleaned = raw.trim().replace(/[\s"']/g, '');
                    console.log(`Found Key in ${p}. Length: ${cleaned.length}`);
                    return cleaned;
                }
            }
        }
    } catch (e) {
        console.error("Env read error:", e.message);
    }
    return null;
}

async function testGoogleAuth(key, model = 'gemini-3-flash-preview') {
    const authTests = [
        { 
            name: "Query Param (?key=)",
            url: `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
            headers: { 'Content-Type': 'application/json' }
        },
        { 
            name: "x-goog-api-key Header",
            url: `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
            headers: { 
                'Content-Type': 'application/json',
                'x-goog-api-key': key
            }
        }
    ];

    for (const test of authTests) {
        console.log(`\n--- Testing ${test.name} ---`);
        try {
            const res = await fetch(test.url, {
                method: 'POST',
                headers: test.headers,
                body: JSON.stringify({ contents: [{ parts: [{ text: "hi" }] }] })
            });
            const data = await res.json();
            if (res.status === 200) {
                console.log(`✅ Success! status=${res.status}`);
            } else {
                console.log(`❌ Error: status=${res.status}, msg=${data.error?.message || JSON.stringify(data)}`);
            }
        } catch (e) {
            console.log(`❌ Fetch Exception: ${e.message}`);
        }
    }
}

async function run() {
    const key = getEnvKey();
    if (!key) {
        console.error("FATAL: No GOOGLE_API_KEY found in .env or .env.local");
        return;
    }
    
    // Check multiple model variations
    const modelVariations = [
        'gemini-3-flash-preview',
        'gemini-3.0-flash',
        'gemini-2.5-flash',
        'gemini-flash-lite'
    ];

    for (const m of modelVariations) {
        console.log(`\n\n=== MODAL TEST: ${m} ===`);
        await testGoogleAuth(key, m);
    }
}

run();
