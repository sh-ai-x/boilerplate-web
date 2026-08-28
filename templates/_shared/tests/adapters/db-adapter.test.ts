// DbAdapter factory + SupabaseDbAdapter env-key resolution tests.
// NeonDbAdapter full SQL execution is deferred (plan section 11 risk #6).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const createClientMock = vi.fn();
vi.mock('@supabase/supabase-js', () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
}));

const createSsrServerClientMock = vi.fn();
vi.mock('@supabase/ssr', () => ({
  createServerClient: (...args: unknown[]) => createSsrServerClientMock(...args),
}));

import { getDbAdapter, _resetDbAdapter, SupabaseDbAdapter } from '../../adapters/db/index';

const SAVED: Record<string, string | undefined> = {};
const ENV_KEYS = [
  'DB_PROVIDER',
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SECRET_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'DATABASE_URL',
  'NEON_DATABASE_URL',
];

function snapshot() {
  for (const k of ENV_KEYS) SAVED[k] = process.env[k];
}
function restore() {
  for (const k of ENV_KEYS) {
    if (SAVED[k] === undefined) delete process.env[k];
    else process.env[k] = SAVED[k];
  }
}
function clearAll() {
  for (const k of ENV_KEYS) delete process.env[k];
}
// Service-client browser-guard: SupabaseDbAdapter.getServiceClient() refuses to
// run when window is defined (jsdom sets it). Clear it for the duration of each
// test so the service-client path can be exercised.
const SAVED_WINDOW = (globalThis as Record<string, unknown>).window;
function stashWindow() {
  (globalThis as Record<string, unknown>).window = undefined;
}
function restoreWindow() {
  (globalThis as Record<string, unknown>).window = SAVED_WINDOW;
}
beforeEach(() => stashWindow());
afterEach(() => restoreWindow());


describe('adapters/db — getDbAdapter() factory', () => {
  beforeEach(() => {
    snapshot();
    clearAll();
    createClientMock.mockClear();
    createSsrServerClientMock.mockClear();
  });
  afterEach(() => {
    restore();
    _resetDbAdapter();
  });

  it('returns SupabaseDbAdapter when DB_PROVIDER=supabase', () => {
    process.env.DB_PROVIDER = 'supabase';
    const db = getDbAdapter();
    expect(db.kind).toBe('supabase');
  });

  it('returns SupabaseDbAdapter when DB_PROVIDER unset but NEXT_PUBLIC_SUPABASE_URL is set', () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    const db = getDbAdapter();
    expect(db.kind).toBe('supabase');
  });

  it('returns NeonDbAdapter when DB_PROVIDER=neon', () => {
    process.env.DB_PROVIDER = 'neon';
    process.env.DATABASE_URL = 'postgres://user:pass@host/db';
    const db = getDbAdapter();
    expect(db.kind).toBe('neon');
  });

  it('returns NeonDbAdapter when DATABASE_URL starts with postgres:// and DB_PROVIDER unset', () => {
    process.env.DATABASE_URL = 'postgres://u:p@h/d';
    const db = getDbAdapter();
    expect(db.kind).toBe('neon');
  });

  it('defaults to Supabase when no relevant env vars are set', () => {
    const db = getDbAdapter();
    expect(db.kind).toBe('supabase');
  });

  it('returns the same singleton across calls', () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    const a = getDbAdapter();
    const b = getDbAdapter();
    expect(a).toBe(b);
  });

  it('_resetDbAdapter() clears the cache', () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    const a = getDbAdapter();
    _resetDbAdapter();
    const b = getDbAdapter();
    expect(a).not.toBe(b);
    // Both should still be Supabase since env didn't change.
    expect(b.kind).toBe('supabase');
  });
});

describe('adapters/db — SupabaseDbAdapter env key resolution', () => {
  beforeEach(() => {
    snapshot();
    clearAll();
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    createClientMock.mockClear();
  });
  afterEach(() => {
    restore();
  });

  it('getServiceClient() uses new SUPABASE_SECRET_KEY (sb_secret_*) when set', () => {
    process.env.SUPABASE_SECRET_KEY = 'sb_secret_NEW';
    new SupabaseDbAdapter().getServiceClient();
    expect(createClientMock).toHaveBeenCalledWith(
      'https://example.supabase.co',
      'sb_secret_NEW',
      expect.any(Object),
    );
  });

  it('getServiceClient() falls back to legacy SUPABASE_SERVICE_ROLE_KEY when new key missing', () => {
    process.env.SUPABASE_SECRET_KEY = '';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'legacy_sr_jwt';
    new SupabaseDbAdapter().getServiceClient();
    expect(createClientMock.mock.calls[0]?.[1]).toBe('legacy_sr_jwt');
  });

  it('getServiceClient() throws when neither secret key is set', () => {
    expect(() => new SupabaseDbAdapter().getServiceClient()).toThrow(/SUPABASE_SECRET_KEY/);
  });

  it('getBrowserClient() uses new NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY when set', () => {
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_NEW';
    new SupabaseDbAdapter().getBrowserClient();
    expect(createClientMock.mock.calls[0]?.[1]).toBe('sb_publishable_NEW');
  });

  it('getBrowserClient() falls back to legacy NEXT_PUBLIC_SUPABASE_ANON_KEY when new key missing', () => {
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = '';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'legacy_anon_jwt';
    new SupabaseDbAdapter().getBrowserClient();
    expect(createClientMock.mock.calls[0]?.[1]).toBe('legacy_anon_jwt');
  });

  it('getServiceClient() refuses to run in the browser', () => {
    process.env.SUPABASE_SECRET_KEY = 'sb_secret_TEST'; // so the env check passes
    const savedWindow = (globalThis as Record<string, unknown>).window;
    (globalThis as Record<string, unknown>).window = { foo: 'bar' } as object;
    try {
      expect(() => new SupabaseDbAdapter().getServiceClient()).toThrow(/browser/i);
    } finally {
      (globalThis as Record<string, unknown>).window = savedWindow;
    }
  });
});
