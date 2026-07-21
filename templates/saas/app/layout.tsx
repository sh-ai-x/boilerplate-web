import type { ReactNode } from 'react';
import { GoogleSignInButton, SignOutButton } from '@boilerplate-web/shared/auth';
import { createServerSupabase } from '@boilerplate-web/shared/supabase';
import { cookies } from 'next/headers';

export const metadata = {
  title: 'SaaS Boilerplate',
  description: 'Next.js + Supabase + Toss billing-key boilerplate',
};

// A10: only the "env not configured" case may be swallowed to a logged-out
// render. Any other error (a real auth/session failure) must surface via
// console.error so operational problems are not masked as "logged out".
function isMissingEnvError(err: unknown): boolean {
  return err instanceof Error && /Missing required env/.test(err.message);
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  // Server-side session check. The cookie store is wired through here.
  let sessionUser: { email?: string | null } | null = null;
  try {
    const cookieStore = cookies();
    const supabase = createServerSupabase({
      get: (n) => cookieStore.get(n),
      set: (n, v, o) => cookieStore.set(n, v, o as never),
    });
    const { data } = await supabase.auth.getUser();
    sessionUser = data.user ? { email: data.user.email } : null;
  } catch (err) {
    if (!isMissingEnvError(err)) {
      // Operational auth failure — do not silently degrade to logged-out.
      console.error('RootLayout auth check failed:', err);
    }
    sessionUser = null;
  }

  return (
    <html lang="en">
      <body>
        <header style={{ padding: '1rem', borderBottom: '1px solid #eee' }}>
          <nav style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
            <a href="/">Home</a>
            <a href="/pricing">Pricing</a>
            {sessionUser ? (
              <>
                <a href="/admin/plans">Admin</a>
                <span style={{ marginLeft: 'auto' }}>{sessionUser.email}</span>
                <SignOutButton label="Sign out" />
              </>
            ) : (
              <div style={{ marginLeft: 'auto' }}>
                <GoogleSignInButton label="Sign in" />
              </div>
            )}
          </nav>
        </header>
        <main style={{ padding: '1rem' }}>{children}</main>
      </body>
    </html>
  );
}
