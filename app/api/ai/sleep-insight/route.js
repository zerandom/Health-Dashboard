import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getSupabaseAdmin } from '@/lib/supabase';
import { NextResponse } from 'next/server';
import { SLEEP_ANALYST_SYSTEM_PROMPT, buildSleepAnalystDataPrompt } from '@/lib/prompts';
import { retrieveLiteratureContext } from '@/lib/rag';

// GET /api/ai/sleep-insight — dual-layer sleep & recovery analysis
export async function GET(request) {
  const TARGET_API_KEY = process.env.COACH_GEMINI_KEY;
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const regen = searchParams.get('regen') === '1';
  const temperature = regen ? 0.7 : 0.4;

  if (!TARGET_API_KEY || TARGET_API_KEY === 'your_gemini_api_key_here' || TARGET_API_KEY.length < 10) {
    console.error(`[Sleep AI] API Key Missing or Invalid. Key exists: ${!!TARGET_API_KEY}`);
    return NextResponse.json({ insight: 'API Key Required (COACH_GEMINI_KEY).' });
  }

  const supabase = getSupabaseAdmin();
  const userEmail = session.user.email.toLowerCase();
  const todayKey = new Date().toISOString().split('T')[0];

  const { data } = await supabase
    .from('health_data')
    .select('payload, ai_cache')
    .eq('user_email', userEmail)
    .single();

  if (!data?.payload) return NextResponse.json({ insight: 'No data found.' });

  const cached = data.ai_cache?.sleep_insight;
  if (!regen && cached?.date === todayKey && cached?.insight) {
    return NextResponse.json({ insight: cached.insight, cached: true });
  }

  const payload = data.payload;
  const lookback = 14;
  const dates = (payload.dates ?? []).slice(-lookback);

  // Read from the new nested `parsed` JSON structure, with fallback to legacy `raw` flat structure
  const hrv = (payload.recovery?.hrv ?? payload.hrv ?? []).slice(-lookback);
  const rhr = (payload.recovery?.rhr ?? payload.rhr ?? []).slice(-lookback);
  const deep = (payload.sleep?.deep ?? payload.sleepDeep ?? []).slice(-lookback);
  const rem = (payload.sleep?.rem ?? payload.sleepREM ?? []).slice(-lookback);
  const core = (payload.sleep?.core ?? payload.sleepCore ?? []).slice(-lookback);
  const bedtimes = (payload.sleepBedtimes ?? []).slice(-lookback);
  const wakeups = (payload.sleepWakeups ?? []).slice(-lookback);

  const summary = dates.map((d, i) =>
    `Date: ${d}, HRV: ${hrv[i] || '--'}, RHR: ${rhr[i] || '--'}, Deep: ${deep[i] || 0}m, REM: ${rem[i] || 0}m, Core: ${core[i] || 0}m, Bedtime: ${bedtimes[i] ?? 'N/A'}, Wakeup: ${wakeups[i] ?? 'N/A'}`
  ).join('\n');

  // Compute stats
  const avg = (arr) => arr.length ? Math.round(arr.reduce((a, b) => a + (b || 0), 0) / arr.length) : 0;
  const avgDeep = avg(deep);
  const avgREM = avg(rem);
  const avgCore = avg(core);
  const avgTotal = ((avgDeep + avgREM + avgCore) / 60).toFixed(1);
  const avgRHR = avg(rhr);

  const effs = payload.signals?.efficiency?.slice(-lookback).filter(Boolean) || [];
  const avgEfficiency = effs.length ? Math.round(effs.reduce((a,b)=>a+b,0)/effs.length) : 'N/A';

  // HRV Trend
  const hrvLast7 = avg(hrv.slice(-7));
  const hrvPrev7 = avg(hrv.slice(0, hrv.length - 7));
  const hrvTrend = hrvLast7 - hrvPrev7;
  const hrvTrendDir = hrvTrend > 0 ? 'Improving' : hrvTrend < 0 ? 'Declining' : 'Stable';

  // Bedtime consistency
  const parseTimeToMins = (t) => {
    if (!t) return null;
    const match = t.match(/(\d+):(\d+)\s*(AM|PM)?/i);
    if (!match) return null;
    let h = parseInt(match[1], 10);
    if (match[3]?.toUpperCase() === 'PM' && h < 12) h += 12;
    if (match[3]?.toUpperCase() === 'AM' && h === 12) h = 0;
    let total = h * 60 + parseInt(match[2], 10);
    if (total < 12 * 60) total += 24 * 60; // shift morning times relative to previous night
    return total;
  };
  const bedMins = bedtimes.map(parseTimeToMins).filter(m => m !== null);
  const stdDev = (arr) => {
    if (!arr.length) return 0;
    const mean = arr.reduce((a,b)=>a+b,0)/arr.length;
    return Math.round(Math.sqrt(arr.reduce((a,b)=>a+Math.pow(b-mean,2),0)/arr.length));
  };
  const bedtimeStdDevMins = stdDev(bedMins);
  const bedtimeQuality = bedtimeStdDevMins < 30 ? 'Excellent' : bedtimeStdDevMins < 60 ? 'Good' : 'Irregular';

  const dailyMins = payload.workoutMinutes || [];
  const weeklyLoadMins = dailyMins.slice(-7).reduce((a,b) => a + (b||0), 0);
  const workoutsDetailed = payload.workouts || [];
  const lastHardSession = (() => {
    for (let i = workoutsDetailed.length - 1; i >= 0; i--) {
      const ws = workoutsDetailed[i] || [];
      const hard = ws.find(w => (w.avgHR > 0.8 * 180) || w.duration > 60);
      if (hard) return `${payload.dates[i]}: ${hard.type} ${hard.duration}m`;
    }
    return 'None in last 14 days';
  })();

  const ragQuery = [
    avgTotal < 7 ? 'sleep deprivation recovery' : '',
    avgDeep < 60 ? 'deep sleep optimization human growth hormone' : '',
    bedtimeStdDevMins > 45 ? 'circadian rhythm bedtime consistency social jetlag' : '',
    'sleep architecture optimization'
  ].filter(Boolean).join(', ');

  const literatureContext = await retrieveLiteratureContext(ragQuery, null, 3);

  const SYSTEM_PROMPT = SLEEP_ANALYST_SYSTEM_PROMPT;
  const DATA_PROMPT = buildSleepAnalystDataPrompt({
    avgDeep, avgREM, avgCore, avgTotal, avgEfficiency,
    hrvTrend, hrvTrendDir, avgRHR,
    bedtimeStdDevMins, bedtimeQuality,
    summary, literatureContext,
    weeklyLoadMins, loadPctLabel: `${Math.round((weeklyLoadMins/500)*100)}%`, lastHardSession
  });

  const cleanKey = (TARGET_API_KEY || '').trim().replace(/[\s"']/g, '');
  const models = ['gemini-3.1-flash-lite', 'gemini-2.5-flash', 'gemini-2.5-flash-lite'];
  let insight = null;
  let lastError = null;

  for (const model of models) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': cleanKey
        },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
          contents: [{ parts: [{ text: DATA_PROMPT }] }],
          generationConfig: {
            temperature,
            maxOutputTokens: 600,
            ...(model.includes('2.5') ? { thinkingConfig: { thinkingBudget: 0 } } : {})
          },
        }),
        cache: 'no-store'
      });

      const json = await res.json();
      
      if (res.ok && json.candidates?.[0]) {
        insight = json.candidates[0].content.parts[0].text.trim();
        break;
      } else {
        throw new Error(json.error?.message || `HTTP ${res.status}: API responded without candidates`);
      }
    } catch (e) {
      lastError = e.message;
      console.warn(`[Sleep AI] Attempt ${model} failed: ${lastError}`);
    }
  }

  if (insight) {
    await supabase.from('health_data')
      .update({ ai_cache: { ...(data.ai_cache || {}), sleep_insight: { date: todayKey, insight } } })
      .eq('user_email', userEmail);
    return NextResponse.json({ insight });
  }
  return NextResponse.json({
    insight: `Sleep Analyst failed to initialize. Try again in a few minutes. (Debug: ${lastError})`,
    is_mock: true
  });
}
