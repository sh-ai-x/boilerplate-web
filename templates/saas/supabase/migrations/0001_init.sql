-- 0001_init.sql — saas template initial schema
-- PRD non-goal: Toss is the only payment provider. No email/password auth —
-- Google OAuth only. RLS keeps plans public-readable (auth), plan-writes
-- admin-only, and subscriptions/payments user-scoped.
--
-- A01/A06: ALL admin RLS policies gate on auth.app_role() — the app metadata
-- role from the JWT ('admin' string). NEVER on auth.jwt() ->> 'role', which
-- is the PostgREST role ('authenticated' / 'anon' / 'service_role') and
-- therefore would NEVER match 'admin', silently breaking every admin write.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- auth.app_role() — read app_metadata.role from the request JWT.
-- Stable + SECURITY DEFINER so policies can use it inside USING clauses
-- without leaking caller auth context. Defined here (not in 0002) because
-- every table's admin RLS policy needs it; 0002 only adds policy overlays.
-- ---------------------------------------------------------------------------
create or replace function auth.app_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    ((auth.jwt() -> 'app_metadata' ->> 'role'))::text,
    ''
  );
$$;

-- plans: admin-managed catalog of subscription plans
create table if not exists public.plans (
  id uuid primary key default gen_random_uuid(),
  name text unique not null,
  price_cents integer not null check (price_cents > 0),
  interval text not null check (interval in ('month', 'year')),
  external_plan_key text,
  created_at timestamptz not null default now()
);

-- subscriptions: a user's recurring subscription to a plan
create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  plan_id uuid not null references public.plans(id) on delete restrict,
  billing_key text,
  status text not null check (status in ('active', 'cancelled', 'past_due')),
  next_bill_at timestamptz,
  created_at timestamptz not null default now()
);

-- payments: individual payment records (for audit + reconciliation)
create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  plan_id uuid not null references public.plans(id) on delete restrict,
  amount_cents integer not null,
  toss_payment_key text unique,
  created_at timestamptz not null default now()
);

-- audit_log: append-only record of privileged mutations. Written via
-- SECURITY DEFINER RPCs (e.g. upsert_plan_with_audit) under the service
-- role. The SELECT policy that lets admins read it lands in 0002 (additive
-- overlay); the table itself MUST live here so any policy referencing it
-- can resolve.
create table if not exists public.audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null,
  action text not null check (action in ('upsert_plan', 'delete_plan')),
  plan_id uuid,
  payload jsonb,
  created_at timestamptz not null default now()
);

-- RLS
alter table public.plans enable row level security;
alter table public.subscriptions enable row level security;
alter table public.payments enable row level security;
alter table public.audit_log enable row level security;

-- plans: anon and authenticated can READ (the public pricing page
-- uses createServerSupabase(), which runs under the anon role, so
-- scoping reads to authenticated breaks /pricing for signed-out
-- visitors). Only admins can WRITE.
drop policy if exists "plans_read_authenticated" on public.plans;
create policy "plans_read_authenticated"
  on public.plans for select
  to anon, authenticated
  using (true);

drop policy if exists "plans_admin_write" on public.plans;
create policy "plans_admin_write"
  on public.plans for all
  to authenticated
  using (auth.app_role() = 'admin')
  with check (auth.app_role() = 'admin');

-- subscriptions: user can read their own; admin can read all
drop policy if exists "subscriptions_read_own" on public.subscriptions;
create policy "subscriptions_read_own"
  on public.subscriptions for select
  to authenticated
  using (auth.uid() = user_id or auth.app_role() = 'admin');

-- payments: user can read their own; admin can read all
drop policy if exists "payments_read_own" on public.payments;
create policy "payments_read_own"
  on public.payments for select
  to authenticated
  using (auth.uid() = user_id or auth.app_role() = 'admin');

-- audit_log: no client-side SELECT (admin policy lands in 0002). Writes
-- happen via SECURITY DEFINER RPCs which run as the function owner and
-- bypass RLS, so no INSERT/UPDATE policy is required here.
drop policy if exists "audit_log_no_client_read" on public.audit_log;
create policy "audit_log_no_client_read"
  on public.audit_log for select
  to authenticated
  using (false);

-- Seed: starter plans (admin can edit/delete these)
insert into public.plans (name, price_cents, interval, external_plan_key) values
  ('Starter',  9900,  'month', 'starter_monthly'),
  ('Pro',     29900,  'month', 'pro_monthly'),
  ('Business',99000,  'month', 'business_monthly')
on conflict (name) do nothing;
