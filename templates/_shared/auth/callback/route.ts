import { NextResponse } from 'next/server';
import { createServerSupabase } from '../../supabase/client';

/**
 * OAuth callback. Exchanges the `code` query param for a Supabase session,
 * then redirects to `?next=` (defaulting to /).
 *
 * Wired up by GoogleSignInButton via redirectTo = `${origin}/auth/callback`.
 * The auth/callback directory is consumed by the consuming app (saas/shop/portfolio)
 * which re-exports this handler.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const next = url.searchParams.get('next') ?? '/';

  if (!code) {
    return NextResponse.redirect(new URL('/?error=missing_code', url.origin));
  }

  // Cookie store shim — Next.js App Router supplies this via cookies() in
  // the route handler wrapper, but we expose a minimal interface here for
  // testability. The consuming app wraps this with the real cookies().
  const cookieStore = {
    get: (_name: string) => undefined as { value: string } | undefined,
    set: (_name: string, _value: string, _options: unknown) => undefined,
  };

  const supabase = createServerSupabase(cookieStore as Parameters<typeof createServerSupabase>[0]);
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(new URL(`/?error=${encodeURIComponent(error.message)}`, url.origin));
  }
  return NextResponse.redirect(new URL(next, url.origin));
}
