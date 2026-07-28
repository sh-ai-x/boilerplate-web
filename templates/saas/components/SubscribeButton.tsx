'use client';

import { useState } from 'react';
import { Turnstile } from '@boilerplate-web/shared/components';
import { createBrowserSupabase } from '@boilerplate-web/shared/supabase';

interface SubscribeButtonProps {
  planId: string;
}

export function SubscribeButton({ planId }: SubscribeButtonProps) {
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function onClick() {
    setError(null);
    setSuccess(null);
    if (!turnstileToken) {
      setError('Please complete the Turnstile challenge.');
      return;
    }
    setSubmitting(true);
    try {
      const supabase = createBrowserSupabase();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setError('Please sign in first.');
        setSubmitting(false);
        return;
      }
      // Call the Edge Function. We do NOT pass amount/price — the function
      // fetches price_cents from the plans table server-side.
      const session = (await supabase.auth.getSession()).data.session;
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/billing`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${session?.access_token ?? ''}`,
          },
          body: JSON.stringify({
            plan_id: planId,
            customer_key: user.id,
            turnstile_token: turnstileToken,
            // Note: deliberately NOT sending amount/price — the Edge Function
            // fetches these from the DB.
          }),
        }
      );
      const data = await res.json() as { ok?: boolean; subscription_id?: string; error?: string };
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
      <Turnstile
        siteKey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? ''}
        onVerify={setTurnstileToken}
      />
      <button type="button" onClick={onClick} disabled={submitting}>
        {submitting ? 'Subscribing…' : 'Subscribe'}
      </button>
      {error ? <p role="alert" style={{ color: 'crimson' }}>{error}</p> : null}
      {success ? <p role="status" style={{ color: 'green' }}>{success}</p> : null}
    </div>
  );
}
