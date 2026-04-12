import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getSupabaseAdmin } from '@/lib/supabase';
import { NextResponse } from 'next/server';

// GET /api/data — return the user's parsed health data from Supabase
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const supabase = getSupabaseAdmin();
  const userEmail = session.user.email.toLowerCase();

  const { data, error } = await supabase
    .from('health_data')
    .select('payload')
    .eq('user_email', userEmail)
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
    const contentLength = req.headers.get('content-length');
    const contentType = req.headers.get('content-type');
    
    // Read payload
    const payload = await req.json();
    
    console.log(`[API Data] Diagnostics for ${session.user.email}:`, { 
      contentLength,
      contentType,
      receivedType: typeof payload, 
      isNull: payload === null,
      keys: payload ? Object.keys(payload) : [] 
    });

    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      const msg = payload === null ? 'Body was empty or unparseable' : `Type: ${typeof payload}`;
      throw new Error(`Data transmission failed. Received: ${msg}. (Size: ${contentLength} bytes)`);
    }

    const supabase = getSupabaseAdmin();
    const userEmail = session.user.email.toLowerCase();

    // Self-healing: Ensure user exists in Supabase
    await supabase.from('users').upsert(
      { email: userEmail, name: session.user.name, avatar_url: session.user.image },
      { onConflict: 'email' }
    );

    const { error } = await supabase
      .from('health_data')
      .upsert({ 
        user_email: userEmail, 
        payload, 
        updated_at: new Date().toISOString() 
      }, { onConflict: 'user_email' });

    if (error) throw error;
    
    return NextResponse.json({ status: 'success' });
  } catch (error) {
    console.error('[/api/data POST] Failed to save health data:', error.stack || error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
