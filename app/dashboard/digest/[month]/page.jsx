import { getSupabaseAdmin } from '@/lib/supabase';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { redirect } from 'next/navigation';
import DigestClientView from './DigestClientView';

export const metadata = {
  title: 'Monthly Health Digest — Ekatra',
  description: 'AI-grounded longitudinal analysis of your physiological and training trends.',
};

export default async function MonthlyDigestPage({ params }) {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');

  const { month } = params;
  const userEmail = session.user.email.toLowerCase();

  const supabase = getSupabaseAdmin();
  const { data: digest } = await supabase
    .from('ai_digests')
    .select('*')
    .eq('user_email', userEmail)
    .eq('month', month)
    .maybeSingle();

  // Format month to readable, e.g. "2026-05" -> "May 2026"
  let formattedMonth = month;
  try {
    const [year, m] = month.split('-');
    const date = new Date(parseInt(year), parseInt(m) - 1, 1);
    formattedMonth = date.toLocaleString('en-US', { month: 'long', year: 'numeric' });
  } catch (e) {
    // fallback
  }

  return <DigestClientView digest={digest} month={formattedMonth} isPublic={false} />;
}
