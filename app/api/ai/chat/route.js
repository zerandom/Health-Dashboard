import { getSupabaseAdmin } from '@/lib/supabase';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { NextResponse } from 'next/server';

export async function POST(request) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { messages } = await request.json();
    if (!messages || !Array.isArray(messages)) {
      return NextResponse.json({ error: 'Invalid messages array' }, { status: 400 });
    }

    const userEmail = session.user.email.toLowerCase();
    const supabase = getSupabaseAdmin();

    // Fetch user health data payload
    const { data: userRow, error: dbError } = await supabase
      .from('health_data')
      .select('payload')
      .eq('user_email', userEmail)
      .maybeSingle();

    if (dbError) {
      return NextResponse.json({ error: dbError.message }, { status: 500 });
    }

    const p = userRow?.payload || {};
    
    // Fetch habit tags
    const { data: tagsRow } = await supabase
      .from('habit_tags')
      .select('log')
      .eq('user_email', userEmail)
      .maybeSingle();
    const habitLog = tagsRow?.log || {};

    // Aggregate health summary to ground the coach (30 days of scope)
    let systemInstruction = '';
    if (p.dates && p.dates.length > 0) {
      const days = 30;
      const sliceDates = p.dates.slice(-days);
      const sliceHrv = (p.hrv || []).slice(-days);
      const sliceRhr = (p.rhr || []).slice(-days);
      const sliceDeep = (p.sleepDeep || []).slice(-days);
      const sliceREM = (p.sleepREM || []).slice(-days);
      const sliceCore = (p.sleepCore || []).slice(-days);
      const sliceWorkouts = (p.workouts || []).slice(-days);

      // 30 days statistics
      const filterHrv = sliceHrv.filter(v => v !== null && v !== undefined);
      const filterRhr = sliceRhr.filter(v => v !== null && v !== undefined);
      const avgHrv30 = filterHrv.length ? (filterHrv.reduce((a, b) => a + b, 0) / filterHrv.length).toFixed(1) : 'N/A';
      const avgRhr30 = filterRhr.length ? (filterRhr.reduce((a, b) => a + b, 0) / filterRhr.length).toFixed(1) : 'N/A';
      
      let totalSleepMins30 = 0;
      let sleepDaysCount30 = 0;
      for (let i = 0; i < sliceDates.length; i++) {
        const d = (sliceDeep[i] || 0) + (sliceREM[i] || 0) + (sliceCore[i] || 0);
        if (d > 0) {
          totalSleepMins30 += d;
          sleepDaysCount30++;
        }
      }
      const avgSleep30 = sleepDaysCount30 > 0 ? (totalSleepMins30 / sleepDaysCount30 / 60).toFixed(1) : 'N/A';

      // Recent 7 days statistics
      const filterHrv7 = filterHrv.slice(-7);
      const filterRhr7 = filterRhr.slice(-7);
      const avgHrv7 = filterHrv7.length ? (filterHrv7.reduce((a, b) => a + b, 0) / filterHrv7.length).toFixed(1) : 'N/A';
      const avgRhr7 = filterRhr7.length ? (filterRhr7.reduce((a, b) => a + b, 0) / filterRhr7.length).toFixed(1) : 'N/A';

      const sliceDates7 = sliceDates.slice(-7);
      const sliceDeep7 = sliceDeep.slice(-7);
      const sliceREM7 = sliceREM.slice(-7);
      const sliceCore7 = sliceCore.slice(-7);
      let totalSleepMins7 = 0;
      let sleepDaysCount7 = 0;
      for (let i = 0; i < sliceDates7.length; i++) {
        const d = (sliceDeep7[i] || 0) + (sliceREM7[i] || 0) + (sliceCore7[i] || 0);
        if (d > 0) {
          totalSleepMins7 += d;
          sleepDaysCount7++;
        }
      }
      const avgSleep7 = sleepDaysCount7 > 0 ? (totalSleepMins7 / sleepDaysCount7 / 60).toFixed(1) : 'N/A';

      // Build daily timeline details
      const dailyDetails = [];
      for (let i = 0; i < sliceDates.length; i++) {
        const dateStr = sliceDates[i];
        const hrvVal = sliceHrv[i] !== null && sliceHrv[i] !== undefined ? `${sliceHrv[i]}ms` : 'N/A';
        const rhrVal = sliceRhr[i] !== null && sliceRhr[i] !== undefined ? `${sliceRhr[i]}bpm` : 'N/A';
        const sleepMins = (sliceDeep[i] || 0) + (sliceREM[i] || 0) + (sliceCore[i] || 0);
        const sleepVal = sleepMins > 0 ? `${(sleepMins / 60).toFixed(1)}h` : 'N/A';
        
        // Logged habits tags
        const loggedTags = habitLog[dateStr] && habitLog[dateStr].length > 0 ? habitLog[dateStr].join(', ') : 'none';
        
        // Logged workouts
        const dayWorkouts = sliceWorkouts[i] && sliceWorkouts[i].length > 0
          ? sliceWorkouts[i].map(w => `${w.name} (${w.duration}m, ${w.calories}kcal)`).join('; ')
          : 'none';

        dailyDetails.push(`${dateStr} | HRV: ${hrvVal} | RHR: ${rhrVal} | Sleep: ${sleepVal} | Habits: ${loggedTags} | Workouts: ${dayWorkouts}`);
      }

      systemInstruction = `You are EKATRA's Personal AI Health Coach.
Your purpose is to help the user understand their sleep, recovery, circadian alignment, and training patterns using 30 days of Apple Watch biometrics.

Scope & Context Provided:
- You have secure, restricted access to the user's last 30 days of daily biometric telemetry (HRV, RHR, Sleep) and logged workouts/habits.
- You do NOT have access to real-time medical diagnostic tools or clinical data outside this scope. Do not try to diagnose diseases.
- Your answers must be grounded strictly in this 30-day timeline.

Here is the user's health telemetry for the last 30 days:
Goal: ${p.user?.goal || 'General Fitness'}
Age: ${p.user?.dob ? new Date().getFullYear() - new Date(p.user.dob).getFullYear() : 30}
Max HR: ${p.user?.maxHR || 180} bpm

30-Day Averages vs. Recent 7-Day Averages:
- HRV: 30-day avg = ${avgHrv30} ms | Recent 7-day avg = ${avgHrv7} ms
- Resting HR: 30-day avg = ${avgRhr30} bpm | Recent 7-day avg = ${avgRhr7} bpm
- Sleep Duration: 30-day avg = ${avgSleep30} hrs | Recent 7-day avg = ${avgSleep7} hrs

Daily Log (Last 30 Days):
${dailyDetails.join('\n')}

Coaching Directives:
1. Grounding: Do NOT give generic health advice (e.g., 'exercise is good'). Instead, cite their actual numbers (e.g. "Your recent 7-day HRV average of ${avgHrv7} ms has decreased compared to your 30-day baseline of ${avgHrv30} ms, which suggests...").
2. Core correlations: Correlate sleep durations (deep/REM) and habits (like alcohol, supplements, late meals) with changes in morning HRV/Resting HR on corresponding dates.
3. Be direct: Avoid generic filler sentences like "we need to compare this to your history" or "you should track your trends over time". You already have their history and trends right in front of you. Analyze it directly!
4. Formatting: Keep responses to 1-3 short, focused paragraphs. Use bolding to highlight key metrics. Make sure responses are highly personalized to their current Goal (${p.user?.goal || 'General Fitness'}).`;
    } else {
      systemInstruction = `You are EKATRA's Personal AI Health Coach. Currently, there is no telemetry data loaded for this user. Welcome them and ask them to import their Apple Health XML data to get started.`;
    }

    // Map frontend messages to Gemini format
    const contents = messages.map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }]
    }));

    const targetKey = process.env.COACH_GEMINI_KEY || process.env.GOOGLE_API_KEY;
    const cleanKey = (targetKey || '').trim().replace(/[\s"']/g, '');

    if (!cleanKey || cleanKey.length < 10) {
      return NextResponse.json({ error: 'Valid Gemini key required' }, { status: 500 });
    }

    const models = ['gemini-3.1-flash-lite', 'gemini-2.5-flash', 'gemini-2.5-flash-lite'];
    let aiResponse = null;

    for (const model of models) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': cleanKey },
          body: JSON.stringify({
            system_instruction: { parts: [{ text: systemInstruction }] },
            contents,
            generationConfig: {
              temperature: 0.7,
              maxOutputTokens: 800,
              ...(model.includes('2.5') ? { thinkingConfig: { thinkingBudget: 0 } } : {})
            }
          }),
          cache: 'no-store'
        });

        const json = await res.json();
        if (res.ok && json.candidates?.[0]?.content?.parts?.[0]?.text) {
          aiResponse = json.candidates[0].content.parts[0].text;
          break;
        } else {
          throw new Error(json.error?.message || `HTTP ${res.status}`);
        }
      } catch (e) {
        console.warn(`[Chat API] Model ${model} failed: ${e.message}`);
      }
    }

    if (!aiResponse) {
      return NextResponse.json({ error: 'Gemini model failed to generate response' }, { status: 502 });
    }

    return NextResponse.json({ text: aiResponse });
  } catch (err) {
    console.error('[Chat API error]', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
