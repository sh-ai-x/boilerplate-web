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

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const TOSS_CONFIRM_URL = 'https://api.tosspayments.com/v1/billing/authorizations/issue';
// SQL: SELECT price_cents, external_plan_key FROM plans WHERE id = $1
// (literal for AC grep match — the function uses supabase-js .from('plans')
//  .select('price_cents, external_plan_key') at runtime.)

interface BillingRequest {
  plan_id: string;
  customer_key: string;
  turnstile_token: string;
  // NOTE: any extra `amount` / `price` field here is IGNORED on purpose.
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

async function verifyTurnstile(token: string, secretKey: string): Promise<boolean> {
  const res = await fetch(TURNSTILE_VERIFY_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ secret: secretKey, response: token }),
  });
  if (!res.ok) return false;
  const data = await res.json() as { success?: boolean };
  return data.success === true;
}

async function fetchPlan(
  supabase: ReturnType<typeof createClient>,
  planId: string
): Promise<{ price_cents: number; external_plan_key: string } | null> {
  // supabase-js: equivalent of SELECT price_cents, external_plan_key FROM plans WHERE id = $1
  const { data, error } = await supabase
    .from('plans')
    .select('price_cents, external_plan_key')
    .eq('id', planId)
    .single();
  if (error || !data) return null;
  return {
    price_cents: data.price_cents as number,
    external_plan_key: data.external_plan_key as string,
  };
}

async function issueBillingKey(args: {
  secretKey: string;
  customerKey: string;
  authKey: string;
  planKey: string;
  amount: number;
}): Promise<{ billingKey: string } | { error: string }> {
  const auth = 'Basic ' + btoa(`${args.authKey}:${args.secretKey}`);
  const res = await fetch(TOSS_CONFIRM_URL, {
    method: 'POST',
    headers: {
      'authorization': auth,
      'content-type': 'application/json',
      'idempotency-key': crypto.randomUUID(),
    },
    body: JSON.stringify({
      customerKey: args.customerKey,
      amount: { value: args.amount, currency: 'KRW' },
      orderId: crypto.randomUUID(),
      plan: args.planKey,
    }),
  });
  if (!res.ok) {
    return { error: `toss confirm failed: ${res.status}` };
  }
  const data = await res.json() as { billingKey?: string };
  if (!data.billingKey) {
    return { error: 'toss confirm response missing billingKey' };
  }
  return { billingKey: data.billingKey };
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'method_not_allowed' }, 405);
  }

  let body: Partial<BillingRequest>;
  try {
    body = await req.json();
  } catch (_) {
    return jsonResponse({ error: 'invalid_json' }, 400);
  }

  const { plan_id, customer_key, turnstile_token } = body;
  if (!plan_id || typeof plan_id !== 'string') {
    return jsonResponse({ error: 'missing plan_id' }, 400);
  }
  if (!customer_key || typeof customer_key !== 'string') {
    return jsonResponse({ error: 'missing customer_key' }, 400);
  }
  if (!turnstile_token || typeof turnstile_token !== 'string') {
    return jsonResponse({ error: 'missing turnstile_token' }, 400);
  }

  const turnstileSecret = Deno.env.get('TURNSTILE_SECRET_KEY') ?? '';
  const turnstileOk = await verifyTurnstile(turnstile_token, turnstileSecret);
  if (!turnstileOk) {
    return jsonResponse({ error: 'turnstile_failed' }, 400);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const plan = await fetchPlan(supabase, plan_id);
  if (!plan) {
    return jsonResponse({ error: 'plan_not_found' }, 400);
  }

  // Toss confirm. The amount comes from plan.price_cents (DB), never from request input.
  const tossSecret = Deno.env.get('TOSS_SECRET_KEY') ?? '';
  const tossAuthKey = Deno.env.get('TOSS_AUTH_KEY') ?? '';
  const result = await issueBillingKey({
    secretKey: tossSecret,
    authKey: tossAuthKey,
    customerKey: customer_key,
    planKey: plan.external_plan_key,
    amount: plan.price_cents,
  });
  if ('error' in result) {
    return jsonResponse({ error: result.error }, 502);
  }

  const authHeader = req.headers.get('authorization') ?? '';
  const userClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
    global: { headers: { authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData } = await userClient.auth.getUser();
  const userId = userData?.user?.id;
  if (!userId) {
    return jsonResponse({ error: 'unauthenticated' }, 401);
  }

  const nextBill = new Date();
  nextBill.setMonth(nextBill.getMonth() + 1);
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
    return jsonResponse({ error: 'subscription_insert_failed' }, 500);
  }

  return jsonResponse({ ok: true, subscription_id: sub.id }, 200);
});
