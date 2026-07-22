-- 0004_billing_rate_limit.sql — per-user billing attempt rate limit.
--
-- A06/F10: the billing Edge Function drives external verification/provider
-- calls (Turnstile + Toss). An authenticated user can replay the function
-- as fast as their browser will let them — even though Cloudflare's
-- Turnstile siteverify and Toss's /issue endpoints have their own rate
-- limits, those limits are coarse and per-IP / per-secret-key, not per-
-- user. A motivated attacker with one valid session can drive the
-- provider quota for everyone.
--
-- Fix: a per-user rate limit (1 billing attempt per minute per user)
-- enforced at the database layer. The RPC is the gating check: it
-- returns TRUE if the request is allowed, FALSE if the user has
-- already attempted a billing flow in the last 60s.
--
-- All statements are ADDITIVE: no DROP / no CREATE TABLE of pre-existing
-- objects.

-- ---------------------------------------------------------------------------
-- billing_attempts
-- ---------------------------------------------------------------------------
create table if not exists public.billing_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  attempted_at timestamptz not null default now()
);

-- A12: lookup-by-user-and-time is the only query path.
create index if not exists billing_attempts_user_id_attempted_at_idx
  on public.billing_attempts (user_id, attempted_at desc);

-- A12: defense-in-depth retention guard. Without this, the table grows
-- unbounded. A scheduled job (or this RPC, on every call) can prune
-- rows older than the window. The partial index on recent rows keeps
-- the working set small.
create index if not exists billing_attempts_recent_idx
  on public.billing_attempts (user_id, attempted_at)
  where attempted_at > now() - interval '5 minutes';

alter table public.billing_attempts enable row level security;

revoke all on public.billing_attempts from public;
revoke all on public.billing_attempts from anon;
revoke all on public.billing_attempts from authenticated;

-- ---------------------------------------------------------------------------
-- check_billing_rate_limit(user_id, max_per_minute) -> boolean
--
-- Returns TRUE if the user may attempt a billing flow (and writes a row
-- recording the attempt). Returns FALSE if the user has already hit the
-- limit in the last 60s.
--
-- Implementation: count rows for this user in the last 60s. If the
-- count is at or above max_per_minute, refuse. Otherwise insert a row
-- and return TRUE. The check + insert is intentionally NOT atomic: a
-- tiny race window (two concurrent requests both seeing count<limit)
-- is acceptable because the rate limit is a courtesy to upstream
-- providers, not a security boundary. The idempotency key on the Toss
-- issue call (billing:${userId}:${plan_id}) handles the actual double-
-- spend problem.
-- ---------------------------------------------------------------------------
create or replace function public.check_billing_rate_limit(
  p_user_id uuid,
  p_max_per_minute integer default 1
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if p_user_id is null then
    raise exception 'user_id is required';
  end if;
  if p_max_per_minute is null or p_max_per_minute < 1 then
    raise exception 'max_per_minute must be >= 1';
  end if;

  select count(*) into v_count
  from public.billing_attempts
  where user_id = p_user_id
    and attempted_at > now() - interval '60 seconds';

  if v_count >= p_max_per_minute then
    return false;
  end if;

  insert into public.billing_attempts (user_id) values (p_user_id);
  return true;
end;
$$;

revoke all on function public.check_billing_rate_limit(uuid, integer) from public;
grant execute on function public.check_billing_rate_limit(uuid, integer) to service_role;
