import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getSupabaseAdmin } from '@/lib/supabase';
import { NextResponse } from 'next/server';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const TARGET_API_KEY = process.env.COACH_GEMINI_KEY || process.env.GOOGLE_API_KEY;
  const cleanKey = (TARGET_API_KEY || '').trim().replace(/[\s"']/g, '');

  if (!cleanKey || cleanKey.length < 10) {
    return NextResponse.json({ anomaly: null });
  }

  const supabase = getSupabaseAdmin();
  const userEmail = session.user.email.toLowerCase();

  const { data } = await supabase
    .from('health_data')
    .select('payload')
    .eq('user_email', userEmail)
    .single();

  if (!data?.payload) return NextResponse.json({ anomaly: null });

  const p = data.payload;
  const hrvSeries = p.hrv || [];
  if (hrvSeries.length < 15) return NextResponse.json({ anomaly: null });

  const today_hrv = hrvSeries.slice(-1)[0];
  const window14 = hrvSeries.slice(-15, -1).filter(Boolean);
  if (window14.length === 0 || today_hrv === null || today_hrv === undefined) {
    return NextResponse.json({ anomaly: null });
  }

  const mean = window14.reduce((a, b) => a + b, 0) / window14.length;
  const std = Math.sqrt(window14.reduce((a, b) => a + (b - mean) ** 2, 0) / window14.length);
  const todayZ = (today_hrv - mean) / (std || 1);
  const isAnomaly = Math.abs(todayZ) > 1.8;

  if (!isAnomaly) {
    return NextResponse.json({ anomaly: null });
  }

  // Retrieve yesterday's workout details
  const yesterdayWorkout = ((p.workouts || []).slice(-2, -1)[0] || [])
    .map(w => `${w.type} ${w.duration}m`).join(', ') || 'Rest';

  // Fetch recent notes from tags table (past 3 days)
  const { data: recentTagData } = await supabase
    .from('tags')
    .select('date, notes')
    .eq('user_email', userEmail)
    .order('date', { ascending: false })
    .limit(3);

  const recentNotes = (recentTagData || [])
    .map(row => row.notes ? `${row.date}: ${row.notes}` : null)
    .filter(Boolean)
    .join('; ') || 'No recent notes logged.';

  const SYSTEM = `You are an anomaly explainer. In 2 sentences, explain the most likely physiological cause of today's unusual reading. No disclaimers. Cite the number.`;
  const DATA = `Metric: HRV | Today: ${today_hrv}ms | 14d average: ${mean.toFixed(1)}ms | Z-score: ${todayZ.toFixed(2)}
Yesterday's workout: ${yesterdayWorkout}
Recent notes: ${recentNotes}
OUTPUT: Two sentences. First: what happened (e.g. drop/spike to X ms). Second: most likely cause based on yesterday's workout and user tags.`;

  const models = ['gemini-3.1-flash-lite', 'gemini-2.5-flash', 'gemini-2.5-flash-lite'];
  let explanation = null;
  let lastError = null;

  for (const model of models) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': cleanKey },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: SYSTEM }] },
          contents: [{ role: 'user', parts: [{ text: DATA }] }],
          generationConfig: {
            temperature: 0.3,
            maxOutputTokens: 150,
            ...(model.includes('2.5') ? { thinkingConfig: { thinkingBudget: 0 } } : {})
          }
        }),
        cache: 'no-store'
      });
      const json = await res.json();
      if (res.ok && json.candidates?.[0]?.content?.parts?.[0]?.text) {
        explanation = json.candidates[0].content.parts[0].text.trim();
        break;
      } else {
        throw new Error(json.error?.message || `HTTP ${res.status}: no candidates`);
      }
    } catch (e) {
      lastError = e.message;
      console.warn(`[Anomaly AI] ${model} failed: ${lastError}`);
    }
  }

  if (explanation) {
    return NextResponse.json({ anomaly: explanation });
  }

  return NextResponse.json({ anomaly: null });
}
