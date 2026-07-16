import type { ReactNode } from 'react';
import { GoogleSignInButton, SignOutButton } from '@boilerplate-web/shared/auth';
import { createServerSupabase } from '@boilerplate-web/shared/supabase';
import { cookies } from 'next/headers';

export const metadata = { title: 'Portfolio', description: 'A MDX portfolio with a Google-OAuth guestbook' };

export default async function RootLayout({ children }: { children: ReactNode }) {
  let sessionEmail: string | null = null;
  try {
    const c = cookies();
    const s = createServerSupabase({ get: (n) => c.get(n), set: (n, v, o) => c.set(n, v, o as never) });
    const { data } = await s.auth.getUser();
    sessionEmail = data.user?.email ?? null;
  } catch (_) {}
  return (
    <html lang="en">
      <body>
        <header style={{ padding: '1rem', borderBottom: '1px solid #eee' }}>
          <nav style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
            <a href="/">Home</a>
            <a href="/portfolio">Portfolio</a>
            <a href="/guestbook">Guestbook</a>
            {sessionEmail ? (
              <>
                <span style={{ marginLeft: 'auto' }}>{sessionEmail}</span>
                <SignOutButton label="Sign out" />
              </>
            ) : (
              <div style={{ marginLeft: 'auto' }}><GoogleSignInButton label="Sign in" /></div>
            )}
          </nav>
        </header>
        <main style={{ padding: '1rem' }}>{children}</main>
      </body>
    </html>
  );
}
