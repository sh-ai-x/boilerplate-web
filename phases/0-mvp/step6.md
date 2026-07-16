# Step 6: Root README + per-template deployment READMEs (Supabase, Cloudflare, Google OAuth, Toss)

## Status
**pending** — last update: 2026-07-16T00:00:00Z

## Read first
- `/PRD.md`
- `.prd/decision-log.md`
- `phases/0-mvp/step0.md` … `step5.md`
- `templates/saas/README.md` (will be created in this step)
- `templates/shop/README.md` (will be created in this step)
- `templates/portfolio/README.md` (will be created in this step)

## Task

Files to create / overwrite:

- Root `README.md` — sections:
  1. **What this is** — one-paragraph framing (CLI + 3 templates).
  2. **Quick start** — `npx create-boilerplate-web <folder> --type=<saas|shop|portfolio>` with all 3 type examples.
  3. **Template matrix** — table: rows = {saas, shop, portfolio}; columns = {auth, payment, encryption, turnstile, waf}.
  4. **Env-var matrix** — table mapping each env var to which templates use it.
  5. **Architecture diagram (ASCII)** — browser → Next.js → Supabase Edge Function → Toss/Cloudflare.
  6. **Security non-goals** — links to `.prd/decision-log.md` non-goals section.
  7. **License** — placeholder (`MIT`).
- `templates/saas/README.md` — sections: Prerequisites (Supabase project, Cloudflare account, Google OAuth client, Toss Payments account), Setup (env, `supabase link`, `supabase db push`, `supabase functions deploy toss-billing`, Cloudflare WAF import), Local dev (`pnpm dev`), Deployment (Vercel env vars).
- `templates/shop/README.md` — same shape as saas, swap `toss-billing` → `toss-pay`, add a "pgsodium key rotation" subsection.
- `templates/portfolio/README.md` — sections: Prerequisites (Supabase project, Google OAuth client — no Toss, no Cloudflare WAF), Setup, Local dev, Deployment.

Non-negotiable rules:
- Every placeholder for a secret MUST be `YOUR_*` (e.g. `YOUR_TOSS_SECRET_KEY`); never commit a real key.
- Every README must have a "Supabase setup" section with `supabase link` + `supabase db push`.
- README content MUST be generic — no references to a specific user's project or domain.

## Acceptance Criteria
```bash
# AC1: root README exists, length > 2000 chars
test -f README.md && [ "$(wc -c < README.md)" -gt 2000 ]
# AC2: every template README has a "Supabase setup" section
for t in saas shop portfolio; do grep -qi 'supabase setup' templates/$t/README.md || exit 1; done
# AC3: every template README mentions 'supabase link'
for t in saas shop portfolio; do grep -q 'supabase link' templates/$t/README.md || exit 1; done
# AC4: env-var matrix in root README covers all 4 env keys
grep -E 'NEXT_PUBLIC_SUPABASE_URL|NEXT_PUBLIC_SUPABASE_ANON_KEY|SUPABASE_SERVICE_ROLE_KEY|NEXT_PUBLIC_TURNSTILE_SITE_KEY' README.md | wc -l | grep -qE '^[4-9]$|^[1-9][0-9]+$'
# AC5: no real-looking secrets in any README (defensive grep)
grep -rE 'sk_live_[a-zA-Z0-9]{20,}|pk_live_[a-zA-Z0-9]{20,}|AIza[0-9A-Za-z_-]{30,}' README.md templates/*/README.md && exit 1
# AC6: portfolio README explicitly says no Toss / no Cloudflare WAF
grep -i 'no.*toss\|no.*cloudflare\|not.*required' templates/portfolio/README.md
# AC7: deployment section in each template README mentions Vercel OR Cloudflare Pages
for t in saas shop portfolio; do grep -iE 'vercel|cloudflare pages' templates/$t/README.md || exit 1; done
```

## Verification & Status Update (REQUIRED before claiming done)
1. Run AC1–AC7. Quote exit codes.
2. Update `phases/0-mvp/index.json` step 6 → `completed`/`error`/`blocked`.
3. Emit the two HTML-comment markers as the last two lines.

## Don't
- Don't reference any specific user's project, domain, or company name in any README.
- Don't put real-looking credentials in examples — use `YOUR_*` placeholders only.
- Don't skip the "Supabase setup" section in any template README.
- Don't edit files outside `README.md`, `templates/*/README.md`, and `phases/0-mvp/`.