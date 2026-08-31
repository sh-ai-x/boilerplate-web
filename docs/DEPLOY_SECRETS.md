# Deploy Secrets — SSOT

> Single source of truth for the GitHub repository secrets required by
> the per-template `deploy.yml` workflows added in phase 2-deploy-automation.
> Cited verbatim by:
> - `cli/lib/post-install.js` (post-install checklist line "Set 7 GitHub repo secrets …")
> - `templates/_shared/.github/workflows/deploy-shared.yml` (composite `secrets:` block)
> - `templates/{saas,shop,portfolio}/.github/workflows/deploy.yml` (per-template `secrets:` references)

The table MUST contain exactly 7 rows. Renaming any secret here is a breaking change —
update the workflows AND the CLI checklist in the same PR.

| Secret name | Where to get it | Required for | Applies to template |
|---|---|---|---|
| `VERCEL_TOKEN` | <https://vercel.com/account/tokens> ("Create Token" → full account scope) | Vercel deploy job | saas, shop, portfolio |
| `VERCEL_ORG_ID` | Vercel team settings → "General" → "Team ID" (or personal-account ID for hobby tier) | Vercel deploy job | saas, shop, portfolio |
| `VERCEL_PROJECT_ID` | Vercel project settings → "General" → "Project ID" (auto-generated on first import) | Vercel deploy job | saas, shop, portfolio |
| `CF_API_TOKEN` | Cloudflare dashboard → My Profile → API Tokens → "Create Token" → template "Edit zone WAF" + zone resources scoped to the target zone | Cloudflare WAF deploy + Cloudflare Pages (optional) | saas, shop (portfolio: not required) |
| `CF_ZONE_ID` | Cloudflare dashboard → zone overview → right column "Zone ID" | Cloudflare WAF deploy | saas, shop (portfolio: not required) |
| `SUPABASE_ACCESS_TOKEN` | <https://supabase.com/dashboard/account/tokens> ("Generate new token" → `project` + `database` + `edge_functions` scopes) | Supabase functions deploy + migrations | saas, shop (portfolio: migrations only) |
| `SUPABASE_PROJECT_REF` | Supabase project dashboard → Settings → General → "Reference ID" (the 20-char alphanumeric in the URL path) | Supabase functions deploy + migrations | saas, shop (portfolio: migrations only) |

## Setting them via `gh secret set`

```bash
gh secret set VERCEL_TOKEN          --body "$VERCEL_TOKEN"          --repo OWNER/REPO
gh secret set VERCEL_ORG_ID         --body "$VERCEL_ORG_ID"         --repo OWNER/REPO
gh secret set VERCEL_PROJECT_ID     --body "$VERCEL_PROJECT_ID"     --repo OWNER/REPO
gh secret set CF_API_TOKEN          --body "$CF_API_TOKEN"          --repo OWNER/REPO
gh secret set CF_ZONE_ID            --body "$CF_ZONE_ID"            --repo OWNER/REPO
gh secret set SUPABASE_ACCESS_TOKEN --body "$SUPABASE_ACCESS_TOKEN" --repo OWNER/REPO
gh secret set SUPABASE_PROJECT_REF  --body "$SUPABASE_PROJECT_REF"  --repo OWNER/REPO
```

`$OWNER/$REPO` is your GitHub user/org + the freshly-pushed scaffold repo.

## Verifying

```bash
gh secret list --repo OWNER/REPO
# expected: CF_API_TOKEN, CF_ZONE_ID, SUPABASE_ACCESS_TOKEN, SUPABASE_PROJECT_REF,
#           VERCEL_ORG_ID, VERCEL_PROJECT_ID, VERCEL_TOKEN (7 lines, alphabetical)
```

## First-deploy trigger

After setting the 7 secrets, dispatch the workflow manually the first time so you can watch the run:

```bash
gh workflow run deploy.yml --repo OWNER/REPO --ref main
gh run watch --repo OWNER/REPO
```

A successful run produces:
- A Vercel deployment URL visible in the run logs.
- `supabase functions list --project-ref $REF` shows the per-template Edge Function(s).
- Cloudflare dashboard → zone → Security → WAF → Custom Rules shows 6 rules (the contents of `cloudflare-rules.json`).