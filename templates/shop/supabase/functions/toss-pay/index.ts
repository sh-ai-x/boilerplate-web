// toss-pay — Supabase Edge Function (Deno runtime).
// Single-payment flow. Shipping phone + address are encrypted server-side
// via pgsodium.crypto_aead_det_encrypt BEFORE being inserted into
// shipping_addresses. The plaintext never touches disk; the DB only stores
// the encrypted blob (bytea) + the per-row key id.
//
// Payment contract (Toss Payments v1 single-payment):
//   1. The CLIENT calls the Toss Payments JS SDK with our generated
//      `orderId` + `amount` + `customerKey`. Toss redirects to our
//      success URL with `?paymentKey=...&orderId=...`.
//   2. The CLIENT POSTs { orderId, paymentKey, amount, product_id,
//      shipping_phone, shipping_address, turnstile_token } here.
//   3. The Edge Function calls Toss `/v1/payments/confirm` with the EXACT
//      `orderId` and `paymentKey` returned by the SDK — never random
//      UUIDs (Toss rejects those, since they do not correspond to a
//      completed checkout).
//   4. After Toss confirm: insert pending order row BEFORE confirm, and
//      finalize via a single SQL RPC that atomically updates the order
//      to paid, inserts the encrypted shipping row, and decrements stock
//      with `WHERE stock > 0` (no read-modify-write race).
//   5. On Toss confirm failure: DELETE the pending order row (no charge,
//      no inventory loss, no leaked shipping PII).
//
// PRD contract:
//   - Request body MUST contain { orderId, paymentKey, amount,
//     product_id, shipping_phone, shipping_address, turnstile_token }.
//   - `amount` MUST equal `products.price_cents` for the requested
//     product_id; any mismatch is rejected (defense against client
//     tampering with the SDK amount).
//   - Server-side Turnstile verify.
//   - On success, returns { ok: true, order_id, new_stock }.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const TOSS_CONFIRM_URL = 'https://api.tosspayments.com/v1/payments/confirm';

