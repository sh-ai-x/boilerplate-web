'use client';

import { useState } from 'react';
import { createBrowserSupabase } from '../supabase/client';

export interface SignOutButtonProps {
  className?: string;
  label?: string;
  redirectTo?: string;
}

export function SignOutButton({
  className,
  label = 'Sign out',
  redirectTo = '/',
}: SignOutButtonProps) {
  const [loading, setLoading] = useState(false);

  async function onClick() {
    setLoading(true);
    try {
      const supabase = createBrowserSupabase();
      await supabase.auth.signOut();
      if (typeof window !== 'undefined') {
        window.location.href = redirectTo;
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading}
      className={className}
      data-testid="signout-button"
    >
      {loading ? 'Signing out…' : label}
    </button>
  );
}
