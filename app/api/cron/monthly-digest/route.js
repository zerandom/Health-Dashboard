import { getSupabaseAdmin } from '@/lib/supabase';
import { NextResponse } from 'next/server';

export async function GET(request) {
  // Simple auth check via header or search parameter for CRON security
  const { searchParams } = new URL(request.url);
  const cronSecret = process.env.CRON_SECRET;
  const reqSecret = searchParams.get('secret') || request.headers.get('Authorization')?.replace('Bearer ', '');

  if (cronSecret && reqSecret !== cronSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const userEmailParam = searchParams.get('user_email');
  const targetKey = process.env.COACH_GEMINI_KEY || process.env.GOOGLE_API_KEY;
  const cleanKey = (targetKey || '').trim().replace(/[\s"']/g, '');

  if (!cleanKey || cleanKey.length < 10) {
    return NextResponse.json({ error: 'Valid Gemini key required' }, { status: 500 });
  }

  const supabase = getSupabaseAdmin();
  let query = supabase.from('health_data').select('user_email, payload');

  if (userEmailParam) {
    query = query.eq('user_email', userEmailParam.toLowerCase());
  }

  const { data: usersData, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!usersData || usersData.length === 0) {
    return NextResponse.json({ ok: true, message: 'No users found to process' });
  }

  const results = [];
  const now = new Date();
  // We compute the digest for the current/previous month.
  // Format: 'YYYY-MM'
  const currentMonthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const monthName = now.toLocaleString('en-US', { month: 'long', year: 'numeric' });

  for (const userRow of usersData) {
    const email = userRow.user_email;
    const p = userRow.payload;

    if (!p || !p.dates || p.dates.length < 15) {
      results.push({ email, status: 'skipped (insufficient data)' });
      continue;
    }

    // Aggregate last 30 days
    const days = 30;
    const sliceDates = p.dates.slice(-days);
    const sliceHrv = (p.hrv || []).slice(-days).filter(v => v !== null && v !== undefined);
    const sliceRhr = (p.rhr || []).slice(-days).filter(v => v !== null && v !== undefined);
    const sliceDeep = (p.sleepDeep || []).slice(-days);
    const sliceREM = (p.sleepREM || []).slice(-days);
    const sliceCore = (p.sleepCore || []).slice(-days);
    const sliceWorkouts = (p.workouts || []).slice(-days);

    const avgHrv = sliceHrv.length ? (sliceHrv.reduce((a, b) => a + b, 0) / sliceHrv.length).toFixed(1) : 'N/A';
    const avgRhr = sliceRhr.length ? (sliceRhr.reduce((a, b) => a + b, 0) / sliceRhr.length).toFixed(1) : 'N/A';
    
    // Sleep duration calculation
    let totalSleepMins = 0;
    let sleepDaysCount = 0;
    for (let i = 0; i < sliceDates.length; i++) {
      const d = (sliceDeep[i] || 0) + (sliceREM[i] || 0) + (sliceCore[i] || 0);
      if (d > 0) {
        totalSleepMins += d;
        sleepDaysCount++;
      }
    }
    const avgSleep = sleepDaysCount > 0 ? (totalSleepMins / sleepDaysCount / 60).toFixed(1) : 'N/A';

    // Workout count
    const workoutCount = sliceWorkouts.filter(w => w && w.length > 0).length;

    // Load progression (weekly sums)
    const dailyMins = p.workoutMinutes || [];
    const last30Mins = dailyMins.slice(-30);
    const weeklyLoads = [];
    for (let i = 0; i < last30Mins.length; i += 7) {
      const weekSum = last30Mins.slice(i, i + 7).reduce((a, b) => a + (b || 0), 0);
      weeklyLoads.push(weekSum);
    }
    const loadProgressionStr = weeklyLoads.map((l, idx) => `Week ${idx + 1}: ${l} mins`).join(', ');

    // Simple correlation narrative
    const sleepHrvCorr = (() => {
      const pairs = [];
      for (let i = p.dates.length - days; i < p.dates.length; i++) {
        const h = p.hrv[i];
        const prevSleep = (p.sleepDeep[i-1] || 0) + (p.sleepREM[i-1] || 0) + (p.sleepCore[i-1] || 0);
        if (h && prevSleep > 0) {
          pairs.push({ sleep: prevSleep / 60, hrv: h });
        }
      }
      if (pairs.length < 5) return 'insufficient correlation data';
      const xs = pairs.map(x => x.sleep);
      const ys = pairs.map(x => x.hrv);
      const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
      const my = ys.reduce((a, b) => a + b, 0) / ys.length;
      const num = xs.reduce((acc, x, idx) => acc + (x - mx) * (ys[idx] - my), 0);
      const den = Math.sqrt(xs.reduce((acc, x) => acc + (x - mx) ** 2, 0) * ys.reduce((acc, y) => acc + (y - my) ** 2, 0));
      const r = den ? num / den : 0;
      return r > 0.3 ? 'Strong positive link between sleep duration and HRV recovery' : 
             r < -0.3 ? 'Sleep debt shows strong negative impact on morning HRV' : 
             'Stable baseline recovery with minor correlation to daily sleep variance';
    })();

    const SYSTEM = `You are EKATRA's monthly health analyst. Generate a structured monthly performance review in 400 words max. No disclaimers. Be specific with numbers.`;
    const DATA = `Month: ${monthName}
User Goal: ${p.user?.goal || 'General fitness'}
Age: ${p.user?.dob ? new Date().getFullYear() - new Date(p.user.dob).getFullYear() : 30}
30-Day Aggregated Stats:
- Average HRV: ${avgHrv} ms
- Average Resting HR: ${avgRhr} bpm
- Average Sleep Duration: ${avgSleep} hrs/night
- Total Workout Sessions: ${workoutCount}
- Weekly Workout Minutes: ${loadProgressionStr}
- Key Biological Relationship: ${sleepHrvCorr}

OUTPUT FORMAT:
## Month in Review: ${monthName}
**Fitness Age movement:** [Describe movement, e.g. -0.4 years or stable based on workouts/RHR]
**Best week:** [Identify the most balanced or high-activity week range, and reason]
**Sleep story:** [2 sentences detailing sleep stats and circadian quality]
**Training story:** [2 sentences detailing training load progression and consistency]
**One thing to change in next month:** [specific, highly actionable suggestion]`;

    let digestText = null;
    let modelUsed = null;

    const models = ['gemini-2.0-flash', 'gemini-2.5-flash', 'gemini-2.5-flash-lite'];
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
              temperature: 0.4,
              maxOutputTokens: 600,
              ...(model.includes('2.5') ? { thinkingConfig: { thinkingBudget: 0 } } : {})
            }
          }),
          cache: 'no-store'
        });
        const json = await res.json();
        if (res.ok && json.candidates?.[0]?.content?.parts?.[0]?.text) {
          digestText = json.candidates[0].content.parts[0].text.trim();
          modelUsed = model;
          break;
        } else {
          throw new Error(json.error?.message || `HTTP ${res.status}`);
        }
      } catch (e) {
        console.warn(`[Cron Digest] Model ${model} failed for ${email}: ${e.message}`);
      }
    }

    if (digestText) {
      // Upsert the digest record
      const { error: upsertError } = await supabase
        .from('ai_digests')
        .upsert({
          user_email: email,
          month: currentMonthStr,
          digest_text: digestText
        }, {
          onConflict: 'user_email, month'
        });

      if (upsertError) {
        results.push({ email, status: 'error saving to DB', error: upsertError.message });
      } else {
        results.push({ email, status: 'success', model: modelUsed, month: currentMonthStr });
      }
    } else {
      results.push({ email, status: 'error generating insight' });
    }
  }

  return NextResponse.json({ ok: true, processed: results });
}
