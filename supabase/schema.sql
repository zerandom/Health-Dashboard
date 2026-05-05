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

-- ── RAG (Retrieval-Augmented Generation) ──────────────────────────────────────
-- Enable pgvector extension
create extension if not exists vector;

-- Coaching literature store
create table if not exists coaching_literature (
  id          bigint generated always as identity primary key,
  source      text not null,         
  category    text not null,         
  chunk_text  text not null,         
  embedding   vector(768) not null,  
  created_at  timestamptz default now()
);

-- IVFFlat index for fast approximate nearest-neighbour search
create index if not exists coaching_literature_embedding_idx on coaching_literature
  using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

-- Similarity search RPC
create or replace function match_literature(
  query_embedding  vector(768),
  match_count      int     default 3,
  filter_category  text    default null
)
returns table (
  id         bigint,
  source     text,
  category   text,
  chunk_text text,
  similarity float
)
language sql stable
as $$
  select
    id, source, category, chunk_text,
    1 - (embedding <=> query_embedding) as similarity
  from coaching_literature
  where (filter_category is null or category = filter_category)
  order by embedding <=> query_embedding
  limit match_count;
$$;
