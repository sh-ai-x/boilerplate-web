'use client';

import { useState } from 'react';
import { createBrowserSupabase } from '../supabase/client';

export interface GoogleSignInButtonProps {
  /** Optional override for the post-auth redirect. Defaults to current origin. */
  redirectTo?: string;
  /** Optional className passthrough. */
  className?: string;
  /** Override button label. */
  label?: string;
}

/**
 * The ONLY sign-in affordance in this boilerplate. Per PRD non-goal #1,
 * we do NOT render email, password, or magic-link inputs anywhere. The
 * Google OAuth flow is the single sign-in path.
 */
export function GoogleSignInButton({
  redirectTo,
  className,
  label = 'Continue with Google',
}: GoogleSignInButtonProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onClick() {
    setLoading(true);
    setError(null);
    try {
      const supabase = createBrowserSupabase();
      const target = redirectTo ?? `${window.location.origin}/auth/callback`;
      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: target },
      });
      if (oauthError) {
        setError(oauthError.message);
        setLoading(false);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setLoading(false);
    }
  }

  return (
    <div className={className}>
      <button
        type="button"
        onClick={onClick}
        disabled={loading}
        aria-label="Sign in with Google"
        data-testid="google-signin-button"
      >
        {loading ? 'Redirecting…' : label}
      </button>
      {error ? (
        <p role="alert" data-testid="google-signin-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}
