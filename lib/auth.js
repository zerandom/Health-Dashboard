import GoogleProvider from 'next-auth/providers/google';
import CredentialsProvider from 'next-auth/providers/credentials';
import { getSupabaseAdmin } from '@/lib/supabase';

export const authOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    }),
    CredentialsProvider({
      name: 'Dev Login',
      credentials: {
        email: { label: "Email", type: "text", placeholder: "rahul.rathee17@gmail.com" }
      },
      async authorize(credentials) {
        const email = (credentials?.email || 'rahul.rathee17@gmail.com').toLowerCase();
        return {
          id: 'dev-user-id',
          name: 'Rahul Rathee',
          email: email,
          image: 'https://lh3.googleusercontent.com/a/ACg8ocLqcvFJzF17zZeIIEpt5qE9lda116BkAlyqTz-cPWE7F-ByJlcX=s96-c'
        };
      }
    })
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
