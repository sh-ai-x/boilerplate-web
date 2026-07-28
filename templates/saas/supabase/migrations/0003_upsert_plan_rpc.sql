-- 0003_upsert_plan_rpc.sql — additive RPC for atomic plan upsert + audit log.
--
-- The admin Server Action in app/admin/plans/page.tsx calls
-- supabase.rpc('upsert_plan_with_audit', { actor_id, plan_id_in, payload })
-- to write plans + audit_log rows in a single transaction. Without this
-- function the action throws 'function public.upsert_plan_with_audit does
-- not exist' at runtime and the audit trail is silently lost.
--
-- Signature:
--   upsert_plan_with_audit(
--     actor_id    uuid,                  -- the JWT subject of the admin caller
--     plan_id_in  uuid,                  -- NULL = INSERT, non-NULL = UPDATE
--     payload     jsonb                  -- { name, price_cents, interval,
--                                       --    external_plan_key }
--   ) returns uuid                        -- the inserted audit_log.id
--
-- Security:
--   - SECURITY DEFINER so the caller (anon/service_role) does not need
--     INSERT/UPDATE grants on plans or audit_log.
--   - revoked from PUBLIC, granted only to service_role. The admin Server
--     Action runs under the service-role client.

-- ---------------------------------------------------------------------------
-- upsert_plan_with_audit()
-- ---------------------------------------------------------------------------
create or replace function public.upsert_plan_with_audit(
  actor_id   uuid,
  plan_id_in uuid,
  payload    jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan_id   uuid;
  v_action    text;
  v_payload   jsonb;
  v_audit_id  uuid;
begin
  -- Validate required payload fields. CHECK constraints on plans will
  -- also enforce these server-side, but doing it here means we never
  -- silently INSERT a malformed row.
  if (payload ->> 'name') is null or length((payload ->> 'name')::text) = 0 then
    raise exception 'payload.name is required';
  end if;
  if (payload ->> 'price_cents') is null or (payload ->> 'price_cents')::int <= 0 then
    raise exception 'payload.price_cents must be a positive integer';
  end if;
  if (payload ->> 'interval') is null or (payload ->> 'interval') not in ('month', 'year') then
    raise exception 'payload.interval must be one of {month, year}';
  end if;

  if plan_id_in is null then
    -- INSERT new plan, return the new id.
    insert into public.plans (
      name, price_cents, interval, external_plan_key
    ) values (
      (payload ->> 'name')::text,
      (payload ->> 'price_cents')::int,
      (payload ->> 'interval')::text,
      nullif((payload ->> 'external_plan_key')::text, '')
    )
    returning id into v_plan_id;
    v_action := 'upsert_plan';  -- INSERT and UPDATE both recorded as upsert
  else
    -- UPDATE existing plan.
    update public.plans set
      name              = (payload ->> 'name')::text,
      price_cents       = (payload ->> 'price_cents')::int,
      interval          = (payload ->> 'interval')::text,
      external_plan_key = nullif((payload ->> 'external_plan_key')::text, '')
    where id = plan_id_in
    returning id into v_plan_id;
    if v_plan_id is null then
      raise exception 'plan % not found', plan_id_in;
    end if;
    v_action := 'upsert_plan';
  end if;

  -- Append the audit row. payload snapshot is the canonical record.
  v_payload := jsonb_build_object(
    'name',              payload ->> 'name',
    'price_cents',       (payload ->> 'price_cents')::int,
    'interval',          payload ->> 'interval',
    'external_plan_key', payload ->> 'external_plan_key'
  );

  insert into public.audit_log (actor_id, action, plan_id, payload)
  values (actor_id, v_action, v_plan_id, v_payload)
  returning id into v_audit_id;

  return v_audit_id;
end;
$$;

-- Lock down execution: revoke from PUBLIC, grant only to service_role.
-- The admin Server Action runs with the service-role key (see
-- createServiceSupabase() in app/admin/plans/page.tsx), so anon and
-- authenticated callers cannot invoke this directly.
revoke all on function public.upsert_plan_with_audit(uuid, uuid, jsonb) from public;
grant execute on function public.upsert_plan_with_audit(uuid, uuid, jsonb) to service_role;
