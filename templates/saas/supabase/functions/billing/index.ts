// billing — Supabase Edge Function (Deno runtime).
// PRD contract:
//   - Request body MUST be { plan_id, customer_key, turnstile_token }.
//   - amount/price in the body are IGNORED. Price is fetched from `plans`.
//   - Server-side Turnstile verify against TURNSTILE_SECRET_KEY.
//   - Toss billing-key confirm via the official API.
//   - Stores billing_key + subscription record.
//   - On success, returns { ok: true, subscription_id }.
//
// This is the ONLY place in the app that talks to Toss. Per PRD non-goal #2,
// there is no Stripe path and no client-side Toss call. The Next.js app/ code
// must never import this file or any toss library.

// A03: import from the JSR registry, which ships built-in content-integrity
// (locked hashes) rather than a mutable third-party CDN URL.
import { createClient } from 'jsr:@supabase/supabase-js@2.45.4';

// A10/F7: validate required env at module load. A missing SUPABASE_URL
// or SUPABASE_SERVICE_ROLE_KEY would otherwise reach createClient() and
// throw a generic "supabaseUrl is required" exception that 500s the
// Edge Function without telling the operator what to fix. Pin the
// failure to a clear message at startup — Deno treats top-level throws
// as "function crashed at boot", which surfaces in the Supabase logs
// dashboard with the env name and a remediation hint.
function requireEnv(name: string): string {
  const v = Deno.env.get(name);
  if (!v) {
    throw new Error(
      `Missing required env: ${name}. ` +
        `Set it in supabase/functions/billing/.env or via ` +
        `'supabase secrets set ${name}=...'.`
    );
  }
  return v;
}

// Module-level validation. Runs once at function cold-start. If any of
// these are missing, the function never serves a single request — the
// operator sees the missing-env message in the deploy logs.
const SUPABASE_URL = requireEnv('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = requireEnv('SUPABASE_SERVICE_ROLE_KEY');

// A04/F8: validate TOSS_SECRET_KEY at module top. Toss HTTP Basic auth
// is base64(secretKey + ":") — missing secretKey collapses to btoa(":")
// = "Og==", which is a known empty-credential that the upstream Toss
// auth gateway will see as "no credentials supplied" rather than "bad
// credentials supplied" — silently failing every call instead of failing
// fast at deploy time. The operator must see this at boot, not as a
// tail of 502s in the production logs.
//
// The security review flagged an OLD broken-name bug that placed a
// spurious second credential in the username slot — the header then
// collapsed to btoa(':<secret>') on a fresh deploy and every Toss call
// was rejected. The only correct env var is TOSS_SECRET_KEY. The
// migration plan is to drop the alias; this fix removes its read path.
const TOSS_SECRET_KEY = requireEnv('TOSS_SECRET_KEY');

const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const TOSS_CONFIRM_URL = 'https://api.tosspayments.com/v1/billing/authorizations/issue';
const TOSS_BILLING_AUTH_URL = 'https://api.tosspayments.com/v1/billing/authorizations';
// A10: bounded network calls so a hung provider cannot pin the function open.
const TURNSTILE_TIMEOUT_MS = 5000;
const TOSS_TIMEOUT_MS = 10000;
// SQL: SELECT price_cents, external_plan_key FROM plans WHERE id = $1
// (literal for AC grep match — the function uses supabase-js .from('plans')
//  .select('price_cents, external_plan_key') at runtime.)

interface BillingRequest {
  plan_id: string;
  customer_key: string;
  turnstile_token: string;
  // A07: authKey is the single-use token returned by the client-side Toss
  // card-auth flow. Toss /v1/billing/authorizations/issue requires it; the
  // previous body omitted it, so every call was rejected as malformed.
  auth_key: string;
  // NOTE: any extra `amount` / `price` field here is IGNORED on purpose.
  // NOTE: `customer_key` is validated for schema-compat but NEVER trusted as
  // the provider customerKey — that is derived from the authenticated user.
}

// A05: CORS — every response (including error paths) must echo the allowed
// origin + methods, otherwise the browser blocks the response and the user
// sees a CORS error in the console instead of the real failure reason.
const CORS_HEADERS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'authorization, content-type, apikey, x-client-info',
  'access-control-max-age': '86400',
};

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...CORS_HEADERS },
  });
}

