# saas template

Subscription-billing SaaS built on the `@boilerplate-web/shared` infra.

## Stack
- Next.js 14 (App Router)
- Supabase (Postgres + Auth + Edge Functions)
- Cloudflare Turnstile (bot protection on the pricing page)
- Toss Payments (billing-key for recurring subscriptions)

## Local setup
1. `cp .env.example .env.local` and fill in the values.
2. `supabase link --project-ref <YOUR_REF>`
3. `supabase db push` — applies `supabase/migrations/0001_init.sql`.
4. `supabase functions deploy billing` — deploys the Edge Function.
5. `pnpm install && pnpm dev` — Next.js dev server on :3000.

## Supabase setup
After `supabase link`, run `supabase db push` to create the `plans`,
`subscriptions`, and `audit_log` tables + RLS policies. There is no seed
data — create your subscription tiers from the `/admin/plans` page (they are
written via `upsert_plan_with_audit`) once the first admin user exists.

The first admin user is created manually:
```sql
update auth.users set raw_app_meta_data = raw_app_meta_data || '{"role":"admin"}'::jsonb
where email = 'you@example.com';
```

## Cloudflare Turnstile
- Create a site key + secret key at <https://dash.cloudflare.com/?to=/:account/turnstile>.
- Put the site key in `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, the secret in `TURNSTILE_SECRET_KEY`.

## Toss billing-key
- Get `TOSS_SECRET_KEY` from the Toss Payments dashboard. The Edge Function
  uses it as the HTTP Basic credential — `base64(TOSS_SECRET_KEY + ":")`.
- The per-request `auth_key` is the single-use card-auth token the client
  obtains from the Toss widget and sends in the request body; it is not an
  environment variable.
- For each plan, copy the Toss-side plan key into the `plans.external_plan_key`
  column.
- The Edge Function does the `billing/authorizations/issue` confirm and stores
  the resulting `billing_key` in `subscriptions.billing_key`.

## Architecture invariants
- **No Toss code in `app/` or `components/`.** The Edge Function is the only
  Toss call site. This is enforced by `grep -r toss app/ components/` in CI.
- **No client-supplied amount.** The pricing page sends `{ plan_id,
  customer_key, turnstile_token }` only; price is fetched from `plans` in
  the Edge Function.
- **Admin pages are server-gated** by `auth.app_role() = 'admin'` (defined in
  `0002_audit_log.sql`, reading `app_metadata.role` — the same claim the
  admin-setup SQL above writes to `raw_app_meta_data`).

## Dependency reproducibility (A03)
This package is a member of the pnpm workspace. Its dependency versions are
pinned by the committed workspace-root `pnpm-lock.yaml`; pnpm does not emit a
per-package lockfile inside a workspace. CI installs with
`pnpm install --frozen-lockfile`, so builds are byte-for-byte reproducible.
When the template is scaffolded standalone, run `pnpm install` once to
generate a project-local `pnpm-lock.yaml` and commit it.
# 2026-07-22T21:57:16+09:00 CI retrigger for fresh security evaluation
