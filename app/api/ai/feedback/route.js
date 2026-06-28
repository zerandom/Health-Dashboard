import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getSupabaseAdmin } from '@/lib/supabase';
import { NextResponse } from 'next/server';

export async function POST(req) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const { surface, rating, insight_snapshot } = await req.json();
    if (!surface || !rating || ![-1, 1].includes(rating)) {
      return NextResponse.json({ error: 'Invalid feedback data' }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    const userEmail = session.user.email.toLowerCase();

    const { error } = await supabase
      .from('ai_feedback')
      .insert({
        user_email: userEmail,
        surface,
        rating,
        insight_snapshot
      });

    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[Feedback Loop Error]:', error);
    return NextResponse.json({ error: 'Failed to record feedback' }, { status: 500 });
  }
}
