const fs = require('fs');

const loadEnv = () => {
    try {
        const raw = fs.readFileSync('.env.local', 'utf8');
        raw.split('\n').forEach(line => {
            const match = line.match(/^([^=]+)=(.*)$/);
            if (match) {
                const key = match[1].trim();
                let val = match[2].trim().replace(/^['"]/, '').replace(/['"]$/, '');
                process.env[key] = val;
            }
        });
    } catch (e) {
        console.warn("Could not read .env.local");
    }
};
loadEnv();

const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY || process.env.COACH_GEMINI_KEY;

async function listModels() {
    const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${GOOGLE_API_KEY}`;
    try {
        const res = await fetch(url);
        const data = await res.json();
        
        if (data.error) {
            console.error("API Error:", data.error.message);
            return;
        }

        const embedModels = data.models.filter(m => 
            m.supportedGenerationMethods && m.supportedGenerationMethods.includes("embedContent")
        );
        
        console.log("=== Available Embedding Models ===");
        embedModels.forEach(m => console.log(m.name));
        console.log("==================================");

    } catch (e) {
        console.error("Fetch failed:", e.message);
    }
}

listModels();
