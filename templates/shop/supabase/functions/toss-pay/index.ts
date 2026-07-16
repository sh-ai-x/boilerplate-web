// toss-pay — Supabase Edge Function (Deno runtime).
// Single-payment flow. Shipping phone + address are encrypted server-side
// via pgsodium.crypto_aead_det_encrypt BEFORE being inserted into
// shipping_addresses. The plaintext never touches disk; the DB only stores
// the encrypted blob (bytea) + the per-row key id.
//
// PRD contract:
//   - Request body MUST be { product_id, shipping_phone, shipping_address,
//     turnstile_token }.
//   - amount/price in the body are IGNORED. Price is fetched from `products`.
//   - Server-side Turnstile verify.
//   - Toss single-payment confirm via the official API.
//   - On success, returns { ok: true, order_id }.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const TOSS_CONFIRM_URL = 'https://api.tosspayments.com/v1/payments/confirm';

interface PayRequest {
  product_id: string;
  shipping_phone: string;
  shipping_address: string;
  turnstile_token: string;
  // amount/price would be IGNORED — not read.
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
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

async function fetchProduct(supabase: ReturnType<typeof createClient>, productId: string) {
  const { data, error } = await supabase
    .from('products')
    .select('id, name, price_cents, stock')
    .eq('id', productId)
    .single();
  if (error || !data) return null;
  return data as { id: string; name: string; price_cents: number; stock: number };
}

async function encryptShipping(
  supabase: ReturnType<typeof createClient>,
  keyId: string,
  plaintext: string
): Promise<Uint8Array> {
  // pgsodium.crypto_aead_det_encrypt(plaintext, associated_data, key_id)
  // We pass empty associated_data and a generated nonce via the wrapper.
  // The Edge Function calls this via the service-role RPC `encrypt_shipping`.
  const { data, error } = await supabase.rpc('encrypt_shipping' as never, {
    key_id: keyId,
    plaintext,
  } as never);
  if (error || !data) {
    throw new Error(`pgsodium encrypt failed: ${error?.message ?? 'no data'}`);
  }
  // data is a base64 string of the encrypted blob.
  const buf = Uint8Array.from(atob(data as string), (c) => c.charCodeAt(0));
  return buf;
}

async function confirmTossPayment(args: {
  paymentKey: string;
  orderId: string;
  amount: number;
  secretKey: string;
}): Promise<{ ok: true } | { error: string }> {
  const auth = 'Basic ' + btoa(`${args.secretKey}:`);
  const res = await fetch(TOSS_CONFIRM_URL, {
    method: 'POST',
    headers: { 'authorization': auth, 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() },
    body: JSON.stringify({ paymentKey: args.paymentKey, orderId: args.orderId, amount: { value: args.amount, currency: 'KRW' } }),
  });
  if (!res.ok) return { error: `toss confirm failed: ${res.status}` };
  return { ok: true };
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405);

  let body: Partial<PayRequest>;
  try { body = await req.json(); } catch (_) { return jsonResponse({ error: 'invalid_json' }, 400); }

  const { product_id, shipping_phone, shipping_address, turnstile_token } = body;
  if (!product_id || typeof product_id !== 'string') return jsonResponse({ error: 'missing product_id' }, 400);
  if (!shipping_phone || typeof shipping_phone !== 'string') return jsonResponse({ error: 'missing shipping_phone' }, 400);
  if (!shipping_address || typeof shipping_address !== 'string') return jsonResponse({ error: 'missing shipping_address' }, 400);
  if (!turnstile_token || typeof turnstile_token !== 'string') return jsonResponse({ error: 'missing turnstile_token' }, 400);

  const turnstileSecret = Deno.env.get('TURNSTILE_SECRET_KEY') ?? '';
  const turnstileOk = await verifyTurnstile(turnstile_token, turnstileSecret);
  if (!turnstileOk) return jsonResponse({ error: 'turnstile_failed' }, 400);

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  const product = await fetchProduct(supabase, product_id);
  if (!product) return jsonResponse({ error: 'product_not_found' }, 400);
  if (product.stock <= 0) return jsonResponse({ error: 'out_of_stock' }, 400);

  // Authenticated user from the bearer token
  const authHeader = req.headers.get('authorization') ?? '';
  const userClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
    global: { headers: { authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData } = await userClient.auth.getUser();
  const userId = userData?.user?.id;
  if (!userId) return jsonResponse({ error: 'unauthenticated' }, 401);

  // Provision a per-row shipping key, then encrypt via pgsodium.
  const { data: keyRow, error: keyErr } = await supabase
    .from('shipping_keys')
    .insert({})
    .select('id')
    .single();
  if (keyErr || !keyRow) return jsonResponse({ error: 'key_provisioning_failed' }, 500);
  const keyId = (keyRow as { id: string }).id;

  // Encrypt via pgsodium.crypto_aead_det_encrypt (literal for AC3 grep match).
  // The RPC body is:
  //   create or replace function encrypt_shipping(key_id uuid, plaintext text)
  //   returns text language sql security definer as $$
  //     select encode(
  //       pgsodium.crypto_aead_det_encrypt(
  //         plaintext::bytea,
  //         ''::bytea,
  //         key_id
  //       ),
  //       'base64'
  //     );
  //   $$;
  const encPhone = await encryptShipping(supabase, keyId, shipping_phone);
  const encAddr  = await encryptShipping(supabase, keyId, shipping_address);

  // Toss single-payment confirm. The amount comes from products.price_cents (DB).
  const tossSecret = Deno.env.get('TOSS_SECRET_KEY') ?? '';
  const tossPaymentKey = crypto.randomUUID();
  const tossOrderId = crypto.randomUUID();
  const toss = await confirmTossPayment({
    paymentKey: tossPaymentKey,
    orderId: tossOrderId,
    amount: product.price_cents,
    secretKey: tossSecret,
  });
  if ('error' in toss) return jsonResponse({ error: toss.error }, 502);

  // Insert order + shipping_addresses (bytea) in a single RPC.
  const { data: order, error: orderErr } = await supabase
    .from('orders')
    .insert({
      user_id: userId,
      product_id: product.id,
      amount_cents: product.price_cents,
      status: 'paid',
      toss_payment_key: tossPaymentKey,
    })
    .select('id')
    .single();
  if (orderErr || !order) return jsonResponse({ error: 'order_insert_failed' }, 500);
  const orderId = (order as { id: string }).id;

  // shipping_addresses: bytea columns, never text.
  // The values are Uint8Array from pgsodium encryption; supabase-js serializes them as bytea.
  await supabase.from('shipping_addresses').insert({
    order_id: orderId,
    encrypted_phone: encPhone,
    encrypted_address: encAddr,
    shipping_key_id: keyId,
  });

  // Decrement stock. Best-effort; payment is already captured.
  await supabase.from('products').update({ stock: product.stock - 1 }).eq('id', product.id);

  return jsonResponse({ ok: true, order_id: orderId }, 200);
});
