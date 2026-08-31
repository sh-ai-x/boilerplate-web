/**
 * getDbAdapter() — runtime factory for the database backend.
 *
 * Selection order:
 *   1. Explicit `DB_PROVIDER` env var (`supabase|neon`, set by the scaffolder
 *      from `cli/index.js#parseArgs --db=...`).
 *   2. Env-var detection: `NEXT_PUBLIC_SUPABASE_URL` → Supabase;
 *      `DATABASE_URL` starting with `postgres://` → Neon.
 *   3. Default: Supabase (backward-compatible).
 *
 * Singleton cache, same shape as getAuthAdapter().
 */

import type { DbAdapter, DbKind, DbClient, ServerCookieStore } from './types';
import { SupabaseDbAdapter } from './supabase';
import { NeonDbAdapter } from './neon';

export type { DbAdapter, DbKind, DbClient, QueryBuilder, ServerCookieStore } from './types';
export { SupabaseDbAdapter } from './supabase';
export { NeonDbAdapter } from './neon';

let cached: DbAdapter | null = null;

function detectKind(): DbKind {
  const explicit = (process.env.DB_PROVIDER ?? '').toLowerCase();
  if (explicit === 'supabase') return 'supabase';
  if (explicit === 'neon') return 'neon';

  const hasSupabaseUrl = !!process.env.NEXT_PUBLIC_SUPABASE_URL;
  const dbUrl = process.env.DATABASE_URL ?? process.env.NEON_DATABASE_URL ?? '';
  const hasNeonUrl = dbUrl.startsWith('postgres://') || dbUrl.startsWith('postgresql://');

  if (hasNeonUrl) return 'neon';
  if (hasSupabaseUrl) return 'supabase';

  // Default to Supabase to preserve existing behavior.
  return 'supabase';
}

export function getDbAdapter(): DbAdapter {
  if (cached) return cached as DbAdapter;
  const kind = detectKind();
  cached = (kind === 'neon' ? new NeonDbAdapter() : new SupabaseDbAdapter()) as DbAdapter;
  return cached as DbAdapter;
}

export function _resetDbAdapter(): void {
  cached = null;
}
