# saas — Post-scaffold Setup Guide

> **You just ran** `npx create-boilerplate-web <dir> --type=saas --yes --allow-unsafe-path` and now have a fresh Next.js + Supabase + Cloudflare + Toss app in `<dir>`.
>
> This guide walks you from "scaffolded" → "first deploy live on Vercel" in **~15 minutes** with mostly copy-paste commands.
>
> Read the whole guide once before starting — there are 6 one-time external setups that must be done in the listed order.

## TL;DR — what you'll do

| # | Step | Where | Time |
|---|------|-------|------|
| 1 | Sign up for Supabase + create project | supabase.com dashboard | 2 min |
| 2 | Sign up for Vercel | vercel.com dashboard | 1 min |
| 3 | Sign up for Cloudflare + add domain | cloudflare.com dashboard | 2 min |
| 4 | Sign up for Toss Payments | tosspayments.com dashboard | 5 min |
| 5 | Set env vars in `.env.local` | local edit | 30 sec |
| 6 | Link Supabase + push migrations + deploy Edge Function | `supabase` CLI | 30 sec |
| 7 | Push to GitHub + set 7 secrets | `gh` CLI | 1 min |
| 8 | First deploy | Vercel auto + GitHub Actions | 30 sec + 2 min build |

**Single local command required after env vars are set:**

```bash
./scripts/setup.sh          # does steps 5-7 (sets .env.local placeholders, links Supabase, deploys Edge Function, sets GitHub secrets)
```

## Pre-flight: external accounts (one-time)

### Step 1 — Supabase project

1. Go to <https://supabase.com/dashboard> → **New project**.
2. Pick a name, generate a strong DB password (save it!), pick a region.
3. Wait for the project to provision (~90 seconds).
4. From the project dashboard, copy:
   - **Settings → API**:
     - `Project URL` → `NEXT_PUBLIC_SUPABASE_URL`
     - `anon public` → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
     - `service_role` → `SUPABASE_SERVICE_ROLE_KEY`
   - **Settings → General → Reference ID** (20-char alphanumeric in the URL path) → `SUPABASE_PROJECT_REF`
5. Also generate an access token at <https://supabase.com/dashboard/account/tokens> → click **Generate new token**, save it as `SUPABASE_ACCESS_TOKEN`. (You only need to do this **once per Supabase account** — same token works for all your projects.)

### Step 2 — Vercel account

1. Go to <https://vercel.com/signup> → sign up with GitHub.
2. From your avatar → **Account Settings → General**, copy:
   - **Your ID** → `VERCEL_ORG_ID` (use your personal-account ID if on the Hobby tier).
3. Create a token: <https://vercel.com/account/tokens> → **Create Token** → full account scope → save the token as `VERCEL_TOKEN`.
4. **Don't create the Vercel project yet** — step 8 creates it automatically when you push to GitHub. `VERCEL_PROJECT_ID` is auto-generated on first import and won't be needed until that step.

**Summary — Vercel provides 3 secrets: `VERCEL_TOKEN` + `VERCEL_ORG_ID` + `VERCEL_PROJECT_ID` (last one auto-set after first import).**

### Step 3 — Cloudflare account (only needed if you want bot protection + WAF)

1. Go to <https://dash.cloudflare.com/sign-up> → create account, add your domain.
2. From **Workers & Pages → Overview**, find your **Account ID** on the right side → save as `CF_ZONE_ID` (no — use the **Zone ID** from the per-domain config, see next bullet).

   ⚠️ **Naming convention**: the variable name in this template is `CF_ZONE_ID` but Cloudflare actually calls this **Account ID**. The **Zone ID** is the per-domain identifier.
3. **Zone ID**: go to your domain → right column "Zone ID" → copy as `CF_API_TOKEN`.
4. Create an API token at <https://dash.cloudflare.com/profile/api-tokens> → **Create Token** → use the **Edit zone WAF** template → scope it to your specific zone → save the token as `CF_API_TOKEN`.

### Step 4 — Toss Payments account (only needed if you'll use Toss billing)

1. Go to <https://tosspayments.com> → sign up → developer dashboard.
2. From **개발자센터 → API 키** (Developer Center → API Keys), issue a **Live Secret Key** and a **Live Auth Key**.
3. Save them as `TOSS_SECRET_KEY` and `TOSS_AUTH_KEY`.

## Local env: one file

### Step 5a — install pnpm + scaffold deps

> ⚠️ **Important**: this boilerplate uses **pnpm** (the `workspace:*` protocol in `package.json` is pnpm-only). **Don't run `npm install`** — it fails with `EUNSUPPORTEDPROTOCOL: workspace:*`.

```bash
# Install pnpm if you don't have it (one-time)
npm install -g pnpm                         # (or: brew install pnpm / winget install pnpm)
pnpm --version                              # verify (>= 8.x recommended)

# Then install deps
cd <dir>                                     # the folder you scaffolded into
pnpm install --frozen-lockfile                # uses pnpm-lock.yaml if present; otherwise pnpm install
```

### Step 5b — fill in `.env.local`

