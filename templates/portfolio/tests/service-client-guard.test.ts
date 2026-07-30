import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getServiceClient } from '../lib/supabase-guard';

const SAVED: Record<string, string | undefined> = {};

function snapshotEnv() {
  for (const k of ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']) {
    SAVED[k] = process.env[k];
  }
}
function restoreEnv() {
  for (const k of Object.keys(SAVED)) {
    if (SAVED[k] === undefined) delete process.env[k];
    else process.env[k] = SAVED[k];
  }
}

describe('portfolio — service-client construction guard (review-blocker #2)', () => {
  beforeEach(() => {
    snapshotEnv();
  });
  afterEach(() => {
    restoreEnv();
  });

  it('returns ok:true when both env vars are present', () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key';
    const r = getServiceClient();
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.client).toBeTruthy();
  });

  it('returns ok:false (never throws) when NEXT_PUBLIC_SUPABASE_URL is empty', () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = '';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key';
    expect(() => getServiceClient()).not.toThrow();
    const r = getServiceClient();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('misconfigured');
  });

  it('returns ok:false (never throws) when SUPABASE_SERVICE_ROLE_KEY is empty', () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = '';
    expect(() => getServiceClient()).not.toThrow();
    const r = getServiceClient();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('misconfigured');
  });

  it('returns ok:false (never throws) when both env vars are unset', () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    expect(() => getServiceClient()).not.toThrow();
    const r = getServiceClient();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('misconfigured');
  });
});
