// A07/F6: OAuth / magic-link callback route.
//
// When a user clicks the GoogleSignInButton in app/layout.tsx, Supabase
// redirects them to the configured Site URL with a `?code=...` query
// parameter. This route is the exchange point: it calls
// `supabase.auth.exchangeCodeForSession(code)`, which:
//   1. POSTs the code to Supabase auth.
//   2. Receives the user's session tokens.
//   3. Writes the auth cookies to the response via the @supabase/ssr
//      cookie handlers (`set` / `remove`) — the same handlers the
//      layout / admin page use to read the session.
//
// Without this route, the OAuth flow is a dead end: the user lands on
// /auth/callback, the code never gets exchanged, no cookie is written,
// every subsequent auth.getUser() returns null, and the user sees the
// logged-out nav even after a successful OAuth.
//
// Returns:
//   302 -> `${origin}${next}`              on success
//   302 -> `${origin}/auth/auth-code-error` on missing code OR exchange error
//
// Reference: https://supabase.com/docs/guides/auth/server-side/nextjs
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';

export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  // `next` is the post-login destination. Caller-supplied input must be
  // constrained to a relative path; an attacker-controlled absolute URL
  // here would enable open-redirect. Only allow same-origin paths
  // starting with a single `/` (and not the protocol-relative `//`).
  const rawNext = url.searchParams.get('next') ?? '/';
  const next =
    rawNext.startsWith('/') && !rawNext.startsWith('//') ? rawNext : '/';

  if (!code) {
    return NextResponse.redirect(`${url.origin}/auth/auth-code-error`);
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnon) {
    // A14: a fresh deploy without env cannot exchange codes. Redirect to
    // the error page rather than crashing the route handler.
    return NextResponse.redirect(`${url.origin}/auth/auth-code-error`);
  }

  const cookieStore = cookies();
  const supabase = createServerClient(supabaseUrl, supabaseAnon, {
    cookies: {
      get(name: string) {
        return cookieStore.get(name)?.value;
      },
      set(name: string, value: string, options: CookieOptions) {
        try {
          cookieStore.set({ name, value, ...options });
        } catch (_err) {
          // Route Handlers CAN set cookies, but the runtime can still
          // reject writes if the request is already streaming a response.
          // Non-fatal — the user just won't have a session this round.
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

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(`${url.origin}/auth/auth-code-error`);
  }
  return NextResponse.redirect(`${url.origin}${next}`);
}