```bash
cp .env.example .env.local
$EDITOR .env.local  # paste in the 7 values from steps 1-4 above
```

`.env.example` already lists every key with a one-line comment.

## Supabase + GitHub: one CLI setup script

### Step 6 + 7 — `./scripts/setup.sh` does both

The script lives at `<dir>/scripts/setup.sh` (created by this scaffold). It:
- Reads your `.env.local`
- Runs `supabase link` (links your local repo to the project from step 1)
- Runs `supabase db push` (applies migrations)
- Runs `supabase functions deploy billing` (deploys the Edge Function)
- Runs `git init && git add && git commit` (only if not already a repo)
- Runs `gh repo create … --push` (creates a GitHub repo + pushes)
- Runs 7× `gh secret set …` to set the GitHub Actions secrets

Before running it, make sure both CLI tools are authenticated:

```bash
supabase login          # enter your Supabase access token from step 1
gh auth login           # sign in to GitHub (browser will open)
```

Now run the script:

```bash
./scripts/setup.sh                  # does the actual work
./scripts/setup.sh --dry-run        # prints what would happen — safe to re-run
./scripts/setup.sh --check         # only verifies prereqs, doesn't mutate
```

If `--check` shows anything missing, fix it and re-run `--check`. Once `--check` is clean, run `./scripts/setup.sh` for real.

## First deploy

### Step 8 — push triggers the entire deploy

Once `./scripts/setup.sh` finishes, your commit is on GitHub AND all 7 secrets are set. The `templates/saas/.github/workflows/deploy.yml` workflow runs **automatically on push to the default branch**:

1. **Vercel deploy** — imports your GitHub repo on first push (if not yet imported) and deploys. The Vercel project settings page is where the `NEXT_PUBLIC_*` env vars live (steps 1-4).

   First-time auto-import: visit Vercel → **Add New → Project** → select your repo → accept auto-detected Next.js build → **Deploy**. This is the only manual Vercel action; subsequent pushes auto-deploy.

2. **Supabase Edge Functions** — auto-deploys `billing` via the GitHub Action's `supabase-functions` job.

3. **Cloudflare WAF** — auto-applies `cloudflare-rules.json` (6 rules) to your zone via the GitHub Action's `cloudflare-waf` job.

4. **Cloudflare Pages** — *optional*. If you want to deploy via Cloudflare Pages instead of Vercel, see the alternative below.

To watch progress:

```bash
gh run watch
```

To trigger manually (useful for the first run before auto-deploy is wired):

```bash
gh workflow run deploy.yml
```

## What you should see (verify each step)

- `https://<your-project>.vercel.app` returns 200 with your landing page.
- `supabase functions list --project-ref $SUPABASE_PROJECT_REF` shows `billing` deployed.
- Cloudflare dashboard → your zone → **Security → WAF → Custom Rules** shows 6 rules.
- Toss billing test: visit `/pricing` on your deployed app → subscribe with a test card → check Toss dashboard for the auto-created billing key.

## Alternative: Cloudflare Pages instead of Vercel

If you'd rather deploy via Cloudflare Pages (skip Vercel entirely):

1. Add `CF_API_TOKEN` + `CF_ZONE_ID` (already required for WAF) — both jobs reuse the same secrets.
2. The `deploy-shared.yml` composite's `cloudflare-pages-deploy` job has an `if: ${{ secrets.CF_API_TOKEN != '' }}` guard — set those secrets and the Pages job runs.
3. First-time only: visit Cloudflare → **Workers & Pages → Create application → Pages → Connect to Git** → pick your repo → accept auto-detected Next.js build settings → **Save and Deploy**.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `./scripts/setup.sh: command not found: supabase` | Supabase CLI not installed | `brew install supabase/tap/supabase` (or `npm i -g supabase`) |
| `./scripts/setup.sh: command not found: gh` | GitHub CLI not installed | `brew install gh` (or `npm i -g gh`), then `gh auth login` |
| `supabase login` succeeds but `supabase link` fails with 401 | Wrong access token | regenerate at <https://supabase.com/dashboard/account/tokens> |
| `gh repo create` fails with `repo not found` | You don't have permission to create repos in the namespace | create the repo under your own user (`gh repo create my-saas --private --source=.`) |
| First push doesn't trigger the deploy workflow | repo isn't on the default branch | `git branch -M <default-branch> && git push -u origin <default-branch>`; the workflow fires on every push to the default branch with no path filter |
| `error: secrets.CF_API_TOKEN not found` in the Actions run | you set some secrets but not all 7 | re-run `./scripts/setup.sh` after fixing `.env.local` |

## Time estimate

| Once | Task | Time |
|---|---|---|
| Once | sign-up for 4 services (Supabase, Vercel, Cloudflare, Toss) | ~5 min |
| Once | fill `.env.local` (one-line per key, paste) | ~30 sec |
| Once | run `./scripts/setup.sh` (or dry-run first) | ~1 min |
| Once | import Vercel project on first push | ~30 sec |
| Every push | auto-deploy (Vercel + Supabase functions + Cloudflare WAF) | ~2 min |

Total one-time: ~10 min. Every subsequent push auto-deploys.
