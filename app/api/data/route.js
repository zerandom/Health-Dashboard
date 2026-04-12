import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getSupabaseAdmin } from '@/lib/supabase';
import { NextResponse } from 'next/server';

// GET /api/data — return the user's parsed health data from Supabase
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('health_data')
    .select('payload')
    .eq('user_email', session.user.email)
    .single();

  if (error || !data) {
    return NextResponse.json({ dataSource: 'none' });
  }

  return NextResponse.json(data.payload);
}

// POST /api/data — save the fully parsed JSON payload from the browser
export async function POST(req) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const payload = await req.json();
    const supabase = getSupabaseAdmin();

    // Self-healing: Ensure user exists in Supabase (in case they logged in before API keys were fixed)
    await supabase.from('users').upsert(
      { email: session.user.email, name: session.user.name, avatar_url: session.user.image },
      { onConflict: 'email' }
    );

    const { error } = await supabase
      .from('health_data')
      .upsert({ 
        user_email: session.user.email, 
        payload, 
        updated_at: new Date().toISOString() 
      }, { onConflict: 'user_email' });

    if (error) throw error;
    
    return NextResponse.json({ status: 'success' });
  } catch (error) {
    console.error('Failed to save health data:', error);
    require('fs').writeFileSync('/Users/rahulrathee/Documents/Health Dashboard/last_api_error.txt', error.stack || error.message || JSON.stringify(error));
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
