import { getSupabaseAdmin } from '@/lib/supabase';
import DigestClientView from '../../[month]/DigestClientView';

export const metadata = {
  title: 'Shared Health Digest — Ekatra',
  description: 'AI-grounded longitudinal analysis of physiological and training trends.',
};

export default async function PublicDigestSharePage({ params }) {
  const { id } = params;

  const supabase = getSupabaseAdmin();
  const { data: digest } = await supabase
    .from('ai_digests')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  let formattedMonth = 'Monthly';
  if (digest?.month) {
    try {
      const [year, m] = digest.month.split('-');
      const date = new Date(parseInt(year), parseInt(m) - 1, 1);
      formattedMonth = date.toLocaleString('en-US', { month: 'long', year: 'numeric' });
    } catch (e) {
      formattedMonth = digest.month;
    }
  }

  return <DigestClientView digest={digest} month={formattedMonth} isPublic={true} />;
}
