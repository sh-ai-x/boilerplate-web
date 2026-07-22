import type { ReactNode } from 'react';
import { GoogleSignInButton, SignOutButton } from '@boilerplate-web/shared/auth';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';

export const metadata = {
  title: 'SaaS Boilerplate',
  description: 'Next.js + Supabase + Toss billing-key boilerplate',
};

// A13: only the "env not configured" case may be swallowed to a logged-out
// render. Any other error (a real auth/session failure) must surface via
// console.error so operational problems are not masked as "logged out".
function isMissingEnvError(err: unknown): boolean {
  return (
    err instanceof Error &&
    /Missing required env|supabaseUrl is required|supabaseKey is required/.test(err.message)
  );
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  // A13: the previous code called the shared bare-client helper, which built a
  // @supabase/supabase-js client that never installed the supplied cookie
  // store as auth storage — so auth.getUser() could not read the request
  // session and every page rendered the logged-out nav (the Admin link never
  // appeared for real signed-in admins). Use the same cookie-backed
  // @supabase/ssr createServerClient the admin page uses so the auth cookie
  // actually reaches Supabase auth.
  let sessionUser: { email?: string | null } | null = null;
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anon) {
      throw new Error('Missing required env: NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY');
    }
    const cookieStore = cookies();
    const supabase = createServerClient(url, anon, {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          try {
            cookieStore.set({ name, value, ...options });
          } catch (_err) {
            // Server Components cannot set cookies; non-fatal for a read-only
            // session check.
          }
        },
        remove(name: string, options: CookieOptions) {
          try {
            cookieStore.set({ name, value: '', ...options });
          } catch (_err) {
            // See note above.
          }
        },
      },
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
