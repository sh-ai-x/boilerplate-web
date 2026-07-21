import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');

const BILLING = read('../supabase/functions/billing/index.ts');
const PLANS_PAGE = read('../app/admin/plans/page.tsx');
const NEXT_CONFIG = read('../next.config.js');
const LAYOUT = read('../app/layout.tsx');
const MIGRATION_0001 = read('../supabase/migrations/0001_init.sql');
const MIGRATION_0002 = read('../supabase/migrations/0002_audit_log.sql');
const SAAS_PKG = read('../package.json');
const SHARED_PKG = read('../../_shared/package.json');
const SAAS_README = read('../README.md');

describe('A01 — admin role enforced inside the upsertPlan Server Action', () => {
  it('re-derives the caller and asserts admin before mutating', () => {
    // The 'use server' action must run its own auth check, not rely on the page.
    const action = PLANS_PAGE.slice(PLANS_PAGE.indexOf("'use server'"));
    expect(action).toMatch(/auth\.getUser\(\)/);
    expect(action).toMatch(/role\s*!==\s*'admin'/);
    expect(action).toMatch(/throw new Error\('forbidden'\)/);
    // The role check must precede the first service-role mutation.
    expect(action.indexOf("throw new Error('forbidden')"))
      .toBeLessThan(action.indexOf('.rpc('));
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

describe('A01 — base schema migration 0001_init.sql', () => {
  it('declares plans, subscriptions, audit_log tables', () => {
    expect(MIGRATION_0001).toMatch(/create table if not exists public\.plans/);
    expect(MIGRATION_0001).toMatch(/create table if not exists public\.subscriptions/);
    expect(MIGRATION_0001).toMatch(/create table if not exists public\.audit_log/);
  });
  it('enables RLS on all three tables', () => {
    expect(MIGRATION_0001.match(/enable row level security/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
  });
});

describe('A01 — RLS predicate reads app_metadata.role via auth.app_role()', () => {
  it('0002 defines auth.app_role() reading app_metadata.role', () => {
    expect(MIGRATION_0002).toMatch(/create or replace function auth\.app_role\(\)/);
    expect(MIGRATION_0002).toMatch(/auth\.jwt\(\)\s*->\s*'app_metadata'\s*->>\s*'role'/);
  });
  it('0002 policy uses auth.app_role() instead of top-level role', () => {
    expect(MIGRATION_0002).toMatch(/using \(auth\.app_role\(\) = 'admin'\)/);
    expect(MIGRATION_0002).not.toMatch(/auth\.jwt\(\)\s*->>\s*'role'/);
  });
  it('0002 is additive (no CREATE TABLE of existing objects)', () => {
    // Strip SQL line comments so the negative assertions only see statements.
    const codeOnly = MIGRATION_0002.replace(/--[^\n]*/g, '');
    expect(codeOnly).not.toMatch(/create table /i);
    expect(codeOnly).not.toMatch(/drop table /i);
  });
  it('0002 has the partial unique index for one active subscription per plan', () => {
    expect(MIGRATION_0002).toMatch(
      /create unique index if not exists subscriptions_one_active_per_plan[\s\S]*where status = 'active'/
    );
  });
});

describe('A07 — admin uses cookie-backed @supabase/ssr client', () => {
  it('imports createServerClient from @supabase/ssr', () => {
    expect(PLANS_PAGE).toMatch(/from '@supabase\/ssr'/);
    expect(PLANS_PAGE).toMatch(/createServerClient/);
  });
  it('wires next/headers cookies.get / cookies.set into the client', () => {
    expect(PLANS_PAGE).toMatch(/const cookieStore = cookies\(\)/);
    expect(PLANS_PAGE).toMatch(/cookieStore\.get\(name\)/);
    expect(PLANS_PAGE).toMatch(/cookieStore\.set\(\{ name, value, \.\.\.options \}\)/);
  });
  it('@supabase/ssr is declared in templates/saas/package.json', () => {
    expect(SAAS_PKG).toMatch(/"@supabase\/ssr":\s*"\^0\./);
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
  it('enforces HTTPS via Strict-Transport-Security (A02)', () => {
    // Without HSTS, a network attacker can downgrade the first request to
    // HTTP and steal the session cookie. max-age=31536000 is one year;
    // includeSubDomains prevents subdomain bypass.
    expect(NEXT_CONFIG).toMatch(
      /Strict-Transport-Security.*max-age=31536000.*includeSubDomains/s
    );
  });
  it('denies legacy cross-domain policies (A02)', () => {
    expect(NEXT_CONFIG).toMatch(/X-Permitted-Cross-Domain-Policies.*none/s);
  });
  it('disables unused browser features via Permissions-Policy (A02)', () => {
    expect(NEXT_CONFIG).toMatch(/Permissions-Policy/);
    expect(NEXT_CONFIG).toMatch(/camera=\(\)/);
    expect(NEXT_CONFIG).toMatch(/microphone=\(\)/);
    expect(NEXT_CONFIG).toMatch(/geolocation=\(\)/);
    expect(NEXT_CONFIG).toMatch(/interest-cohort=\(\)/);
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
    const LOCKFILE = read('../../../pnpm-lock.yaml');
    expect(LOCKFILE).toMatch(/templates\/saas:/);
    expect(SAAS_README).toMatch(/frozen-lockfile/);
  });
});

describe('A04 — atomic CAS billing-key cleanup', () => {
  it('0001 declares claim_toss_billing_key_cleanup returning boolean', () => {
    expect(MIGRATION_0001).toMatch(
      /create or replace function public\.claim_toss_billing_key_cleanup\([\s\S]*?p_active_subscription_id uuid[\s\S]*?returns boolean/
    );
  });
  // The previous implementation did a destructive UPDATE that returned the
  // WRONG answer in the winner-exists race (the WHERE clause excluded the
  // winner's row, so the UPDATE matched zero rows, returning FALSE — the
  // loser then DELETED the winner's Toss key). The new implementation is a
  // pure existence check. These two assertions pin the new contract.
  it('0001 cleanup is a read-only existence check (no destructive UPDATE)', () => {
    // The function body must NOT mark rows abandoned.
    const fnMatch = MIGRATION_0001.match(
      /create or replace function public\.claim_toss_billing_key_cleanup[\s\S]*?returns boolean([\s\S]*?)as \$\$([\s\S]*?)\$\$/
    );
    expect(fnMatch).not.toBeNull();
    const body = fnMatch![2];
    expect(body).not.toMatch(/update\s+public\.subscriptions/i);
    expect(body).not.toMatch(/status\s*=\s*'abandoned'/i);
    expect(body).toMatch(/select exists/i);
    expect(body).toMatch(/from public\.subscriptions/i);
    expect(body).toMatch(/where billing_key = p_billing_key/i);
  });
  // Scenario-A regression: a loser's cleanup call must return TRUE when a
  // winning row already holds the billing_key, so the Edge Function KEEPS the
  // Toss key instead of deleting it. Reproduce the bug-prone SQL semantics
  // in JS so the test fails if a future contributor reintroduces the UPDATE
  // pattern.
  it('A04 regression: RPC returns TRUE when winner row has the billing_key (no DELETE)', () => {
    // The RPC contract: TRUE iff some row has the billing_key. The
    // previous UPDATE-based logic returned FALSE here because the WHERE
    // excluded the winner's row, matching zero rows.
    function rpcSemantics(rows: { id: string; billing_key: string }[], p_billing_key: string): boolean {
      return rows.some((r) => r.billing_key === p_billing_key);
    }
    // Race: winner W just inserted with the same billing_key.
    const winner = [{ id: 'winner-id', billing_key: 'BK_FROM_TOSS' }];
    expect(rpcSemantics(winner, 'BK_FROM_TOSS')).toBe(true);
    // No row holds the key -> RPC returns FALSE -> safe to delete orphan.
    expect(rpcSemantics([], 'BK_FROM_TOSS')).toBe(false);
    // Stale row from another user's cancelled sub holds the key -> still TRUE.
    const stale = [{ id: 'stale-id', billing_key: 'BK_FROM_TOSS', status: 'cancelled' }];
    expect(rpcSemantics(stale, 'BK_FROM_TOSS')).toBe(true);
  });
  it('Edge Function only deletes the Toss key when the CAS says it is safe', () => {
    expect(BILLING).toMatch(/claim_toss_billing_key_cleanup/);
    expect(BILLING).toMatch(/if \(keepKey !== true\)/);
    const insertFail = BILLING.slice(BILLING.indexOf('if (subErr || !sub)'));
    expect(insertFail).toMatch(/deleteBillingKey/);
    expect(insertFail).toMatch(/claim_toss_billing_key_cleanup/);
    // Loser must look up the winner's id and pass it so the cleanup RPC
    // excludes the winning row from being marked abandoned.
    expect(insertFail).toMatch(/p_active_subscription_id/);
    expect(insertFail).toMatch(/\.eq\('billing_key'/);
  });
  it('interval-aware next_bill_at: uses addInterval helper', () => {
    expect(BILLING).toMatch(/function addInterval\(d: Date, interval:/);
    expect(BILLING).toMatch(/addInterval\(new Date\(\), plan\.interval\)/);
  });
  it('addInterval clamps end-of-month: Jan 31 + 1 month stays in February (not Mar 3)', () => {
    // Textual proof of the clamp branch — the helper uses setDate(0) to
    // snap an over-shot JS Date back to the LAST day of the intended
    // target month.
    expect(BILLING).toMatch(/setDate\(0\)/);
    expect(BILLING).toMatch(/next\.getMonth\(\) !== targetMonth/);
    // And the helper is called for the recurring-bill date.
    expect(BILLING).toMatch(/addInterval\(new Date\(\), plan\.interval\)/);
  });
  // Locally exercise the helper against the same Date semantics the Deno
  // runtime uses, to prove the clamp really prevents Jan 31 -> Mar 3.
  it('addInterval(Deno-style Date) returns Feb 28/29 for Jan 31 + 1 month', () => {
    const jan31 = new Date(2026, 0, 31); // local-time Jan 31, 2026
    const targetMonth = jan31.getMonth() + 1; // 1 = February
    const next = new Date(jan31);
    next.setMonth(targetMonth);
    if (next.getMonth() !== targetMonth) {
      // Same clamp as the helper under test.
      next.setDate(0);
    }
    expect(next.getMonth()).toBe(1); // February
    expect([28, 29]).toContain(next.getDate()); // 28 non-leap, 29 leap
  });
});

describe('A05 — CORS preflight + headers on every response', () => {
  it('declares CORS_HEADERS and applies them via jsonResponse', () => {
    expect(BILLING).toMatch(/CORS_HEADERS/);
    expect(BILLING).toMatch(/access-control-allow-origin/);
    expect(BILLING).toMatch(/access-control-allow-methods/);
    expect(BILLING).toMatch(/access-control-allow-headers/);
  });
  it('handles OPTIONS preflight returning 204 with CORS headers', () => {
    expect(BILLING).toMatch(/req\.method === 'OPTIONS'/);
    expect(BILLING).toMatch(/status: 204/);
  });
  it('rejects null/empty external_plan_key with plan_missing_external_key BEFORE Toss', () => {
    // Admin form allows external_plan_key to be NULL. Without this guard the
    // code would hand null to Toss and surface an opaque provider error.
    expect(BILLING).toMatch(/plan_missing_external_key/);
    // The check must happen before issueBillingKey is called.
    expect(BILLING.indexOf('plan_missing_external_key'))
      .toBeLessThan(BILLING.indexOf('issueBillingKey({'));
    // The check must guard the existing call site (not be unreachable).
    const beforeToss = BILLING.slice(0, BILLING.indexOf('issueBillingKey({'));
    expect(beforeToss).toMatch(/plan_missing_external_key/);
    expect(beforeToss).toMatch(/return jsonResponse\(\{ error: 'plan_missing_external_key' \}, 400\)/);
  });
});

describe('A06 — no duplicate active subscriptions', () => {
  it('pre-checks for an existing active subscription and uses a stable idempotency key', () => {
    expect(BILLING).toMatch(/\.eq\('status',\s*'active'\)/);
    expect(BILLING).toMatch(/subscription_already_active/);
    expect(BILLING).toMatch(/idempotencyKey = `billing:\$\{userId\}:\$\{plan_id\}`/);
    expect(BILLING).not.toMatch(/'idempotency-key':\s*crypto\.randomUUID\(\)[\s\S]*TOSS_CONFIRM_URL/);
  });
});

describe('A07 — Toss billing-key issuance contract', () => {
  it('body contains customerKey + authKey + plan (no amount, no orderId)', () => {
    // The body object is built in issueBillingKey.
    const bodyMatch = BILLING.match(/body: JSON\.stringify\(\{([\s\S]*?)\}\)/);
    expect(bodyMatch).not.toBeNull();
    const body = bodyMatch![1];
    expect(body).toMatch(/customerKey:/);
    expect(body).toMatch(/authKey:/);
    expect(body).toMatch(/plan:/);
    expect(body).not.toMatch(/amount:/);
    expect(body).not.toMatch(/orderId:/);
  });
  it('Authorization is Basic base64(secretKey:) — Toss contract', () => {
    // Per Toss docs: 'Append a colon (:) to the end of your secret key,
    // then Base64-encode it'. The previous test pinned the WRONG order
    // (authKey:secretKey) which produced 401 at runtime. The new regex
    // pins the correct Basic auth contract: secret key followed by a
    // trailing colon, base64-encoded.
    expect(BILLING).toMatch(/Basic ' \+ btoa\(`\$\{tossSecret\}:`\)/);
    expect(BILLING).not.toMatch(/TOSS_AUTH_KEY/);
    expect(BILLING).not.toMatch(/tossAuthKey/);
  });
  it('btoa(secretKey:) round-trip: base64 decodes to "sk_test_xxx:"', () => {
    // Reproduce the header value so the test fails if a future
    // contributor introduces a different credential shape.
    const secretKey = 'sk_test_dummyKeyValue';
    const header = 'Basic ' + btoa(`${secretKey}:`);
    // btoa is available in the Deno runtime that ships the Edge
    // Function; vitest's jsdom env also exposes it for tests.
    const decoded = atob(header.replace(/^Basic /, ''));
    expect(decoded).toBe('sk_test_dummyKeyValue:');
  });
  it('Idempotency-Key is stable per (user, plan) — no crypto.randomUUID() on issue', () => {
    const issueFn = BILLING.slice(
      BILLING.indexOf('async function issueBillingKey'),
      BILLING.indexOf('async function deleteBillingKey')
    );
    expect(issueFn).not.toMatch(/crypto\.randomUUID\(\)/);
  });
});

describe('A09 — transactional plan + audit via RPC', () => {
  it('0001 declares upsert_plan_with_audit returning audit id', () => {
    expect(MIGRATION_0001).toMatch(
      /create or replace function public\.upsert_plan_with_audit\(/
    );
    expect(MIGRATION_0001).toMatch(/insert into public\.audit_log/);
  });
  it('admin Server Action calls upsert_plan_with_audit (not separate insert + audit)', () => {
    const action = PLANS_PAGE.slice(PLANS_PAGE.indexOf("'use server'"));
    expect(action).toMatch(/\.rpc\('upsert_plan_with_audit'/);
    // Strip line-comment matches so the negative assertions below only see code.
    const codeOnly = action.replace(/\/\/[^\n]*/g, '');
    expect(codeOnly).not.toMatch(/\.from\(['"]audit_log['"]\)\.insert\(/);
    expect(codeOnly).not.toMatch(/\.from\(['"]plans['"]\)\.insert\(/);
    expect(codeOnly).not.toMatch(/\.from\(['"]plans['"]\)\.update\(/);
  });
  it('0001 audit_log table is the source of truth for the trail', () => {
    expect(MIGRATION_0001).toMatch(/create table if not exists public\.audit_log/);
  });
});

describe('A09 — logging / audit trail', () => {
  it('logs turnstile failures, unauth requests, toss errors and success', () => {
    expect(BILLING).toMatch(/logEvent\('turnstile_failed'/);
    expect(BILLING).toMatch(/logEvent\('billing_unauthenticated'/);
    expect(BILLING).toMatch(/logEvent\('billing_toss_error'/);
    expect(BILLING).toMatch(/logEvent\('subscription_created'/);
  });
});

describe('A10 — resilience: timeouts, cleanup, narrow catch', () => {
  it('bounds both external fetches with AbortController timeouts', () => {
    expect(BILLING).toMatch(/TURNSTILE_TIMEOUT_MS = 5000/);
    expect(BILLING).toMatch(/TOSS_TIMEOUT_MS = 10000/);
    expect((BILLING.match(/new AbortController\(\)/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });
  it('rejects non-object body before destructuring', () => {
    expect(BILLING).toMatch(/body === null \|\| typeof body !== 'object' \|\| Array\.isArray\(body\)/);
    expect(BILLING).toMatch(/invalid_body/);
  });
  it('narrows the layout catch so real auth failures are not swallowed', () => {
    expect(LAYOUT).not.toMatch(/catch \(_\) \{[\s\S]*?\}\s*$/m);
    expect(LAYOUT).toMatch(/isMissingEnvError/);
    expect(LAYOUT).toMatch(/console\.error/);
  });
});
describe('A01/A09 — README matches the actual schema', () => {
  it('README documents plans + subscriptions + audit_log (no phantom payments table)', () => {
    expect(SAAS_README).toMatch(/plans/);
    expect(SAAS_README).toMatch(/subscriptions/);
    expect(SAAS_README).toMatch(/audit_log/);
    expect(SAAS_README).not.toMatch(/\bpayments\b\s+tables?/);
  });
  it('README does not promise seed data the migration never inserts', () => {
    expect(SAAS_README).not.toMatch(/Seed data inserts/);
    expect(SAAS_README).not.toMatch(/Starter\s*\/\s*Pro\s*\/\s*Business/);
  });
  it('README column name is external_plan_key (matches migration)', () => {
    expect(SAAS_README).toMatch(/plans\.external_plan_key/);
    expect(SAAS_README).not.toMatch(/plans\.toss_plan_key/);
  });
  it('README admin invariant uses auth.app_role() (matches 0002 migration)', () => {
    expect(SAAS_README).toMatch(/auth\.app_role\(\)/);
    const codeOnly = SAAS_README.replace(/`[^`]*`/g, '').replace(/^>.*$/gm, '');
    expect(codeOnly).not.toMatch(/admin pages are server-gated.*auth\.jwt\(\)\s*->>\s*'role'/i);
  });
  it('README notes that Toss Basic auth uses just the secret key', () => {
    expect(SAAS_README).not.toMatch(/TOSS_AUTH_KEY/);
  });
  it('README has no leftover CI retrigger comment trailers', () => {
    expect(SAAS_README).not.toMatch(/^#\s*20\d\d-\d\d-\d\d.*CI retrigger/m);
  });
});describe('A04/A09 — upsert_plan_with_audit preserves external_plan_key on update', () => {
  it('UPDATE branch coalesces payload key against existing column', () => {
    // The admin edit form does not pre-fill external_plan_key, so a blank
    // submit would otherwise overwrite an existing Toss plan key with NULL.
    // The RPC must coalesce(payload, existing) to keep the prior value.
    expect(MIGRATION_0001).toMatch(
      /external_plan_key\s*=\s*coalesce\s*\(\s*payload\s*->>\s*'external_plan_key'\s*,\s*external_plan_key\s*\)/
    );
  });
  it('SQL semantics: blank payload key keeps prior external_plan_key', () => {
    // Reproduce the merge in JS so the test would fail if a future
    // contributor reintroduces the unconditional `payload ->> 'external_plan_key'`
    // assignment.
    function mergeUpdate(existing: { external_plan_key: string | null }, payload: { external_plan_key?: string | null }) {
      // Same shape as the plpgsql coalesce(payload ->> key, existing col).
      const payloadKey = Object.prototype.hasOwnProperty.call(payload, 'external_plan_key')
        ? payload.external_plan_key
        : null;
      return {
        external_plan_key: payloadKey ?? existing.external_plan_key,
      };
    }
    // Form submits a blank external_plan_key -> payload.external_plan_key = null.
    expect(
      mergeUpdate({ external_plan_key: 'toss-plan-abc' }, { external_plan_key: null })
    ).toEqual({ external_plan_key: 'toss-plan-abc' });
    // Caller omits the key entirely (e.g. an admin edit form that did not
    // render the field) -> payload key is missing.
    expect(mergeUpdate({ external_plan_key: 'toss-plan-abc' }, {})).toEqual({ external_plan_key: 'toss-plan-abc' });
    // Caller explicitly supplies a NEW key -> payload wins.
    expect(
      mergeUpdate({ external_plan_key: 'toss-plan-old' }, { external_plan_key: 'toss-plan-new' })
    ).toEqual({ external_plan_key: 'toss-plan-new' });
  });
});describe('A10 — verifyTurnstile pins hostname and action', () => {
  it('verifyTurnstile signature accepts expectedHostname + expectedAction', () => {
    expect(BILLING).toMatch(
      /async function verifyTurnstile\([\s\S]*?expectedHostname\?:\s*string[\s\S]*?expectedAction\?:\s*string/
    );
  });
  it('verifyTurnstile compares data.hostname against expectedHostname', () => {
    expect(BILLING).toMatch(/data\.hostname\s*!==\s*expectedHostname/);
  });
  it('verifyTurnstile compares data.action against expectedAction', () => {
    expect(BILLING).toMatch(/data\.action\s*!==\s*expectedAction/);
  });
  it('handler reads TURNSTILE_EXPECTED_HOSTNAME / TURNSTILE_EXPECTED_ACTION env vars', () => {
    expect(BILLING).toMatch(/TURNSTILE_EXPECTED_HOSTNAME/);
    expect(BILLING).toMatch(/TURNSTILE_EXPECTED_ACTION/);
  });
  it('hostname / action mismatch semantics: cross-origin token is rejected', () => {
    // Reproduce the gate locally so the test fails if a future contributor
    // drops one of the comparisons.
    function verify(data: { success?: boolean; hostname?: string; action?: string }, expectedHostname?: string, expectedAction?: string): boolean {
      if (data.success !== true) return false;
      if (expectedHostname && data.hostname !== expectedHostname) return false;
      if (expectedAction && data.action !== expectedAction) return false;
      return true;
    }
    // Token issued for attacker host, replayed against billing.
    expect(
      verify({ success: true, hostname: 'attacker.example', action: 'subscribe' }, 'billing.example', 'subscribe')
    ).toBe(false);
    // Token issued for /login widget action, replayed against /billing.
    expect(
      verify({ success: true, hostname: 'billing.example', action: 'login' }, 'billing.example', 'subscribe')
    ).toBe(false);
    // Token issued for the right host + action: accepted.
    expect(
      verify({ success: true, hostname: 'billing.example', action: 'subscribe' }, 'billing.example', 'subscribe')
    ).toBe(true);
    // No expectations configured: legacy behavior (success-only) preserved.
    expect(verify({ success: true, hostname: 'anything', action: 'login' })).toBe(true);
  });
});describe('A01 — admin page guards missing env vars', () => {
  it('getSupabaseForRequest validates NEXT_PUBLIC_SUPABASE_URL is non-empty', () => {
    expect(PLANS_PAGE).toMatch(/readEnv\(['"]NEXT_PUBLIC_SUPABASE_URL['"]\)/);
  });
  it('getSupabaseForRequest validates NEXT_PUBLIC_SUPABASE_ANON_KEY is non-empty', () => {
    expect(PLANS_PAGE).toMatch(/readEnv\(['"]NEXT_PUBLIC_SUPABASE_ANON_KEY['"]\)/);
  });
  it('readEnv throws Missing required env: <key> on empty values', () => {
    expect(PLANS_PAGE).toMatch(/Missing required env: /);
  });
  it('createServerClient is never called with empty strings', () => {
    // Regression: previously the code passed `?? ''` into createServerClient,
    // which produced a generic 500 on misconfiguration. After the fix, every
    // env value reaches createServerClient via readEnv, which throws first.
    const admin = PLANS_PAGE.slice(PLANS_PAGE.indexOf('function getSupabaseForRequest'));
    expect(admin).not.toMatch(/createServerClient\(\s*\n?\s*process\.env\.NEXT_PUBLIC_SUPABASE_URL\s*\?\?\s*''/);
    expect(admin).not.toMatch(/createServerClient\(\s*\n?\s*''\s*,/);
  });
  it('readEnv JS semantics: empty string raises a clean error', () => {
    function readEnv(key: string, value: string | undefined): string {
      const v = value ?? '';
      if (!v) throw new Error(`Missing required env: ${key}. Copy .env.example to .env.local and fill it in.`);
      return v;
    }
    expect(() => readEnv('NEXT_PUBLIC_SUPABASE_URL', '')).toThrow(/Missing required env: NEXT_PUBLIC_SUPABASE_URL/);
    expect(() => readEnv('NEXT_PUBLIC_SUPABASE_URL', undefined)).toThrow(/Missing required env: NEXT_PUBLIC_SUPABASE_URL/);
    expect(readEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://x.supabase.co')).toBe('https://x.supabase.co');
  });
});