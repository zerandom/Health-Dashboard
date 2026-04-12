const https = require('https');
const fs = require('fs');
const path = require('path');

// Read API key from .env.local
const envPath = path.join(__dirname, '..', '.env.local');
const envContent = fs.readFileSync(envPath, 'utf8');
const keyMatch = envContent.match(/GOOGLE_API_KEY=([^\n\r]+)/);
const GOOGLE_API_KEY = keyMatch ? keyMatch[1].trim() : null;

if (!GOOGLE_API_KEY) {
    console.error("API Key not found in .env.local");
    process.exit(1);
}

const model = 'gemini-3.1-flash-lite';
const prompt = "Say 'Hello, Ekatra works with 3.1 Flash Lite!'";

console.log(`Testing model: ${model}...`);

const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GOOGLE_API_KEY}`;
const req = https.request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
}, (res) => {
    let body = '';
    res.on('data', d => body += d);
    res.on('end', () => {
        try {
            const json = JSON.parse(body);
            if (res.statusCode === 200 && json.candidates?.[0]) {
                console.log("Success!");
                console.log("Response:", json.candidates[0].content.parts[0].text.trim());
            } else {
                console.error(`Error ${res.statusCode}:`, json.error?.message || body);
            }
        } catch(e) { console.error("Parse Error:", e.message); }
    });
});

req.on('error', (e) => console.error("Request Error:", e.message));
req.write(JSON.stringify({
    contents: [{ parts: [{ text: prompt }] }]
}));
req.end();
