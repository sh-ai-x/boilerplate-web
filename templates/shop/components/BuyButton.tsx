'use client';
import { useState } from 'react';
import { Turnstile } from '@boilerplate-web/shared/components';
import { createBrowserSupabase } from '@boilerplate-web/shared/supabase';

export function BuyButton({ productId }: { productId: string }) {
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
      const session = (await s.auth.getSession()).data.session;
      const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/toss-pay`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${session?.access_token ?? ''}` },
        body: JSON.stringify({ product_id: productId, shipping_phone: phone, shipping_address: address, turnstile_token: token }),
      });
      const data = await res.json() as { ok?: boolean; order_id?: string; error?: string };
      if (!res.ok || !data.ok) setErr(data.error ?? `HTTP ${res.status}`);
      else setOk(`Order placed: ${data.order_id}`);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  return (
    <div>
      <label>Phone<br /><input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="010-1234-5678" /></label>
      <br />
      <label>Address<br /><textarea value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Seoul, ..." rows={3} /></label>
      <br />
      <Turnstile siteKey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? ''} onVerify={setToken} />
      <button type="button" onClick={onBuy} disabled={busy}>{busy ? 'Placing order…' : 'Buy now'}</button>
      {err ? <p role="alert" style={{ color: 'crimson' }}>{err}</p> : null}
      {ok ? <p role="status" style={{ color: 'green' }}>{ok}</p> : null}
    </div>
  );
}
