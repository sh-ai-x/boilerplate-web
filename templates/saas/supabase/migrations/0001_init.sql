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


-- ---------------------------------------------------------------------------
-- claim_toss_billing_key_cleanup() — A04 atomic CAS for billing-key cleanup.
--
-- Called by the Edge Function after a failed subscriptions INSERT. Returns
-- TRUE if THIS function's billing_key is still referenced in subscriptions
-- (a concurrent request won the race, so the Toss key must NOT be deleted —
-- it is the winner's key). Returns FALSE if no row has this billing_key
-- (the orphan is safe to delete from Toss).
--
-- SECURITY DEFINER + locked search_path so the Edge Function can call it via
-- the service-role client without granting the anon role any extra privileges.
-- ---------------------------------------------------------------------------
create or replace function public.claim_toss_billing_key_cleanup(p_billing_key text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  update public.subscriptions
     set status = 'abandoned', updated_at = now()
   where billing_key = p_billing_key
   returning id into v_id;

  -- true  => our key is in the DB; do NOT delete (winner depends on it).
  -- false => no row has our key; safe to delete from Toss.
  return v_id is not null;
end;
$$;

revoke all on function public.claim_toss_billing_key_cleanup(text) from public;
grant execute on function public.claim_toss_billing_key_cleanup(text) to service_role;


-- ---------------------------------------------------------------------------
-- upsert_plan_with_audit() — A09 transactional plan write + audit insert.
--
-- The admin Server Action MUST be atomic: the plans write and the
-- audit_log insert must both succeed or neither must be recorded.
-- Wrapping both in a single SECURITY DEFINER function achieves this in
-- a single round-trip and returns the audit row id to the caller.
-- ---------------------------------------------------------------------------
create or replace function public.upsert_plan_with_audit(
  actor_id uuid,
  plan_id_in uuid,
  payload jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan_id uuid;
  v_before jsonb;
  v_audit_id uuid;
begin
  if payload is null or jsonb_typeof(payload) <> 'object' then
    raise exception 'payload must be a json object';
  end if;

  -- Capture prior state for the audit diff (NULL on insert).
  if plan_id_in is not null then
    select to_jsonb(p) into v_before
    from public.plans p
    where p.id = plan_id_in;
    if v_before is null then
      raise exception 'plan_not_found';
    end if;

    update public.plans
       set name              = payload ->> 'name',
           price_cents       = (payload ->> 'price_cents')::int,
           interval          = payload ->> 'interval',
           external_plan_key = payload ->> 'external_plan_key',
           updated_at        = now()
     where id = plan_id_in;
  else
    insert into public.plans (name, price_cents, interval, external_plan_key)
    values (
      payload ->> 'name',
      (payload ->> 'price_cents')::int,
      payload ->> 'interval',
      payload ->> 'external_plan_key'
    )
    returning id into v_plan_id;
  end if;

  insert into public.audit_log (actor_id, action, before, after)
  values (
    actor_id,
    'plans.upsert',
    v_before,
    payload
  )
  returning id into v_audit_id;

  return v_audit_id;
end;
$$;

revoke all on function public.upsert_plan_with_audit(uuid, uuid, jsonb) from public;
grant execute on function public.upsert_plan_with_audit(uuid, uuid, jsonb) to service_role;
