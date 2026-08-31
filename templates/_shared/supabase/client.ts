/**
 * @deprecated This file is now a thin re-export wrapper around
 * `@boilerplate-web/shared/adapters/db`. New code should import the
 * adapter directly:
 *
 *   import { getDbAdapter } from '@boilerplate-web/shared/adapters/db';
 *   const db = getDbAdapter();
 *   const client = db.getServiceClient();
 *
 * The createBrowserSupabase / createServerSupabase / createServiceSupabase
 * functions below are preserved so the existing 15 call sites across the
 * saas / shop / portfolio templates keep working unchanged. Each delegates
 * to `getDbAdapter().get*Client()`.
 */

import { getDbAdapter } from '../adapters/db/index';
import type { DbClient, ServerCookieStore } from '../adapters/db/types';

export type { BrowserSupabase, ServerSupabase, ServiceSupabase } from '../adapters/db/supabase';
// Re-export the native SupabaseClient type for callers that need it.
export type { SupabaseClient } from '@supabase/supabase-js';

export function createBrowserSupabase(): DbClient {
  return getDbAdapter().getBrowserClient();
}

// Backward-compat: the legacy `createServerSupabase(cookieStore?)` was always
// synchronous — it built a bare @supabase/supabase-js client and ignored the
// cookie store. The new path for cookie-aware SSR is `createServerClient` from
// `@supabase/ssr` (see saas/admin/plans/page.tsx). New code should call
// `getDbAdapter().getServerClient(cookieStore)` directly when it actually
// needs the async cookie-backed client.
export function createServerSupabase(_cookieStore?: ServerCookieStore): DbClient {
  // Sync path: bare client (cookie store ignored for backward compat).
  // The SupabaseDbAdapter.getBrowserClient() returns a sync client with
  // persistSession disabled when no cookie store is wired in.
  return getDbAdapter().getBrowserClient() as DbClient;
}

export function createServiceSupabase(): DbClient {
  return getDbAdapter().getServiceClient();
}
