/**
 * DbAdapter — runtime-pluggable database backend.
 *
 * Consumers import `getDbAdapter()` from `./index.ts` instead of importing
 * `@supabase/supabase-js` or `@neondatabase/serverless` directly. The Supabase
 * backend returns the native SupabaseClient (so call sites keep their
 * `.from().select().eq()` shape verbatim); the Neon backend returns a thin
 * proxy with the same surface, implemented via @neondatabase/serverless.
 *
 * Adding a new DB backend = adding a new file in this directory that
 * implements DbAdapter. No consumer code changes.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export type DbKind = 'supabase' | 'neon';

/**
 * Cookie store for server-side Supabase clients (matches the existing
 * `_shared/supabase/client.ts#ServerCookieStore` shape so @supabase/ssr
 * wrappers can pass through).
 */
export interface ServerCookieStore {
  get(name: string): { value: string } | undefined;
  set(name: string, value: string, options: Record<string, unknown>): void;
}

/**
 * Minimum query surface every adapter MUST support. Mirrors the methods used
 * by the existing call sites (templates/{saas,shop,portfolio}/app/**) so the
 * adapter swap is transparent.
 *
 *   .from(table).select(cols?).eq(col,val).single() / .order(col)
 *   .from(table).insert(row).select(cols?).single()
 *   .from(table).update(patch).eq(col,val).select(cols?).single()
 *   .from(table).upsert(row).select(cols?).single()
 *   .from(table).delete().eq(col,val)
 *   .rpc(name, args)
 *   .auth.getUser()
 */
export interface DbAdapter {
  readonly kind: DbKind;
  // Server
  /**
   * Server-side client bound to the request's cookie store. For Supabase
   * this is `createServerClient` (cookie-backed); for Neon this is a plain
   * neon() function (Neon has no request-time auth concept).
   */
  getServerClient(cookieStore?: ServerCookieStore): Promise<DbClient>;
  /** Service-role / admin client (server-only, bypasses RLS). */
  getServiceClient(): DbClient;
  /** Browser-side client (publishable key, anon RLS). */
  getBrowserClient(): DbClient;
  /**
   * Escape hatch: native clients, exposed for advanced queries not covered
   * by the DbClient surface (e.g. Supabase storage, Neon transactions).
   */
  readonly raw: {
    supabase?: {
      browser?: () => SupabaseClient;
      server?: (cookieStore?: ServerCookieStore) => Promise<SupabaseClient>;
      service: () => SupabaseClient;
    };
    neon?: {
      sql: ReturnType<typeof import('@neondatabase/serverless').neon>;
    };
  };
}

/**
 * The unified client interface. For Supabase it's literally a SupabaseClient;
 * for Neon it's a thin proxy that exposes the same method names.
 *
 * Call sites that need backend-specific features (storage, complex RPCs)
 * can branch on `db.kind === 'supabase' | 'neon'` and use the raw escape hatch.
 */
export interface DbClient {
  /** Supabase-only: auth.getUser(). For Neon, returns null. */
  auth: {
    getUser(): Promise<{
      data: { user: { id: string; email: string | null } | null } | null;
      error: { message: string } | null;
    }>;
  };
  from(table: string): QueryBuilder;
  rpc<T = unknown>(name: string, args?: Record<string, unknown>): Promise<{
    data: T;
    error: { message: string } | null;
  }>;
}

export interface QueryBuilder {
  select(cols?: string): QueryBuilder;
  insert(row: Record<string, unknown> | Record<string, unknown>[]): QueryBuilder;
  update(patch: Record<string, unknown>): QueryBuilder;
  upsert(row: Record<string, unknown> | Record<string, unknown[]>): QueryBuilder;
  delete(): QueryBuilder;
  eq(col: string, val: unknown): QueryBuilder;
  order(col: string, opts?: { ascending?: boolean }): QueryBuilder;
  single(): Promise<{ data: unknown; error: { message: string } | null }>;
  // Materialize the query (await it directly).
  then<TResult1 = { data: unknown[]; error: { message: string } | null }, TResult2 = never>(
    onfulfilled?: (value: { data: unknown[]; error: { message: string } | null }) => TResult1 | PromiseLike<TResult1>,
    onrejected?: (reason: unknown) => TResult2 | PromiseLike<TResult2>,
  ): PromiseLike<TResult1 | TResult2>;
}
