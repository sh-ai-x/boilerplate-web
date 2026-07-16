# saas template

Subscription-billing SaaS built on the `@boilerplate-web/shared` infra. The
Toss billing-key flow is the only payment path; the Edge Function fetches
the price from the `plans` table and ignores any client-supplied amount.

## Prerequisites

- **Supabase project** — create one at <https://supabase.com>. You'll need
  the project ref + the service-role key (server-side only).
- **Google OAuth client** — create a Web application OAuth client at
  <https://console.cloud.google.com/apis/credentials>. Authorized redirect
  URI: `https://YOUR_PROJECT.supabase.co/auth/v1/callback`.
- **Cloudflare account** — for the Turnstile widget and the WAF rules in
  `/cloudflare-rules.json`. Create a Turnstile widget at
  <https://dash.cloudflare.com/?to=/:account/turnstile>.
- **Toss Payments account** — get `TOSS_SECRET_KEY` and `TOSS_AUTH_KEY` from
  the Toss dashboard. Create a plan (or three) in Toss and note the
  `toss_plan_key` for each.
- **Vercel or Cloudflare Pages** — for the Next.js deployment.

## Supabase setup

```bash
supabase link --project-ref YOUR_REF
supabase db push                  # creates plans / subscriptions / payments + RLS
supabase functions deploy billing # deploys the Edge Function (canonical name: toss-billing)
```

Then promote the first admin user:

```bash
psql $SUPABASE_DB_URL -c \
  "update auth.users set raw_app_meta_data = raw_app_meta_data || '{\"role\":\"admin\"}'::jsonb where email = 'you@example.com';"
```

## Local dev

```bash
pnpm install
cp .env.example .env.local
# fill in NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
# SUPABASE_SERVICE_ROLE_KEY, NEXT_PUBLIC_TURNSTILE_SITE_KEY,
# TURNSTILE_SECRET_KEY, TOSS_SECRET_KEY, TOSS_AUTH_KEY
pnpm dev      # http://localhost:3000
pnpm test     # vitest, 5 tests
pnpm build    # next build (4 dynamic routes)
```

## Deployment (Vercel or Cloudflare Pages)

### Vercel

1. Push to a fresh GitHub repo.
2. Import in Vercel.
3. Set the env vars in the Vercel project settings (Production + Preview).
4. Vercel auto-detects Next.js. Deploy.

### Cloudflare Pages

1. Push to a fresh GitHub repo.
2. Import in Cloudflare Pages. Build: `pnpm build`. Output: `.next`.
3. Add the env vars.
4. Import `/cloudflare-rules.json` into the same zone for WAF.

## Architecture invariants

- **No Toss code in `app/` or `components/`.** The Edge Function is the only
  Toss call site. CI enforces this with `grep -rE 'toss|TossPayments' app/
  components/`.
- **No client-supplied amount.** The pricing page sends
  `{ plan_id, customer_key, turnstile_token }` only. Price is fetched from
  the `plans` table inside the Edge Function.
- **Admin pages are server-gated** by `auth.jwt() ->> 'role' = 'admin'`.
  The RLS policy `plans_admin_write` enforces this at the DB level too.
