-- 0002_audit_log.sql — actor-attributed audit trail + subscription dedupe guard
-- A09: privileged admin mutations (plan price / external-plan-key changes) and
--      other sensitive actions must be recorded with the acting user's id.
-- A06: defense-in-depth against duplicate active subscriptions.

create table if not exists public.audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references auth.users(id) on delete set null,
  action text not null,
  before jsonb,
  after jsonb,
  created_at timestamptz not null default now()
);

alter table public.audit_log enable row level security;

-- Only admins may read the audit trail. Writes happen through the service-role
-- key, which bypasses RLS, so no insert policy is granted to end users.
drop policy if exists "audit_log_admin_read" on public.audit_log;
create policy "audit_log_admin_read"
  on public.audit_log for select
  to authenticated
  using (auth.jwt() ->> 'role' = 'admin');

-- A06: a user may hold at most one active subscription per plan. This makes
-- retried billing requests idempotent at the database layer even if the
-- application-level pre-check races.
create unique index if not exists subscriptions_one_active_per_plan
  on public.subscriptions (user_id, plan_id)
  where status = 'active';
