import { createClient, type SupabaseClient } from '@supabase/supabase-js';
export type BrowserSupabase = SupabaseClient;
export type ServerSupabase = SupabaseClient;
export type ServiceSupabase = SupabaseClient;
export interface ServerCookieStore { get(n: string): { value: string } | undefined; set(n: string, v: string, o: Record<string, unknown>): void; }
function readEnv(key: string): string { const v = (typeof process !== 'undefined' && process.env) ? process.env[key] ?? '' : ''; if (!v) throw new Error(`Missing required env: ${key}`); return v; }
export function createBrowserSupabase(): BrowserSupabase { return createClient(readEnv('NEXT_PUBLIC_SUPABASE_URL'), readEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY')); }
export function createServerSupabase(_cookieStore?: ServerCookieStore): ServerSupabase { return createClient(readEnv('NEXT_PUBLIC_SUPABASE_URL'), readEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY')); }
export function createServiceSupabase(): ServiceSupabase {
  if (typeof window !== 'undefined') throw new Error('createServiceSupabase() must NOT be called in the browser');
  return createClient(readEnv('NEXT_PUBLIC_SUPABASE_URL'), readEnv('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false, autoRefreshToken: false } });
}
