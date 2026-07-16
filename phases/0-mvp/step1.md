# Step 1: Shared infra — env templates, Supabase client wrapper, Google-OAuth-only auth UI, Turnstile component

## Status
**pending** — last update: 2026-07-16T00:00:00Z

## Read first
- `/PRD.md`
- `.prd/decision-log.md` (non-goals §1)
- `phases/0-mvp/step0.md`

## Task

All 3 templates import from `templates/_shared/`. Files to create:

- `templates/_shared/package.json` — name `@boilerplate-web/shared`, exports `./supabase`, `./auth`, `./components`, `./env`.
- `templates/_shared/supabase/client.ts` — typed `createBrowserClient` + `createServerClient` factories reading from `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Service-role client (`createServiceClient`) reads `SUPABASE_SERVICE_ROLE_KEY` and is server-only.
- `templates/_shared/auth/GoogleSignInButton.tsx` — single button: onClick → `supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: <window.location.origin>/auth/callback } })`. NO email input. NO password input. NO magic-link input. NO "continue with email" link.
- `templates/_shared/auth/SignOutButton.tsx` — `supabase.auth.signOut()`.
- `templates/_shared/auth/callback/route.ts` — exchanges code for session, redirects to `next` query param.
- `templates/_shared/components/Turnstile.tsx` — wraps Cloudflare's `<div class="cf-turnstile">`; props: `siteKey: string`, `onVerify: (token: string) => void`. Renders nothing if `siteKey` is empty (dev-mode escape hatch, with a console.warn).
- `templates/_shared/.env.example` — `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_TURNSTILE_SITE_KEY` (saas + shop only — documented inline).
- `templates/_shared/vitest.config.ts` + `templates/_shared/tests/auth.test.tsx` (asserts GoogleSignInButton renders no input element of `type="email"` or `type="password"`) + `templates/_shared/tests/turnstile.test.tsx` (asserts Turnstile renders when siteKey is provided, renders nothing when siteKey is empty).

Non-negotiable rules:
- Google-OAuth is the ONLY sign-in path. No email, no password, no magic link.
- Turnstile component is shared but ONLY used by saas + shop; portfolio must NOT import it.
- `_shared` MUST NOT import any Toss code (payment is template-specific).

## Acceptance Criteria
```bash
# AC1: no email/password input in shared auth UI
grep -rE 'type="(email|password)"' templates/_shared/auth/ && exit 1
# AC2: GoogleSignInButton is the only sign-in affordance
grep -rE 'signInWith(OAuth|Email|MagicLink)' templates/_shared/auth/ | grep -v 'signInWithOAuth' && exit 1
# AC3: shared package builds
pnpm --filter @boilerplate-web/shared build && echo "AC3 ok"
# AC4: shared tests pass
pnpm --filter @boilerplate-web/shared test 2>&1 | tail -5
# AC5: portfolio template does NOT import Turnstile (verified after step 4 — run now as a forward-check)
grep -r 'Turnstile' templates/portfolio/ 2>/dev/null && exit 1 || echo "AC5 ok (portfolio not yet built)"
# AC6: .env.example lists all four keys
grep -E 'NEXT_PUBLIC_SUPABASE_URL|NEXT_PUBLIC_SUPABASE_ANON_KEY|SUPABASE_SERVICE_ROLE_KEY|NEXT_PUBLIC_TURNSTILE_SITE_KEY' templates/_shared/.env.example | wc -l | grep -q '^4$'
```

## Verification & Status Update (REQUIRED before claiming done)
1. Run AC1–AC6. Quote exit codes.
2. Update `phases/0-mvp/index.json` step 1 → `completed`/`error`/`blocked`.
3. Emit the two HTML-comment markers as the last two lines.

## Don't
- Don't add a "continue with email" fallback or any non-Google sign-in affordance — Gate 3 non-goal #1.
- Don't import Toss code into `_shared`.
- Don't hardcode Turnstile secret-key in the component (server-side verification is in Edge Functions).
- Don't edit root `CLAUDE.md` or files outside `templates/_shared/`.