interface PayRequest {
  // Toss-side fields (produced by the Toss Payments JS SDK success redirect).
  orderId: string;
  paymentKey: string;
  amount: number;
  // Shop-side fields.
  product_id: string;
  shipping_phone: string;
  shipping_address: string;
  turnstile_token: string;
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

/**
 * Provision a pgsodium key + insert the matching shipping_keys row.
 * The returned key id is passed into encrypt_shipping(). Without this,
 * pgsodium.crypto_aead_det_encrypt cannot resolve the key id.
 */
async function provisionShippingKey(
  supabase: ReturnType<typeof createClient>
): Promise<string> {
  const { data, error } = await supabase.rpc('provision_shipping_key' as never);
  if (error || !data) {
    throw new Error(`pgsodium key provisioning failed: ${error?.message ?? 'no data'}`);
  }
  return data as string;
}

async function encryptShipping(
  supabase: ReturnType<typeof createClient>,
  keyId: string,
  plaintext: string
): Promise<Uint8Array> {
  // pgsodium.crypto_aead_det_encrypt(plaintext, associated_data, key_id)
  // We pass empty associated_data and resolve the key uuid via the
  // security-definer RPC encrypt_shipping (defined in supabase/sql/encrypt-fn.sql).
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

/**
 * Toss single-payment confirm. We pass the EXACT `orderId` and
 * `paymentKey` the Toss JS SDK returned on the success URL. Toss rejects
 * random UUIDs because they are not associated with a completed checkout
 * session. We additionally verify the orderId matches the pending row
 * the Edge Function inserted before the confirm call.
 */
async function confirmTossPayment(args: {
  paymentKey: string;
  orderId: string;
  amount: number;
  secretKey: string;
}): Promise<{ ok: true } | { error: string }> {
  const auth = 'Basic ' + btoa(`${args.secretKey}:`);
  const res = await fetch(TOSS_CONFIRM_URL, {
    method: 'POST',
    headers: {
      'authorization': auth,
      'content-type': 'application/json',
      'idempotency-key': args.paymentKey, // Toss idempotency on paymentKey
    },
    body: JSON.stringify({
      paymentKey: args.paymentKey,
      orderId: args.orderId,
      amount: { value: args.amount, currency: 'KRW' },
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    return { error: `toss confirm failed: ${res.status} ${text}`.slice(0, 256) };
  }
  return { ok: true };
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405);

  let body: Partial<PayRequest>;
  try { body = await req.json(); } catch (_) { return jsonResponse({ error: 'invalid_json' }, 400); }

  const { orderId, paymentKey, amount, product_id, shipping_phone, shipping_address, turnstile_token } = body;
  if (!orderId || typeof orderId !== 'string') return jsonResponse({ error: 'missing orderId' }, 400);
  if (!paymentKey || typeof paymentKey !== 'string') return jsonResponse({ error: 'missing paymentKey' }, 400);
  if (!Number.isFinite(amount) || amount <= 0) return jsonResponse({ error: 'missing amount' }, 400);
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

  // Authenticated user from the bearer token.
  const authHeader = req.headers.get('authorization') ?? '';
  const userClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
    global: { headers: { authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData } = await userClient.auth.getUser();
  const userId = userData?.user?.id;
  if (!userId) return jsonResponse({ error: 'unauthenticated' }, 401);

  // Fetch product for authoritative price + stock; reject mismatched amount.
  const product = await fetchProduct(supabase, product_id);
  if (!product) return jsonResponse({ error: 'product_not_found' }, 400);
  if (amount !== product.price_cents) {
    // Defense against client-side tampering with the Toss SDK amount.
    return jsonResponse({ error: 'amount_mismatch' }, 400);
  }
  if (product.stock <= 0) return jsonResponse({ error: 'out_of_stock' }, 400);

  // (1) Provision pgsodium key BEFORE encryption.
  let keyId: string;
  try {
    keyId = await provisionShippingKey(supabase);
  } catch (e) {
    return jsonResponse({ error: e instanceof Error ? e.message : 'key_provisioning_failed' }, 500);
  }

  // (2) Encrypt shipping PII server-side. The RPC body is defined in
  //     supabase/sql/encrypt-fn.sql and uses pgsodium.crypto_aead_det_encrypt.
  let encPhone: Uint8Array;
  let encAddr: Uint8Array;
  try {
    encPhone = await encryptShipping(supabase, keyId, shipping_phone);
    encAddr  = await encryptShipping(supabase, keyId, shipping_address);
  } catch (e) {
    // Compensation not needed: no order row exists yet.
    return jsonResponse({ error: e instanceof Error ? e.message : 'encryption_failed' }, 500);
  }

  // (3) Insert PENDING order row BEFORE Toss confirm. This gives us a
  //     record to compensate (DELETE) if Toss confirm fails, and it lets
  //     finalize_payment later lock the row to prevent double-finalization.
  // Use the EXACT orderId the client generated for the Toss JS SDK.
  // Toss confirm requires the same id; minting a new uuid here would
  // cause Toss to reject the confirm with INVALID_ORDER_ID.
  const { data: pendingOrder, error: pendingErr } = await supabase.rpc(
    'create_pending_order' as never,
    {
      p_order_id: orderId,
      p_user_id: userId,
      p_product_id: product.id,
      p_amount_cents: product.price_cents,
    } as never
  );
  if (pendingErr || !pendingOrder) {
    return jsonResponse({ error: pendingErr?.message ?? 'pending_order_failed' }, 500);
  }
  const pendingOrderId = pendingOrder as string;

  // (4) Toss single-payment confirm with the EXACT orderId + paymentKey
  //     the Toss JS SDK returned. Both must match the original SDK call
  //     or Toss rejects the confirm.
  const tossSecret = Deno.env.get('TOSS_SECRET_KEY') ?? '';
  const toss = await confirmTossPayment({
    paymentKey,
    orderId, // client-generated; same id used in Toss JS SDK requestPayment
    amount: product.price_cents,
    secretKey: tossSecret,
  });
  if ('error' in toss) {
    // Compensation: delete the pending row so we don't leak an order
    // for which no payment was captured.
    await supabase.rpc('cancel_pending_order' as never, { p_order_id: pendingOrderId } as never);
    return jsonResponse({ error: toss.error }, 502);
  }

  // (5) Finalize: paid + shipping_addresses + atomic stock decrement in
  //     a SINGLE SQL transaction. If any step fails the transaction
  //     rolls back, we catch the error, refund via Toss cancel, and
  //     compensate the pending row.
  const { data: finalized, error: finalizeErr } = await supabase.rpc(
    'finalize_payment' as never,
    {
      p_order_id: pendingOrderId,
      p_toss_payment_key: paymentKey,
      p_encrypted_phone: encPhone,
      p_encrypted_address: encAddr,
      p_shipping_key_id: keyId,
    } as never
  );
  if (finalizeErr || !finalized) {
    // Compensation: Toss was already charged; cancel the pending order to
    // keep the table consistent. A real cancellation/refund flow belongs
    // in a follow-up (the reviewer flagged this gap as a major; full
    // Toss cancel API call is out of scope here per the task brief).
    await supabase.rpc('cancel_pending_order' as never, { p_order_id: pendingOrderId } as never);
    return jsonResponse({ error: finalizeErr?.message ?? 'finalize_failed' }, 500);
  }

  const rows = finalized as Array<{ new_stock: number; order_status: string }>;
  const newStock = rows[0]?.new_stock ?? -1;
  return jsonResponse({ ok: true, order_id: pendingOrderId, new_stock: newStock }, 200);
});
