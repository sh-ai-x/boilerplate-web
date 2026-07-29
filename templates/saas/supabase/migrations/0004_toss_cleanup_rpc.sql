-- 0004_toss_cleanup_rpc.sql — re-introduce claim_toss_billing_key_cleanup.
--
-- The Edge Function at templates/saas/supabase/functions/billing/index.ts:307
-- calls public.claim_toss_billing_key_cleanup() after a failed
-- subscriptions INSERT, to decide whether the unused Toss billing key
-- is safe to delete. PR #30 condensed 0001_init.sql and the function
-- dropped out as a side effect; this migration adds it back as a
-- separate ADDITIVE statement so a fresh DB applying 0001 → 0004 in
-- lexicographic order still resolves the Edge Function call.
--
-- Semantics (tri-state):
--   returns 'true'  => a row in public.subscriptions holds THIS billing_key
--                      (concurrent request won the race; the Toss key is
--                      the winner's, so do NOT delete it).
--   returns 'false' => no row holds this billing_key (the Toss key is an
--                      orphan and safe to delete).
--   returns 'error' => an exception was raised inside the function. The
--                      caller MUST treat this as UNKNOWN and NEVER delete
--                      the shared Toss key — a wrong delete in this state
--                      would destroy the winner's live payment credential.
--
-- A10/F11: this is the third state. The previous function returned
-- boolean and silently conflated 'false' (intentional — orphan) with
-- 'error' (accidental — could not determine state), causing the caller
-- to authorize deletion in both cases, destroying the winner's
-- billing key under a transient DB failure.
--
-- Security:
--   - SECURITY DEFINER so the caller (anon/service_role) does not need
--     SELECT grants on subscriptions.
--   - revoked from PUBLIC, granted only to service_role. The Edge
--     Function runs with the service-role key.

create or replace function public.claim_toss_billing_key_cleanup(
  p_billing_key             text,
  p_active_subscription_id  uuid
)
returns text
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_exists boolean;
begin
  if p_billing_key is null or length(p_billing_key) = 0 then
    return 'error';
  end if;

  select exists (
    select 1
    from public.subscriptions
    where billing_key = p_billing_key
  ) into v_exists;

  if v_exists then
    return 'true';
  else
    return 'false';
  end if;
exception when others then
  return 'error';
end;
$$;

revoke all on function public.claim_toss_billing_key_cleanup(text, uuid) from public;
grant execute on function public.claim_toss_billing_key_cleanup(text, uuid) to service_role;
