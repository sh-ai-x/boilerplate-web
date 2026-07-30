-- 0001_init.sql — portfolio template initial schema
-- Non-goal #1: Google OAuth only. No email/password fields.
-- Non-goal #2: NO Toss / Turnstile / payment code in this template.

create extension if not exists "pgcrypto";

-- portfolio_items: MDX-backed blog/portfolio entries
create table if not exists public.portfolio_items (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  title text,
  content_mdx text not null,
  published_at timestamptz,
  created_at timestamptz not null default now()
);

-- guestbook_entries: signed-in users can post a short message
create table if not exists public.guestbook_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  message text not null check (length(message) <= 1000),
  created_at timestamptz not null default now()
);

-- RLS
alter table public.portfolio_items enable row level security;
alter table public.guestbook_entries enable row level security;

-- portfolio_items: anyone (incl. anon) can read; admin can write.
drop policy if exists "portfolio_items_public_read" on public.portfolio_items;
create policy "portfolio_items_public_read"
  on public.portfolio_items for select using (true);

drop policy if exists "portfolio_items_admin_write" on public.portfolio_items;
create policy "portfolio_items_admin_write"
  on public.portfolio_items for all to authenticated
  using (auth.jwt() ->> 'role' = 'admin')
  with check (auth.jwt() ->> 'role' = 'admin');

-- guestbook_entries: anyone can read; authenticated users can insert their own;
-- users can delete their own; admin can delete any.
drop policy if exists "guestbook_public_read" on public.guestbook_entries;
create policy "guestbook_public_read"
  on public.guestbook_entries for select using (true);

drop policy if exists "guestbook_authenticated_insert" on public.guestbook_entries;
create policy "guestbook_authenticated_insert"
  on public.guestbook_entries for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "guestbook_own_delete" on public.guestbook_entries;
create policy "guestbook_own_delete"
  on public.guestbook_entries for delete to authenticated
  using (auth.uid() = user_id or auth.jwt() ->> 'role' = 'admin');

-- Seed: a couple of MDX items
insert into public.portfolio_items (slug, title, content_mdx, published_at) values
  ('hello-world', 'Hello, world', E'# Hello\n\nWelcome to my portfolio. Sign the [guestbook](/guestbook).\n', now()),
  ('about-me', 'About me', E'## About\n\nI build things with Next.js, Supabase, and Cloudflare.\n', now())
on conflict (slug) do nothing;
