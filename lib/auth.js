import GoogleProvider from 'next-auth/providers/google';
import { getSupabaseAdmin } from '@/lib/supabase';

export const authOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    }),
  ],

  callbacks: {
    // Persist the user's Supabase user_id in the session token
    async signIn({ user }) {
      const supabase = getSupabaseAdmin();
      // Upsert user record on first login
      await supabase.from('users').upsert(
        { email: user.email, name: user.name, avatar_url: user.image },
        { onConflict: 'email' }
      );
      return true;
    },

    async session({ session, token }) {
      // Attach user id to session so API routes can scope data
      if (session?.user) {
        session.user.id = token.sub;
      }
      return session;
    },
  },

  pages: {
    signIn: '/login',
    error: '/login',
  },

  session: {
    strategy: 'jwt',
  },
};
