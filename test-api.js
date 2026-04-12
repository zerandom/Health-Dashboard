const https = require('https');
const fs = require('fs');

async function test() {
    const rawEnv = fs.readFileSync('.env.local', 'utf8');
    const match = rawEnv.match(/GOOGLE_API_KEY=(.*)/);
    const key = match[1].trim().replace(/[\s"']/g, '');

    console.log("Extracted Key starts with:", key.substring(0, 4), "Length:", key.length);

    const postData = JSON.stringify({
        contents: [{ parts: [{ text: "Hello" }] }]
    });

    const options = {
        hostname: 'generativelanguage.googleapis.com',
        port: 443,
        path: `/v1beta/models/gemini-flash-latest:generateContent?key=${key}`,
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(postData)
        }
    };

    const req = https.request(options, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => console.log("\nResponse:", res.statusCode, body.substring(0, 500)));
    });

    req.on('error', (e) => console.error(e));
    req.write(postData);
    req.end();
}
test();
