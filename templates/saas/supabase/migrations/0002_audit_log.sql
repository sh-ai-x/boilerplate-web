-- 0002_audit_log.sql — additive hardening on top of 0001_init.sql.
--
-- Adds:
--   - an admin-only SELECT policy on audit_log that calls auth.app_role()
--     (the helper function is defined in 0001_init.sql because the plans
--     admin RLS policy also needs it).
--   - a partial unique index on subscriptions ensuring at most one active
--     row per (user, plan) — defends against duplicate-provider-billing-key
--     races even if the application-layer pre-check loses the race.
--   - an append-only TRIGGER on public.audit_log that raises an exception
--     on UPDATE or DELETE. RLS + REVOKE are not enough: service-role
--     bypasses RLS, and a permissive GRANT or future migration could
--     silently re-grant UPDATE/DELETE. A trigger is enforced inside
--     the same transaction as the mutating statement, so even a
--     privileged caller cannot rewrite or scrub forensic rows.
--
-- All statements are ADDITIVE: no DROP TABLE / no CREATE TABLE of existing
-- objects (the tables are owned by 0001_init.sql).

-- ---------------------------------------------------------------------------
-- audit_log SELECT policy — admin-only, via auth.app_role().
-- ---------------------------------------------------------------------------
drop policy if exists "audit_log_admin_read" on public.audit_log;
create policy "audit_log_admin_read"
  on public.audit_log for select
  to authenticated
  using (auth.app_role() = 'admin');

-- ---------------------------------------------------------------------------
-- A09: audit_log is append-only. UPDATE and DELETE are forbidden even
-- for service_role.
-- ---------------------------------------------------------------------------
create or replace function public.audit_log_block_mutations()
returns trigger
language plpgsql
as $$
begin
  raise exception 'public.audit_log is append-only; % is forbidden', tg_op
    using errcode = 'insufficient_privilege';
end;
$$;

drop trigger if exists audit_log_no_update on public.audit_log;
create trigger audit_log_no_update
  before update on public.audit_log
  for each row execute function public.audit_log_block_mutations();

drop trigger if exists audit_log_no_delete on public.audit_log;
create trigger audit_log_no_delete
  before delete on public.audit_log
  for each row execute function public.audit_log_block_mutations();

-- A09: defense-in-depth — even bypassing the trigger, REVOKE on UPDATE/
-- DELETE from PUBLIC/anon/authenticated narrows the attack surface so
-- only service_role (which the trigger still blocks) could attempt a
-- mutation. Service_role INSERT is preserved (the upsert RPC writes
-- audit rows under service_role via SECURITY DEFINER).
revoke update, delete on public.audit_log from public, anon, authenticated;
-- INSERT and SELECT are NOT revoked from service_role:
--   - INSERT is granted to service_role by the upsert RPC's SECURITY
--     DEFINER wrapper.
--   - SELECT for service_role is granted implicitly as the table owner.

-- ---------------------------------------------------------------------------
-- A06: at-most-one-active-subscription per (user, plan).
-- ---------------------------------------------------------------------------
create unique index if not exists subscriptions_one_active_per_plan
  on public.subscriptions (user_id, plan_id)
  where status = 'active';
