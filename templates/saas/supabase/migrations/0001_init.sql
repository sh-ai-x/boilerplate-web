-- 0001_init.sql — base schema for the saas template.
-- Creates the three tables the app/ + Edge Function rely on:
--   - public.plans         — catalogue of subscription tiers (priced in KRW).
--   - public.subscriptions — one active subscription per (user, plan).
--   - public.audit_log     — actor-attributed trail of privileged mutations.
--
-- A fresh deployment applies migrations in lexicographic order, so this file
-- MUST exist and MUST define every table referenced by 0002 + the Edge
-- Function. Without it, `supabase db push` produces an empty database and
-- the billing function / admin page fail at runtime.

-- ---------------------------------------------------------------------------
-- plans
-- ---------------------------------------------------------------------------
create table if not exists public.plans (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  price_cents integer not null check (price_cents > 0),
  interval text not null check (interval in ('month', 'year')),
  external_plan_key text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.plans enable row level security;

-- Anyone (including anon) can read the price list. Writes are service-role only.
drop policy if exists "plans_public_read" on public.plans;
create policy "plans_public_read"
  on public.plans for select
  using (true);

-- ---------------------------------------------------------------------------
-- subscriptions
-- ---------------------------------------------------------------------------
create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  plan_id uuid not null references public.plans(id) on delete restrict,
  billing_key text not null,
  status text not null check (status in ('active', 'cancelled', 'abandoned')),
  next_bill_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists subscriptions_user_id_idx
  on public.subscriptions (user_id);
create index if not exists subscriptions_plan_id_idx
  on public.subscriptions (plan_id);

alter table public.subscriptions enable row level security;

-- A user can read only their own subscriptions. Writes are service-role only.
drop policy if exists "subscriptions_owner_read" on public.subscriptions;
create policy "subscriptions_owner_read"
  on public.subscriptions for select
  to authenticated
  using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- audit_log
-- ---------------------------------------------------------------------------
create table if not exists public.audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references auth.users(id) on delete set null,
  action text not null,
  before jsonb,
  after jsonb,
  created_at timestamptz not null default now()
);

create index if not exists audit_log_actor_id_idx
  on public.audit_log (actor_id);
create index if not exists audit_log_created_at_idx
  on public.audit_log (created_at desc);

alter table public.audit_log enable row level security;
