import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getSupabaseAdmin } from '@/lib/supabase';
import { NextResponse } from 'next/server';
import { MACRO_ANALYST_SYSTEM_PROMPT, buildMacroAnalystDataPrompt } from '@/lib/prompts';

export async function GET(request) {
  const TARGET_API_KEY = process.env.COACH_GEMINI_KEY;
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const regen = searchParams.get('regen') === '1';
  const temperature = regen ? 0.7 : 0.4;

  if (!TARGET_API_KEY || TARGET_API_KEY === 'your_gemini_api_key_here' || TARGET_API_KEY.length < 10) {
    return NextResponse.json({ error: 'API Key Required (COACH_GEMINI_KEY).' }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  const userEmail = session.user.email.toLowerCase();
  
  const { data } = await supabase
    .from('health_data')
    .select('payload, ai_cache')
    .eq('user_email', userEmail)
    .single();

  if (!data?.payload) return NextResponse.json({ error: 'No data found.' }, { status: 404 });

  const now = Date.now();
  const cached = data.ai_cache?.macro_insight;
  const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
  
  if (!regen && cached?.timestamp && (now - cached.timestamp < SEVEN_DAYS_MS) && cached?.insight) {
    return NextResponse.json({ insight: cached.insight, cached: true });
  }

  const payload = data.payload;
  const lookback = 180;
  const dates = (payload.dates ?? []).slice(-lookback);
  const n = dates.length;
  
  if (n < 30) {
    return NextResponse.json({ error: 'Insufficient data for macro analysis (need at least 30 days).' }, { status: 400 });
  }

  const hrv = (payload.recovery?.hrv ?? payload.hrv ?? []).slice(-lookback);
  const deep = (payload.sleep?.deep ?? payload.sleepDeep ?? []).slice(-lookback);
  const effs = (payload.signals?.efficiency ?? []).slice(-lookback);
  
  // Format data
  let monthlyStats = {};
  let habitStats = {};
  let rawLogsArr = [];

  for (let i = 0; i < n; i++) {
    const dStr = dates[i];
    if (!dStr) continue;
    const dateObj = new Date(dStr);
    const monthKey = `${dateObj.getFullYear()}-${(dateObj.getMonth()+1).toString().padStart(2, '0')}`;
    
    const h = hrv[i] || 0;
    const dp = deep[i] || 0;
    const ef = effs[i] || 0;
    const tgs = payload.tags?.[dStr] || [];

    // Monthly
    if (!monthlyStats[monthKey]) monthlyStats[monthKey] = { hrv: [], deep: [], count: 0 };
    if (h) monthlyStats[monthKey].hrv.push(h);
    if (dp) monthlyStats[monthKey].deep.push(dp);
    monthlyStats[monthKey].count++;

    // Habits
    tgs.forEach(t => {
       if (!habitStats[t]) habitStats[t] = { hrv: [], deep: [], count: 0 };
       if (h) habitStats[t].hrv.push(h);
       if (dp) habitStats[t].deep.push(dp);
       habitStats[t].count++;
    });

    rawLogsArr.push(`${dStr} | ${h} | ${dp} | ${ef} | ${tgs.join(',')}`);
  }

  // Build prompt strings
  let monthlyAverages = Object.keys(monthlyStats).sort().map(m => {
    const st = monthlyStats[m];
    const avgH = st.hrv.length ? Math.round(st.hrv.reduce((a,b)=>a+b,0)/st.hrv.length) : 0;
    const avgD = st.deep.length ? Math.round(st.deep.reduce((a,b)=>a+b,0)/st.deep.length) : 0;
    return `${m}: Avg HRV=${avgH}, Avg Deep=${avgD} (Days=${st.count})`;
  }).join('\n');

  let habitCorrelations = Object.keys(habitStats).filter(t => habitStats[t].count > 5).map(t => {
    const st = habitStats[t];
    const avgH = st.hrv.length ? Math.round(st.hrv.reduce((a,b)=>a+b,0)/st.hrv.length) : 0;
    const avgD = st.deep.length ? Math.round(st.deep.reduce((a,b)=>a+b,0)/st.deep.length) : 0;
    return `${t} (${st.count}x): Avg HRV=${avgH}, Avg Deep=${avgD}`;
  }).join('\n');

  const DATA_PROMPT = buildMacroAnalystDataPrompt({
    days: n,
    monthlyAverages,
    habitCorrelations,
    rawLogs: rawLogsArr.join('\n')
  });

  const cleanKey = TARGET_API_KEY.trim().replace(/[\s"']/g, '');
  const model = 'gemini-2.5-flash';
  let insight = null;
  let lastError = null;

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': cleanKey },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: MACRO_ANALYST_SYSTEM_PROMPT }] },
        contents: [{ parts: [{ text: DATA_PROMPT }] }],
        generationConfig: {
          temperature,
          maxOutputTokens: 8192,
          responseMimeType: "application/json",
          ...(model.includes('2.5') ? { thinkingConfig: { thinkingBudget: 0 } } : {})
        },
      }),
      cache: 'no-store'
    });

    const json = await res.json();
    if (res.ok && json.candidates?.[0]) {
      let text = json.candidates[0].content.parts[0].text.trim();
      if (text.startsWith('```json')) text = text.replace(/^```json\n?/, '').replace(/\n?```$/, '');
      if (text.startsWith('```')) text = text.replace(/^```\n?/, '').replace(/\n?```$/, '');
      insight = JSON.parse(text);
    } else {
      throw new Error(json.error?.message || `API Error: ${res.status}`);
    }
  } catch (e) {
    console.error(`[Macro AI] Error:`, e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }

  if (insight) {
    await supabase.from('health_data')
      .update({ ai_cache: { ...(data.ai_cache || {}), macro_insight: { timestamp: now, insight } } })
      .eq('user_email', userEmail);
    return NextResponse.json({ insight });
  }
  
  return NextResponse.json({ error: 'Failed to generate insight.' }, { status: 500 });
}
