# Step 5: Cloudflare WAF rules + Turnstile config snippets for saas + shop

## Status
**pending** — last update: 2026-07-16T00:00:00Z

## Read first
- `/PRD.md`
- `.prd/decision-log.md`
- `phases/0-mvp/step2.md` (saas Edge Function paths)
- `phases/0-mvp/step3.md` (shop Edge Function paths)

## Task

Files to create at repo root + inside templates:

- `cloudflare-rules.json` — top-level array of Cloudflare WAF custom-rules entries. Each entry has `description`, `expression`, `action`, `priority`. Minimum 5 rules:
  1. Rate-limit Edge Function path `/functions/v1/toss-billing` to 10 req/min/IP.
  2. Rate-limit `/functions/v1/toss-pay` to 10 req/min/IP.
  3. Block requests with no `User-Agent` header to Edge Function paths.
  4. Geo-block (allowlist) Edge Function paths to KR + US + JP (configurable via comment).
  5. Challenge (managed challenge) requests to admin paths `/admin/*` without a valid `cf_clearance` cookie.
- `templates/saas/cloudflare/turnstile-config.md` — site-key + secret-key env setup, widget render snippet (referencing `_shared/components/Turnstile`), verification flow inside the Edge Function.
- `templates/shop/cloudflare/turnstile-config.md` — same as saas but bound to `toss-pay` Edge Function.
- `templates/portfolio/cloudflare/README.md` — states portfolio does NOT need Turnstile/WAF rules (single paragraph).

Non-negotiable rules:
- `cloudflare-rules.json` MUST NOT contain any real secrets (use placeholders like `<YOUR_ZONE_ID>`).
- WAF rules target Edge Function paths, not Next.js routes (Edge Functions are the actual public surface).
- Turnstile verification is server-side in the Edge Function; the widget render is client-side only.

## Acceptance Criteria
```bash
# AC1: cloudflare-rules.json is valid JSON
jq . cloudflare-rules.json > /dev/null && echo "AC1 ok"
# AC2: WAF rule count ≥ 5
jq '. | length' cloudflare-rules.json | grep -qE '^[5-9]$|^[1-9][0-9]+$'
# AC3: rules reference Edge Function paths (not Next.js app routes)
jq -r '.[].expression' cloudflare-rules.json | grep -q '/functions/v1/'
# AC4: no real secrets in rules
grep -E 'sk_live|pk_live|TOSS_API_KEY=[a-z0-9]{16,}' cloudflare-rules.json && exit 1
# AC5: saas turnstile config mentions the Edge Function by name
grep -c 'toss-billing' templates/saas/cloudflare/turnstile-config.md | grep -qE '^[3-9]$|^[1-9][0-9]+$'
# AC6: shop turnstile config mentions the Edge Function by name
grep -c 'toss-pay' templates/shop/cloudflare/turnstile-config.md | grep -qE '^[3-9]$|^[1-9][0-9]+$'
# AC7: portfolio explicitly says "no Turnstile"
grep -i 'no.*turnstile\|turnstile.*not.*required' templates/portfolio/cloudflare/README.md
```

## Verification & Status Update (REQUIRED before claiming done)
1. Run AC1–AC7. Quote exit codes.
2. Update `phases/0-mvp/index.json` step 5 → `completed`/`error`/`blocked`.
3. Emit the two HTML-comment markers as the last two lines.

## Don't
- Don't hardcode real zone IDs, account IDs, or API tokens in `cloudflare-rules.json`.
- Don't auto-deploy WAF rules — provide JSON for manual import via Cloudflare dashboard.
- Don't put Turnstile verification logic in a Next.js API route — verification stays in Edge Functions.
- Don't edit files outside `cloudflare-rules.json`, `templates/*/cloudflare/`, and `phases/0-mvp/`.