import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getSupabaseAdmin } from '@/lib/supabase';
import { NextResponse } from 'next/server';

const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;

// GET /api/ai/sleep-insight — dual-layer sleep & recovery analysis
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (!GOOGLE_API_KEY || GOOGLE_API_KEY === 'your_gemini_api_key_here') {
    return NextResponse.json({ insight: 'API Key Required.' });
  }

  const supabase = getSupabaseAdmin();
  const { data } = await supabase
    .from('health_data')
    .select('payload')
    .eq('user_email', session.user.email)
    .single();

  if (!data?.payload) return NextResponse.json({ insight: 'No data found.' });

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
    `Date: ${d}, HRV: ${hrv[i]}, RHR: ${rhr[i]}, Deep: ${deep[i]}m, REM: ${rem[i]}m, Core: ${core[i]}m, Bedtime: ${bedtimes[i] ?? 'N/A'}, Wakeup: ${wakeups[i] ?? 'N/A'}`
  ).join('\n');

  const prompt = `You are the Ekatra Health Scientist. Analyze the last 14 days of Sleep and Recovery data.\nDATA CONTEXT: Sleep Trend, HRV/RHR, AND Sleep/Wake Schedule consistency.\nProvide a 3-part response that GUIDES the user:\n1. WHAT'S GOING WELL: Focus on wins (max 1 sentence).\n2. WHAT'S GOING WRONG: Focus on risks (max 1 sentence).\n3. WHAT DOES IT MEAN: Actionable meaning (max 2 sentences).\n\nBe sophisticated with specific numbers. Avoid generic advice.\n\nDATA:\n${summary}`;

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${GOOGLE_API_KEY}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.8, maxOutputTokens: 400 },
      }),
    });
    const json = await res.json();
    if (!json.candidates || !json.candidates[0]) {
      console.error('[sleep-insight] Gemini API Error:', json);
      throw new Error(json.error?.message || 'Empty API candidate response');
    }
    const insight = json.candidates[0].content.parts[0].text.trim();
    return NextResponse.json({ insight });
  } catch (e) {
    console.error('[sleep-insight]', e);
    return NextResponse.json({ insight: 'Sleep analysis engine is warming up. Your biometric data is queued — check back shortly.' });
  }
}