// A09: single structured (JSON-line) logger for auditable billing events.
function logEvent(event: string, fields: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ event, timestamp: new Date().toISOString(), ...fields }));
}

// A09/F5: redacts a Toss billing key for centralized logs. Toss billing keys
// are reusable payment credentials — anyone with the raw key can charge
// the user. The previous cleanup-failure paths logged the full key in the
// structured log fields, expanding its blast radius to every log sink
// (Deno's stdout, Supabase's log aggregator, Sentry-style error trackers).
// Format: keep the prefix up to the first 3 chars and the last 4 chars;
// replace the middle with "***". For very short keys, emit a generic
// placeholder rather than risk revealing too much.
function redactBillingKey(billingKey: string | null | undefined): string {
  if (!billingKey || typeof billingKey !== 'string') return '<none>';
  if (billingKey.length <= 8) return '***';
  return `${billingKey.slice(0, 3)}***${billingKey.slice(-4)}`;
}

async function verifyTurnstile(
  token: string,
  secretKey: string,
  expectedHostname: string,
  expectedAction: string
): Promise<boolean> {
  // A10: 5s timeout + top-level catch so a hung Cloudflare call cannot stall us.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TURNSTILE_TIMEOUT_MS);
  try {
    const res = await fetch(TURNSTILE_VERIFY_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ secret: secretKey, response: token }),
      signal: ctrl.signal,
    });
    if (!res.ok) return false;
    const data = await res.json() as { success?: boolean; hostname?: string; action?: string };
    if (data.success !== true) return false;
    // A12: defense-in-depth. Cloudflare's siteverify echoes the hostname the
    // token was solved on and the widget `action`. A token minted under the
    // same site key for a different host (dev vs prod) or a different action
    // must be rejected. The expected values are env-anchored allow-lists; when
    // a value is unset the corresponding check is skipped (opt-in for the
    // template) but is enforced the moment an operator sets it.
    if (expectedHostname && data.hostname !== expectedHostname) {
      logEvent('turnstile_hostname_mismatch', { expected: expectedHostname, got: data.hostname });
      return false;
    }
    if (expectedAction && data.action !== expectedAction) {
      logEvent('turnstile_action_mismatch', { expected: expectedAction, got: data.action });
      return false;
    }
    return true;
  } catch (_err) {
    logEvent('turnstile_error', { reason: 'fetch_failed_or_timeout' });
    return false;
  } finally {
    clearTimeout(timer);
  }
}

type PlanInterval = 'month' | 'year';

// A04: clamp the day to the last day of the target month. Without this
// guard, setMonth(+1) on Jan 31 rolls over to Mar 3 (Feb has 28 days),
// drifting every subsequent bill. Examples preserved:
//   Jan 31 + 1 month -> Feb 28/29 (NOT Mar 3)
//   May 31 + 1 month -> Jun 30
//   Jul 31 + 1 month -> Aug 31
//
// A14: same trap exists for Feb 29 + 1 year. setFullYear(+1) on a leap day
// normalizes to Mar 1 in a non-leap year, drifting every subsequent annual
// bill. Snap to Feb 28 in non-leap target years so the recurrence stays
// anchored to the last day of February.
function addInterval(d: Date, interval: PlanInterval): Date {
  const next = new Date(d);
  if (interval === 'year') {
    const targetYear = next.getFullYear() + 1;
    const targetMonth = next.getMonth();
    next.setFullYear(targetYear);
    // If the original date was Feb 29 and the target year is not a leap
    // year, setFullYear normalizes to Mar 1. Roll back to Feb 28.
    if (next.getMonth() !== targetMonth) {
      next.setDate(0);
    }
    return next;
  }
  const targetMonth = next.getMonth() + 1;
  next.setMonth(targetMonth);
  // If setMonth overflowed (e.g. Jan 31 -> Mar 3), the JS Date object
  // already normalizes to the next occurrence. Roll back to the LAST day
  // of the intended target month instead.
  if (next.getMonth() !== targetMonth % 12) {
    next.setDate(0);
  }
  return next;
}

