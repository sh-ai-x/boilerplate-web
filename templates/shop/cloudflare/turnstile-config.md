# Cloudflare Turnstile — shop template (toss-pay)

This template uses Cloudflare Turnstile to gate the **toss-pay** Edge
Function (deployed at `/functions/v1/toss-pay`). The widget renders on the
product detail page; the secret-key verification runs server-side inside the
**toss-pay** Edge Function.

## 1. Create a Turnstile widget

1. Cloudflare dashboard → **Turnstile** → **Add widget**.
2. Choose **Managed** challenge type (recommended).
3. Copy the **Site Key** and **Secret Key** into your `.env.local`:
   ```
   NEXT_PUBLIC_TURNSTILE_SITE_KEY=<your-site-key>
   TURNSTILE_SECRET_KEY=<your-secret-key>
   ```
4. The **toss-pay** Edge Function reads `TURNSTILE_SECRET_KEY` at request
   time. The browser only ever sees the site key (via `_shared/components/Turnstile`).

## 2. Widget render (client-side)

The product detail page uses the shared `Turnstile` component from
`templates/_shared/components/Turnstile.tsx`. The component renders nothing if
`NEXT_PUBLIC_TURNSTILE_SITE_KEY` is empty.

```tsx
import { Turnstile } from '@boilerplate-web/shared/components';

<Turnstile
  siteKey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? ''}
  onVerify={(token) => /* hand off to toss-pay via fetch */}
/>
```

The `onVerify(token)` callback receives the Turnstile token. Pass it to the
`toss-pay` Edge Function as `{ turnstile_token: token }`.

## 3. Verification (server-side, inside toss-pay)

Inside `templates/shop/supabase/functions/toss-pay/index.ts` (the **toss-pay**
function), the function POSTs the token to:

```
POST https://challenges.cloudflare.com/turnstile/v0/siteverify
Content-Type: application/x-www-form-urlencoded

secret=<TURNSTILE_SECRET_KEY>&response=<token>
```

If `success` is not `true`, the **toss-pay** function returns
`{ error: 'turnstile_failed' }` with HTTP 400 — no Toss API call is made.

## 4. Cloudflare WAF

The WAF rules in `/cloudflare-rules.json` at the repo root enforce:
- **toss-pay** rate limit: 10 req/min/IP at `/functions/v1/toss-pay`.
- No-User-Agent block on `/functions/v1/*`.
- Geo-allowlist (KR + US + JP) on `/functions/v1/*`.
- Managed challenge on `/admin/*` without `cf_clearance`.

## 5. Local development

If you don't have a Turnstile widget yet, set `NEXT_PUBLIC_TURNSTILE_SITE_KEY=`
(empty). The widget renders nothing and the **toss-pay** function will return
400 in dev — to test the full flow, sign up for a free Cloudflare account and
create a widget.
