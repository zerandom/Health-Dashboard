const fs = require('fs');
const path = require('path');

// Extract GOOGLE_API_KEY from .env.local manually to avoid dependency issues
const envLocal = fs.readFileSync('.env.local', 'utf8');
const match = envLocal.match(/GOOGLE_API_KEY=(.*)/);
const key = match ? match[1].trim() : null;

if (!key) {
    console.error('❌ No GOOGLE_API_KEY found in .env.local');
    process.exit(1);
}

const models = [
    'gemini-2.5-flash-lite',
    'gemini-flash-latest',
    'gemini-2.0-flash-lite',
    'gemini-1.5-flash-8b'
];

async function test() {
    console.log('Testing models with key:', key.slice(0, 8) + '...');
    for (const m of models) {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${key}`;
        try {
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ contents: [{ parts: [{ text: 'Say hi' }] }] })
            });
            const data = await res.json();
            if (data.error) {
                console.log(`❌ ${m}: [${data.error.code}] ${data.error.message}`);
            } else {
                console.log(`✅ ${m}: Success! Response: ${data.candidates[0].content.parts[0].text.substring(0, 20)}...`);
            }
        } catch (e) {
            console.log(`❌ ${m}: Fetch Failed: ${e.message}`);
        }
    }
}

test();
