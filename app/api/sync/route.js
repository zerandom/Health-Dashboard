import { getSupabaseAdmin } from '@/lib/supabase';
import { NextResponse } from 'next/server';

// POST /sync — accepts JSON payload from iOS app
// The iOS app sends a simple bearer token (user email) for identification.
// In a production setup, replace this with a signed JWT.
export async function POST(request) {
  const authHeader = request.headers.get('authorization') ?? '';
  const userEmail = authHeader.replace('Bearer ', '').trim();

  if (!userEmail || !userEmail.includes('@')) {
    return NextResponse.json({ error: 'Missing or invalid auth token' }, { status: 401 });
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  const { error } = await supabase.from('live_sync').upsert(
    { user_email: userEmail, payload, synced_at: new Date().toISOString() },
    { onConflict: 'user_email' }
  );

  if (error) {
    console.error('[sync] Supabase error:', error);
    return NextResponse.json({ error: 'Storage error' }, { status: 500 });
  }

  return NextResponse.json({ status: 'success', message: 'Synced successfully' });
}
