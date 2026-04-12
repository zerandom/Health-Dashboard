'use client';

import { signIn, useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

export default function LoginPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status === 'authenticated') {
      router.replace('/dashboard');
    }
  }, [status, router]);

  if (status === 'loading' || status === 'authenticated') {
    return (
      <div style={styles.page}>
        <div style={styles.spinner} />
      </div>
    );
  }

  return (
    <div style={styles.page}>
      {/* Background grid */}
      <div style={styles.grid} aria-hidden="true" />

      <div style={styles.card}>
        {/* Logo */}
        <div style={styles.logo}>
          <span style={styles.logoIcon}>✦</span>
          <span style={styles.logoText}>EKATRA</span>
        </div>

        <h1 style={styles.headline}>Your health data,<br />finally making sense.</h1>
        <p style={styles.subheadline}>
          AI-powered insights from your Apple Watch — HRV, sleep stages, training load, and habits — in one intelligent dashboard.
        </p>

        {/* Feature pills */}
        <div style={styles.pills}>
          {['🧠 AI Health Coach', '😴 Sleep Intelligence', '💪 Readiness Score', '🔥 Habit Impact'].map((f) => (
            <span key={f} style={styles.pill}>{f}</span>
          ))}
        </div>

        {/* Sign in button */}
        <button
          id="google-signin-btn"
          style={styles.googleBtn}
          onClick={() => signIn('google', { callbackUrl: '/dashboard' })}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'rgba(255,255,255,0.12)';
            e.currentTarget.style.boxShadow = '0 0 30px rgba(143,0,255,0.3)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'rgba(255,255,255,0.06)';
            e.currentTarget.style.boxShadow = 'none';
          }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
          </svg>
          Continue with Google
        </button>

        <p style={styles.disclaimer}>
          Your health data is stored securely and is never shared or sold.
          By signing in you agree to our{' '}
          <a href="#" style={styles.link}>Terms</a> and{' '}
          <a href="#" style={styles.link}>Privacy Policy</a>.
        </p>
      </div>
    </div>
  );
}

const styles = {
  page: {
    minHeight: '100vh',
    background: '#0A0B11',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    overflow: 'hidden',
    fontFamily: "'Plus Jakarta Sans', sans-serif",
  },
  grid: {
    position: 'absolute',
    inset: 0,
    backgroundImage: 'linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px)',
    backgroundSize: '60px 60px',
    pointerEvents: 'none',
  },
  card: {
    position: 'relative',
    zIndex: 1,
    background: 'rgba(20,22,31,0.8)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: '28px',
    padding: '3rem',
    maxWidth: '480px',
    width: '90%',
    backdropFilter: 'blur(20px)',
    boxShadow: '0 40px 80px rgba(0,0,0,0.6)',
  },
  logo: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.6rem',
    marginBottom: '2.5rem',
  },
  logoIcon: {
    fontSize: '22px',
    color: '#FFD166',
  },
  logoText: {
    fontFamily: "'Outfit', sans-serif",
    fontWeight: 700,
    fontSize: '1.1rem',
    letterSpacing: '3px',
    color: '#E2E8F0',
  },
  headline: {
    fontFamily: "'Outfit', sans-serif",
    fontSize: '2rem',
    fontWeight: 700,
    color: '#E2E8F0',
    lineHeight: 1.3,
    marginBottom: '1rem',
    letterSpacing: '-0.5px',
  },
  subheadline: {
    fontSize: '0.9rem',
    color: '#94A3B8',
    lineHeight: 1.7,
    marginBottom: '1.75rem',
  },
  pills: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '0.5rem',
    marginBottom: '2rem',
  },
  pill: {
    fontSize: '0.75rem',
    color: '#94A3B8',
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: '20px',
    padding: '0.35rem 0.9rem',
    fontWeight: 500,
  },
  googleBtn: {
    width: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '0.75rem',
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.15)',
    color: '#E2E8F0',
    padding: '0.9rem 1.5rem',
    borderRadius: '14px',
    fontSize: '0.95rem',
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'all 0.2s ease',
    marginBottom: '1.5rem',
    fontFamily: "'Plus Jakarta Sans', sans-serif",
  },
  disclaimer: {
    fontSize: '0.75rem',
    color: '#475569',
    textAlign: 'center',
    lineHeight: 1.6,
  },
  link: {
    color: '#94A3B8',
    textDecoration: 'underline',
    textUnderlineOffset: '3px',
  },
  spinner: {
    width: '32px',
    height: '32px',
    border: '3px solid rgba(255,255,255,0.1)',
    borderTopColor: '#8F00FF',
    borderRadius: '50%',
    animation: 'spin 0.8s linear infinite',
  },
};
