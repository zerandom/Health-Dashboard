/**
 * EKATRA — Training Coach Prompt Eval Suite
 * ─────────────────────────────────────────
 * Tests Prompt 1 (Training Coach) against the new system_instruction format.
 * Run: node scratch/coach_evals.js
 *
 * Eval categories:
 *   [S] Structure   — does the output follow the 4-point format?
 *   [L] Length      — is it within the 200-word cap?
 *   [Q] Quality     — no disclaimers, data-grounded?
 *   [G] Logic Gate  — does the scoring logic hold under edge cases?
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

// ── API Key ───────────────────────────────────────────────────────────────────
const envPath = path.join(__dirname, '../.env.local');
let apiKey = '';
try {
  const raw = fs.readFileSync(envPath, 'utf8');
  const match = raw.match(/COACH_GEMINI_KEY=(.*)/);
  const fallback = raw.match(/GOOGLE_API_KEY=(.*)/);
  apiKey = (match || fallback)?.[1]?.trim().replace(/[\s"']/g, '') || '';
} catch (e) {
  console.error('Could not read .env.local');
  process.exit(1);
}
if (!apiKey) { console.error('API Key not found.'); process.exit(1); }

// ── System Prompt (mirrors route.js SYSTEM_PROMPT exactly) ───────────────────
const SYSTEM_PROMPT = `You are EKATRA Coach — a no-fluff, data-first personal training advisor.
Your only job is to interpret this athlete's own biometric data and deliver one clear daily directive.
Rules you must never break:
- Never give generic health advice. Every sentence must reference a specific number from the data.
- Never add disclaimers ("as an AI", "consult a doctor", "I am not a medical professional").
- Never deviate from the 4-point output format below.
- Biometric data overrides subjective feeling. If HRV is crashed, do not recommend hard training even if energy is 9/10.
- Max 200 words total across all 4 points.`;

// ── Prompt Builder (mirrors route.js DATA_PROMPT construction) ────────────────
function buildDataPrompt(d) {
  const weekLoadPct = Math.round((d.currentWeekLoad / (d.loadCeiling || 1)) * 100);

  const corrNarratives = [];
  if (d.sleepCorr !== undefined && d.sleepCorr !== null) {
    const s = Math.abs(d.sleepCorr) > 0.5 ? 'strong' : Math.abs(d.sleepCorr) > 0.3 ? 'moderate' : 'weak';
    corrNarratives.push(`${s} link (r=${d.sleepCorr}): more sleep → better next-morning HRV`);
  }
  if (d.bedCorr !== undefined && d.bedCorr !== null) {
    const s = Math.abs(d.bedCorr) > 0.5 ? 'strong' : Math.abs(d.bedCorr) > 0.3 ? 'moderate' : 'weak';
    corrNarratives.push(`${s} link (r=${d.bedCorr}): earlier bedtime → better HRV`);
  }

  const stressDebtDelta = d.hrv_7d !== undefined ? (d.hrv_7d - d.hrv_21d).toFixed(1) : null;
  const stressDebtNarrative = stressDebtDelta !== null && parseFloat(stressDebtDelta) < -4
    ? `STRESS DEBT DETECTED: 7-day avg HRV (${d.hrv_7d}ms) is ${Math.abs(stressDebtDelta)}ms below 21-day avg (${d.hrv_21d}ms). Fatigue is accumulating — hard constraint against high-intensity work.`
    : (stressDebtDelta !== null
      ? `Recovery load is balanced: 7-day avg HRV within ${Math.abs(stressDebtDelta)}ms of 21-day avg.`
      : 'Stress debt data not available.');

  return `TODAY: 2026-05-03 (Saturday)

ATHLETE BASELINES (last 30 days)
- Avg HRV: ${d.avg_hrv} ms  |  Avg RHR: ${d.avg_rhr} bpm
- Personal recovery window: ${d.recoveryWindow}h after hard sessions
- Weekly load ceiling: ${d.loadCeiling} min  |  This week so far: ${d.currentWeekLoad} min (${weekLoadPct}% of ceiling)

LAST 7 DAYS
Date       | HRV (ms) | RHR (bpm) | Workout
-----------|----------|-----------|--------
${d.seven_day_log}

TODAY'S READINESS
- HRV: ${d.today_hrv} ms  |  RHR: ${d.today_rhr} bpm
- Sleep: ${d.today_sleep_hrs}h, bedtime ${d.today_bedtime}
- Subjective energy: ${d.energy}/10
- Notes: ${d.notes}

PHYSIOLOGICAL SIGNALS
- ${stressDebtNarrative}
${corrNarratives.length > 0 ? corrNarratives.map(c => `- Personal pattern: ${c}`).join('\n') : ''}

REQUIRED OUTPUT FORMAT (use exactly these labels, in this order):
1. Readiness: [Green / Amber / Red] — [one sentence citing the specific number(s) that drove this score]
2. Today: [train hard / train easy / active recovery / full rest] — [2-3 sentences referencing MY specific data]
3. Watch: [one metric + threshold to monitor over the next 3 days]
4. Pattern: [one observation from the 7-day log I might be missing]`;
}

// ── Test Cases ─────────────────────────────────────────────────────────────────
const testCases = [
  {
    name: '🔴 The Burnout — Overtrained',
    description: 'HRV crashed 33% below baseline, load 50% over ceiling, poor sleep.',
    data: {
      avg_hrv: 60, avg_rhr: 50, recoveryWindow: 24, loadCeiling: 300, currentWeekLoad: 450,
      hrv_7d: 44, hrv_21d: 61,
      today_hrv: 40, today_rhr: 58, today_sleep_hrs: 4.5, today_bedtime: '02:00 AM',
      energy: 2, notes: 'Legs very sore, feel wiped',
      sleepCorr: 0.42, bedCorr: 0.38,
      seven_day_log: [
        '2026-04-27  | 45        | 55        | Running 60m @162bpm',
        '2026-04-28  | 42        | 57        | HIIT 45m @170bpm',
        '2026-04-29  | 40        | 58        | rest',
        '2026-04-30  | 43        | 56        | Cycling 90m @155bpm',
        '2026-05-01  | 38        | 60        | rest',
        '2026-05-02  | 41        | 57        | Running 50m @158bpm',
        '2026-05-03  | 40        | 58        | rest',
      ].join('\n'),
    },
    assertions: {
      requireScore: 'Red',
      forbiddenWords: ['train hard', 'push yourself', 'high intensity', 'Green', 'Amber'],
    },
  },
  {
    name: '🟢 The Peak — Rested and Ready',
    description: 'HRV 18% above baseline, load at 25% of ceiling, great sleep.',
    data: {
      avg_hrv: 55, avg_rhr: 52, recoveryWindow: 48, loadCeiling: 400, currentWeekLoad: 100,
      hrv_7d: 62, hrv_21d: 56,
      today_hrv: 65, today_rhr: 48, today_sleep_hrs: 8.5, today_bedtime: '10:30 PM',
      energy: 9, notes: 'Feeling great',
      sleepCorr: 0.51, bedCorr: 0.44,
      seven_day_log: [
        '2026-04-27  | 58        | 51        | rest',
        '2026-04-28  | 60        | 50        | Yoga 30m',
        '2026-04-29  | 62        | 49        | rest',
        '2026-04-30  | 61        | 50        | Walking 40m',
        '2026-05-01  | 63        | 48        | rest',
        '2026-05-02  | 64        | 49        | rest',
        '2026-05-03  | 65        | 48        | rest',
      ].join('\n'),
    },
    assertions: {
      requireScore: 'Green',
      requireContainsAny: ['train hard', 'high intensity', 'HIIT', 'strength'],
    },
  },
  {
    name: '⚠️  The False Positive — Biometrics Override Subjective Energy',
    description: 'Energy 9/10 but HRV is 40% below baseline and RHR +10bpm. AI must not give Green.',
    data: {
      avg_hrv: 50, avg_rhr: 50, recoveryWindow: 36, loadCeiling: 350, currentWeekLoad: 200,
      hrv_7d: 32, hrv_21d: 51,
      today_hrv: 30, today_rhr: 60, today_sleep_hrs: 6.0, today_bedtime: '11:30 PM',
      energy: 9, notes: 'Feeling great actually, ready to crush it!',
      seven_day_log: [
        '2026-04-27  | 35        | 58        | rest',
        '2026-04-28  | 33        | 59        | rest',
        '2026-04-29  | 31        | 61        | rest',
        '2026-04-30  | 34        | 58        | rest',
        '2026-05-01  | 32        | 60        | rest',
        '2026-05-02  | 30        | 61        | rest',
        '2026-05-03  | 30        | 60        | rest',
      ].join('\n'),
    },
    assertions: {
      forbiddenWords: ['Readiness: Green', 'train hard'],
    },
  },
  {
    name: '🟡 The Stress Debt Case — HRV Divergence',
    description: '7-day HRV avg is 14ms below 21-day avg. Moderate subjective energy. Load at 80% of ceiling.',
    data: {
      avg_hrv: 60, avg_rhr: 53, recoveryWindow: 36, loadCeiling: 350, currentWeekLoad: 280,
      hrv_7d: 48, hrv_21d: 62,
      today_hrv: 52, today_rhr: 54, today_sleep_hrs: 7.0, today_bedtime: '11:00 PM',
      energy: 6, notes: 'Slightly sluggish',
      seven_day_log: [
        '2026-04-27  | 55        | 52        | Running 45m @158bpm',
        '2026-04-28  | 50        | 53        | Strength 60m',
        '2026-04-29  | 48        | 54        | HIIT 35m @168bpm',
        '2026-04-30  | 46        | 55        | rest',
        '2026-05-01  | 49        | 53        | Cycling 50m @150bpm',
        '2026-05-02  | 48        | 54        | rest',
        '2026-05-03  | 52        | 54        | rest',
      ].join('\n'),
    },
    assertions: {
      forbiddenWords: ['Readiness: Green', 'train hard'],
      requireContainsAny: ['stress', 'fatigue', 'debt', 'load', 'accumulated'],
    },
  },
  {
    name: '🔀 Conflicting Signals — Good Sleep, Bad HRV',
    description: '9h sleep but HRV dropped 29% from baseline. RHR elevated. Should be Amber or Red.',
    data: {
      avg_hrv: 55, avg_rhr: 52, recoveryWindow: 48, loadCeiling: 380, currentWeekLoad: 150,
      hrv_7d: 42, hrv_21d: 54,
      today_hrv: 39, today_rhr: 58, today_sleep_hrs: 9.0, today_bedtime: '9:45 PM',
      energy: 7, notes: 'Slept a lot, feel okay',
      sleepCorr: 0.38,
      seven_day_log: [
        '2026-04-27  | 52        | 52        | Running 55m @160bpm',
        '2026-04-28  | 48        | 53        | rest',
        '2026-04-29  | 44        | 55        | HIIT 40m @172bpm',
        '2026-04-30  | 41        | 57        | rest',
        '2026-05-01  | 40        | 58        | rest',
        '2026-05-02  | 38        | 59        | rest',
        '2026-05-03  | 39        | 58        | rest',
      ].join('\n'),
    },
    assertions: {
      forbiddenWords: ['Readiness: Green', 'train hard'],
    },
  },
];

// ── Gemini Fetch ──────────────────────────────────────────────────────────────
async function fetchGemini(systemPrompt, dataPrompt) {
  const postData = JSON.stringify({
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents: [{ role: 'user', parts: [{ text: dataPrompt }] }],
    // Use low temp for evals — reproducibility over creativity
    generationConfig: { temperature: 0.1, maxOutputTokens: 400 },
  });

  const options = {
    hostname: 'generativelanguage.googleapis.com',
    port: 443,
    path: `/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(postData),
    },
  };

  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (d) => (body += d));
      res.on('end', () => {
        try {
          const json = JSON.parse(body);
          const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
          if (!text) throw new Error(`No text in response: ${body.slice(0, 200)}`);
          resolve(text.trim());
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
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║       EKATRA — Training Coach Prompt Eval Suite             ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  let totalPass = 0, totalFail = 0;

  for (const tc of testCases) {
    console.log(`\n┌─ ${tc.name}`);
    console.log(`│  ${tc.description}`);
    console.log('│');

    let response;
    try {
      response = await fetchGemini(SYSTEM_PROMPT, buildDataPrompt(tc.data));
    } catch (e) {
      console.log(`│  ❌ API call failed: ${e.message}\n└`);
      totalFail++;
      continue;
    }

    console.log('│  [RAW OUTPUT]');
    response.split('\n').forEach(line => console.log(`│  ${line}`));
    console.log('│');

    const evalResults = [];
    const lc = response.toLowerCase();

    // [S] Structure: all 4 required labels present
    const has1 = /1\.\s*readiness\s*:/i.test(response);
    const has2 = /2\.\s*today\s*:/i.test(response);
    const has3 = /3\.\s*watch\s*:/i.test(response);
    const has4 = /4\.\s*pattern\s*:/i.test(response);
    evalResults.push({ cat: 'S', name: 'Has all 4 required labels', pass: has1 && has2 && has3 && has4,
      detail: [has1 ? null : 'missing "1. Readiness:"', has2 ? null : 'missing "2. Today:"',
                has3 ? null : 'missing "3. Watch:"', has4 ? null : 'missing "4. Pattern:"'].filter(Boolean).join(', ') });

    // [S] Score is exactly Green / Amber / Red
    const scoreMatch = response.match(/1\.\s*readiness\s*:\s*(green|amber|red)/i);
    const validScore = !!scoreMatch;
    evalResults.push({ cat: 'S', name: 'Readiness score is Green/Amber/Red', pass: validScore,
      detail: validScore ? `Detected: ${scoreMatch[1]}` : 'No valid score found' });

    // [L] Word count ≤ 210 (10-word buffer)
    const words = response.split(/\s+/).length;
    evalResults.push({ cat: 'L', name: `Word count ≤ 210 (found ${words})`, pass: words <= 210 });

    // [Q] No disclaimers
    const DISCLAIMERS = ['as an ai', 'not a doctor', 'consult a', 'medical professional', 'cannot provide medical', 'seek professional'];
    const foundDisclaimers = DISCLAIMERS.filter(d => lc.includes(d));
    evalResults.push({ cat: 'Q', name: 'No disclaimers', pass: foundDisclaimers.length === 0,
      detail: foundDisclaimers.length ? `Found: ${foundDisclaimers.join(', ')}` : null });

    // [Q] Data-grounded: response contains at least one number
    const hasNumber = /\d+(\.\d+)?\s*(ms|bpm|min|%|h|hrs)/.test(response);
    evalResults.push({ cat: 'Q', name: 'Contains at least one data number with unit', pass: hasNumber });

    // [G] Logic: required score
    if (tc.assertions.requireScore) {
      const actualScore = scoreMatch?.[1] || 'none';
      const pass = actualScore.toLowerCase() === tc.assertions.requireScore.toLowerCase();
      evalResults.push({ cat: 'G', name: `Score must be ${tc.assertions.requireScore}`,
        pass, detail: `Got: ${actualScore}` });
    }

    // [G] Logic: forbidden words
    if (tc.assertions.forbiddenWords) {
      const found = tc.assertions.forbiddenWords.filter(w => lc.includes(w.toLowerCase()));
      evalResults.push({ cat: 'G', name: 'Forbidden concepts absent', pass: found.length === 0,
        detail: found.length ? `Found: ${found.join(', ')}` : null });
    }

    // [G] Logic: required contains (any of)
    if (tc.assertions.requireContainsAny) {
      const found = tc.assertions.requireContainsAny.filter(w => lc.includes(w.toLowerCase()));
      evalResults.push({ cat: 'G', name: `Must mention at least one of: ${tc.assertions.requireContainsAny.join(' / ')}`,
        pass: found.length > 0, detail: found.length ? `Found: ${found.join(', ')}` : 'None found' });
    }

    // Print eval results
    let tcPassed = true;
    evalResults.forEach(r => {
      const icon = r.pass ? '✅' : '❌';
      const detail = r.detail && !r.pass ? `  → ${r.detail}` : '';
      console.log(`│  ${icon} [${r.cat}] ${r.name}${detail}`);
      if (!r.pass) tcPassed = false;
    });

    const verdict = tcPassed ? '✅ PASSED' : '❌ FAILED';
    console.log(`│`);
    console.log(`└─ Verdict: ${verdict}`);
    if (tcPassed) totalPass++; else totalFail++;

    // Small delay to avoid rate limiting
    await new Promise(r => setTimeout(r, 1500));
  }

  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log(`║  FINAL: ${totalPass}/${totalPass + totalFail} passed  (${totalFail} failed)${' '.repeat(Math.max(0, 36 - String(totalPass).length - String(totalFail).length))}║`);
  console.log('╚══════════════════════════════════════════════════════════════╝\n');
}

runEvals().catch(console.error);
