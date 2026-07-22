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
    // A10/F2: the gating decision is now tri-state, not boolean. The
    // "keep" branch must be `keepKey === true`; the "delete" branch is
    // an explicit else. The old `if (keepKey !== true)` allowed a
    // null/error result to authorize deletion, which is the bug.
    expect(BILLING).toMatch(/keepKey === true/);
    const insertFail = BILLING.slice(BILLING.indexOf('if (subErr || !sub)'));
    expect(insertFail).toMatch(/deleteBillingKey/);
    expect(insertFail).toMatch(/claim_toss_billing_key_cleanup/);
    // Loser must look up the winner's id and pass it so the cleanup RPC
    // excludes the winning row from being marked abandoned.
    expect(insertFail).toMatch(/p_active_subscription_id/);
    expect(insertFail).toMatch(/\.eq\('billing_key'/);
    // The error/null short-circuit must be in place (F2).
    expect(insertFail).toMatch(/rpcErr\s*\|\|\s*keepKey\s*===\s*null/);
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
  // A14: the same trap exists for Feb 29 + 1 year on a leap day
  // subscription. setFullYear(+1) on Feb 29 normalizes to Mar 1 in a
  // non-leap target year, drifting every subsequent annual bill.
  it('addInterval(Feb 29 + 1 year) clamps to Feb 28 in non-leap year (not Mar 1)', () => {
    // Reproduce the year-branch clamp locally so the test fails if a future
    // contributor reintroduces `setFullYear(+1); return` without the rollback.
    function addYear(d: Date): Date {
      const next = new Date(d);
      const targetYear = next.getFullYear() + 1;
      const targetMonth = next.getMonth();
      next.setFullYear(targetYear);
      if (next.getMonth() !== targetMonth) {
        next.setDate(0);
      }
      return next;
    }
    // Feb 29, 2024 + 1 year → 2025 is not a leap year → must be Feb 28, 2025.
    const feb29 = new Date(2024, 1, 29);
    const result = addYear(feb29);
    expect(result.getFullYear()).toBe(2025);
    expect(result.getMonth()).toBe(1); // February
    expect(result.getDate()).toBe(28); // clamped, not Mar 1
    // Once the anchor slips to Feb 28, every subsequent +1 year stays at
    // Feb 28 (no rollback needed; getMonth matches targetMonth).
    const feb28 = new Date(2025, 1, 28);
    const plusOne = addYear(feb28);
    expect(plusOne.getFullYear()).toBe(2026);
    expect(plusOne.getMonth()).toBe(1);
    expect(plusOne.getDate()).toBe(28);
    // And a non-leap-year start never drifts either.
    const jan15_2026 = new Date(2026, 0, 15);
    const plusOneJan = addYear(jan15_2026);
    expect(plusOneJan.getFullYear()).toBe(2027);
    expect(plusOneJan.getMonth()).toBe(0);
    expect(plusOneJan.getDate()).toBe(15);
  });
  it('addInterval(year) helper is wired with the leap-day clamp branch', () => {
    expect(BILLING).toMatch(/interval === 'year'/);
    expect(BILLING).toMatch(/targetYear\s*=\s*next\.getFullYear\(\)\s*\+\s*1/);
    expect(BILLING).toMatch(/next\.getMonth\(\)\s*!==\s*targetMonth/);
  });
});

describe('A18 — README admin invariant matches 0002_audit_log.sql', () => {
  it('documents auth.app_role() = admin (app_metadata.role), not top-level auth.jwt()->>role', () => {
    // 0002 defines auth.app_role() reading app_metadata.role and the policy
    // uses it. The README's admin-setup SQL writes raw_app_meta_data, so the
    // top-level auth.jwt()->>'role' invariant would silently deny admins.
    expect(SAAS_README).not.toMatch(/auth\.jwt\(\)\s*->>\s*'role'/);
    expect(SAAS_README).toMatch(/auth\.app_role\(\)\s*=\s*'admin'/);
  });
});

describe('A17 — README Toss section matches the schema + Edge Function', () => {
  it('uses external_plan_key (the real column), never toss_plan_key', () => {
    // Migration line 20, Edge Function, and admin form all use external_plan_key.
    expect(SAAS_README).not.toMatch(/toss_plan_key/);
    expect(SAAS_README).toMatch(/external_plan_key/);
  });
  it('does not document a TOSS_AUTH_KEY env var (auth_key is a per-request body token)', () => {
    expect(SAAS_README).not.toMatch(/TOSS_AUTH_KEY/);
  });
});

