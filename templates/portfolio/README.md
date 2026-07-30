# portfolio template

MDX portfolio + Google-OAuth guestbook. **No payment, no Turnstile.**

## Stack
- Next.js 14 (App Router, with `@next/mdx`)
- Supabase (Postgres + Auth)
- MDX content stored in DB (not file-based)

## What this template deliberately omits
- **No Toss code** — there is no payment surface. Per PRD non-goal #2.
- **No Turnstile** — the guestbook is gated by Google OAuth, not a captcha.
  Per PRD non-goal #2 + the dead-code prohibition (Iron Law #4).
- **No email/password fields** — Google OAuth is the single sign-in path.
  Per PRD non-goal #1.
- **No Cloudflare WAF** — no payment surface, no bot-protection needs. Per
  PRD non-goal #2 + `cloudflare-rules.json` (step 5) ships only with
  saas + shop.

## Local setup
1. `cp .env.example .env.local` and fill in `NEXT_PUBLIC_SUPABASE_URL` +
   `NEXT_PUBLIC_SUPABASE_ANON_KEY` (+ `SUPABASE_SERVICE_ROLE_KEY` for admin
   reads via service-role).
2. `pnpm install && pnpm dev`

## Supabase setup
1. `supabase link --project-ref <YOUR_REF>`
2. `supabase db push` — applies `supabase/migrations/0001_init.sql` and
   the `portfolio_items` + `guestbook_entries` schema with RLS.

## Deployment (Vercel or Cloudflare Pages)
Both Vercel and Cloudflare Pages are supported deployment targets for this
template. Set the Supabase env vars (`NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`) in the
deploy dashboard under Environment Variables. See
`templates/_shared/.env.example` for the canonical list. No Turnstile or
Cloudflare WAF keys are required.

## MDX content
Portfolio items are stored in the `portfolio_items` table. The `content_mdx`
column is compiled server-side via `compileMDX` from `next-mdx-remote/rsc` on
each request. There is no file-based content.

## Guestbook
The guestbook inserts into `guestbook_entries` with `user_id = auth.uid()`.
RLS enforces:
- Anyone can read.
- Authenticated users can insert their own (`auth.uid() = user_id`).
- Users can delete their own; admin role can delete any.

The `<GuestbookForm>` has only a textarea + submit button. Sign-in is the
shared `GoogleSignInButton`.
