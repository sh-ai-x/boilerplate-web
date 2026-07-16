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

## Local setup
1. `cp .env.example .env.local` and fill in `NEXT_PUBLIC_SUPABASE_URL` +
   `NEXT_PUBLIC_SUPABASE_ANON_KEY` (+ `SUPABASE_SERVICE_ROLE_KEY` for admin
   reads via service-role).
2. `supabase link --project-ref <YOUR_REF>`
3. `supabase db push` — applies `supabase/migrations/0001_init.sql`.
4. `pnpm install && pnpm dev`

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
