import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getSupabaseAdmin } from '@/lib/supabase';
import { NextResponse } from 'next/server';

export async function PATCH(req) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  
  const body = await req.json();
  const goal = body.goal;
  
  const validGoals = ['Marathon / Triathlon', 'Cycling / Endurance', 'Strength & Hypertrophy', 'Weight Loss', 'General Fitness'];
  if (!validGoals.includes(goal)) return NextResponse.json({ error: 'Invalid goal' }, { status: 400 });

  const supabase = getSupabaseAdmin();
  const { data } = await supabase.from('health_data').select('payload')
    .eq('user_email', session.user.email.toLowerCase()).single();
  if (!data) return NextResponse.json({ error: 'No data' }, { status: 404 });

  const updated = { ...data.payload, user: { ...(data.payload.user || {}), goal } };
  await supabase.from('health_data').update({ payload: updated })
    .eq('user_email', session.user.email.toLowerCase());
  return NextResponse.json({ ok: true, goal });
}
