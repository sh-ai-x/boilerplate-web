# shop — Deployment Runbook (Phase 2 auto-deploy)

> Operator guide for the shop boilerplate, scaffolded via
> `npx create-boilerplate-web my-app --type=shop`.
> Push-to-main automation is wired up by `templates/shop/.github/workflows/deploy.yml`.

The full secret-name SSOT lives at [`docs/DEPLOY_SECRETS.md`](../../docs/DEPLOY_SECRETS.md)
in the boilerplate-web monorepo. This runbook consumes that SSOT.

## Before first push

1. **Scaffold locally**:
   ```bash
   npx create-boilerplate-web my-shop --type=shop --yes
   ```
2. **Init git + push to a fresh GitHub repo**:
   ```bash
   cd my-shop
   git init && git add -A && git commit -m "feat: scaffolded shop"
   gh repo create my-shop --private --source=. --push
   ```
3. **Set the 7 GitHub repo secrets** (see `docs/DEPLOY_SECRETS.md` in the monorepo):
   ```bash
   gh secret set VERCEL_TOKEN          --body "$VERCEL_TOKEN"          --repo OWNER/REPO
   gh secret set VERCEL_ORG_ID         --body "$VERCEL_ORG_ID"         --repo OWNER/REPO
   gh secret set VERCEL_PROJECT_ID     --body "$VERCEL_PROJECT_ID"     --repo OWNER/REPO
   gh secret set CF_API_TOKEN          --body "$CF_API_TOKEN"          --repo OWNER/REPO
   gh secret set CF_ZONE_ID            --body "$CF_ZONE_ID"            --repo OWNER/REPO
   gh secret set SUPABASE_ACCESS_TOKEN --body "$SUPABASE_ACCESS_TOKEN" --repo OWNER/REPO
   gh secret set SUPABASE_PROJECT_REF  --body "$SUPABASE_PROJECT_REF"  --repo OWNER/REPO
   ```
4. **Vercel — create the project** (one-time, in the Vercel dashboard): Import the GitHub repo, accept auto-detected Next.js build settings. The 6 env vars are read from Vercel's own env-var dashboard.
5. **Supabase — link the project** (one-time, locally):
   ```bash
   supabase link --project-ref <YOUR_REF>
   supabase db push
   supabase functions deploy toss-pay --project-ref <YOUR_REF>
   ```
   (`toss-pay` is the shop Edge Function for single-payment processing.)

## After first push

The `templates/shop/.github/workflows/deploy.yml` workflow runs four jobs on every push to `main`:

1. **deploy-shared** — Vercel + (optionally) Cloudflare Pages deploy.
2. **supabase-functions** — `supabase functions deploy toss-pay` for the single-payment Edge Function.
3. **cloudflare-waf** — automatically applies the 6-rule `cloudflare-rules.json` to your Cloudflare zone via the v4 API.

To trigger manually:
```bash
gh workflow run deploy.yml --repo OWNER/REPO --ref main
gh run watch --repo OWNER/REPO
```

A successful run produces:
- A Vercel deployment URL in the run logs.
- `supabase functions list --project-ref <YOUR_REF>` shows `toss-pay` deployed.
- Cloudflare dashboard → your zone → Security → WAF → Custom Rules shows the 6 rules from `cloudflare-rules.json`.
