-- 0003_cleanup_queue.sql — durable retry queue for orphaned Toss billing keys.
--
-- A10/F4: the billing Edge Function's deleteBillingKey helper is a
-- best-effort DELETE against Toss. If Toss returns a non-2xx (transient
-- 5xx, auth glitch) or the request times out, the key is still live on
-- Toss — a reusable payment credential the user could be charged against
-- without any record in our database. The previous code only logged the
-- failure. This migration adds a durable retry queue so a cron / scheduled
-- Edge Function can re-attempt the DELETE until it succeeds.
--
-- Lifecycle:
--   1. billing Edge Function enqueues a row here on cleanup failure.
--   2. A scheduled job (e.g. pg_cron + service_role Edge Function, or a
--      Supabase scheduled function) reads pending rows, re-issues the
--      DELETE against Toss, and either deletes the row on success or
--      increments attempts + sets next_retry_at with backoff.
--   3. RLS is restrictive: only the service_role can read or write. There
--      is no client-facing policy — end users must never see or interact
--      with this table.
--
-- All statements are ADDITIVE: no DROP / no CREATE TABLE of pre-existing
-- objects (cleanup_queue is new in this migration).

-- ---------------------------------------------------------------------------
-- cleanup_queue
-- ---------------------------------------------------------------------------
create table if not exists public.cleanup_queue (
  id uuid primary key default gen_random_uuid(),
  billing_key text not null,
  attempts integer not null default 0,
  last_error text,
  last_attempt_at timestamptz,
  next_retry_at timestamptz not null default now(),
  enqueued_at timestamptz not null default now(),
  -- A12: monotonic guard so the retry worker cannot push next_retry_at
  -- backwards. Combined with the unique index below, this prevents two
  -- concurrent retries from racing on the same row.
  retry_locked_until timestamptz
);

-- Lookup is by billing_key for the retry worker.
create index if not exists cleanup_queue_billing_key_idx
  on public.cleanup_queue (billing_key);

-- The retry worker queries pending rows in next_retry_at order.
create index if not exists cleanup_queue_next_retry_at_idx
  on public.cleanup_queue (next_retry_at)
  where retry_locked_until is null or retry_locked_until < now();

alter table public.cleanup_queue enable row level security;

-- No policies for anon / authenticated — only service_role bypasses RLS.
-- Belt-and-suspenders: explicit REVOKE so a future policy mistake cannot
-- expose this table to end users.
revoke all on public.cleanup_queue from public;
revoke all on public.cleanup_queue from anon;
revoke all on public.cleanup_queue from authenticated;

-- ---------------------------------------------------------------------------
-- enqueue_billing_key_cleanup() — service_role-only INSERT helper.
--
-- The billing Edge Function calls this on cleanup failure. The function is
-- the ONLY supported write path into cleanup_queue; it returns the queue
-- row id so the caller can correlate logs.
-- ---------------------------------------------------------------------------
create or replace function public.enqueue_billing_key_cleanup(
  p_billing_key text,
  p_last_error text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_billing_key is null or length(p_billing_key) = 0 then
    raise exception 'billing_key must be non-empty';
  end if;

  insert into public.cleanup_queue (billing_key, last_error)
  values (p_billing_key, p_last_error)
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.enqueue_billing_key_cleanup(text, text) from public;
grant execute on function public.enqueue_billing_key_cleanup(text, text) to service_role;
