# portfolio template

MDX portfolio + Google-OAuth guestbook. **No payment, no Turnstile, no
Cloudflare WAF required.**

## Prerequisites

- **Supabase project** — for the database + Auth.
- **Google OAuth client** — Web application type; authorized redirect URI:
  `https://YOUR_PROJECT.supabase.co/auth/v1/callback`.
- **Vercel or Cloudflare Pages** — for the Next.js deployment.

You do **not** need:
- Toss Payments (no payment surface).
- Cloudflare WAF (the only public write path is the guestbook, gated by
  Google OAuth at the DB level via RLS).

## Supabase setup

```bash
supabase link --project-ref YOUR_REF
supabase db push  # creates portfolio_items + guestbook_entries + RLS
```

## Local dev

```bash
pnpm install
cp .env.example .env.local  # only NEXT_PUBLIC_SUPABASE_URL + ANON_KEY are required
pnpm dev      # http://localhost:3000
pnpm test     # vitest, 6 tests
pnpm build    # next build (6 dynamic routes)
```

## Deployment (Vercel or Cloudflare Pages)

### Vercel

1. Push to a fresh GitHub repo.
2. Import in Vercel. Add the env vars.
3. Deploy. Vercel auto-detects Next.js.

### Cloudflare Pages

1. Push to a fresh GitHub repo.
2. Import in Cloudflare Pages. Build: `pnpm build`. Output: `.next`.
3. Add the env vars. No WAF rules needed.

## MDX content

Portfolio items live in the `portfolio_items` table. The `content_mdx`
column is compiled server-side via `compileMDX` from
`next-mdx-remote/rsc` on each request. There is no file-based content.

## Guestbook

- `guestbook_entries` allows insert for authenticated users only
  (`auth.uid() = user_id`).
- Length is enforced at the DB level: `length(message) <= 1000`.
- Users can delete their own; admin role can delete any.

## Architecture invariants

- **No Toss code** (L4 dead-code prohibition + PRD non-goal #2).
- **No Turnstile** (no captcha surface).
- **No email/password** (PRD non-goal #1; Google OAuth is the only path).
