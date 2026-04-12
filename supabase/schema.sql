-- Ekatra — Supabase Schema
-- Run this in Supabase Dashboard → SQL Editor

-- ── Users ────────────────────────────────────────────────────────────────────
create table if not exists users (
  id          uuid primary key default gen_random_uuid(),
  email       text unique not null,
  name        text,
  avatar_url  text,
  created_at  timestamptz default now()
);

-- ── Parsed Health Data (XML export, one record per user) ──────────────────────
create table if not exists health_data (
  id          uuid primary key default gen_random_uuid(),
  user_email  text unique not null references users(email) on delete cascade,
  payload     jsonb not null,
  updated_at  timestamptz default now()
);

-- ── Live Sync Data (iOS HealthKit, latest snapshot per user) ─────────────────
create table if not exists live_sync (
  id          uuid primary key default gen_random_uuid(),
  user_email  text unique not null references users(email) on delete cascade,
  payload     jsonb not null,
  synced_at   timestamptz default now()
);

-- ── Habit Tags (daily log + habits list per user) ────────────────────────────
create table if not exists habit_tags (
  id          uuid primary key default gen_random_uuid(),
  user_email  text unique not null references users(email) on delete cascade,
  habits      jsonb not null default '["alcohol","supplements","sauna","cold_plunge","heavy_leg_day"]',
  log         jsonb not null default '{}'
);

-- ── Row Level Security ────────────────────────────────────────────────────────
-- Note: All queries go through the service role key on the server,
-- so RLS is a defence-in-depth layer. Enable it but allow service role through.

alter table users enable row level security;
alter table health_data enable row level security;
alter table live_sync enable row level security;
alter table habit_tags enable row level security;

-- Service role bypasses RLS automatically in Supabase.
-- No additional policies needed for server-side operations.
