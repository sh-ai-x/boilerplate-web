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
3. `supabase db push` — applies `supabase/migrations/0001_init.sql` and
   `supabase/migrations/0002_audit_log.sql` in lexicographic order.
4. `supabase functions deploy billing` — deploys the Edge Function.
5. `pnpm install && pnpm dev` — Next.js dev server on :3000.

## Supabase setup
After `supabase link`, run `supabase db push` to create the `plans`,
`subscriptions`, and `audit_log` tables + RLS policies. The migration
files do NOT seed any starter plans; add plans from the admin UI at
`/admin/plans` once Supabase Auth has an admin user.

The first admin user is created manually:
```sql
update auth.users set raw_app_meta_data = raw_app_meta_data || '{"role":"admin"}'::jsonb
where email = 'you@example.com';
```

The admin role is read by RLS policies through the SECURITY DEFINER
helper `auth.app_role()` (declared in `0002_audit_log.sql`), which
reads `auth.jwt() -> 'app_metadata' ->> 'role'`. The top-level
`auth.jwt() ->> 'role'` is the PostgREST role and is NOT used for
admin gating.

## Cloudflare Turnstile
- Create a site key + secret key at <https://dash.cloudflare.com/?to=/:account/turnstile>.
- Put the site key in `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, the secret in `TURNSTILE_SECRET_KEY`.

## Toss billing-key
- Get `TOSS_SECRET_KEY` from the Toss Payments dashboard. The Toss API
  authenticates with HTTP Basic auth `Basic base64(secretKey:)` — note
  the trailing colon — so only the secret key is required.
- For each plan, copy the Toss-side plan key into the
  `plans.external_plan_key` column. The column is nullable; the
  billing Edge Function rejects requests with `plan_missing_external_key`
  before any Toss call if it is null/empty.
- The Edge Function does the `billing/authorizations/issue` confirm and stores
  the resulting `billing_key` in `subscriptions.billing_key`.

## Architecture invariants
- **No Toss code in `app/` or `components/`.** The Edge Function is the only
  Toss call site. This is enforced by `grep -r toss app/ components/` in CI.
- **No client-supplied amount.** The pricing page sends `{ plan_id,
  customer_key, turnstile_token }` only; price is fetched from `plans` in
  the Edge Function.
- **Admin pages are server-gated** by `auth.app_role() = 'admin'`.

## Dependency reproducibility (A03)
This package is a member of the pnpm workspace. Its dependency versions are
pinned by the committed workspace-root `pnpm-lock.yaml`; pnpm does not emit a
per-package lockfile inside a workspace. CI installs with
`pnpm install --frozen-lockfile`, so builds are byte-for-byte reproducible.
When the template is scaffolded standalone, run `pnpm install` once to
generate a project-local `pnpm-lock.yaml` and commit it.
