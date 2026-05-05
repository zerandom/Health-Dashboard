import { NextResponse } from 'next/server';
import { SLEEP_ANALYST_SYSTEM_PROMPT, buildSleepAnalystDataPrompt } from '@/lib/prompts';

// Temporary route to allow evaluating the Sleep Analyst prompt via browser DevTools
export async function POST(req) {
  const data = await req.json();
  const SYSTEM_PROMPT = SLEEP_ANALYST_SYSTEM_PROMPT;
  const DATA_PROMPT = buildSleepAnalystDataPrompt(data);

  const cleanKey = (process.env.COACH_GEMINI_KEY || process.env.GOOGLE_API_KEY || '').trim().replace(/[\s"']/g, '');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent`;
  
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': cleanKey
      },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ role: 'user', parts: [{ text: DATA_PROMPT }] }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 600 },
      }),
      cache: 'no-store'
    });

    const json = await res.json();
    return NextResponse.json({ insight: json.candidates?.[0]?.content?.parts?.[0]?.text });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
