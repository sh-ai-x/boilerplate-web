# portfolio — Deployment Runbook (Phase 2 auto-deploy)

> Operator guide for the portfolio boilerplate, scaffolded via
> `npx create-boilerplate-web my-app --type=portfolio`.
> Push-to-main automation is wired up by `templates/portfolio/.github/workflows/deploy.yml`.

The full secret-name SSOT lives at [`docs/DEPLOY_SECRETS.md`](../../docs/DEPLOY_SECRETS.md)
in the boilerplate-web monorepo.

## Before first push

1. **Scaffold locally**:
   ```bash
   npx create-boilerplate-web my-portfolio --type=portfolio --yes
   ```
2. **Init git + push to a fresh GitHub repo**:
   ```bash
   cd my-portfolio
   git init && git add -A && git commit -m "feat: scaffolded portfolio"
   gh repo create my-portfolio --source=. --push
   ```
3. **Set the GitHub repo secrets** (see `docs/DEPLOY_SECRETS.md` in the monorepo):
   ```bash
   gh secret set VERCEL_TOKEN          --body "$VERCEL_TOKEN"          --repo OWNER/REPO
   gh secret set VERCEL_ORG_ID         --body "$VERCEL_ORG_ID"         --repo OWNER/REPO
   gh secret set VERCEL_PROJECT_ID     --body "$VERCEL_PROJECT_ID"     --repo OWNER/REPO
   gh secret set CF_API_TOKEN          --body "$CF_API_TOKEN"          --repo OWNER/REPO
   gh secret set CF_ZONE_ID            --body "$CF_ZONE_ID"            --repo OWNER/REPO
   gh secret set SUPABASE_ACCESS_TOKEN --body "$SUPABASE_ACCESS_TOKEN" --repo OWNER/REPO
   gh secret set SUPABASE_PROJECT_REF  --body "$SUPABASE_PROJECT_REF"  --repo OWNER/REPO
   ```
   Note: CF_API_TOKEN / CF_ZONE_ID are OPTIONAL for portfolio (no Cloudflare WAF); you can skip them and the workflow silently skips the cloudflare-pages job (it gates on `secrets.CF_* != ''`).
4. **Vercel — create the project** (one-time, in the Vercel dashboard): Import the GitHub repo. The 3 Supabase env vars are read from Vercel's own env-var dashboard.
5. **Supabase — link the project** (one-time, locally):
   ```bash
   supabase link --project-ref <YOUR_REF>
   supabase db push
   ```
   (No Edge Functions to deploy — portfolio has no Edge Functions.)

## After first push

The `templates/portfolio/.github/workflows/deploy.yml` workflow runs **two jobs** on every push to `main` (no Edge Functions, no Cloudflare WAF):

1. **deploy-shared** — Vercel deploy (Cloudflare Pages deploy is included inside the composite but is gated on `CF_*` secrets being set).

To trigger manually:
```bash
gh workflow run deploy.yml --repo OWNER/REPO --ref main
gh run watch --repo OWNER/REPO
```

A successful run produces a Vercel deployment URL in the run logs.

## What's NOT in this deploy

- **No Edge Functions** — portfolio has no Edge Functions (no payment surface; the guestbook write uses a direct client insert with RLS).
- **No Cloudflare WAF** — portfolio has no payment surface and no bot-protection needs (per PRD non-goal #2). If you want opportunistic Turnstile on the guestbook POST, enable it manually in the Cloudflare dashboard per `templates/portfolio/cloudflare/README.md`.
