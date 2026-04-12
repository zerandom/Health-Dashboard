const fs = require('fs');

async function test() {
    const rawEnv = fs.readFileSync('.env.local', 'utf8');
    const match = rawEnv.match(/GOOGLE_API_KEY=(.*)/);
    const key = match[1].trim().replace(/[\s"']/g, '');

    const models = [
        'gemini-3.0-flash',
        'gemini-flash-latest',
        'gemini-2.5-flash',
        'gemini-3.1-flash-lite-preview',
        'gemini-2.5-flash-lite'
    ];

    for (const m of models) {
        console.log(`\nTesting ${m}...`);
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${key}`;
        try {
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ contents: [{ parts: [{ text: "hi" }] }] })
            });
            const data = await res.json();
            if (data.error) {
                console.log("❌ Error:", data.error.message);
            } else {
                console.log("✅ Success! Model used:", data.modelVersion || m);
            }
        } catch (e) {
            console.log("❌ Fetch Error:", e.message);
        }
    }
}
test();
