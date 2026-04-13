import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getSupabaseAdmin } from '@/lib/supabase';
import { NextResponse } from 'next/server';
import https from 'https';

// GET /api/ai/sleep-insight — dual-layer sleep & recovery analysis
export async function GET() {
  const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (!GOOGLE_API_KEY || GOOGLE_API_KEY === 'your_gemini_api_key_here' || GOOGLE_API_KEY.length < 10) {
    return NextResponse.json({ insight: 'API Key Required.' });
  }

  const supabase = getSupabaseAdmin();
  const userEmail = session.user.email.toLowerCase();
  const { data } = await supabase
    .from('health_data')
    .select('payload')
    .eq('user_email', userEmail)
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

  const prompt = `You are a LIFESTYLE WELLNESS ASSISTANT (Not a doctor). Analyze the last 14 days of Sleep and Recovery data.
DATA CONTEXT: Sleep Trend, HRV/RHR, AND Sleep/Wake Schedule consistency.
Provide a 3-part response that GUIDES the user:
1. WHAT'S GOING WELL: Highlight 2-3 specific wins with numbers from the data.
2. WHAT'S GOING WRONG: Identify 2-3 specific risks or concerning trends with numbers.
3. WHAT DOES IT MEAN: Provide 3-4 sentences of actionable meaning and concrete next steps.

Focus strictly on lifestyle/habit trends. DO NOT provide medical diagnoses.
CRITICAL: Every part must consist of complete sentences — the response must NOT end mid-sentence.
Be sophisticated and specific with numbers. Avoid generic advice.

DATA:
${summary}`;

  const cleanKey = (GOOGLE_API_KEY || '').trim().replace(/[\s"']/g, '');
  const models = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-flash-latest', 'gemini-2.5-flash-lite', 'gemini-flash-lite-latest'];
  let insight = null;
  let lastError = null;

  console.log(`[sleep-insight] Nuclear Bypass Fetch. Key len: ${cleanKey.length}. Models: ${models.join(', ')}`);

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
          generationConfig: { temperature: 0.7, maxOutputTokens: 2048 },
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
        console.log(`[Sleep AI Final] Insight: "${insight.substring(0, 100)}..."`);
        break;
      }
    } catch (e) {
      lastError = e.message;
      console.warn(`[sleep-insight] Attempt ${model} failed: ${lastError}`);
    }
  }

  if (insight) return NextResponse.json({ insight });
  return NextResponse.json({ 
    insight: `Sleep Analyst failed to initialize. Try again in a few minutes. (Debug: ${lastError})`, 
    is_mock: true 
  });
}
