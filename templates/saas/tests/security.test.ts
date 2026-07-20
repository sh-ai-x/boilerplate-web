import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');

const BILLING = read('../supabase/functions/billing/index.ts');
const PLANS_PAGE = read('../app/admin/plans/page.tsx');
const NEXT_CONFIG = read('../next.config.js');
const LAYOUT = read('../app/layout.tsx');
const AUDIT_MIGRATION = read('../supabase/migrations/0002_audit_log.sql');
const LOCKFILE = read('../../../pnpm-lock.yaml');
const SAAS_README = read('../README.md');

describe('A01 — admin role enforced inside the upsertPlan Server Action', () => {
  it('re-derives the caller and asserts admin before mutating', () => {
    // The 'use server' action must run its own auth check, not rely on the page.
    const action = PLANS_PAGE.slice(PLANS_PAGE.indexOf("'use server'"));
    expect(action).toMatch(/createServerSupabase/);
    expect(action).toMatch(/auth\.getUser\(\)/);
    expect(action).toMatch(/role\s*!==\s*'admin'/);
    expect(action).toMatch(/throw new Error\('forbidden'\)/);
    // The role check must precede the first service-role mutation.
    expect(action.indexOf("throw new Error('forbidden')"))
      .toBeLessThan(action.indexOf('.from(\'plans\')'));
  });
});

describe('A01/A07 — billing customerKey is bound to the authenticated user', () => {
  it('derives customerKey from the user id, never from the request body', () => {
    expect(BILLING).toMatch(/const customerKey = userId;/);
    expect(BILLING).not.toMatch(/customerKey:\s*customer_key/);
  });
  it('authenticates (getUser) before any Toss issuance', () => {
    expect(BILLING.indexOf('auth.getUser()'))
      .toBeLessThan(BILLING.indexOf('issueBillingKey({'));
  });
});

describe('A02 — anti-framing / security headers', () => {
  it('sets X-Frame-Options, CSP frame-ancestors, Referrer-Policy, nosniff', () => {
    expect(NEXT_CONFIG).toMatch(/async headers\(\)/);
    expect(NEXT_CONFIG).toMatch(/X-Frame-Options.*DENY/s);
    expect(NEXT_CONFIG).toMatch(/frame-ancestors 'none'/);
    expect(NEXT_CONFIG).toMatch(/Referrer-Policy/);
    expect(NEXT_CONFIG).toMatch(/X-Content-Type-Options.*nosniff/s);
  });
});

describe('A03 — dependency integrity', () => {
  it('imports supabase-js from an integrity-locked registry (not mutable esm.sh)', () => {
    expect(BILLING).not.toMatch(/esm\.sh/);
    expect(BILLING).toMatch(/jsr:@supabase\/supabase-js@2\.45\.4/);
  });
});

describe('A03 — committed lockfile', () => {
  it('has a committed workspace lockfile governing this package', () => {
    expect(LOCKFILE).toMatch(/templates\/saas:/);
    expect(SAAS_README).toMatch(/frozen-lockfile/);
  });
});

describe('A06 — no duplicate active subscriptions', () => {
  it('pre-checks for an existing active subscription and uses a stable idempotency key', () => {
    expect(BILLING).toMatch(/\.eq\('status',\s*'active'\)/);
    expect(BILLING).toMatch(/subscription_already_active/);
    expect(BILLING).toMatch(/idempotencyKey = `billing:\$\{userId\}:\$\{plan_id\}`/);
    expect(BILLING).not.toMatch(/'idempotency-key':\s*crypto\.randomUUID\(\)[\s\S]*TOSS_CONFIRM_URL/);
  });
  it('has a DB-level unique guard for one active subscription per plan', () => {
    expect(AUDIT_MIGRATION).toMatch(/unique index[\s\S]*subscriptions[\s\S]*status = 'active'/i);
  });
});

describe('A09 — logging / audit trail', () => {
  it('logs turnstile failures, unauth requests, toss errors and success', () => {
    expect(BILLING).toMatch(/logEvent\('turnstile_failed'/);
    expect(BILLING).toMatch(/logEvent\('billing_unauthenticated'/);
    expect(BILLING).toMatch(/logEvent\('billing_toss_error'/);
    expect(BILLING).toMatch(/logEvent\('subscription_created'/);
  });
  it('writes an actor-attributed audit row on plan mutations', () => {
    expect(PLANS_PAGE).toMatch(/\.from\('audit_log'\)\.insert\(/);
    expect(PLANS_PAGE).toMatch(/actor_id:\s*user\.id/);
    expect(PLANS_PAGE).toMatch(/action:\s*'plans\.upsert'/);
    expect(AUDIT_MIGRATION).toMatch(/create table if not exists public\.audit_log/);
  });
});

describe('A10 — resilience: timeouts, cleanup, narrow catch', () => {
  it('bounds both external fetches with AbortController timeouts', () => {
    expect(BILLING).toMatch(/TURNSTILE_TIMEOUT_MS = 5000/);
    expect(BILLING).toMatch(/TOSS_TIMEOUT_MS = 10000/);
    expect((BILLING.match(/new AbortController\(\)/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });
  it('cleans up the orphaned Toss billing key on insert failure', () => {
    expect(BILLING).toMatch(/deleteBillingKey\(tossAuth, result\.billingKey\)/);
    const insertFail = BILLING.slice(BILLING.indexOf('if (subErr || !sub)'));
    expect(insertFail).toMatch(/deleteBillingKey/);
  });
  it('narrows the layout catch so real auth failures are not swallowed', () => {
    expect(LAYOUT).not.toMatch(/catch \(_\) \{[\s\S]*?\}\s*$/m);
    expect(LAYOUT).toMatch(/isMissingEnvError/);
    expect(LAYOUT).toMatch(/console\.error/);
  });
});
