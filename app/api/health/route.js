import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getSupabaseAdmin } from '@/lib/supabase';
import { NextResponse } from 'next/server';

// GET /api/health — return the latest live-sync payload from iOS
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('live_sync')
    .select('payload')
    .eq('user_email', session.user.email)
    .order('synced_at', { ascending: false })
    .limit(1)
    .single();

  if (error || !data) return NextResponse.json({});

  return NextResponse.json(data.payload);
}
