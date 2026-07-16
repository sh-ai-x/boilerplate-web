# Step 2: saas template — plans/subscriptions schema, admin pricing UI, Toss billing-key Edge Function

## Status
**pending** — last update: 2026-07-16T00:00:00Z

## Read first
- `/PRD.md`
- `.prd/decision-log.md`
- `phases/0-mvp/step0.md`
- `phases/0-mvp/step1.md`
- `templates/_shared/` (built in step 1)

## Task

Directory: `templates/saas/`.

- `templates/saas/package.json` — depends on `@boilerplate-web/shared` (workspace:*), `@supabase/supabase-js`, `next`, `react`. Scripts: `dev`, `build`, `test`, `lint`.
- `templates/saas/supabase/migrations/0001_init.sql`:
  - `plans (id uuid pk, name text unique, price_cents int not null check (price_cents > 0), interval text not null check (interval in ('month','year')), toss_plan_key text, created_at timestamptz default now())`
  - `subscriptions (id uuid pk, user_id uuid references auth.users(id), plan_id uuid references plans(id), billing_key text, status text not null check (status in ('active','cancelled','past_due')), next_bill_at timestamptz, created_at timestamptz default now())`
  - `payments (id uuid pk, user_id uuid references auth.users(id), plan_id uuid references plans(id), amount_cents int not null, toss_payment_key text unique, created_at timestamptz default now())`
  - RLS: `plans` readable by all authenticated users; `plans` writable only by users with `auth.jwt() ->> 'role' = 'admin'` (custom claim). `subscriptions`/`payments` readable by `auth.uid() = user_id`; admin role can read all.
- `templates/saas/supabase/functions/toss-billing/index.ts`:
  - Reads request body: `{ plan_id: string, customer_key: string, turnstile_token: string }`. **MUST NOT accept `amount` or `price` from the body.**
  - Verifies Turnstile token by POSTing to `https://challenges.cloudflare.com/turnstile/v0/siteverify` with `TURNSTILE_SECRET_KEY`.
  - Fetches `price_cents` and `toss_plan_key` from DB via service-role client: `SELECT price_cents, toss_plan_key FROM plans WHERE id = $1`.
  - If plan not found → 400.
  - Calls Toss Payments `confirm` API with the DB-fetched amount and `customer_key`. On success, stores `billing_key` in `subscriptions`.
  - Returns `{ ok: true, subscription_id }`.
- `templates/saas/app/admin/plans/page.tsx` — server component; lists plans; form to create/update plan (name, price_cents, interval, toss_plan_key). Server action writes to DB with service-role client. Page requires `role = 'admin'` (redirect if not).
- `templates/saas/app/pricing/page.tsx` — fetches plans from DB (NOT from any client-side config), renders pricing cards, "Subscribe" button triggers Turnstile → Edge Function call.
- `templates/saas/tests/edge-fn.test.ts` — uses `supabase-functions-test` (or equivalent) to assert:
  - request with `{ plan_id: 'X', amount: 1 }` → 400 (client-supplied amount ignored).
  - request with valid plan_id, valid Turnstile token, no customer_key → 400.
  - request with valid plan_id, valid Turnstile, valid customer_key, but DB returns no plan → 400.

Non-negotiable rules:
- Toss confirm + billing-key issuance runs ONLY in the Edge Function. NO Next.js API route, NO server action, NO client-side fetch to Toss.
- `price_cents` is fetched from DB inside the Edge Function. Client-supplied `amount`/`price` MUST be ignored even if present.
- Admin page requires server-side role check; no client-side gate.

## Acceptance Criteria
```bash
# AC1: saas template builds
pnpm --filter saas build && echo "AC1 ok"
# AC2: no Toss code in Next.js app/ routes (only in supabase/functions/)
grep -rE 'toss|TossPayments|tossPayments' templates/saas/app/ templates/saas/components/ 2>/dev/null && exit 1
# AC3: Edge Function ignores client-supplied amount
grep -E 'amount|price' templates/saas/supabase/functions/toss-billing/index.ts | grep -E 'req\.body|request\.json|body\.' && exit 1
# AC4: Edge Function fetches price from DB
grep -E 'SELECT.*price_cents.*FROM plans' templates/saas/supabase/functions/toss-billing/index.ts
# AC5: saas tests pass
pnpm --filter saas test 2>&1 | tail -10
# AC6: migration applies cleanly (use a throwaway local Postgres or `supabase db reset` in CI)
supabase db reset --linked 2>&1 | tail -5 || echo "AC6 skipped — local Supabase not linked; CI will run"
```

## Verification & Status Update (REQUIRED before claiming done)
1. Run AC1–AC6. Quote exit codes.
2. Update `phases/0-mvp/index.json` step 2 → `completed`/`error`/`blocked`.
3. Emit the two HTML-comment markers as the last two lines.

## Don't
- Don't accept `amount` / `price` / `plan_price` from the Edge Function request body.
- Don't implement Toss confirm logic in `app/api/*` or in a server action.
- Don't gate the admin page on a client-side `if (role === 'admin')` — gate must be server-side.
- Don't edit files outside `templates/saas/` and `phases/0-mvp/`.