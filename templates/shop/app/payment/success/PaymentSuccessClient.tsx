'use client';
import { useEffect, useState } from 'react';
import { createBrowserSupabase } from '@boilerplate-web/shared/supabase';

interface BuyContext {
  product_id: string;
  shipping_phone: string;
  shipping_address: string;
  turnstile_token: string;
}
interface EdgeResponse {
  ok?: boolean;
  order_id?: string;
  new_stock?: number;
  error?: string;
}

export default function PaymentSuccessClient({
  paymentKey,
  orderId,
  amount,
}: {
  paymentKey: string;
  orderId: string;
  amount: number;
}) {
  const [state, setState] = useState<'pending' | 'done' | 'failed'>('pending');
  const [orderIdEcho, setOrderIdEcho] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const ctxRaw = sessionStorage.getItem(`buy:${orderId}`);
      if (!ctxRaw) {
        setErr('Lost buy context (sessionStorage expired). Please retry.');
        setState('failed');
        return;
      }
      const ctx = JSON.parse(ctxRaw) as BuyContext;
      sessionStorage.removeItem(`buy:${orderId}`);
      const s = createBrowserSupabase();
      const { data } = await s.auth.getSession();
      const token = data.session?.access_token ?? '';
      const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/toss-pay`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({
          orderId,
          paymentKey,
          amount,
          product_id: ctx.product_id,
          shipping_phone: ctx.shipping_phone,
          shipping_address: ctx.shipping_address,
          turnstile_token: ctx.turnstile_token,
        }),
      });
      const payload = (await res.json().catch(() => ({}))) as EdgeResponse;
      if (cancelled) return;
      if (!res.ok || !payload.ok) {
        setErr(payload.error ?? `HTTP ${res.status}`);
        setState('failed');
      } else {
        setOrderIdEcho(payload.order_id ?? orderId);
        setState('done');
      }
    })();
    return () => { cancelled = true; };
  }, [paymentKey, orderId, amount]);

  return (
    <section>
      <h1>Payment {state === 'done' ? 'succeeded' : state === 'failed' ? 'failed' : 'processing…'}</h1>
      {state === 'pending' ? <p>Confirming your payment with Toss…</p> : null}
      {state === 'done' ? (
        <>
          <p role="status" style={{ color: 'green' }}>Order placed: <code>{orderIdEcho}</code></p>
          <p><a href="/">Back to shop</a></p>
        </>
      ) : null}
      {state === 'failed' ? (
        <>
          <p role="alert" style={{ color: 'crimson' }}>Error: {err}</p>
          <p><a href="/">Back to shop</a></p>
        </>
      ) : null}
    </section>
  );
}
