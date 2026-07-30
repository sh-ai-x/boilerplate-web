import { createServiceSupabase, type ServiceSupabase } from '@boilerplate-web/shared/supabase';

/**
 * Result of trying to construct the service-role Supabase client.
 *
 * - `ok: true`  -> client is ready; the route can query data.
 * - `ok: false` -> env is missing/empty OR `createServiceSupabase()`
 *                  threw; the route should render <ServiceNotice /> and
 *                  return 200, never bubble a 500.
 */
export type ServiceClientResult =
  | { ok: true; client: ServiceSupabase }
  | { ok: false; reason: 'misconfigured' };

/**
 * Construct the service-role Supabase client in a failure-safe way.
 *
 * `createServiceSupabase()` in `@boilerplate-web/shared/supabase` throws
 * when `NEXT_PUBLIC_SUPABASE_URL` or `SUPABASE_SERVICE_ROLE_KEY` is
 * missing or empty. We don't want a missing deployment secret to
 * crash a public route, so we pre-check the env and wrap the call in
 * a try/catch — both paths yield a typed `{ ok: false }` instead of a
 * thrown exception.
 */
export function getServiceClient(): ServiceClientResult {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  if (!url || !key) return { ok: false, reason: 'misconfigured' };
  try {
    return { ok: true, client: createServiceSupabase() };
  } catch (_err) {
    return { ok: false, reason: 'misconfigured' };
  }
}
