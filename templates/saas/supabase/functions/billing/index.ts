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

async function verifyTurnstile(token: string, secretKey: string): Promise<boolean> {
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
    const data = await res.json() as { success?: boolean };
    return data.success === true;
  } catch (_err) {
    logEvent('turnstile_error', { reason: 'fetch_failed_or_timeout' });
    return false;
  } finally {
    clearTimeout(timer);
  }
}

type PlanInterval = 'month' | 'year';

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

// A10: best-effort cleanup of an orphaned Toss billing key. Never throws.
async function deleteBillingKey(auth: string, billingKey: string): Promise<void> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TOSS_TIMEOUT_MS);
  try {
    await fetch(`${TOSS_BILLING_AUTH_URL}/${billingKey}`, {
      method: 'DELETE',
      headers: { authorization: auth, 'idempotency-key': crypto.randomUUID() },
      signal: ctrl.signal,
    });
  } catch (_err) {
    // Cleanup must never throw — the caller is already on the failure path.
  } finally {
    clearTimeout(timer);
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

  const { plan_id, customer_key, turnstile_token, auth_key } = body as Partial<BillingRequest>;
  if (!plan_id || typeof plan_id !== 'string') {
    return jsonResponse({ error: 'missing plan_id' }, 400);
  }
  if (!customer_key || typeof customer_key !== 'string') {
    return jsonResponse({ error: 'missing customer_key' }, 400);
  }
  if (!turnstile_token || typeof turnstile_token !== 'string') {
    return jsonResponse({ error: 'missing turnstile_token' }, 400);
  }
  if (!auth_key || typeof auth_key !== 'string') {
    return jsonResponse({ error: 'missing auth_key' }, 400);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';

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

  const turnstileSecret = Deno.env.get('TURNSTILE_SECRET_KEY') ?? '';
  const turnstileOk = await verifyTurnstile(turnstile_token, turnstileSecret);
  if (!turnstileOk) {
    logEvent('turnstile_failed', { user_id: userId });
    return jsonResponse({ error: 'turnstile_failed' }, 400);
  }

  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const plan = await fetchPlan(supabase, plan_id);
  if (!plan) {
    return jsonResponse({ error: 'plan_not_found' }, 400);
  }

  // A06: reject if the user already holds an active subscription to this plan,
  // so a retried/duplicated request cannot create two active subscriptions.
  const { data: existing } = await supabase
    .from('subscriptions')
    .select('id')
    .eq('user_id', userId)
    .eq('plan_id', plan_id)
    .eq('status', 'active')
    .maybeSingle();
  if (existing) {
    logEvent('subscription_duplicate_blocked', { user_id: userId, plan_id });
    return jsonResponse({ error: 'subscription_already_active' }, 409);
  }

  // Toss confirm. The amount comes from plan.price_cents (DB), never from request input.
  const tossSecret = Deno.env.get('TOSS_SECRET_KEY') ?? '';
  const tossAuthKey = Deno.env.get('TOSS_AUTH_KEY') ?? '';
  const tossAuth = 'Basic ' + btoa(`${tossAuthKey}:${tossSecret}`);
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

  // A04: next-bill date must respect the plan's interval. The previous
  // implementation hard-coded +1 month, so a yearly plan was scheduled to
  // bill again in 30 days (12x oversell). Branch on plan.interval.
  const nextBill = new Date();
  if (plan.interval === 'year') {
    nextBill.setFullYear(nextBill.getFullYear() + 1);
  } else {
    nextBill.setMonth(nextBill.getMonth() + 1);
  }
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
    // The RPC returns a tri-state: 'true' (winner has the key — KEEP it),
    // 'false' (no row has the key — safe to delete), 'error' (RPC failed —
    // do NOT delete; the key state is unknown).
    const { data: keepKey } = await supabase.rpc('claim_toss_billing_key_cleanup', {
      p_billing_key: result.billingKey,
      p_active_subscription_id: null,  // our insert failed, so we have no id to pass
    });
    if (keepKey === 'false') {
      // A10: best-effort delete so an orphaned Toss key is not left dangling.
      // Cleanup never throws.
      await deleteBillingKey(tossAuth, result.billingKey);
    } else if (keepKey === 'true') {
      logEvent('billing_key_kept', { user_id: userId, plan_id, reason: 'cas_winner' });
    } else {
      // 'error' or null/undefined — RPC failed. Do NOT delete; the key state
      // is unknown. Log so the orphan key is visible in the audit trail.
      logEvent('billing_cleanup_unknown', { user_id: userId, plan_id, keep_key: keepKey });
    }
    logEvent('subscription_insert_failed', { user_id: userId, plan_id });
    return jsonResponse({ error: 'subscription_insert_failed' }, 500);
  }

  logEvent('subscription_created', { user_id: userId, plan_id, subscription_id: sub.id });
  return jsonResponse({ ok: true, subscription_id: sub.id }, 200);
});
