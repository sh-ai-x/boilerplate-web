-- 0002_audit_log.sql — additive hardening on top of 0001_init.sql.
--
-- Adds:
--   - a SECURITY DEFINER helper auth.app_role() that exposes the JWT
--     `app_metadata.role` claim (the top-level `auth.jwt()->>role` is the
--     PostgREST role, NOT the app role).
--   - an admin-only SELECT policy on audit_log that calls auth.app_role().
--   - a partial unique index on subscriptions ensuring at most one active
--     row per (user, plan) — defends against duplicate-provider-billing-key
--     races even if the application-layer pre-check loses the race.
--
-- All statements are ADDITIVE: no DROP TABLE / no CREATE TABLE of existing
-- objects (the tables are owned by 0001_init.sql).

-- ---------------------------------------------------------------------------
-- auth.app_role() — read app_metadata.role from the request JWT.
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

-- ---------------------------------------------------------------------------
-- audit_log SELECT policy — admin-only, via auth.app_role().
-- ---------------------------------------------------------------------------
drop policy if exists "audit_log_admin_read" on public.audit_log;
create policy "audit_log_admin_read"
  on public.audit_log for select
  to authenticated
  using (auth.app_role() = 'admin');

-- ---------------------------------------------------------------------------
-- A06: at-most-one-active-subscription per (user, plan).
-- ---------------------------------------------------------------------------
create unique index if not exists subscriptions_one_active_per_plan
  on public.subscriptions (user_id, plan_id)
  where status = 'active';