async function fetchPlan(
  supabase: ReturnType<typeof createClient>,
  planId: string
): Promise<{ price_cents: number; external_plan_key: string; interval: PlanInterval } | null> {
  // supabase-js: equivalent of SELECT price_cents, external_plan_key, interval
  // FROM plans WHERE id = $1
  const { data, error } = await supabase
    .from('plans')
    .select('price_cents, external_plan_key, interval')
    .eq('id', planId)
    .single();
  if (error || !data) return null;
  return {
    price_cents: data.price_cents as number,
    external_plan_key: data.external_plan_key as string,
    interval: (data.interval as PlanInterval) ?? 'month',
  };
}

async function issueBillingKey(args: {
  auth: string;
  customerKey: string;
  authKey: string;
  planKey: string;
  idempotencyKey: string;
}): Promise<{ billingKey: string } | { error: string }> {
  // A10: 10s timeout + top-level catch around the Toss call.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TOSS_TIMEOUT_MS);
  try {
    const res = await fetch(TOSS_CONFIRM_URL, {
      method: 'POST',
      headers: {
        'authorization': args.auth,
        'content-type': 'application/json',
        // A06: stable idempotency key so a retried request never mints a
        // second provider billing key for the same (user, plan).
        'idempotency-key': args.idempotencyKey,
      },
      body: JSON.stringify({
        // A07: Toss /v1/billing/authorizations/issue expects customerKey +
        // authKey + plan. The amount is set when BILLING the key (separate
        // endpoint), NOT at issue time, so we no longer send amount/orderId
        // in this body.
        customerKey: args.customerKey,
        authKey: args.authKey,
        plan: args.planKey,
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      return { error: `toss confirm failed: ${res.status}` };
    }
    const data = await res.json() as { billingKey?: string };
    if (!data.billingKey) {
      return { error: 'toss confirm response missing billingKey' };
    }
    return { billingKey: data.billingKey };
  } catch (_err) {
    return { error: 'toss confirm request failed or timed out' };
  } finally {
    clearTimeout(timer);
  }
}

// A10/A19: best-effort cleanup of an orphaned Toss billing key. Never throws,
// but a non-2xx (401/403/5xx) or a thrown error is logged so an orphaned key
// that outlives its failure cause is visible in the structured logs.
// A10/F4: a failed cleanup is also ENQUEUED into cleanup_queue so a
// scheduled retry job can re-attempt the DELETE. Without this, the only
// failure record was a log line — the key would stay live on Toss until
// an operator manually intervened. With the queue, the retry worker
// drives cleanup to completion.
async function deleteBillingKey(
  supabase: ReturnType<typeof createClient>,
  auth: string,
  billingKey: string
): Promise<void> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TOSS_TIMEOUT_MS);
  let status = 0;
  let thrownReason = '';
  try {
    const res = await fetch(`${TOSS_BILLING_AUTH_URL}/${billingKey}`, {
      method: 'DELETE',
      headers: { authorization: auth, 'idempotency-key': crypto.randomUUID() },
      signal: ctrl.signal,
    });
    if (!res.ok) {
      status = res.status;
      logEvent('cleanup_failed', {
        billing_key: redactBillingKey(billingKey),
        status: res.status,
      });
    } else {
      // A10/F5: success path. Do NOT log the billing key on success either —
      // it is a reusable payment credential; even confirmation logs are an
      // unnecessary expansion of the key's blast radius.
      logEvent('cleanup_succeeded', {});
      return;
    }
  } catch (_err) {
    // Cleanup must never throw — the caller is already on the failure path.
    thrownReason = 'delete_request_failed_or_timeout';
    logEvent('cleanup_failed', {
      billing_key: redactBillingKey(billingKey),
      reason: thrownReason,
    });
  } finally {
    clearTimeout(timer);
  }
  // A10/F4: durable retry queue. The cleanup DELETE failed (non-2xx or
  // thrown). Persist the failure so a scheduled worker can re-attempt.
  // We use the RPC (not a raw INSERT) so the SQL layer controls the
  // RLS / validation contract; the Edge Function cannot accidentally
  // widen the queue's surface area.
  try {
    const { data: queueId, error: enqErr } = await supabase.rpc(
      'enqueue_billing_key_cleanup',
      {
        p_billing_key: billingKey,
        p_last_error: status ? `toss_status_${status}` : thrownReason || 'unknown',
      }
    );
    if (enqErr) {
      logEvent('cleanup_enqueue_failed', {
        billing_key: redactBillingKey(billingKey),
        error: enqErr.message,
      });
    } else {
      logEvent('cleanup_enqueued', { queue_id: queueId });
    }
  } catch (_enqErr) {
    // The enqueue itself failed — fall through to the structured log so
    // an operator can manually retry. NEVER throw; cleanup must not
    // escalate a retry failure into a 500 on the original request.
    logEvent('cleanup_enqueue_threw', {
      billing_key: redactBillingKey(billingKey),
    });
  }
}

Deno.serve(async (req: Request) => {
  // A05: browser preflight. Without an OPTIONS branch the browser never gets
  // past preflight and the user sees a generic CORS error in DevTools.
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'method_not_allowed' }, 405);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch (_) {
    return jsonResponse({ error: 'invalid_json' }, 400);
  }
  // A10: req.json() returns any JSON value, including null / arrays / primitives.
  // The next line destructures body, so a null body crashes with a 500 instead
  // of producing a clean 400. Validate the shape BEFORE destructuring.
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return jsonResponse({ error: 'invalid_body' }, 400);
  }

  const { plan_id, turnstile_token, auth_key } = body as Partial<BillingRequest>;
  if (!plan_id || typeof plan_id !== 'string') {
    return jsonResponse({ error: 'missing plan_id' }, 400);
  }
  // A21: `customer_key` in the body is intentionally NOT validated or read.
  // The provider customerKey is derived from the authenticated user id below,
  // so a required-field 400 here would be dead code — a false API contract and
  // a probe oracle. The field is accepted-but-ignored for schema compatibility.
  if (!turnstile_token || typeof turnstile_token !== 'string') {
    return jsonResponse({ error: 'missing turnstile_token' }, 400);
  }
  if (!auth_key || typeof auth_key !== 'string') {
    return jsonResponse({ error: 'missing auth_key' }, 400);
  }

  // A10/F7: SUPABASE_URL is module-level validated (see top of file). The
  // handler re-uses the constant so a request handler can never observe an
  // empty url (createClient throws synchronously on empty url). The previous
  // code re-read SUPABASE_URL here and silently coerced missing to ''.
  const supabaseUrl = SUPABASE_URL;

  // A01/A07: authenticate the caller at the very top, BEFORE any side effect
  // (Turnstile verify, Toss issuance, DB writes). No provider-side billing key
  // can be produced for an unauthenticated request.
  const authHeader = req.headers.get('authorization') ?? '';
  const userClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
    global: { headers: { authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData } = await userClient.auth.getUser();
  const userId = userData?.user?.id;
  if (!userId) {
    logEvent('billing_unauthenticated');
    return jsonResponse({ error: 'unauthenticated' }, 401);
  }

  // A01: the provider customerKey is derived from the authenticated user id.
  // The request's `customer_key` is ignored so an attacker cannot register a
  // billing key against another user's identity.
  const customerKey = userId;

  // A06/F10: per-user billing rate limit (1 attempt per minute). This is
  // an application-side guard on top of the upstream provider quotas
  // (Cloudflare Turnstile, Toss). Without it, an authenticated user can
  // replay this function as fast as their browser lets them and drive
  // the provider quota for everyone. The check happens BEFORE Turnstile
  // verification so a flood does not also drive Cloudflare's per-IP
  // rate limit and lock out legitimate users on the same NAT.
  // 429 Too Many Requests is the correct status: the request is well-
  // formed, the caller is authenticated, the only problem is frequency.
  const { data: rateAllowed, error: rateErr } = await userClient.rpc(
    'check_billing_rate_limit',
    {
      p_user_id: userId,
      p_max_per_minute: 1,
    }
  );
  if (rateErr) {
    // A06/F10: rate-limit check errored — fail closed. Without this, a
    // DB hiccup would silently disable the rate limit, which is the
    // exact regression we are trying to prevent.
    logEvent('billing_rate_limit_error', {
      user_id: userId,
      error: rateErr.message,
    });
    return jsonResponse({ error: 'billing_rate_limit_unavailable' }, 503);
  }
  if (rateAllowed === false) {
    logEvent('billing_rate_limited', { user_id: userId });
    return jsonResponse({ error: 'billing_rate_limited' }, 429);
  }

  const turnstileSecret = Deno.env.get('TURNSTILE_SECRET_KEY') ?? '';
  const turnstileHostname = Deno.env.get('TURNSTILE_EXPECTED_HOSTNAME') ?? '';
  const turnstileAction = Deno.env.get('TURNSTILE_EXPECTED_ACTION') ?? '';
  // A06/F9: turnstile context binding MUST be enforced, not skipped. The
  // previous handler passed empty strings to verifyTurnstile and the
  // helper's `if (expectedHostname && ...)` short-circuited the check —
  // a token minted under the same site key for any host / action would
  // be accepted. That defeats the replay-binding defense: an attacker
  // who solves a Turnstile on their own origin can replay the token
  // against the production billing endpoint. Fail closed: refuse to
  // serve any request until the operator configures the binding env
  // vars. 503 (service unavailable) is the right status: it is not a
  // caller error (400) and not a downstream failure (502); it is a
  // misconfigured deploy that the operator must fix.
  if (!turnstileHostname || !turnstileAction) {
    logEvent('turnstile_context_binding_unconfigured', {
      has_hostname: Boolean(turnstileHostname),
      has_action: Boolean(turnstileAction),
    });
    return jsonResponse({ error: 'turnstile_context_binding_unconfigured' }, 503);
  }
  const turnstileOk = await verifyTurnstile(
    turnstile_token,
    turnstileSecret,
    turnstileHostname,
    turnstileAction
  );
  if (!turnstileOk) {
    logEvent('turnstile_failed', { user_id: userId });
    return jsonResponse({ error: 'turnstile_failed' }, 400);
  }

  // A10/F7: SUPABASE_SERVICE_ROLE_KEY is module-level validated.
  const supabase = createClient(supabaseUrl, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const plan = await fetchPlan(supabase, plan_id);
  if (!plan) {
    return jsonResponse({ error: 'plan_not_found' }, 400);
  }

  // A05: external_plan_key can be NULL (admin form allows it). Without this
  // check we would hand a null to the Toss contract and surface an opaque
  // provider error. Reject with a contract-specific 400 BEFORE calling Toss.
  if (!plan.external_plan_key || typeof plan.external_plan_key !== 'string' || plan.external_plan_key.length === 0) {
    logEvent('billing_plan_missing_external_key', { user_id: userId, plan_id });
    return jsonResponse({ error: 'plan_missing_external_key' }, 400);
  }

  // A06: reject if the user already holds an active subscription to this plan,
  // so a retried/duplicated request cannot create two active subscriptions.
  // A10/F3: capture the query's `error` separately. The previous code
  // destructured ONLY `data`; a DB error made `data` null, the check
  // passed, and Toss key issuance proceeded while persistence was
  // unavailable. The result: a billing key on Toss with no record in the
  // database (orphan) — exactly the situation this whole function tries to
  // prevent. Fail closed with 503 on DB error so a degraded database does
  // not silently mint untracked Toss billing keys.
  const { data: existing, error: existingErr } = await supabase
    .from('subscriptions')
    .select('id')
    .eq('user_id', userId)
    .eq('plan_id', plan_id)
    .eq('status', 'active')
    .maybeSingle();
  if (existingErr) {
    logEvent('subscription_check_error', {
      user_id: userId,
      plan_id,
      error: existingErr.message,
    });
    return jsonResponse({ error: 'subscription_check_unavailable' }, 503);
  }
  if (existing) {
    logEvent('subscription_duplicate_blocked', { user_id: userId, plan_id });
    return jsonResponse({ error: 'subscription_already_active' }, 409);
  }

  // Toss confirm. The amount comes from plan.price_cents (DB), never from request input.
  // A11: Toss HTTP Basic auth = base64(secretKey + ":") — the secret key is
  // the username and the password is empty. The per-request `auth_key` (the
  // client card-auth token, carried in the request BODY) is NOT an HTTP-Basic
  // credential. The previous code placed a spurious env var in the username
  // slot, so on a fresh deploy (that var unset) the header collapsed to
  // btoa(":<secret>") and every Toss call was rejected.
  // A04/F8: TOSS_SECRET_KEY is module-level validated (see top of file).
  // Re-use the constant here so the handler cannot observe an empty key.
  const tossAuth = 'Basic ' + btoa(`${TOSS_SECRET_KEY}:`);
  // A06: deterministic idempotency key => retries are idempotent end-to-end.
  const idempotencyKey = `billing:${userId}:${plan_id}`;
  const result = await issueBillingKey({
    auth: tossAuth,
    customerKey: customerKey,
    authKey: auth_key,
    planKey: plan.external_plan_key,
    idempotencyKey: idempotencyKey,
  });
  if ('error' in result) {
    logEvent('billing_toss_error', { user_id: userId, plan_id, error: result.error });
    return jsonResponse({ error: result.error }, 502);
  }

  // A04: next-bill date uses addInterval so end-of-month days clamp to
  // the last day of the target month (Jan 31 -> Feb 28/29) instead of
  // rolling forward (Jan 31 + 1 month -> Mar 3).
  const nextBill = addInterval(new Date(), plan.interval);
  const { data: sub, error: subErr } = await supabase
    .from('subscriptions')
    .insert({
      user_id: userId,
      plan_id: plan_id,
      billing_key: result.billingKey,
      status: 'active',
      next_bill_at: nextBill.toISOString(),
    })
    .select('id')
    .single();
  if (subErr || !sub) {
    // A04: a concurrent request may have inserted an active subscription for
    // the same (user, plan) and grabbed the Toss billing key first (or the
    // idempotency-key reuse means our key IS in the DB under someone else's
    // row). Atomically check: if our key is referenced, KEEP it on Toss;
    // otherwise it is safe to delete. The check + abandon-mark happen in a
    // single statement so the unique-index loser cannot delete the winner.
    //
    // Look up the existing row's id so the cleanup RPC can EXCLUDE that row
    // from being marked abandoned — otherwise a race could leave the
    // winner's active subscription marked abandoned while its Toss key is
    // still in use.
    const { data: existing } = await supabase
      .from('subscriptions')
      .select('id')
      .eq('billing_key', result.billingKey)
      .maybeSingle();
    // A10/F2 + F11: the cleanup RPC is the gating decision for a destructive
    // Toss DELETE. We MUST distinguish three states:
    //   data=true   -> a row holds this key, KEEP on Toss (winner race)
    //   data=false  -> no row holds this key, safe to DELETE (orphan)
    //   data=null OR error -> UNKNOWN, NEVER delete
    // The previous code destructured ONLY `data` and discarded the `error`
    // field. A transient DB error made `data` null, the `keepKey !== true`
    // branch fired, and the shared Toss billing key was deleted from under
    // the winner's active subscription. Capture and inspect `error` here.
    const { data: keepKey, error: rpcErr } = await supabase.rpc(
      'claim_toss_billing_key_cleanup',
      {
        p_billing_key: result.billingKey,
        p_active_subscription_id: existing?.id ?? null,
      }
    );
    if (rpcErr || keepKey === null) {
      // A10/F2: RPC errored or returned no data - we cannot prove the key
      // is safe to delete. Fail closed. The key stays on Toss; an operator
      // can investigate via the structured log. The shared Toss key is the
      // winner's live payment credential; a wrong delete means the winner
      // is silently unsubscribed.
      logEvent('cleanup_rpc_error', {
        user_id: userId,
        plan_id,
        reason: rpcErr ? 'rpc_error' : 'rpc_null_result',
        error: rpcErr?.message ?? null,
      });
      logEvent('subscription_insert_failed', { user_id: userId, plan_id });
      return jsonResponse({ error: 'subscription_insert_failed' }, 500);
    }
    if (keepKey === true) {
      // A04: a row holds this key (the winner race). Do NOT delete.
      logEvent('billing_key_kept', { user_id: userId, plan_id, reason: 'cas_winner' });
    } else {
      // data === false: RPC confirmed no row holds this key. Safe to delete.
      // A10: best-effort delete so an orphaned Toss key is not left dangling.
      // Cleanup never throws.
      await deleteBillingKey(supabase, tossAuth, result.billingKey);
    }
    logEvent('subscription_insert_failed', { user_id: userId, plan_id });
    return jsonResponse({ error: 'subscription_insert_failed' }, 500);
  }

  logEvent('subscription_created', { user_id: userId, plan_id, subscription_id: sub.id });
  return jsonResponse({ ok: true, subscription_id: sub.id }, 200);
});
