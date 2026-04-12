import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getSupabaseAdmin } from '@/lib/supabase';
import { NextResponse } from 'next/server';

const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;

function isValidKey(key) {
  return key && key !== 'your_gemini_api_key_here' && key.length > 10;
}

// GET /api/ai/insight — daily Coach AI card
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (!isValidKey(GOOGLE_API_KEY)) {
    return NextResponse.json({ insight: 'AI Insights require a valid Gemini API Key. Add GOOGLE_API_KEY to your environment variables.', is_mock: true });
  }

  const supabase = getSupabaseAdmin();
  const { data } = await supabase
    .from('health_data')
    .select('payload')
    .eq('user_email', session.user.email)
    .single();

  if (!data?.payload) {
    return NextResponse.json({ insight: 'No health data found. Import your export.xml first.' });
  }

  const payload = data.payload;
  const lookback = 14;
  const dates = (payload.dates ?? []).slice(-lookback);
  const hrv = (payload.recovery?.hrv ?? payload.hrv ?? []).slice(-lookback);
  const rhr = (payload.recovery?.rhr ?? payload.rhr ?? []).slice(-lookback);
  const sleepDeep = (payload.sleep?.deep ?? payload.sleepDeep ?? []).slice(-lookback);
  const sleepREM = (payload.sleep?.rem ?? payload.sleepREM ?? []).slice(-lookback);
  const workouts = (payload.workouts?.minutes ?? payload.workoutMinutes ?? []).slice(-lookback);

  const summary = dates.map((d, i) =>
    `Date: ${d}, HRV: ${hrv[i]}ms, RHR: ${rhr[i]}bpm, Deep Sleep: ${sleepDeep[i]}m, REM: ${sleepREM[i]}m, Workouts: ${workouts[i]}m`
  ).join('\n');

  const nowStr = new Date().toISOString();
  const prompt = `CURRENT TIME: ${nowStr}\nYou are the Ekatra Health Coach. Analyze the last 14 days of health data. Provide a single, proactive, and FRESH health insight (max 2 sentences). If the data is stagnant compared to previous days, explicitly mention it or find a minor nuance to highlight. Avoid repeating generic advice. Be punchy.\n\nDATA:\n${summary}`;

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${GOOGLE_API_KEY}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 1.0, maxOutputTokens: 100 },
      }),
    });
    const json = await res.json();
    if (!json.candidates || !json.candidates[0]) {
      console.error('[AI insight] Gemini API Error:', json);
      throw new Error(json.error?.message || 'Empty API candidate response');
    }
    const insight = json.candidates[0].content.parts[0].text.trim();
    return NextResponse.json({ insight });
  } catch (e) {
    console.error('[AI insight]', e);
    // Return 200 with a graceful fallback so the UI shows something meaningful
    return NextResponse.json({ insight: 'The AI Coach is taking a breather. Your data is loading — check back in a moment.' });
  }
}
