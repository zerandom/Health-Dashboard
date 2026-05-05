const cleanKey = 'AIzaSyBVT0Vu_5pdey-HIHRoBLNbea_MNbpJzwk';
const models = ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.5-flash-lite'];
const prompt = "Analyze my data: heart rate is fine. Make it short.";

async function testFetch() {
  for (const model of models) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
      console.log(`[AI Coach DEBUG] Calling: ${url}`);
      
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': cleanKey
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.7, maxOutputTokens: 2048 },
        }),
        cache: 'no-store'
      });

      const text = await res.text();
      console.log(`[AI Coach DEBUG] ${model} response status: ${res.status}`);
      console.log(`[AI Coach DEBUG] ${model} response body: ${text.substring(0, 300)}`);
      
    } catch (e) {
      console.warn(`[AI Coach] Attempt ${model} failed: ${e.message}`);
    }
  }
}

testFetch();
