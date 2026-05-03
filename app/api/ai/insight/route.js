import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getSupabaseAdmin } from '@/lib/supabase';
import { NextResponse } from 'next/server';

// GET /api/ai/insight — personalized Training Coach AI
export async function GET(request) {
  const TARGET_API_KEY = process.env.COACH_GEMINI_KEY || process.env.GOOGLE_API_KEY;
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const energy = searchParams.get('energy') || 'Not provided';
  const notes = searchParams.get('note') || 'Not provided';

  if (!TARGET_API_KEY || TARGET_API_KEY === 'your_gemini_api_key_here' || TARGET_API_KEY.length < 10) {
    console.error(`[AI Coach] API Key Missing or Invalid. Key exists: ${!!TARGET_API_KEY}`);
    return NextResponse.json({ insight: 'AI Insights require a valid Gemini API Key in your .env.local file.', is_mock: true });
  }

  const supabase = getSupabaseAdmin();
  const userEmail = session.user.email.toLowerCase();
  const { data } = await supabase
    .from('health_data')
    .select('payload')
    .eq('user_email', userEmail)
    .single();

  if (!data?.payload) {
    return NextResponse.json({ insight: 'No health data found. Import your export.xml first.' });
  }

  const p = data.payload;
  const n = p.dates?.length || 0;
  if (n < 7) {
    return NextResponse.json({ insight: 'Insufficient data for coaching. Please import at least 7 days of history.' });
  }

  // ── 1. USER METRICS & BASELINES ───────────────────────────────────────────
  const user = p.user || { dob: null, maxHR: null };
  const age = user.dob ? (new Date().getFullYear() - new Date(user.dob).getFullYear()) : 30;
  const maxHR = user.maxHR || (220 - age);

  const last30_hrv = (p.hrv || []).slice(-30).filter(v => v !== null);
  const last30_rhr = (p.rhr || []).slice(-30).filter(v => v !== null);
  const avg_hrv = (last30_hrv.reduce((a, b) => a + b, 0) / (last30_hrv.length || 1)).toFixed(1);
  const avg_rhr = (last30_rhr.reduce((a, b) => a + b, 0) / (last30_rhr.length || 1)).toFixed(1);

  // ── 2. RECOVERY WINDOW COMPUTATION ────────────────────────────────────────
  // Definition: Hrs until both HRV/RHR return to 7-day pre-workout baseline
  const computeRecoveryWindow = () => {
    const workouts = p.workouts || []; // Array of arrays per date
    let totalWindowHrs = 0;
    let counts = 0;

    for (let i = 7; i < n - 3; i++) {
      const dayWorkouts = workouts[i] || [];
      const isHard = dayWorkouts.some(w => (w.avgHR > maxHR * 0.8) || (w.duration > 60));
      if (!isHard) continue;

      // Establish 7-day baseline *before* this workout
      const baseHRV = (p.hrv.slice(i - 7, i).reduce((a, b) => a + b, 0) / 7);
      const baseRHR = (p.rhr.slice(i - 7, i).reduce((a, b) => a + b, 0) / 7);

      // Find when it returns
      for (let next = 1; next <= 4; next++) {
        const curHRV = p.hrv[i + next];
        const curRHR = p.rhr[i + next];
        if (curHRV >= baseHRV * 0.95 && curRHR <= baseRHR + 3) {
          totalWindowHrs += (next * 24);
          counts++;
          break;
        }
      }
    }
    return counts > 0 ? Math.round(totalWindowHrs / counts) : 48; // Default to 48 if no data
  };

  const recoveryWindow = computeRecoveryWindow();

  // ── 3. WEEKLY LOAD CEILING ───────────────────────────────────────────────
  const computeLoadStats = () => {
    const dailyMinutes = p.workoutMinutes || [];
    const workoutsDetailed = p.workouts || [];

    const getIntensity = (w) => {
      if (w.avgHR > maxHR * 0.9) return 2.5;
      if (w.avgHR > maxHR * 0.8) return 2.0;
      if (w.avgHR > maxHR * 0.7) return 1.5;
      // Fallback by type
      const t = (w.type || '').toLowerCase();
      if (t.includes('run') || t.includes('cycle') || t.includes('hiit')) return 1.8;
      if (t.includes('strength') || t.includes('core')) return 1.3;
      return 1.0;
    };

    const dailyLoad = dailyMinutes.map((m, i) => {
      const detail = workoutsDetailed[i] || [];
      if (detail.length === 0) return 0;
      return detail.reduce((acc, w) => acc + (w.duration * getIntensity(w)), 0);
    });

    // Group into weeks
    const weeks = [];
    for (let i = 0; i < n; i += 7) {
      const weekLoad = dailyLoad.slice(i, i + 7).reduce((a, b) => a + b, 0);
      const nextWeekHRV = (p.hrv.slice(i + 7, i + 14).reduce((a, b) => a + b, 0) / 7);
      weeks.push({ load: weekLoad, nextHRV: nextWeekHRV });
    }

    // Find ceiling (load where next week HRV drops > 8%)
    const sorted = weeks.filter(w => !isNaN(w.nextHRV)).sort((a, b) => a.load - b.load);
    let ceiling = 500; // Default
    if (sorted.length > 4) {
      const baselineNextHRV = sorted.slice(0, 3).reduce((acc, w) => acc + w.nextHRV, 0) / 3;
      const dropPoint = sorted.find(w => w.nextHRV < baselineNextHRV * 0.92);
      if (dropPoint) ceiling = Math.round(dropPoint.load);
    }

    const currentWeekLoad = dailyLoad.slice(-7).reduce((a, b) => a + b, 0);
    return { ceiling, currentWeekLoad };
  };

  const { ceiling: loadCeiling, currentWeekLoad } = computeLoadStats();

  // ── 4. LOGS & READINESS ──────────────────────────────────────────────────
  const lookback = 7;
  const historyDates = p.dates.slice(-lookback);
  const historyHrv = p.hrv.slice(-lookback);
  const historyRhr = p.rhr.slice(-lookback);
  const historyWorkouts = (p.workouts ?? []).slice(-lookback);

  const seven_day_log = historyDates.map((d, i) => {
    const ws = historyWorkouts[i] || [];
    const wStr = ws.length ? ws.map(w => `${w.type} (${w.duration}m${w.avgHR ? `, ${Math.round(w.avgHR)}bpm` : ''})`).join(', ') : 'rest';
    return `[${d}]: HRV ${historyHrv[i] || '--'} ms, RHR ${historyRhr[i] || '--'} bpm, Workout: ${wStr}`;
  }).join('\n');

  const today_hrv = p.hrv[n - 1];
  const today_rhr = p.rhr[n - 1];
  const today_deep = (p.sleepDeep || []).slice(-1)[0] || 0;
  const today_rem = (p.sleepREM || []).slice(-1)[0] || 0;
  const today_core = (p.sleepCore || []).slice(-1)[0] || 0;
  const lastSleep = today_deep + today_rem + today_core;
  const today_sleep_hrs = (lastSleep / 60).toFixed(1);
  const today_bedtime = (p.sleepBedtimes || []).slice(-1)[0] || '--:--';

  // ── 5. ENRICHMENT SIGNALS ────────────────────────────────────────────────

  // A. Stress Debt: 7d rolling avg vs 21d rolling avg
  const hrv7dAvg = parseFloat(avg_hrv);
  const hrv21d = (p.hrv || []).slice(-21).filter(v => v !== null);
  const hrv21dAvg = hrv21d.length ? (hrv21d.reduce((a, b) => a + b, 0) / hrv21d.length).toFixed(1) : avg_hrv;
  const stressDebtDelta = (hrv7dAvg - parseFloat(hrv21dAvg)).toFixed(1);
  const stressDebtNarrative = parseFloat(stressDebtDelta) < -4
    ? `STRESS DEBT DETECTED: Your 7-day avg HRV (${hrv7dAvg}ms) is ${Math.abs(stressDebtDelta)}ms below your 21-day avg (${hrv21dAvg}ms). Fatigue is accumulating — treat this as a hard constraint against high-intensity work.`
    : `Recovery load is balanced: 7-day avg HRV (${hrv7dAvg}ms) is within ${Math.abs(stressDebtDelta)}ms of your 21-day avg (${hrv21dAvg}ms).`;

  // B. Sleep efficiency
  const sleepEfficiency = (p.signals?.efficiency?.slice(-1)[0]) ?? null;

  // C. Day-before correlations — pre-interpreted into plain English
  const computeDayBeforeCorrelations = () => {
    const window = Math.min(60, n - 1);
    const sleepPairs = [], bedPairs = [], workPairs = [];
    for (let i = 1; i <= window; i++) {
      const todayHrv = p.hrv[i];
      const baseline = p.hrv.slice(Math.max(0, i - 7), i).filter(Boolean);
      if (!todayHrv || baseline.length < 3) continue;
      const baseAvg = baseline.reduce((a, b) => a + b, 0) / baseline.length;
      const delta = todayHrv - baseAvg;
      const sleepMins = (p.sleepDeep?.[i-1]||0) + (p.sleepREM?.[i-1]||0) + (p.sleepCore?.[i-1]||0);
      sleepPairs.push({ x: sleepMins / 60, delta });
      const bed = p.sleepBedtimes?.[i-1];
      if (bed) {
        const h = new Date(bed).getHours();
        bedPairs.push({ x: (h >= 0 && h < 6) ? 1 : 0, delta });
      }
      workPairs.push({ x: (p.workoutMinutes?.[i-1] || 0) > 15 ? 1 : 0, delta });
    }
    const pearson = (pairs) => {
      if (pairs.length < 10) return null;
      const xs = pairs.map(p => p.x), ys = pairs.map(p => p.delta);
      const mx = xs.reduce((a,b)=>a+b,0)/xs.length, my = ys.reduce((a,b)=>a+b,0)/ys.length;
      const num = xs.reduce((s,x,i)=>s+(x-mx)*(ys[i]-my),0);
      const den = Math.sqrt(xs.reduce((s,x)=>s+(x-mx)**2,0)*ys.reduce((s,y)=>s+(y-my)**2,0));
      return den ? +(num/den).toFixed(2) : null;
    };
    return {
      sleepCorr: pearson(sleepPairs),
      bedCorr:   pearson(bedPairs),
      workCorr:  pearson(workPairs)
    };
  };
  const dayBefore = computeDayBeforeCorrelations();

  // D. Pre-interpret r-values into plain-English narratives
  const interpretCorr = (r, positiveLabel, negativeLabel) => {
    if (r === null) return null;
    const strength = Math.abs(r) > 0.5 ? 'strong' : Math.abs(r) > 0.3 ? 'moderate' : 'weak';
    const dir = r > 0 ? positiveLabel : negativeLabel;
    return `${strength} link (r=${r}): ${dir}`;
  };
  const corrNarratives = [
    interpretCorr(dayBefore.sleepCorr, 'more sleep → better next-morning HRV', 'more sleep → lower next-morning HRV (unusual — check stress/illness)'),
    interpretCorr(dayBefore.bedCorr !== null ? dayBefore.bedCorr * -1 : null, 'earlier bedtime → better HRV', 'late nights are taxing your recovery'),
    interpretCorr(dayBefore.workCorr, 'workout days boost next-morning HRV', 'workout days suppress next-morning HRV (may be over-training)')
  ].filter(Boolean);

  // E. Date context
  const now = new Date();
  const today_date = now.toISOString().split('T')[0];
  const day_of_week = now.toLocaleDateString('en-US', { weekday: 'long' });

  // F. Table-formatted 7-day log
  const seven_day_table = [
    'Date       | HRV (ms) | RHR (bpm) | Workout',
    '-----------|----------|-----------|--------',
    ...historyDates.map((d, i) => {
      const ws = historyWorkouts[i] || [];
      const wStr = ws.length
        ? ws.map(w => `${w.type} ${w.duration}m${w.avgHR ? ` @${Math.round(w.avgHR)}bpm` : ''}`).join(', ')
        : 'rest';
      const pad = (s, l) => String(s).padEnd(l);
      return `${pad(d, 11)}| ${pad(historyHrv[i] || '--', 9)}| ${pad(historyRhr[i] || '--', 10)}| ${wStr}`;
    })
  ].join('\n');

  const loadPct = loadCeiling > 0 ? Math.min(Math.round((currentWeekLoad / loadCeiling) * 100), 300) : 0;
  const loadPctLabel = loadPct >= 300 ? '>300% (significantly over ceiling)' : `${loadPct}% of ceiling`;
  const SYSTEM_PROMPT = `You are EKATRA Coach — a no-fluff, data-first personal training advisor.
Your only job is to interpret this athlete's own biometric data and deliver one clear daily directive.
Rules you must never break:
- Never give generic health advice. Every sentence must reference a specific number from the data.
- Never add disclaimers ("as an AI", "consult a doctor", "I am not a medical professional").
- Never deviate from the 4-point output format below.
- Biometric data overrides subjective feeling. If HRV is crashed, do not recommend hard training even if energy is 9/10.
- Max 200 words total across all 4 points.`;

  const DATA_PROMPT = `TODAY: ${today_date} (${day_of_week})

ATHLETE BASELINES (last 30 days)
- Avg HRV: ${avg_hrv} ms  |  Avg RHR: ${avg_rhr} bpm
- Personal recovery window: ${recoveryWindow}h after hard sessions
- Weekly load ceiling: ${loadCeiling} min  |  This week so far: ${currentWeekLoad.toFixed(0)} min (${loadPctLabel})

LAST 7 DAYS
${seven_day_table}

TODAY'S READINESS
- HRV: ${today_hrv} ms  |  RHR: ${today_rhr} bpm
- Sleep: ${today_sleep_hrs}h, bedtime ${today_bedtime}${sleepEfficiency !== null ? `, efficiency ${sleepEfficiency}%` : ''}
- Subjective energy: ${energy}/10
- Notes: ${notes}

PHYSIOLOGICAL SIGNALS
- ${stressDebtNarrative}
${corrNarratives.length > 0 ? corrNarratives.map(c => `- Personal pattern: ${c}`).join('\n') : ''}

REQUIRED OUTPUT FORMAT (use exactly these labels, in this order):
1. Readiness: [Green / Amber / Red] — [one sentence citing the specific number(s) that drove this score]
2. Today: [train hard / train easy / active recovery / full rest] — [2-3 sentences referencing MY specific data]
3. Watch: [one metric + threshold to monitor over the next 3 days]
4. Pattern: [one observation from the 7-day log I might be missing]`;

  // ── 7. AI FETCH ──────────────────────────────────────────────────────────
  const cleanKey = (TARGET_API_KEY || '').trim().replace(/[\s"']/g, '');
  const models = ['gemini-2.0-flash', 'gemini-2.5-flash', 'gemini-2.5-flash-lite'];
  let insight = null;
  let lastError = null;

  console.log(`[AI Coach] Key prefix: "${cleanKey.substring(0, 10)}" | Load: ${currentWeekLoad.toFixed(0)}/${loadCeiling} min | HRV: ${today_hrv}ms vs ${avg_hrv}ms avg`);

  for (const model of models) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
      console.log(`[AI Coach] Trying model: ${model}`);

      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': cleanKey
        },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
          contents: [{ role: 'user', parts: [{ text: DATA_PROMPT }] }],
          generationConfig: {
            temperature: 0.4,
            maxOutputTokens: 1024,
            // Disable thinking for 2.5 models — thinking tokens consume output budget
            ...(model.includes('2.5') ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
          },
        }),
        cache: 'no-store'
      });

      const json = await res.json();
      console.log(`[AI Coach] ${model} → status ${res.status}, candidates: ${!!json.candidates?.[0]}`);

      if (res.ok && json.candidates?.[0]) {
        insight = json.candidates[0].content.parts[0].text.trim();
        break;
      } else {
        throw new Error(json.error?.message || `HTTP ${res.status}: no candidates`);
      }
    } catch (e) {
      lastError = e.message;
      console.warn(`[AI Coach] ${model} failed: ${lastError}`);
    }
  }

  if (insight) return NextResponse.json({ insight });
  return NextResponse.json({
    insight: `Coach failed to respond. (Debug: ${lastError})`,
    is_mock: true
  });
}
