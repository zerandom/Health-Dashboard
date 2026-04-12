import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getSupabaseAdmin } from '@/lib/supabase';
import { NextResponse } from 'next/server';
import https from 'https';

// GET /api/ai/insight — daily Coach AI card
export async function GET() {
  const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (!GOOGLE_API_KEY || GOOGLE_API_KEY === 'your_gemini_api_key_here' || GOOGLE_API_KEY.length < 10) {
    return NextResponse.json({ insight: 'AI Insights require a valid Gemini API Key. Add GOOGLE_API_KEY to your environment variables.', is_mock: true });
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
  const prompt = `You are a LIFESTYLE WELLNESS ASSISTANT (Not a doctor). Analyze the last 14 days of health data. 
Provide a single, proactive, and FRESH health insight (1-2 sentences). 
Focus on lifestyle trends, energy, and recovery. DO NOT provide medical diagnoses.
CRITICAL: Ensure the response is a complete thought and does NOT end mid-sentence.
Avoid repeating generic advice. Be punchy.

DATA:
${summary}`;

  const cleanKey = (GOOGLE_API_KEY || '').trim().replace(/[\s"']/g, '');
  const models = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-flash-latest'];
  let insight = null;
  let lastError = null;

  console.log(`[AI insight] Nuclear Bypass Fetch. Key len: ${cleanKey.length}. Models: ${models.join(', ')}`);

  for (const model of models) {
    try {
      insight = await new Promise((resolve, reject) => {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${cleanKey}`;
        const req = https.request(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        }, (res) => {
          let body = '';
          res.on('data', d => body += d);
          res.on('end', () => {
            try {
              const json = JSON.parse(body);
              if (res.statusCode === 200 && json.candidates?.[0]) {
                resolve(json.candidates[0].content.parts[0].text.trim());
              } else {
                reject(new Error(json.error?.message || `HTTP ${res.statusCode}: ${body.substring(0,100)}`));
              }
            } catch(e) { reject(e); }
          });
        });
        req.on('error', reject);
        req.write(JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.7, maxOutputTokens: 500 },
          safetySettings: [
            { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
            { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
            { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
            { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }
          ]
        }));
        req.end();
      });

      if (insight) {
        console.log(`[AI Final] Insight: "${insight}"`);
        break;
      }
    } catch (e) {
      lastError = e.message;
      console.warn(`[AI insight] Attempt ${model} failed: ${lastError}`);
    }
  }

  if (insight) return NextResponse.json({ insight });
  return NextResponse.json({ 
    insight: `AI Insight failed to initialize. Try again in a few minutes. (Debug: ${lastError})`, 
    is_mock: true 
  });
}
