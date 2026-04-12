import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getSupabaseAdmin } from '@/lib/supabase';
import { NextResponse } from 'next/server';

// GET /api/tags — return habits list and daily log for the user
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('habit_tags')
    .select('habits, log')
    .eq('user_email', session.user.email)
    .single();

  if (error || !data) {
    return NextResponse.json({
      habits: ['alcohol', 'supplements', 'sauna', 'cold_plunge', 'heavy_leg_day'],
      log: {},
    });
  }

  return NextResponse.json({ habits: data.habits, log: data.log });
}

// POST /api/tags — merge incoming tag data into user's habit record
export async function POST(request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let incoming;
  try {
    incoming = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();

  // Fetch existing record
  const { data: existing } = await supabase
    .from('habit_tags')
    .select('habits, log')
    .eq('user_email', session.user.email)
    .single();

  const current = existing ?? { habits: ['alcohol', 'supplements', 'sauna', 'cold_plunge', 'heavy_leg_day'], log: {} };

  if (incoming.date && incoming.tags !== undefined) {
    current.log[incoming.date] = incoming.tags;
  }
  if (incoming.habits) {
    current.habits = incoming.habits;
  }

  await supabase.from('habit_tags').upsert(
    { user_email: session.user.email, habits: current.habits, log: current.log },
    { onConflict: 'user_email' }
  );

  return NextResponse.json({ status: 'ok' });
}
