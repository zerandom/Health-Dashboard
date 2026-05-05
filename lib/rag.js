import { getSupabaseAdmin } from './supabase';

const EMBEDDING_MODEL = 'gemini-embedding-2';
const GOOGLE_API_KEY = process.env.COACH_GEMINI_KEY || process.env.GOOGLE_API_KEY;

/**
 * Embed a query string using Google text-embedding-004.
 */
async function embedQuery(text) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${EMBEDDING_MODEL}:embedContent?key=${GOOGLE_API_KEY}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ 
      model: `models/${EMBEDDING_MODEL}`, 
      content: { parts: [{ text }] },
      outputDimensionality: 768
    })
  });
  if (!res.ok) {
    const text = await res.text();
    console.error(`[RAG] embedQuery failed: ${text}`);
    return null;
  }
  const json = await res.json();
  return json.embedding.values;
}

/**
 * Retrieve the top-K most relevant literature chunks for a given query.
 * @param {string} query  - Natural-language description of today's situation
 * @param {string} [category] - Optional filter: 'hrv' | 'sleep' | 'load' | 'hr_zones' | 'nutrition'
 * @param {number} [k=3]  - Number of chunks to retrieve
 * @returns {string}      - Formatted context block ready to inject into a prompt
 */
export async function retrieveLiteratureContext(query, category = null, k = 3) {
  if (!query) return '';
  try {
    const embedding = await embedQuery(query);
    if (!embedding) return '';
    
    const supabase = getSupabaseAdmin();

    const { data, error } = await supabase.rpc('match_literature', {
      query_embedding:  embedding,
      match_count:      k,
      filter_category:  category
    });

    if (error || !data?.length) {
       console.warn('[RAG] No data returned or error:', error?.message);
       return '';
    }

    const chunks = data.map(row =>
      `[Source: ${row.source}]\n${row.chunk_text}`
    ).join('\n\n---\n\n');

    return `COACHING LITERATURE (retrieved, similarity-ranked):\n${chunks}`;
  } catch (e) {
    console.warn('[RAG] Literature retrieval failed:', e.message);
    return ''; // Graceful degradation
  }
}
