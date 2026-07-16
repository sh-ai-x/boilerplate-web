'use client';
import { useState } from 'react';
import { createBrowserSupabase } from '../supabase/client';
export function GoogleSignInButton({ redirectTo, className, label = 'Continue with Google' }: { redirectTo?: string; className?: string; label?: string }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function onClick() {
    setLoading(true); setError(null);
    try {
      const supabase = createBrowserSupabase();
      const target = redirectTo ?? `${typeof window !== 'undefined' ? window.location.origin : ''}/auth/callback`;
      const { error: oauthError } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: target } });
      if (oauthError) { setError(oauthError.message); setLoading(false); }
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); setLoading(false); }
  }
  return <div className={className}><button type="button" onClick={onClick} disabled={loading} aria-label="Sign in with Google" data-testid="google-signin-button">{loading ? 'Redirecting…' : label}</button>{error ? <p role="alert" data-testid="google-signin-error">{error}</p> : null}</div>;
}
