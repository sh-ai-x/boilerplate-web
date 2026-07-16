-- 0001_init.sql — saas template initial schema
-- PRD non-goal: Toss is the only payment provider. No email/password auth —
-- Google OAuth only. RLS keeps plans public-readable (auth), plan-writes
-- admin-only, and subscriptions/payments user-scoped.

create extension if not exists "pgcrypto";

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

-- RLS
alter table public.plans enable row level security;
alter table public.subscriptions enable row level security;
alter table public.payments enable row level security;

-- plans: any authenticated user can READ; only admins can WRITE
drop policy if exists "plans_read_authenticated" on public.plans;
create policy "plans_read_authenticated"
  on public.plans for select
  to authenticated
  using (true);

drop policy if exists "plans_admin_write" on public.plans;
create policy "plans_admin_write"
  on public.plans for all
  to authenticated
  using (auth.jwt() ->> 'role' = 'admin')
  with check (auth.jwt() ->> 'role' = 'admin');

-- subscriptions: user can read their own; admin can read all
drop policy if exists "subscriptions_read_own" on public.subscriptions;
create policy "subscriptions_read_own"
  on public.subscriptions for select
  to authenticated
  using (auth.uid() = user_id or auth.jwt() ->> 'role' = 'admin');

-- payments: user can read their own; admin can read all
drop policy if exists "payments_read_own" on public.payments;
create policy "payments_read_own"
  on public.payments for select
  to authenticated
  using (auth.uid() = user_id or auth.jwt() ->> 'role' = 'admin');

-- Seed: starter plans (admin can edit/delete these)
insert into public.plans (name, price_cents, interval, external_plan_key) values
  ('Starter',  9900,  'month', 'starter_monthly'),
  ('Pro',     29900,  'month', 'pro_monthly'),
  ('Business',99000,  'month', 'business_monthly')
on conflict (name) do nothing;
