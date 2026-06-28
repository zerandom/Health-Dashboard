import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getSupabaseAdmin } from '@/lib/supabase';
import { NextResponse } from 'next/server';

export async function GET(request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const regen = searchParams.get('regen') === '1';
  const temperature = regen ? 0.7 : 0.3;

  const TARGET_API_KEY = process.env.COACH_GEMINI_KEY || process.env.GOOGLE_API_KEY;
  const supabase = getSupabaseAdmin();
  const { data } = await supabase
    .from('health_data').select('payload')
    .eq('user_email', session.user.email.toLowerCase()).single();

  if (!data?.payload) return NextResponse.json({ advice: 'No data found.' });
  const p = data.payload;
  const n = p.dates?.length || 0;
  if (n < 2) return NextResponse.json({ advice: 'Import more data first.' });

  const last30_hrv = (p.hrv || []).slice(-30).filter(v => v !== null);
  const last30_rhr = (p.rhr || []).slice(-30).filter(v => v !== null);

  const hrv = (p.hrv || []).slice(-1)[0] || 50;
  const avg_hrv = (last30_hrv.reduce((a, b) => a + b, 0) / (last30_hrv.length || 1)).toFixed(1);
  const rhr = (p.rhr || []).slice(-1)[0] || 60;
  const avg_rhr = (last30_rhr.reduce((a, b) => a + b, 0) / (last30_rhr.length || 1)).toFixed(1);

  const yesterday = ((p.workouts || []).slice(-2,-1)[0] || [])
    .map(w => `${w.type} ${w.duration}m`).join(', ') || 'Rest';
  const age = p.user?.dob ? new Date().getFullYear() - new Date(p.user.dob).getFullYear() : 30;
  const maxHR = p.user?.maxHR || (220 - age);
  const score = Math.round(
    Math.min(100, Math.max(0, ((hrv/avg_hrv) * 0.6 + (1 - (rhr - 40)/50) * 0.4) * 100))
  );
  const goal = p.user?.goal || 'General fitness';

  const SYSTEM = `You are a concise workout directive engine. Respond in ONE sentence (max 25 words). 
Name a specific protocol with intensity targets. No disclaimers. No generic advice.`;

  const DATA = `RECOVERY SCORE: ${score}/100
HRV: ${hrv}ms (30d avg: ${avg_hrv}ms) | RHR: ${rhr}bpm | Max HR: ${maxHR}bpm
YESTERDAY: ${yesterday}
ATHLETE GOAL: ${goal}
OUTPUT: One specific workout directive with named protocol and HR zone or load target.`;

  const cleanKey = (TARGET_API_KEY || '').trim().replace(/[\s"']/g, '');
  const models = ['gemini-3.1-flash-lite', 'gemini-2.5-flash', 'gemini-2.5-flash-lite'];
  
  let advice = null;
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
            temperature,
            maxOutputTokens: 80,
            ...(model.includes('2.5') ? { thinkingConfig: { thinkingBudget: 0 } } : {})
          }
        }),
        cache: 'no-store'
      });
      const json = await res.json();
      if (res.ok && json.candidates?.[0]?.content?.parts?.[0]?.text) {
        advice = json.candidates[0].content.parts[0].text.trim();
        break;
      } else {
        throw new Error(json.error?.message || `HTTP ${res.status}: no candidates`);
      }
    } catch (e) {
      lastError = e.message;
      console.warn(`[Workout Coach] ${model} failed: ${lastError}`);
    }
  }

  return NextResponse.json({ advice: advice || `Insight unavailable. (Debug: ${lastError})` });
}