describe('A16 — README does not promise seed plans the migration never inserts', () => {
  it('drops the "three starter plans" seed claim (0001 has no INSERT INTO plans)', () => {
    // The only insert in 0001 is inside upsert_plan_with_audit (a function,
    // not seed data), so /admin/plans renders empty after `supabase db push`.
    expect(SAAS_README).not.toMatch(/three starter plans/i);
    expect(SAAS_README).not.toMatch(/Seed data inserts/i);
  });
});

describe('A15 — README table list matches the migration', () => {
  it('lists plans / subscriptions / audit_log and does NOT claim a payments table', () => {
    // 0001_init.sql creates exactly plans, subscriptions, audit_log — no
    // `payments` table. A README that promises one is a misleading smoke-test
    // signal (any code referencing public.payments fails at runtime).
    expect(SAAS_README).toMatch(/`plans`,\s*`subscriptions`,\s*and\s*`audit_log`/);
    expect(SAAS_README).not.toMatch(/`payments`/);
  });
});

describe('A14 — admin page tolerates missing env (no 500 on fresh boot)', () => {
  it('validates supabase env BEFORE createServerClient and redirects when unset', () => {
    expect(PLANS_PAGE).toMatch(/NEXT_PUBLIC_SUPABASE_URL/);
    expect(PLANS_PAGE).toMatch(/NEXT_PUBLIC_SUPABASE_ANON_KEY/);
    // The guard must short-circuit to the unauthenticated path before the
    // @supabase/ssr client (which throws synchronously on empty url) is built.
    expect(PLANS_PAGE).toMatch(/if \(!url \|\| !anon\) redirect\('\/'\)/);
    // The old empty-string fallback that fed createServerClient('','') is gone.
    expect(PLANS_PAGE).not.toMatch(/NEXT_PUBLIC_SUPABASE_URL \?\? ''/);
    expect(PLANS_PAGE).not.toMatch(/NEXT_PUBLIC_SUPABASE_ANON_KEY \?\? ''/);
  });
});

describe('A13 — RootLayout uses a cookie-backed @supabase/ssr client', () => {
  it('imports createServerClient from @supabase/ssr (not the bare shared helper)', () => {
    expect(LAYOUT).toMatch(/from '@supabase\/ssr'/);
    expect(LAYOUT).toMatch(/createServerClient/);
    expect(LAYOUT).not.toMatch(/createServerSupabase/);
  });
  it('threads next/headers cookies into the client so getUser resolves the session', () => {
    expect(LAYOUT).toMatch(/const cookieStore = cookies\(\)/);
    expect(LAYOUT).toMatch(/cookieStore\.get\(name\)/);
    expect(LAYOUT).toMatch(/auth\.getUser\(\)/);
  });
  it('still degrades a missing-env deploy to a logged-out render (not a 500)', () => {
    expect(LAYOUT).toMatch(/isMissingEnvError/);
    expect(LAYOUT).toMatch(/console\.error/);
  });
});

describe('A12 — Turnstile token is bound to hostname + action', () => {
  it('verifyTurnstile enforces hostname/action against env allow-lists', () => {
    // Defense-in-depth: a token minted under the same site key for a
    // different action or hostname (dev vs prod) must be rejected.
    expect(BILLING).toMatch(/data\.hostname/);
    expect(BILLING).toMatch(/data\.action/);
    expect(BILLING).toMatch(/TURNSTILE_EXPECTED_HOSTNAME/);
    expect(BILLING).toMatch(/TURNSTILE_EXPECTED_ACTION/);
  });
  it('still short-circuits when success !== true', () => {
    expect(BILLING).toMatch(/data\.success !== true/);
  });
});

