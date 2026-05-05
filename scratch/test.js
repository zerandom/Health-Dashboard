const https = require('https');

const postData = JSON.stringify({ contents: [{ parts: [{ text: "hi" }] }] });

const req = https.request('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=AIzaSyBVT0Vu_5pdey-HIHRoBLNbea_MNbpJzwk', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
}, res => {
    let d = '';
    res.on('data', c => d+=c);
    res.on('end', () => console.log("Response:", res.statusCode, d));
});
req.write(postData);
req.end();
