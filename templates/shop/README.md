# shop template

Single-payment e-commerce built on the `@boilerplate-web/shared` infra.

## Stack
- Next.js 14 (App Router)
- Supabase (Postgres + Auth + Edge Functions)
- Cloudflare Turnstile (bot protection on Buy)
- Toss Payments (single-payment confirm)
- pgsodium TDE (encrypted shipping address + phone)

## Local setup
1. `cp .env.example .env.local` and fill in the values.
2. `supabase link --project-ref <YOUR_REF>`
3. `supabase db push` — applies `supabase/migrations/0001_init.sql`.
4. `psql -f supabase/sql/encrypt-fn.sql` — installs the `encrypt_shipping` RPC.
5. `supabase functions deploy toss-pay` — deploys the Edge Function.
6. `pnpm install && pnpm dev` — Next.js dev server on :3000.

## Supabase setup
Run `supabase db push` to create `products`, `orders`, `shipping_addresses`,
`shipping_keys`, and the RLS policies. Shipping phone + address are `bytea`
columns, encrypted via `pgsodium.crypto_aead_det_encrypt` server-side. The
plaintext never touches disk; the DB only stores the encrypted blob + the
per-row key id.

The `encrypt_shipping` RPC must be installed (in `supabase/sql/encrypt-fn.sql`):
```sql
create or replace function encrypt_shipping(key_id uuid, plaintext text)
returns text language sql security definer as $$
  select encode(pgsodium.crypto_aead_det_encrypt(plaintext::bytea, ''::bytea, key_id), 'base64');
$$;
```

## Cloudflare Turnstile
- Create a site key + secret key at <https://dash.cloudflare.com/?to=/:account/turnstile>.
- `NEXT_PUBLIC_TURNSTILE_SITE_KEY` + `TURNSTILE_SECRET_KEY`.

## Toss single-payment
- `TOSS_SECRET_KEY` from the Toss Payments dashboard.
- The Edge Function does the single-payment confirm. The amount comes from
  `products.price_cents` (DB), never from the request body.

## Deployment (Vercel or Cloudflare Pages)
Both Vercel and Cloudflare Pages are supported deployment targets for this
template. Set the required env vars (`NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
`NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`, `TOSS_SECRET_KEY`)
in the deploy dashboard under Environment Variables. See
`templates/_shared/.env.example` for the canonical list. The Cloudflare WAF
rules (`cloudflare-rules.json` from step 5) are recommended for production.

## Architecture invariants
- **No Toss code in `app/`.** The Edge Function is the only Toss call site.
  This is enforced by `grep -r toss app/` in CI.
- **No client-supplied amount.** The BuyButton sends `{ product_id,
  shipping_phone, shipping_address, turnstile_token }` only.
- **Shipping is `bytea`, not `text`.** Encryption via `pgsodium` happens
  server-side in the Edge Function before insert.
