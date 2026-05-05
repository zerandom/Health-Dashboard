import fs from 'fs';
import { createClient } from '@supabase/supabase-js';

// ── 1. ENV LOADING ──
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
    } catch (e) {}
};
loadEnv();

const GOOGLE_API_KEY = process.env.COACH_GEMINI_KEY || process.env.GOOGLE_API_KEY;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
const EMBEDDING_MODEL = 'gemini-embedding-2';

// ── 2. RAG UTILITY (mirrored from lib/rag.js) ──
async function embedQuery(text) {
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
  const json = await res.json();
  return json.embedding.values;
}

async function retrieveLiteratureContext(query) {
  const embedding = await embedQuery(query);
  const { data, error } = await supabase.rpc('match_literature', {
    query_embedding:  embedding,
    match_count:      3,
    filter_category:  null
  });
  if (error || !data?.length) return '';
  const chunks = data.map(row => `[Source: ${row.source}]\n${row.chunk_text}`).join('\n\n---\n\n');
  return `COACHING LITERATURE (retrieved, similarity-ranked):\n${chunks}`;
}

// ── 3. PROMPTS (mirrored from lib/prompts.js) ──
const SYSTEM_PROMPT = `You are EKATRA Coach — a no-fluff, data-first personal training advisor.
Your only job is to interpret this athlete's own biometric data and deliver one clear daily directive.
Rules you must never break:
- Never give generic health advice. Every sentence must reference a specific number from the data.
- Never add disclaimers ("as an AI", "consult a doctor").
- Never deviate from the 4-point output format below.
- Biometric data overrides subjective feeling.
- Max 200 words total across all 4 points.`;

const buildDataPrompt = (d) => `TODAY: ${d.today_date}

ATHLETE BASELINES (last 30 days)
- Avg HRV: ${d.avg_hrv} ms  |  Avg RHR: ${d.avg_rhr} bpm

LAST 7 DAYS
${d.seven_day_table}

TODAY'S READINESS
- HRV: ${d.today_hrv} ms  |  RHR: ${d.today_rhr} bpm
- Sleep: ${d.today_sleep_hrs}h
- Subjective energy: ${d.energy}/10

PHYSIOLOGICAL SIGNALS
- ${d.stressDebtNarrative}

${d.literatureContext ? `\n${d.literatureContext}\n\nUse the literature above to cite specific mechanisms. Reference the source name when applicable.\n` : ''}
REQUIRED OUTPUT FORMAT (use exactly these labels, in this order):
1. Readiness: [Green / Amber / Red] — [one sentence citing the specific number(s)]
2. Today: [train hard / train easy / active recovery / full rest] — [2-3 sentences]
3. Watch: [one metric to monitor]
4. Pattern: [one observation]`;

// ── 4. EXECUTION ──
async function run() {
    console.log("Fetching test health data from Supabase...");
    const { data } = await supabase.from('health_data').select('payload').limit(1).single();
    
    if (!data) {
        console.log("No health data found in DB. Let's use a mock payload.");
    }
    
    // Use real data if exists, otherwise mock
    const p = data?.payload || {
        hrv: [50, 52, 48, 55, 45, 40, 38], // Downward trend
        rhr: [50, 50, 51, 50, 53, 55, 58], // Upward trend
        sleepDeep: [60, 60, 60, 60, 60, 60, 60],
        sleepREM: [60, 60, 60, 60, 60, 60, 60],
        sleepCore: [200, 200, 200, 200, 200, 200, 200],
        workouts: [[],[],[],[],[],[],[]],
        dates: ['2026-05-01','2026-05-02','2026-05-03','2026-05-04','2026-05-05','2026-05-06','2026-05-07']
    };

    const avg_hrv = 55; // Mock baseline
    const avg_rhr = 50; 
    const today_hrv = p.hrv.slice(-1)[0];
    const today_rhr = p.rhr.slice(-1)[0];
    
    console.log(`\nMetrics => Baseline HRV: ${avg_hrv}ms | Today HRV: ${today_hrv}ms`);

    // Generate RAG Query based on metrics
    const ragQuery = today_hrv < avg_hrv * 0.9 ? 'HRV drop below baseline recovery protocol negative stress debt' : 'training load management';
    console.log(`\n1. RAG Query Generated: "${ragQuery}"`);
    
    const literatureContext = await retrieveLiteratureContext(ragQuery);
    console.log(`\n2. Retrieved Context Length: ${literatureContext.length} chars`);
    if (literatureContext.includes('altini')) {
        console.log("   ✅ Successfully retrieved 'altini blog' RAG source!");
    } else {
        console.log("   ❌ RAG source missing or not retrieved.");
    }

    const dataPrompt = buildDataPrompt({
        today_date: new Date().toISOString().split('T')[0],
        avg_hrv, avg_rhr,
        today_hrv, today_rhr,
        today_sleep_hrs: 6.5,
        energy: 7,
        stressDebtNarrative: `STRESS DEBT DETECTED: 7-day HRV is significantly below baseline.`,
        seven_day_table: "Mock table omitted for brevity",
        literatureContext
    });

    console.log(`\n3. Sending to Gemini...`);
    
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GOOGLE_API_KEY },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
          contents: [{ role: 'user', parts: [{ text: dataPrompt }] }],
          generationConfig: { temperature: 0.4 }
        })
    });

    const json = await res.json();
    if (json.candidates) {
        console.log(`\n=== 🤖 AI COACH RESPONSE ===\n`);
        console.log(json.candidates[0].content.parts[0].text);
        console.log(`\n============================\n`);
    } else {
        console.log("Gemini Error:", json);
    }
}

run();
