# shop template

Single-payment e-commerce built on the `@boilerplate-web/shared` infra. The
Toss single-payment flow is the only payment path; the Edge Function fetches
the price from the `products` table and ignores any client-supplied amount.
Shipping phone + address are encrypted server-side via
`pgsodium.crypto_aead_det_encrypt` and stored as `bytea`.

## Prerequisites

- **Supabase project** — for the database + Edge Functions. The `pgcrypto`
  and `pgsodium` extensions must be enabled (the migration does this).
- **Google OAuth client** — Web application type; authorized redirect URI:
  `https://YOUR_PROJECT.supabase.co/auth/v1/callback`.
- **Cloudflare account** — for Turnstile (gates the BuyButton) and WAF.
- **Toss Payments account** — for single-payment confirm.
- **Vercel or Cloudflare Pages** — for the Next.js deployment.

## Supabase setup

```bash
supabase link --project-ref YOUR_REF
supabase db push                     # creates products / orders / shipping_addresses / shipping_keys + RLS
psql -f supabase/sql/encrypt-fn.sql  # installs the encrypt_shipping RPC
supabase functions deploy toss-pay   # deploys the Edge Function
```

Then promote the first admin user (same as saas).

## Local dev

```bash
pnpm install
cp .env.example .env.local  # fill in 6 env keys
pnpm dev      # http://localhost:3000
pnpm test     # vitest, 5 tests
pnpm build    # next build (4 dynamic routes)
```

## pgsodium key rotation

The `shipping_keys` table holds one row per encrypted shipping blob. To
rotate (e.g. after a suspected compromise), re-encrypt all rows:

```sql
begin;
update public.shipping_keys
  set revoked_at = now()
  where id in (select shipping_key_id from public.shipping_addresses);
-- (service-role re-encryption in a single Edge Function call, not shown here)
commit;
```

The admin `orders/[id]` page (if you build one) reads `shipping_addresses`
with the service-role client and decrypts via
`pgsodium.crypto_aead_det_decrypt`.

## Deployment (Vercel or Cloudflare Pages)

### Vercel

1. Push to a fresh GitHub repo.
2. Import in Vercel. Add the 6 env vars in project settings.
3. Deploy. Vercel auto-detects Next.js.

### Cloudflare Pages

1. Push to a fresh GitHub repo.
2. Import in Cloudflare Pages. Build: `pnpm build`. Output: `.next`.
3. Add the 6 env vars. Import `/cloudflare-rules.json` into the same zone.

## Architecture invariants

- **No Toss code in `app/`.** The Edge Function is the only Toss call site.
- **No client-supplied amount.** The BuyButton sends
  `{ product_id, shipping_phone, shipping_address, turnstile_token }` only.
- **Shipping is `bytea`, not `text`.** Encryption via `pgsodium` happens
  server-side in the Edge Function before insert. Plaintext never touches
  disk.
