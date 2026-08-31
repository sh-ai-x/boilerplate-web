/**
 * SupabaseDbAdapter — wraps @supabase/supabase-js (and @supabase/ssr for
 * the cookie-backed server client).
 *
 * The three get*Client() methods return the native SupabaseClient. The
 * DbClient interface in types.ts is structurally compatible with
 * SupabaseClient (same method names), so consumers can use the surface
 * verbatim without ever branching on `db.kind`.
 *
 * For Edge Function compatibility, the Edge Functions (Deno runtime)
 * import `createClient` directly from `jsr:@supabase/supabase-js`; they
 * do NOT go through this adapter (the Edge Functions don't need cookie
 * handling or server/client separation — they use the service-role key
 * with no browser/server distinction).
 */

import { createClient as createBrowserClient, type SupabaseClient } from '@supabase/supabase-js';
import { createServerClient as createSsrServerClient, type CookieOptions } from '@supabase/ssr';
import type { DbAdapter, DbClient, ServerCookieStore } from './types';

// Backward-compat type aliases for the legacy `_shared/supabase/client.ts` API.
export type BrowserSupabase = SupabaseClient;
export type ServerSupabase = SupabaseClient;
export type ServiceSupabase = SupabaseClient;

// ---- env resolution (matches the existing _shared/supabase/client.ts logic) ----

function readEnv(key: string): string {
  const v = process.env[key] ?? '';
  if (!v) {
    throw new Error(
      `Missing required env: ${key}. Copy .env.example to .env.local and fill it in.`,
    );
  }
  return v;
}

function resolvePublishableKey(): string {
  return (
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    (() => {
      throw new Error(
        'Missing required env: NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (or legacy NEXT_PUBLIC_SUPABASE_ANON_KEY)',
      );
    })()
  );
}

function resolveSecretKey(): string {
  const newKey = process.env.SUPABASE_SECRET_KEY;
  const legacyKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (newKey) return newKey;
  if (legacyKey) return legacyKey;
  throw new Error(
    'Missing required env: SUPABASE_SECRET_KEY (or legacy SUPABASE_SERVICE_ROLE_KEY). Copy .env.example to .env.local and fill it in.',
  );
}

function readEnvAllowEmpty(key: string): string {
  return process.env[key] ?? '';
}

// ---- adapter ----

export class SupabaseDbAdapter implements DbAdapter {
  readonly kind = 'supabase' as const;

  async getServerClient(cookieStore?: ServerCookieStore): Promise<DbClient> {
    const url = readEnv('NEXT_PUBLIC_SUPABASE_URL');
    const key = resolvePublishableKey();
    if (!cookieStore) {
      // No cookie store: fall back to a bare client (matches the existing
      // `_shared/supabase/client.ts#createServerSupabase()` behavior).
      return createBrowserClient(url, key, {
        auth: { persistSession: false, autoRefreshToken: false },
      }) as unknown as DbClient;
    }
    return createSsrServerClient(url, key, {
      cookies: {
        get: (name: string) => cookieStore.get(name)?.value,
        set: (name: string, value: string, options: CookieOptions) => {
          try {
            cookieStore.set(name, value, options as Record<string, unknown>);
          } catch (_err) {
            // Server Components can't set cookies; non-fatal.
          }
        },
        remove: (name: string, options: CookieOptions) => {
          try {
            cookieStore.set(name, '', options as Record<string, unknown>);
          } catch (_err) {
            // Same as above.
          }
        },
      },
    }) as unknown as DbClient;
  }

  getServiceClient(): DbClient {
    const url = readEnv('NEXT_PUBLIC_SUPABASE_URL');
    const key = resolveSecretKey();
    if (typeof window !== 'undefined') {
      throw new Error('getServiceClient() must NOT be called in the browser');
    }
    return createBrowserClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    }) as unknown as DbClient;
  }

  getBrowserClient(): DbClient {
    const url = readEnvAllowEmpty('NEXT_PUBLIC_SUPABASE_URL');
    const key = resolvePublishableKey();
    return createBrowserClient(url, key, {
      auth: { persistSession: true, autoRefreshToken: true },
    }) as unknown as DbClient;
  }

  readonly raw = {
    supabase: {
      browser: () =>
        createBrowserClient(
          readEnv('NEXT_PUBLIC_SUPABASE_URL'),
          resolvePublishableKey(),
          { auth: { persistSession: true, autoRefreshToken: true } },
        ) as SupabaseClient,
      service: () => {
        if (typeof window !== 'undefined') {
          throw new Error('raw.supabase.service must NOT be called in the browser');
        }
        return createBrowserClient(
          readEnv('NEXT_PUBLIC_SUPABASE_URL'),
          resolveSecretKey(),
          { auth: { persistSession: false, autoRefreshToken: false } },
        ) as SupabaseClient;
      },
    },
  };
}
