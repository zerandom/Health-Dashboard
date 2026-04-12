# Ekatra — Personal Health Intelligence

> Turn your Apple Watch data into a personal health coach. Ekatra surfaces the patterns your wearable collects but never tells you about.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/zerandom/Health-Dashboard)

---

## What is Ekatra?

Most health apps show you numbers. Ekatra shows you **what those numbers mean for you, today**.

A self-hosted AI health dashboard connecting directly to Apple HealthKit, parsing years of biometric history, and using Gemini AI to deliver contextual, personalised coaching — not generic tips.

**Key features:** AI Health Coach · Sleep Intelligence · HRV Readiness · Habit Impact Matrix · Circadian Rhythm Estimate · Workout Momentum Tracking

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 14 (App Router) |
| Auth | NextAuth.js v4 (Google OAuth) |
| Database | Supabase (PostgreSQL) |
| AI | Google Gemini 2.0 Flash |
| iOS Sync | Swift / HealthKit companion app |
| Hosting | Vercel |

---

## Getting Started

### 1. Prerequisites

- [Node.js 18+](https://nodejs.org)
- A [Supabase](https://supabase.com) project (free tier works)
- A [Google Cloud](https://console.cloud.google.com) project with OAuth credentials
- A [Gemini API key](https://aistudio.google.com/apikey)

### 2. Clone & Install

```bash
git clone https://github.com/zerandom/Health-Dashboard.git ekatra
cd ekatra
npm install
```

### 3. Set Up Environment Variables

```bash
cp .env.example .env.local
```

Fill in all values in `.env.local` (see `.env.example` for descriptions).

### 4. Set Up Supabase

1. Create a new project at [supabase.com](https://supabase.com)
2. Open **SQL Editor** and run the contents of `supabase/schema.sql`
3. Copy your project URL and API keys into `.env.local`

### 5. Set Up Google OAuth

1. Go to [Google Cloud Console](https://console.cloud.google.com) → APIs & Services → Credentials
2. Create an **OAuth 2.0 Client ID** (Web application)
3. Add authorised redirect URIs:
   - `http://localhost:3000/api/auth/callback/google` (development)
   - `https://your-app.vercel.app/api/auth/callback/google` (production)
4. Copy Client ID and Secret into `.env.local`

### 6. Run Locally

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

### 7. Deploy to Vercel

```bash
npx vercel
```

Add all environment variables in the Vercel dashboard under Project Settings → Environment Variables. Update `NEXTAUTH_URL` to your production domain.

---

## Data Import

### Option 1: iOS Companion App *(Recommended)*
Automatically syncs HealthKit data in the background. See [iOS Setup Guide](ios/ios_setup.md).

### Option 2: Apple Health XML Export
Coming in Phase 2. For now, import your data via the iOS companion app.

---

## Project Structure

```
/app                  → Next.js App Router pages and API routes
  /api/auth           → NextAuth Google OAuth handler
  /api/data           → Serve user's health data
  /api/health         → Live sync data (iOS)
  /api/sync           → iOS HealthKit sync endpoint
  /api/tags           → Habit log persistence
  /api/ai             → Gemini AI coaching endpoints
  /dashboard          → Main dashboard page (auth protected)
  /login              → Google sign-in page
/components           → Shared React components
/lib                  → Supabase client, auth config
/public               → Static assets (app.js, parser.js, index.css)
/supabase             → Database schema SQL
/ios                  → Native Swift companion app
```

---

## Environment Variables

See `.env.example` for the full list with descriptions.

| Variable | Required | Description |
|---|---|---|
| `NEXTAUTH_SECRET` | ✅ | Random secret for JWT signing |
| `NEXTAUTH_URL` | ✅ | App base URL |
| `GOOGLE_CLIENT_ID` | ✅ | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | ✅ | Google OAuth client secret |
| `NEXT_PUBLIC_SUPABASE_URL` | ✅ | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✅ | Supabase anonymous key |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | Supabase service role key (server only) |
| `GOOGLE_API_KEY` | ✅ | Gemini API key for AI coaching |
