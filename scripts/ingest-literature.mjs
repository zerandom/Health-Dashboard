import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

// Manual ENV loading to avoid requiring 'dotenv'
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
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!GOOGLE_API_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error("Missing required environment variables (GOOGLE_API_KEY or COACH_GEMINI_KEY, NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)");
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
const EMBEDDING_MODEL = 'gemini-embedding-2';

// Simple text chunker (~500 chars per chunk with some overlap)
function chunkText(text, chunkSize = 2000, overlap = 200) {
    const chunks = [];
    let i = 0;
    while (i < text.length) {
        let end = i + chunkSize;
        // Try to snap to the nearest paragraph or sentence end
        if (end < text.length) {
            let nextNewline = text.lastIndexOf('\n', end);
            let nextPeriod = text.lastIndexOf('.', end);
            if (nextNewline > i + chunkSize / 2) end = nextNewline + 1;
            else if (nextPeriod > i + chunkSize / 2) end = nextPeriod + 1;
        }
        chunks.push(text.slice(i, end).trim());
        if (end >= text.length) break;
        i = end - overlap;
    }
    return chunks.filter(c => c.length > 50);
}

async function embedChunk(text) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${EMBEDDING_MODEL}:embedContent?key=${GOOGLE_API_KEY}`;
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model: `models/${EMBEDDING_MODEL}`,
            content: { parts: [{ text }] },
            outputDimensionality: 768
        })
    });
    if (!res.ok) {
        const err = await res.text();
        throw new Error(`Embedding failed: ${err}`);
    }
    const json = await res.json();
    return json.embedding.values;
}

async function run() {
    const litDir = path.join(process.cwd(), 'scripts', 'literature');
    if (!fs.existsSync(litDir)) {
        fs.mkdirSync(litDir, { recursive: true });
        console.log(`Created ${litDir}. Please add .txt files here.`);
        return;
    }

    const files = fs.readdirSync(litDir).filter(f => f.endsWith('.txt'));
    if (files.length === 0) {
        console.log(`No .txt files found in ${litDir}.`);
        return;
    }

    for (const file of files) {
        console.log(`Processing ${file}...`);
        const content = fs.readFileSync(path.join(litDir, file), 'utf8');
        
        // Infer category and source from filename
        // Example filename: hrv_altini_blog.txt
        const parts = file.replace('.txt', '').split('_');
        const category = parts[0]; // 'hrv'
        const source = parts.slice(1).join(' '); // 'altini blog'

        const chunks = chunkText(content);
        console.log(`  - Created ${chunks.length} chunks.`);
        
        // Remove old chunks for this source to prevent duplicates
        await supabase.from('coaching_literature').delete().eq('source', source);

        for (let i = 0; i < chunks.length; i++) {
            const chunkTextStr = chunks[i];
            console.log(`  - Embedding chunk ${i+1}/${chunks.length}...`);
            try {
                const vector = await embedChunk(chunkTextStr);
                
                const { error } = await supabase
                    .from('coaching_literature')
                    .insert({
                        source,
                        category,
                        chunk_text: chunkTextStr,
                        embedding: vector
                    });
                
                if (error) {
                    console.error(`  ❌ Supabase Error on chunk ${i+1}:`, error.message);
                } else {
                    console.log(`  ✅ Inserted chunk ${i+1}`);
                }
            } catch (e) {
                console.error(`  ❌ Failed chunk ${i+1}:`, e.message);
            }
            // slight delay to prevent rate limits
            await new Promise(r => setTimeout(r, 500));
        }
    }
    console.log("Ingestion complete!");
}

run();
