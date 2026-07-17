import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export type BrowserSupabase = SupabaseClient;
export type ServerSupabase = SupabaseClient;
export type ServiceSupabase = SupabaseClient;

function readEnv(key: string, allowEmpty = false): string {
  const v =
    typeof process !== 'undefined' && process.env ? process.env[key] ?? '' : '';
  if (!allowEmpty && !v) {
    throw new Error(
      `Missing required env: ${key}. Copy .env.example to .env.local and fill it in.`
    );
  }
  return v;
}

/**
 * Cookie options for the server-side client. Kept structurally compatible
 * with the Next.js `cookies()` API so it can be wrapped by the consumer.
 */
export interface ServerCookieStore {
  get(name: string): { value: string } | undefined;
  set(name: string, value: string, options: Record<string, unknown>): void;
}

/**
 * Browser Supabase client. Reads NEXT_PUBLIC_* keys so it's safe to ship to
 * the client bundle.
 */
export function createBrowserSupabase(): BrowserSupabase {
  const url = readEnv('NEXT_PUBLIC_SUPABASE_URL');
  const anonKey = readEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY');
  return createClient(url, anonKey, {
    auth: { persistSession: true, autoRefreshToken: true },
  });
}

/**
 * Server Supabase client (Next.js Server Components / Route Handlers).
 * Uses the same anon key; the caller wires cookie persistence via the
 * supplied cookieStore shim (Next.js `cookies()` is structurally compatible).
 */
export function createServerSupabase(cookieStore?: ServerCookieStore): ServerSupabase {
  const url = readEnv('NEXT_PUBLIC_SUPABASE_URL');
  const anonKey = readEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY');
  return createClient(url, anonKey, {
    auth: {
      persistSession: !!cookieStore,
      autoRefreshToken: !!cookieStore,
      // storageKey is configurable per-request in real apps; the default is fine.
    },
  });
}

/**
 * Service-role Supabase client. SERVER-ONLY — never import from a client
 * component or any file that ends up in the browser bundle.
 */
export function createServiceSupabase(): ServiceSupabase {
  const url = readEnv('NEXT_PUBLIC_SUPABASE_URL');
  const serviceKey = readEnv('SUPABASE_SERVICE_ROLE_KEY');
  if (typeof window !== 'undefined') {
    throw new Error('createServiceSupabase() must NOT be called in the browser');
  }
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
