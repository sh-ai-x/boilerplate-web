# Step 3: shop template — products/orders schema (pgsodium TDE), admin pricing UI, Toss single-payment Edge Function

## Status
**pending** — last update: 2026-07-16T00:00:00Z

## Read first
- `/PRD.md`
- `.prd/decision-log.md`
- `phases/0-mvp/step0.md`
- `phases/0-mvp/step1.md`
- `phases/0-mvp/step2.md`
- `templates/_shared/`
- `templates/saas/` (cross-template consistency reference)

## Task

Directory: `templates/shop/`.

- `templates/shop/package.json` — same structure as saas; depends on `@boilerplate-web/shared`.
- `templates/shop/supabase/migrations/0001_init.sql`:
  - `products (id uuid pk, name text, description text, price_cents int not null check (price_cents > 0), stock int not null default 0, created_at timestamptz default now())`
  - `orders (id uuid pk, user_id uuid references auth.users(id), product_id uuid references products(id), amount_cents int not null, status text not null check (status in ('pending','paid','shipped','cancelled','refunded')), toss_payment_key text unique, created_at timestamptz default now())`
  - `shipping_addresses (order_id uuid pk references orders(id), encrypted_phone bytea not null, encrypted_address bytea not null, created_at timestamptz default now())` — **phone and address are `bytea`**, encrypted via `pgsodium.crypto_aead_det_encrypt`.
  - Key management: `shipping_keys` table holds the per-row key id; key access is via service-role client in Edge Function only.
  - RLS: `products` readable by all; writable by admin role. `orders` readable by `auth.uid() = user_id`; admin can read all. `shipping_addresses` readable by `auth.uid()` matching the order's `user_id` OR admin role; **no other role can read the encrypted blob.**
- `templates/shop/supabase/functions/toss-pay/index.ts`:
  - Body: `{ product_id, shipping_phone, shipping_address, turnstile_token }`. **MUST NOT accept `amount` / `price`.**
  - Verifies Turnstile token.
  - Fetches `price_cents` from DB.
  - Encrypts `shipping_phone` and `shipping_address` via `pgsodium.crypto_aead_det_encrypt` (server-side, in the function via service-role RPC).
  - Calls Toss single-payment confirm API with DB-fetched amount.
  - Inserts `orders` row + `shipping_addresses` row with encrypted blobs.
  - Decrements `products.stock` by 1.
- `templates/shop/app/admin/products/page.tsx` — admin-only; CRUD products (name, price_cents, stock).
- `templates/shop/app/products/[id]/page.tsx` — product detail; "Buy" button triggers Turnstile → Edge Function call.
- `templates/shop/tests/edge-fn.test.ts` — asserts:
  - client-supplied `amount` ignored.
  - shipping columns are written as `bytea`, not `text`.
  - missing Turnstile token → 400.

Non-negotiable rules:
- `shipping_phone` and `shipping_address` are `bytea` columns, encrypted by `pgsodium`. Plaintext must never be written.
- Toss confirm runs ONLY in the Edge Function.
- `price_cents` from DB only.

## Acceptance Criteria
```bash
# AC1: shop template builds
pnpm --filter shop build && echo "AC1 ok"
# AC2: shipping columns are bytea (NOT text)
grep -E 'encrypted_(phone|address)\s+(bytea|text)' templates/shop/supabase/migrations/0001_init.sql | grep -v 'bytea' && exit 1
# AC3: pgsodium encryption function called in Edge Function
grep -E 'pgsodium\.crypto_aead_det_encrypt' templates/shop/supabase/functions/toss-pay/index.ts
# AC4: Edge Function ignores client-supplied amount
grep -E 'amount|price' templates/shop/supabase/functions/toss-pay/index.ts | grep -E 'req\.body|request\.json|body\.' && exit 1
# AC5: no Toss code in Next.js app/ routes
grep -rE 'toss|TossPayments' templates/shop/app/ 2>/dev/null && exit 1
# AC6: shop tests pass
pnpm --filter shop test 2>&1 | tail -10
```

## Verification & Status Update (REQUIRED before claiming done)
1. Run AC1–AC6. Quote exit codes.
2. Update `phases/0-mvp/index.json` step 3 → `completed`/`error`/`blocked`.
3. Emit the two HTML-comment markers as the last two lines.

## Don't
- Don't store phone/address as `text` columns — must be `bytea` encrypted via `pgsodium`.
- Don't accept `amount` / `price` from the Edge Function body.
- Don't decrypt shipping data on the client — decryption only via service-role in admin views.
- Don't edit files outside `templates/shop/` and `phases/0-mvp/`.