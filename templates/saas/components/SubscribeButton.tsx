'use client';

import { useState } from 'react';
import { useAuth, useSession, useUser } from '@clerk/nextjs';

interface SubscribeButtonProps {
  planId: string;
}

export function SubscribeButton({ planId }: SubscribeButtonProps) {
  const { isSignedIn, isLoaded } = useAuth();
  const { session } = useSession();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  if (isLoaded && !isSignedIn) {
    return (
      <a href="/sign-in">
        <button type="button">Sign in to subscribe</button>
      </a>
    );
  }

  async function onClick() {
    setError(null);
    setSuccess(null);
    setSubmitting(true);
    try {
      // A01: the Edge Function verifies the Clerk session JWT itself
      // (see billing/index.ts: verifyToken). The browser just forwards
      // the session token.
      const token = await session?.getToken();
      if (!token) {
        setError('Please sign in again.');
        setSubmitting(false);
        return;
      }
      // The Toss card-auth flow happens client-side BEFORE this call -
      // the resulting authKey is sent in the body. (For brevity this
      // template omits the Toss Checkout.js wiring; a real deployment
      // would integrate Toss Checkout and pass authKey here.)
      const authKey = prompt('Paste Toss card-auth authKey (or cancel):') ?? '';
      if (!authKey) {
        setSubmitting(false);
        return;
      }
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/billing`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            plan_id: planId,
            auth_key: authKey,
            // Note: deliberately NOT sending amount/price - the Edge
            // Function fetches these from the DB.
          }),
        }
      );
      const data = (await res.json()) as { ok?: boolean; subscription_id?: string; error?: string };
      if (!res.ok || !data.ok) {
        setError(data.error ?? `HTTP ${res.status}`);
      } else {
        setSuccess(`Subscription created: ${data.subscription_id}`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <button type="button" onClick={onClick} disabled={submitting || !isLoaded}>
        {submitting ? 'Subscribing…' : 'Subscribe'}
      </button>
      {error ? <p role="alert" style={{ color: 'crimson' }}>{error}</p> : null}
      {success ? <p role="status" style={{ color: 'green' }}>{success}</p> : null}
    </div>
  );
}
