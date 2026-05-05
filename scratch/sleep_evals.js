/**
 * EKATRA — Sleep Analyst Prompt Eval Suite
 * ─────────────────────────────────────────
 * Tests Prompt 2 (Sleep Analyst) against the new system_instruction format.
 * Run: node scratch/sleep_evals.js
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

// ── API Key ───────────────────────────────────────────────────────────────────
const envPath = path.join(__dirname, '../.env.local');
let apiKey = '';
try {
  const raw = fs.readFileSync(envPath, 'utf8');
  const matchCoach = raw.match(/COACH_GEMINI_KEY=([^\r\n]+)/);
  const matchGoogle = raw.match(/GOOGLE_API_KEY=([^\r\n]+)/);
  apiKey = (matchCoach || matchGoogle)?.[1]?.trim().replace(/[\s"']/g, '') || '';
} catch (e) {
  console.error('Could not read .env.local');
  process.exit(1);
}
if (!apiKey) { console.error('API Key not found.'); process.exit(1); }

// ── System + Data Prompt (mirrors lib/prompts.js) ─────────────────────────────
const SYSTEM_PROMPT = `You are EKATRA's Sleep Strategist. Analyze 14 days of biometric data and
deliver a structured sleep coaching report. Be specific with numbers. No generic advice.
Never diagnose. Always complete every sentence. Max 180 words total.`;

function buildDataPrompt(d) {
  return `PRE-COMPUTED SUMMARY (last 14 days)
Avg Deep Sleep: ${d.avgDeep}m | Avg REM: ${d.avgREM}m | Avg Core: ${d.avgCore}m
Avg Total Sleep: ${d.avgTotal}h | Avg Sleep Efficiency: ${d.avgEfficiency}%
HRV trend: ${d.hrvTrend} (${d.hrvTrendDir}) | Avg RHR: ${d.avgRHR} bpm
Bedtime consistency: ±${d.bedtimeStdDevMins}m variance (${d.bedtimeQuality})

RAW NIGHTLY DATA (most recent 14 nights)
${d.summary}

RESPONSE FORMAT — use these exact headers:
**WHAT'S GOING WELL**
[2-3 specific wins with numbers]

**WHAT NEEDS ATTENTION**
[2-3 specific risks or declining trends with numbers]

**YOUR NEXT MOVE**
[3-4 sentences of concrete, actionable next steps — no vague advice]`;
}

// ── Test Cases ─────────────────────────────────────────────────────────────────
const testCases = [
  {
    name: '🟢 Good Sleep Case — High Efficiency & Deep Sleep',
    description: 'Efficiency > 88% and Deep Sleep > 90m. The AI should highlight this as a win.',
    data: {
      avgDeep: 105, avgREM: 95, avgCore: 240, avgTotal: 7.3, avgEfficiency: 92,
      hrvTrend: 4, hrvTrendDir: 'Improving', avgRHR: 52,
      bedtimeStdDevMins: 20, bedtimeQuality: 'Excellent',
      summary: `Date: 2026-04-20, HRV: 60, RHR: 51, Deep: 110m, REM: 90m, Core: 240m, Bedtime: 10:30 PM, Wakeup: 6:30 AM\n(Repeated good nights...)`
    },
    assertions: {
      requireHeaders: true,
      forbiddenWords: ['you may have', 'disorder', 'syndrome', 'consult a doctor'],
      requireGoodSleepMention: true // Checks "WHAT'S GOING WELL" for deep/efficiency
    }
  },
  {
    name: '🔴 Poor Sleep Case — Low Efficiency & Irregular Bedtime',
    description: 'Efficiency < 75% and Bedtime Variance > 45m. AI should flag consistency or efficiency.',
    data: {
      avgDeep: 45, avgREM: 60, avgCore: 180, avgTotal: 4.8, avgEfficiency: 70,
      hrvTrend: -8, hrvTrendDir: 'Declining', avgRHR: 62,
      bedtimeStdDevMins: 65, bedtimeQuality: 'Irregular',
      summary: `Date: 2026-04-20, HRV: 40, RHR: 64, Deep: 40m, REM: 50m, Core: 150m, Bedtime: 1:30 AM, Wakeup: 7:00 AM\n(Repeated poor nights...)`
    },
    assertions: {
      requireHeaders: true,
      forbiddenWords: ['you may have', 'disorder', 'syndrome', 'consult a doctor'],
      requirePoorSleepMention: true // Checks "WHAT NEEDS ATTENTION" for consistency/efficiency
    }
  }
];

// ── Gemini Call ───────────────────────────────────────────────────────────────
function callGemini(systemPrompt, dataPrompt) {
  const postData = JSON.stringify({
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents: [{ role: 'user', parts: [{ text: dataPrompt }] }],
    generationConfig: { temperature: 0.1, maxOutputTokens: 600 },
  });

  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'generativelanguage.googleapis.com',
      port: 443,
      path: `/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) },
    };
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => {
        try {
          const json = JSON.parse(body);
          const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
          if (!text) reject(new Error(json.error?.message || 'No candidates'));
          else resolve(text.trim());
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

// ── Eval Runner ───────────────────────────────────────────────────────────────
async function runEvals() {
  console.log('\\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║       EKATRA — Sleep Analyst Prompt Eval Suite              ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\\n');

  let totalPass = 0, totalFail = 0;

  for (const tc of testCases) {
    console.log(`\\n┌─ ${tc.name}`);
    console.log(`│  ${tc.description}\\n│`);

    let response;
    try {
      response = await callGemini(SYSTEM_PROMPT, buildDataPrompt(tc.data));
    } catch (e) {
      console.log(`│  ❌ API call failed: ${e.message}\\n└`);
      totalFail++;
      continue;
    }

    console.log('│  [AI OUTPUT]');
    response.split('\\n').forEach(line => console.log(`│    ${line}`));
    console.log('│');

    const evalResults = [];
    const lc = response.toLowerCase();

    // [S] Structure: Headers
    const hasH1 = response.includes("**WHAT'S GOING WELL**");
    const hasH2 = response.includes("**WHAT NEEDS ATTENTION**");
    const hasH3 = response.includes("**YOUR NEXT MOVE**");
    evalResults.push({ cat: 'S', name: 'Has all 3 required headers', pass: hasH1 && hasH2 && hasH3 });

    // [Q] No disclaimers/diagnosis
    const foundDisc = tc.assertions.forbiddenWords.filter(d => lc.includes(d));
    evalResults.push({ cat: 'Q', name: 'No medical diagnosis or disclaimers', pass: foundDisc.length === 0, detail: foundDisc.length ? `Found: ${foundDisc.join(', ')}` : null });

    // [L] Word count
    const words = response.split(/\s+/).filter(Boolean).length;
    evalResults.push({ cat: 'L', name: `Word count ≤ 200 (got ${words})`, pass: words <= 200 });

    // [Q] Sentence completeness
    const endsWithPunctuation = /[.!?]$/.test(response.trim());
    evalResults.push({ cat: 'Q', name: 'Ends in a complete sentence', pass: endsWithPunctuation });

    // [G] Good sleep logic
    if (tc.assertions.requireGoodSleepMention) {
      // Get text inside WHAT'S GOING WELL
      const sectionMatch = response.match(/\*\*WHAT'S GOING WELL\*\*([\s\S]*?)(?=\*\*WHAT NEEDS ATTENTION\*\*)/i);
      const sectionText = sectionMatch ? sectionMatch[1].toLowerCase() : '';
      const mentionsGood = sectionText.includes('deep') || sectionText.includes('efficiency');
      evalResults.push({ cat: 'G', name: 'Good Sleep: Highlights Deep Sleep or Efficiency', pass: mentionsGood });
    }

    // [G] Poor sleep logic
    if (tc.assertions.requirePoorSleepMention) {
      const sectionMatch = response.match(/\*\*WHAT NEEDS ATTENTION\*\*([\s\S]*?)(?=\*\*YOUR NEXT MOVE\*\*)/i);
      const sectionText = sectionMatch ? sectionMatch[1].toLowerCase() : '';
      const mentionsPoor = sectionText.includes('consistency') || sectionText.includes('variance') || sectionText.includes('efficiency') || sectionText.includes('irregular');
      evalResults.push({ cat: 'G', name: 'Poor Sleep: Flags Consistency or Efficiency', pass: mentionsPoor });
    }

    let tcPassed = true;
    evalResults.forEach(r => {
      const icon = r.pass ? '✅' : '❌';
      const det = r.detail && !r.pass ? `  → ${r.detail}` : '';
      console.log(`│  ${icon} [${r.cat}] ${r.name}${det}`);
      if (!r.pass) tcPassed = false;
    });

    console.log('│\n└─ ' + (tcPassed ? '✅ PASSED' : '❌ FAILED'));
    if (tcPassed) totalPass++; else totalFail++;
  }

  console.log(`\n╔══════════════════════════════════════════════════════════════╗`);
  console.log(`║  RESULT: ${totalPass}/${totalPass + totalFail} passed  (${totalFail} failed)                        ║`);
  console.log(`╚══════════════════════════════════════════════════════════════╝\n`);
}

runEvals();