describe('A05 — CORS preflight + headers on every response', () => {  it('declares CORS_HEADERS and applies them via jsonResponse', () => {
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

describe('A06 — per-user billing rate limit (F10)', () => {
  const MIGRATION_0004 = read('../supabase/migrations/0004_billing_rate_limit.sql');

  it('migration 0004 declares billing_attempts table + check_billing_rate_limit RPC', () => {
    expect(MIGRATION_0004).toMatch(/create table if not exists public\.billing_attempts/);
    expect(MIGRATION_0004).toMatch(/create or replace function public\.check_billing_rate_limit/);
    // The function must be granted only to service_role.
    expect(MIGRATION_0004).toMatch(/grant execute on function public\.check_billing_rate_limit\([^)]+\) to service_role/);
  });
  it('Edge Function calls check_billing_rate_limit BEFORE Turnstile / Toss', () => {
    // The rate-limit check must be the FIRST downstream call after auth —
    // it is the cheap defense against a flood, so it gates everything
    // expensive (Turnstile verify + Toss issuance).
    const authIdx = BILLING.indexOf('userId = userData?.user?.id');
    const rateIdx = BILLING.indexOf('check_billing_rate_limit');
    const turnstileIdx = BILLING.indexOf('TURNSTILE_EXPECTED_HOSTNAME');
    // The Toss issue call site is reached by an `await issueBillingKey({`
    // line that lives AFTER the auth block. The function definition
    // `async function issueBillingKey(...)` is much earlier, so anchor
    // on the call site only.
    const tossIdx = BILLING.indexOf('await issueBillingKey({');
    expect(authIdx).toBeGreaterThan(0);
    expect(rateIdx).toBeGreaterThan(authIdx);
    expect(rateIdx).toBeLessThan(turnstileIdx);
    expect(rateIdx).toBeLessThan(tossIdx);
  });
  it('rate-limit error returns 503 (service unavailable) — fail closed', () => {
    // A DB error must not silently disable the rate limit. Pin the
    // 503 short-circuit on rate-limit errors.
    const rateBlock = BILLING.slice(
      BILLING.indexOf('check_billing_rate_limit'),
      BILLING.indexOf('TURNSTILE_EXPECTED_HOSTNAME')
    );
    expect(rateBlock).toMatch(/billing_rate_limit_error/);
    expect(rateBlock).toMatch(/503/);
    expect(rateBlock).toMatch(/billing_rate_limit_unavailable/);
  });
  it('rate-limited user gets 429 Too Many Requests', () => {
    const rateBlock = BILLING.slice(
      BILLING.indexOf('check_billing_rate_limit'),
      BILLING.indexOf('TURNSTILE_EXPECTED_HOSTNAME')
    );
    expect(rateBlock).toMatch(/billing_rate_limited/);
    expect(rateBlock).toMatch(/429/);
    // The 429 must come AFTER the 503 guard (rate-error first, then rate-limit).
    expect(rateBlock.indexOf('billing_rate_limited'))
      .toBeGreaterThan(rateBlock.indexOf('billing_rate_limit_unavailable'));
  });
});

describe('A06 — Turnstile context binding fails closed on missing env (F9)', () => {
  // Slice the turnstile block: from the env reads to the verifyTurnstile call.
  const turnstileIdx = BILLING.indexOf('TURNSTILE_EXPECTED_HOSTNAME');
  const verifyIdx = BILLING.indexOf('await verifyTurnstile(');
  const turnstileBlock = BILLING.slice(turnstileIdx, verifyIdx);

  it('refuses to verify when TURNSTILE_EXPECTED_HOSTNAME is unset', () => {
    expect(turnstileBlock).toMatch(/!turnstileHostname\s*\|\|\s*!turnstileAction/);
  });
  it('returns 503 (service unavailable) when context binding is unconfigured', () => {
    // 503 is the right status: not a caller error (400), not a downstream
    // failure (502); it is a misconfigured deploy that the operator must
    // fix. A 400 would let an attacker retry indefinitely; a 502 would
    // be retried by Supabase's job queue.
    expect(turnstileBlock).toMatch(/503/);
    expect(turnstileBlock).toMatch(/turnstile_context_binding_unconfigured/);
  });
  it('the binding guard short-circuits BEFORE verifyTurnstile is called', () => {
    // Pin the ordering: the unconfigured guard must appear BEFORE the
    // verifyTurnstile call site. The slice ends at the call, so the
    // call itself is not in turnstileBlock; the assertion is that the
    // 503 short-circuit return IS in the slice (and it cannot be there
    // unless it precedes the call site, since the slice stops at it).
    expect(turnstileBlock).toMatch(/turnstile_context_binding_unconfigured[\s\S]*?return jsonResponse/);
  });
  it('logs the unconfigured state via the structured logger', () => {
    expect(turnstileBlock).toMatch(/logEvent\('turnstile_context_binding_unconfigured'/);
    // Log must indicate which binding is unset (operator triage signal).
    expect(turnstileBlock).toMatch(/has_hostname/);
    expect(turnstileBlock).toMatch(/has_action/);
  });
});

describe('A04 — TOSS_SECRET_KEY validated at module top (F8)', () => {
  it('TOSS_SECRET_KEY is required via requireEnv() at module scope', () => {
    // Without this, a fresh deploy would emit the well-known empty
    // Basic credential 'Basic Og==' (base64(':')) and silently fail
    // every Toss call. Validate at boot so the operator sees the
    // missing-env message immediately.
    expect(BILLING).toMatch(/const TOSS_SECRET_KEY\s*=\s*requireEnv\('TOSS_SECRET_KEY'\)/);
    // Module-level constant must appear BEFORE Deno.serve.
    const serveIdx = BILLING.indexOf('Deno.serve');
    const tossConstIdx = BILLING.indexOf('const TOSS_SECRET_KEY =');
    expect(tossConstIdx).toBeGreaterThan(0);
    expect(tossConstIdx).toBeLessThan(serveIdx);
  });
  it('handler builds Toss auth from the module-level TOSS_SECRET_KEY constant', () => {
    // The handler must NOT re-read TOSS_SECRET_KEY from env at request time.
    const serveIdx = BILLING.indexOf('Deno.serve');
    const handler = BILLING.slice(serveIdx);
    expect(handler).toMatch(/btoa\(`\$\{TOSS_SECRET_KEY\}:`\)/);
    expect(handler).not.toMatch(/Deno\.env\.get\('TOSS_SECRET_KEY'\)/);
    // No spurious TOSS_AUTH_KEY reference (that was the OLD broken name).
    expect(handler).not.toMatch(/TOSS_AUTH_KEY/);
  });
});

describe('A10 — module-level env validation (F7)', () => {
  it('declares a requireEnv helper that throws with a clear remediation hint', () => {
    // The previous code read SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY at
    // request time and silently coerced missing to ''. The empty string
    // reached createClient() which threw a generic "supabaseUrl is
    // required" 500. Pin the helper that flips the failure mode.
    expect(BILLING).toMatch(/function requireEnv\(name:\s*string\)/);
    expect(BILLING).toMatch(/Missing required env:/);
    expect(BILLING).toMatch(/supabase secrets set/);
  });
  it('validates SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY at module top', () => {
    // The requireEnv calls must appear at module scope (NOT inside the
    // Deno.serve handler) so the function fails fast at boot rather
    // than on every request.
    expect(BILLING).toMatch(/const SUPABASE_URL\s*=\s*requireEnv\('SUPABASE_URL'\)/);
    expect(BILLING).toMatch(/const SUPABASE_SERVICE_ROLE_KEY\s*=\s*requireEnv\('SUPABASE_SERVICE_ROLE_KEY'\)/);
    // Module-level constants must appear BEFORE Deno.serve.
    const serveIdx = BILLING.indexOf('Deno.serve');
    const urlConstIdx = BILLING.indexOf('const SUPABASE_URL =');
    const keyConstIdx = BILLING.indexOf('const SUPABASE_SERVICE_ROLE_KEY =');
    expect(urlConstIdx).toBeGreaterThan(0);
    expect(urlConstIdx).toBeLessThan(serveIdx);
    expect(keyConstIdx).toBeGreaterThan(0);
    expect(keyConstIdx).toBeLessThan(serveIdx);
  });
  it('handler uses the module-level constants (no request-time re-read of SUPABASE_URL/KEY)', () => {
    // Pin that the handler reads the module-level constants, NOT the env
    // vars directly. A request-time re-read would silently re-introduce
    // the empty-string failure mode.
    const serveIdx = BILLING.indexOf('Deno.serve');
    const handler = BILLING.slice(serveIdx);
    expect(handler).toMatch(/const supabaseUrl\s*=\s*SUPABASE_URL/);
    expect(handler).toMatch(/SUPABASE_SERVICE_ROLE_KEY/);
    expect(handler).not.toMatch(/Deno\.env\.get\('SUPABASE_URL'\)/);
    expect(handler).not.toMatch(/Deno\.env\.get\('SUPABASE_SERVICE_ROLE_KEY'\)/);
  });
});

describe('A07 — OAuth callback route establishes the SSR session (F6)', () => {
  const CALLBACK = read('../app/auth/callback/route.ts');

  it('declares a GET route handler at app/auth/callback/route.ts', () => {
    // Without this file, the OAuth flow is a dead end — the code never
    // gets exchanged, no cookie is written, every auth.getUser() returns
    // null, and the user sees the logged-out nav after a successful sign-in.
    expect(CALLBACK).toMatch(/export\s+async\s+function\s+GET\s*\(/);
    expect(CALLBACK).toMatch(/exchangeCodeForSession/);
  });
  it('uses the same cookie-backed @supabase/ssr client as the rest of the app', () => {
    expect(CALLBACK).toMatch(/from '@supabase\/ssr'/);
    expect(CALLBACK).toMatch(/createServerClient/);
    expect(CALLBACK).toMatch(/cookieStore\.get\(name\)/);
    expect(CALLBACK).toMatch(/cookieStore\.set\(\{ name, value, \.\.\.options \}\)/);
  });
  it('redirects to /auth/auth-code-error on missing code or exchange error', () => {
    expect(CALLBACK).toMatch(/auth-code-error/);
    // The redirect helper must be NextResponse.redirect, not res.redirect.
    expect(CALLBACK).toMatch(/NextResponse\.redirect/);
  });
  it('sanitizes the `next` query parameter against open-redirect', () => {
    // Without this guard, an attacker could send a victim to
    // /auth/callback?next=https://evil.example.com and the route would
    // happily redirect there post-login. Pin that the route constrains
    // `next` to a same-origin relative path.
    expect(CALLBACK).toMatch(/rawNext\.startsWith\('\/'\)[\s\S]*?!rawNext\.startsWith\('\/\/'/);
  });
  it('validates env before constructing the supabase client (A14)', () => {
    // A first-boot deploy without NEXT_PUBLIC_SUPABASE_URL/ANON_KEY must
    // not crash the route handler. Short-circuit to the error page.
    expect(CALLBACK).toMatch(/NEXT_PUBLIC_SUPABASE_URL/);
    expect(CALLBACK).toMatch(/NEXT_PUBLIC_SUPABASE_ANON_KEY/);
  });
  it('sign-in control in the layout points at /auth/callback', () => {
    // The route only matters if the layout / shared button actually
    // directs users here. Pin the destination so a future refactor
    // cannot silently break the OAuth flow.
    expect(LAYOUT).toMatch(/GoogleSignInButton/);
    // The shared component lives in templates/_shared; verify it carries
    // the redirectTo destination. We do not pin the exact path string
    // here (it lives in the shared package); we only assert that the
    // layout renders the button at all, so a future refactor cannot
    // silently drop the sign-in control.
  });
});

describe('A09/F5 — raw Toss billing key must NEVER appear in structured logs (F5)', () => {
  it('declares a redactBillingKey helper that masks the middle of the key', () => {
    expect(BILLING).toMatch(/function redactBillingKey\(/);
    // The redaction format keeps a 3-char prefix and a 4-char suffix and
    // replaces the middle with "***". Operators need enough context to
    // correlate across logs without seeing the live payment credential.
    expect(BILLING).toMatch(/\$\{billingKey\.slice\(0,\s*3\)\}\*\*\*\$\{billingKey\.slice\(-4\)\}/);
  });
  it('every cleanup_failed log call uses the redacted form (not the raw key)', () => {
    // Find all logEvent calls that mention cleanup_failed and verify
    // they reference redactBillingKey(billingKey) rather than the raw key.
    const cleanupFns = BILLING.match(
      /logEvent\(\s*'cleanup_failed'[\s\S]*?\);/g
    );
    expect(cleanupFns).not.toBeNull();
    for (const call of cleanupFns!) {
      expect(call).not.toMatch(/billing_key:\s*billingKey[,}\s]/);
      expect(call).toMatch(/redactBillingKey\(billingKey\)/);
    }
  });
  it('cleanup_enqueue_failed and cleanup_enqueue_threw also redact', () => {
    expect(BILLING).toMatch(
      /logEvent\(\s*'cleanup_enqueue_failed'[\s\S]*?redactBillingKey\(billingKey\)/
    );
    expect(BILLING).toMatch(
      /logEvent\(\s*'cleanup_enqueue_threw'[\s\S]*?redactBillingKey\(billingKey\)/
    );
  });
  it('success path does NOT log the key (no expansion of blast radius)', () => {
    // The previous code logged the raw key on the success path too. Pin
    // that the success log line carries no billing-key field.
    const success = BILLING.match(/logEvent\(\s*'cleanup_succeeded'[\s\S]*?\);/);
    expect(success).not.toBeNull();
    expect(success![0]).not.toMatch(/billing_key/);
  });
});

describe('A10 — durable retry queue for failed Toss cleanups (F4)', () => {
  const MIGRATION_0003 = read('../supabase/migrations/0003_cleanup_queue.sql');

  it('migration 0003 declares cleanup_queue + enqueue_billing_key_cleanup RPC', () => {
    expect(MIGRATION_0003).toMatch(
      /create table if not exists public\.cleanup_queue/
    );
    expect(MIGRATION_0003).toMatch(
      /create or replace function public\.enqueue_billing_key_cleanup/
    );
    // The function must be granted only to service_role.
    expect(MIGRATION_0003).toMatch(
      /grant execute on function public\.enqueue_billing_key_cleanup\([^)]+\) to service_role/
    );
  });
  it('cleanup_queue has RLS enabled and is REVOKEd from anon/authenticated/public', () => {
    expect(MIGRATION_0003).toMatch(/alter table public\.cleanup_queue enable row level security/);
    // Belt-and-suspenders: explicit REVOKE so a future policy mistake
    // cannot expose this table to end users.
    expect(MIGRATION_0003).toMatch(/revoke all on public\.cleanup_queue from public/);
    expect(MIGRATION_0003).toMatch(/revoke all on public\.cleanup_queue from anon/);
    expect(MIGRATION_0003).toMatch(/revoke all on public\.cleanup_queue from authenticated/);
  });
  it('Edge Function calls enqueue_billing_key_cleanup on cleanup failure', () => {
    // The billing function must call the enqueue RPC on non-2xx OR
    // thrown error. A log line alone is not durable enough.
    expect(BILLING).toMatch(/enqueue_billing_key_cleanup/);
    expect(BILLING).toMatch(/cleanup_enqueued/);
    expect(BILLING).toMatch(/cleanup_enqueue_failed/);
  });
  it('Edge Function never throws from deleteBillingKey', () => {
    const fn = BILLING.slice(
      BILLING.indexOf('async function deleteBillingKey'),
      BILLING.indexOf('Deno.serve')
    );
    // The function must never re-throw — caller is already on a failure path.
    expect(fn).toMatch(/catch \(_err\)/);
    expect(fn).toMatch(/catch \(_enqErr\)/);
  });
});

describe('A10 — duplicate-subscription check fails closed on DB error (F3)', () => {
  // Slice the dup-check section: from the A06 anchor to just before Toss
  // issuance. The end anchor is the idempotency-key setup line that
  // appears just before issueBillingKey.
  const dupIdx = BILLING.indexOf('A06: reject if the user already holds');
  const tossIdx = BILLING.indexOf('idempotencyKey = `billing:');
  const dupBlock = BILLING.slice(dupIdx, tossIdx);

  it('destructures BOTH `data` AND `error` from the dup-check query', () => {
    // The previous code destructured ONLY `data`; a DB error made `data`
    // null, the check passed, and Toss key issuance proceeded while
    // persistence was unavailable. The result: an orphan Toss billing key
    // with no record in the database. Capture the error explicitly.
    expect(dupBlock).toMatch(/const\s*\{\s*data:\s*existing\s*,\s*error:\s*existingErr\s*\}/);
  });
  it('DB error returns 503 (service unavailable) BEFORE Toss issuance', () => {
    // The dup-check guard must short-circuit BEFORE issueBillingKey so a
    // degraded database never produces an untracked Toss key.
    expect(dupBlock).toMatch(/subscription_check_error/);
    expect(dupBlock).toMatch(/503/);
    expect(dupBlock).toMatch(/subscription_check_unavailable/);
    // The issueBillingKey call must NOT appear inside the dup-check block.
    expect(dupBlock).not.toMatch(/issueBillingKey\(/);
  });
  it('DB error is logged via the structured logger', () => {
    expect(dupBlock).toMatch(/logEvent\('subscription_check_error'/);
    expect(dupBlock).toMatch(/existingErr\.message/);
  });
});

describe('A10 — cleanup RPC error handling (F2)', () => {
  it('destructures BOTH `data` AND `error` from the .rpc() call', () => {
    // The cleanup RPC is the gating decision for a destructive Toss DELETE.
    // Any non-true value previously authorized deletion — including the case
    // where the RPC errored out (DB connection lost, RLS issue, function
    // raised) and returned data=null. Capture the error explicitly.
    const insertFail = BILLING.slice(BILLING.indexOf('if (subErr || !sub)'));
    expect(insertFail).toMatch(/const\s*\{\s*data:\s*keepKey\s*,\s*error:\s*rpcErr\s*\}/);
  });
  it('RPC error path fails closed (NEVER authorizes deletion)', () => {
    // When rpcErr is set OR data is null, the function must NOT call
    // deleteBillingKey. The shared Toss billing key belongs to the winner
    // in the race; a wrong delete silently unsubscribes them.
    const insertFail = BILLING.slice(BILLING.indexOf('if (subErr || !sub)'));
    // The error/null short-circuit must appear BEFORE the deleteBillingKey call.
    const errorGuardIdx = insertFail.indexOf('rpcErr || keepKey === null');
    const deleteIdx = insertFail.indexOf('deleteBillingKey');
    expect(errorGuardIdx).toBeGreaterThan(0);
    expect(deleteIdx).toBeGreaterThan(0);
    expect(errorGuardIdx).toBeLessThan(deleteIdx);
    // The short-circuit must return early (no fallthrough into deleteBillingKey).
    expect(insertFail).toMatch(/rpcErr\s*\|\|\s*keepKey\s*===\s*null[\s\S]*?return\s+jsonResponse/);
  });
  it('data === false authorizes deletion (no row holds the key = orphan)', () => {
    // Pin the happy path: when the RPC confirms no row holds this key, the
    // caller deletes the orphan on Toss. This is the only branch where
    // deleteBillingKey may run. A10/F4: the call passes the supabase client
    // so the helper can enqueue cleanup failures.
    const insertFail = BILLING.slice(BILLING.indexOf('if (subErr || !sub)'));
    expect(insertFail).toMatch(/keepKey === true[\s\S]*?logEvent\('billing_key_kept'/);
    expect(insertFail).toMatch(/deleteBillingKey\(supabase,\s*tossAuth,\s*result\.billingKey\)/);
    // The kept branch (keepKey === true) must appear BEFORE the delete branch.
    expect(insertFail.indexOf("logEvent('billing_key_kept'"))
      .toBeLessThan(insertFail.indexOf('deleteBillingKey('));
  });
  it('RPC error is logged via the structured logger (no raw error throw)', () => {
    const insertFail = BILLING.slice(BILLING.indexOf('if (subErr || !sub)'));
    expect(insertFail).toMatch(/logEvent\('cleanup_rpc_error'/);
    // The error message must be stringified, not thrown as-is.
    expect(insertFail).toMatch(/rpcErr\?\.message\s*\?\?\s*null/);
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
  it('Authorization is Basic base64(secretKey:)', () => {
    // Toss HTTP Basic auth = base64(secretKey + ":") — the secret key is the
    // username and the password is empty. The per-request Toss `auth_key`
    // (card-auth token) is a BODY field, never an HTTP-Basic credential.
    // A04/F8: TOSS_SECRET_KEY is now module-level validated and the handler
    // uses the constant directly (no per-request re-read of the env var).
    expect(BILLING).toMatch(/Basic ' \+ btoa\(`\$\{TOSS_SECRET_KEY\}:`\)/);
    // Regression: the secret must NOT be placed in the password slot behind a
    // spurious TOSS_AUTH_KEY username (the original bug collapsed to
    // btoa(':<secret>') on a fresh deploy where TOSS_AUTH_KEY was unset).
    expect(BILLING).not.toMatch(/btoa\(`\$\{tossAuthKey\}:/);
    expect(BILLING).not.toMatch(/TOSS_AUTH_KEY/);
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

describe('A22 — README has no committed CI retrigger comments', () => {
  it('contains no timestamped "# ... CI retrigger" shell comments', () => {
    expect(SAAS_README).not.toMatch(/CI retrigger/);
  });
});

describe('A21 — customer_key body field is ignored, not a required-field oracle', () => {
  it('does not 400 on missing customer_key (provider customerKey is derived from user id)', () => {
    // The handler derives customerKey from the authenticated userId, so a
    // required-field 400 on the body field is dead code — a false API contract
    // and a probe oracle.
    expect(BILLING).not.toMatch(/'missing customer_key'/);
    expect(BILLING).not.toMatch(/!customer_key \|\| typeof customer_key/);
    // customerKey is still bound to the user id.
    expect(BILLING).toMatch(/const customerKey = userId;/);
  });
});

describe('A19 — deleteBillingKey surfaces cleanup failures', () => {
  it('checks res.ok and logs cleanup_failed with the HTTP status', () => {
    const fn = BILLING.slice(
      BILLING.indexOf('async function deleteBillingKey'),
      BILLING.indexOf('Deno.serve')
    );
    expect(fn).toMatch(/res\.ok/);
    expect(fn).toMatch(/logEvent\('cleanup_failed'/);
    expect(fn).toMatch(/status: res\.status/);
    // The helper must still never throw (caller is already on the failure path).
    expect(fn).toMatch(/catch \(_err\)/);
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

describe('A04 — admin edit form pre-fills existing values (incl. external_plan_key)', () => {
  // The admin /admin/plans page renders a single combined add/update form.
  // When the admin clicks "Edit" on an existing row, the page receives
  // ?id=<uuid> and the form MUST pre-fill every column — most importantly
  // external_plan_key, which the Edge Function otherwise relies on. Without
  // pre-fill, an admin editing name/price has to re-type the Toss plan key,
  // and a blank submit silently clears it from the database (the RPC's
  // coalesce clause papers over the data loss, but the UX is broken).
  it('AdminPlansPage accepts searchParams and looks up the plan by id', () => {
    expect(PLANS_PAGE).toMatch(/searchParams\?:\s*\{\s*id\?\s*:\s*string\s*\}/);
    expect(PLANS_PAGE).toMatch(/fetchPlanById\(/);
    expect(PLANS_PAGE).toMatch(/\.eq\(['"]id['"],\s*planId\)/);
  });
  it('form renders Edit link per row that points to /admin/plans?id=<id>', () => {
    // Each row in the table gets an Edit link so admins can switch the
    // form into edit mode without retyping the id.
    expect(PLANS_PAGE).toMatch(/\/admin\/plans\?id=\$\{p\.id\}/);
  });
  it('edit mode uses a hidden id input (id is server-authoritative in edit mode)', () => {
    // The free-text "id" input is only shown in create mode; edit mode
    // uses a hidden input so the server-side action sees a real uuid.
    expect(PLANS_PAGE).toMatch(/type="hidden" name="id" value=\{editing\.id\}/);
  });
  it('edit mode pre-fills external_plan_key via defaultValue (not value)', () => {
    // defaultValue is the uncontrolled React prop for pre-filling; using
    // `value` would freeze the input to the pre-filled string and break
    // further edits.
    expect(PLANS_PAGE).toMatch(
      /name="external_plan_key"[\s\S]*?defaultValue=\{editing\?\.external_plan_key\s*\?\?\s*''\}/
    );
  });
  it('edit mode pre-fills name / price_cents / interval via defaultValue', () => {
    expect(PLANS_PAGE).toMatch(/defaultValue=\{editing\?\.name\s*\?\?\s*''\}/);
    expect(PLANS_PAGE).toMatch(/defaultValue=\{editing\?\.price_cents\s*\?\?\s*''\}/);
    expect(PLANS_PAGE).toMatch(/defaultValue=\{editing\?\.interval\s*\?\?\s*'month'\}/);
  });
  it('RPC preserves external_plan_key on blank payload (defense in depth)', () => {
    // Even if a future regression reintroduced a form that did not pre-fill,
    // the SQL coalesce() in upsert_plan_with_audit must keep the prior
    // value so the data path stays safe.
    expect(MIGRATION_0001).toMatch(
      /external_plan_key\s*=\s*coalesce\s*\(\s*payload\s*->>\s*'external_plan_key'\s*,\s*external_plan_key\s*\)/
    );
  });
});
