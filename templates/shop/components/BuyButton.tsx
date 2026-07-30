'use client';
import { useState } from 'react';
import { Turnstile } from '@boilerplate-web/shared/components';
import { createBrowserSupabase } from '@boilerplate-web/shared/supabase';

// Toss Payments JS SDK is loaded lazily on first click (see loadTossSdk()).
// We do NOT bundle it; the SDK is injected via <script> on demand.
declare global {
  interface Window {
    TossPayments?: (clientKey: string) => TossPaymentsInstance;
  }
}
interface TossPaymentsInstance {
  requestPayment: (args: TossRequestArgs) => Promise<void>;
}
interface TossRequestArgs {
  method: 'CARD';
  amount: { value: number; currency: 'KRW' };
  orderId: string;
  orderName: string;
  successUrl: string;
  failUrl: string;
  customerEmail?: string;
  customerName?: string;
  customerKey?: string;
}

let sdkPromise: Promise<void> | null = null;
function loadTossSdk(): Promise<void> {
  if (sdkPromise) return sdkPromise;
  sdkPromise = new Promise<void>((resolve, reject) => {
    if (typeof window === 'undefined') return reject(new Error('ssr'));
    if (window.TossPayments) return resolve();
    const SCRIPT_ID = 'toss-sdk-script';
    if (!document.getElementById(SCRIPT_ID)) {
      const s = document.createElement('script');
      s.id = SCRIPT_ID;
      s.src = 'https://js.tosspayments.com/v1/payment';
      s.async = true;
      document.head.appendChild(s);
    }
    const start = Date.now();
    const poll = setInterval(() => {
      if (window.TossPayments) {
        clearInterval(poll);
        resolve();
      } else if (Date.now() - start > 5000) {
        clearInterval(poll);
        reject(new Error('Toss SDK load timeout'));
      }
    }, 100);
  });
  return sdkPromise;
}

export function BuyButton({ productId, productName, priceCents }: { productId: string; productName: string; priceCents: number }) {
  const [token, setToken] = useState<string | null>(null);
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  async function onBuy() {
    setErr(null); setOk(null);
    if (!token) { setErr('Please complete Turnstile.'); return; }
    if (!phone || !address) { setErr('Phone and address required.'); return; }
    setBusy(true);
    try {
      const s = createBrowserSupabase();
      const { data: { user } } = await s.auth.getUser();
      if (!user) { setErr('Please sign in.'); setBusy(false); return; }

      // Generate the orderId client-side. The Toss JS SDK requires it
      // BEFORE redirect; the Edge Function confirms with the EXACT same id.
      const orderId = (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
        ? crypto.randomUUID()
        : `order-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

      // Stash shipping + turnstile + product context so the success page
      // can POST to the Edge Function with the EXACT same paymentKey
      // and orderId Toss returns via query string.
      sessionStorage.setItem(`buy:${orderId}`, JSON.stringify({
        product_id: productId,
        shipping_phone: phone,
        shipping_address: address,
        turnstile_token: token,
      }));

      // Load SDK and call Toss requestPayment. Toss redirects to successUrl
      // with ?paymentKey=...&orderId=<orderId>; the success page reads
      // sessionStorage and POSTs to the Edge Function.
      await loadTossSdk();
      const tossClientKey = process.env.NEXT_PUBLIC_TOSS_CLIENT_KEY ?? '';
      if (!tossClientKey || !window.TossPayments) {
        throw new Error('Toss client key missing.');
      }
      const toss = window.TossPayments(tossClientKey);
      await toss.requestPayment({
        method: 'CARD',
        amount: { value: priceCents, currency: 'KRW' },
        orderId,
        orderName: productName,
        successUrl: `${window.location.origin}/payment/success`,
        failUrl: `${window.location.origin}/payment/fail`,
        customerKey: user.id,
        customerEmail: user.email ?? undefined,
      });
    } catch (e) {
      // AbortError means the user closed the Toss widget without paying.
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.toLowerCase().includes('abort') || msg.toLowerCase().includes('user')) {
        setErr('Payment cancelled.');
      } else {
        setErr(msg);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <label>Phone<br /><input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="010-1234-5678" /></label>
      <br />
      <label>Address<br /><textarea value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Seoul, ..." rows={3} /></label>
      <br />
      <Turnstile siteKey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? ''} onVerify={setToken} />
      <button type="button" onClick={onBuy} disabled={busy}>{busy ? 'Redirecting…' : 'Buy now'}</button>
      {err ? <p role="alert" style={{ color: 'crimson' }}>{err}</p> : null}
      {ok ? <p role="status" style={{ color: 'green' }}>{ok}</p> : null}
    </div>
  );
}
