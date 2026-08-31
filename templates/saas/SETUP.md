# saas — Post-scaffold Setup Guide

> **You just ran** `npx create-boilerplate-web <dir> --type=saas [...]` and now have a fresh Next.js app in `<dir>`.
>
> This guide walks you from "scaffolded" → "first deploy live" in **~10–20 minutes** depending on which adapters you picked.
>
> **Pick your adapter combination first** — it determines which sections of this guide you follow.

---

## 0 · Pick your adapters (read this first)

The CLI scaffolds three independent choices. **You can change your mind later** — the runtime detects via env vars (`AUTH_PROVIDER`, `DB_PROVIDER`) and falls back to whichever keys are present in your shell.

### 0.1 · CLI flags you passed (or defaults)

| Flag | Values | Default | What it controls |
|---|---|---|---|
| `--auth` | `clerk` \| `none` | `clerk` | Auth provider + Clerk UI / pages |
| `--db` | `supabase` \| `neon` | `supabase` | Database backend + migrations / Edge Functions |
| `--deploy-target` | `vercel` \| `none` | `vercel` | GitHub Actions deploy workflow |

### 0.2 · All 8 valid combinations

| `--auth` | `--db` | `--deploy-target` | What you'll configure | Time |
|---|---|---|---|---|
| `clerk` | `supabase` | `vercel` | full stack — Clerk + Supabase + Vercel + CF WAF + Toss | ~15 min |
| `clerk` | `supabase` | `none` | Clerk + Supabase, deploy via CLI/Fly/Railway | ~10 min |
| `clerk` | `neon` | `vercel` | Clerk + Neon (Drizzle) + Vercel + Toss | ~12 min |
| `clerk` | `neon` | `none` | Clerk + Neon, deploy elsewhere | ~8 min |
| `none` | `supabase` | `vercel` | no auth, Supabase, Vercel + CF WAF + Toss | ~12 min |
| `none` | `supabase` | `none` | no auth, Supabase, deploy elsewhere | ~7 min |
| `none` | `neon` | `vercel` | no auth, Neon (Drizzle), Vercel + Toss | ~10 min |
| `none` | `neon` | `none` | bare Next.js + Neon, deploy anywhere | ~5 min |

### 0.3 · How runtime detection actually works

`_shared/adapters/<auth|db>/index.ts#detectKind()` runs on first import:

```
AUTH_PROVIDER:
  1. env AUTH_PROVIDER=clerk|none  → explicit override (highest priority)
  2. NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY present in env  → 'clerk'
  3. default → 'clerk'

DB_PROVIDER:
  1. env DB_PROVIDER=supabase|neon  → explicit override
  2. NEXT_PUBLIC_SUPABASE_URL present  → 'supabase'
  3. DATABASE_URL starts with postgres://  → 'neon'
  4. default → 'supabase'
```

**Implication**: the SETUP.html/SETUP.md you see in the scaffold was generated based on **your `--auth × --db × --deploy-target` choice**. If you set `AUTH_PROVIDER=none` at runtime, the in-app UI will show the `NoAuthAdapter` (no sign-in buttons, `auth.getUserId()` returns `null`) — even if the scaffolded files include Clerk code. The setup guide is documentation; runtime wins.

### 0.4 · How to switch adapters after scaffold

You don't need to re-scaffold. Just edit `.env.local`:

```bash
# Switch from Clerk to no auth without re-scaffolding
AUTH_PROVIDER=none
```

```bash
# Switch from Supabase to Neon
DB_PROVIDER=neon
DATABASE_URL=postgres://user:pass@ep-xxx.neon.tech/mydb
```

Then re-run `pnpm install` (only required if `--auth`/`--db` changed which packages are present), set the new env vars, and `pnpm dev` will pick the new adapter on next request.

---

## 1 · Pre-flight: which accounts do I need?

Open the section for **your** adapter combination only.

### 1.1 · `--auth=clerk` (default)

- **Clerk** — <https://dashboard.clerk.com>
  - **Why**: handles sign-up/sign-in UI, OAuth, sessions, webhooks
  - **Time**: 2 min
  - **Skippable?** Only if you also pass `--auth=none` at scaffold time, OR set `AUTH_PROVIDER=none` later

### 1.2 · `--auth=none`

- **No external account needed.** `NoAuthAdapter` makes `auth.getUserId()` always return `null`.
- If you want auth later, either (a) re-scaffold with `--auth=clerk`, or (b) implement a new adapter in `templates/_shared/adapters/auth/<your-provider>.ts` (see §6 below).

### 1.3 · `--db=supabase` (default)

- **Supabase** — <https://supabase.com/dashboard>
  - **Why**: Postgres DB + RLS + Edge Functions
  - **Time**: 2 min for project + token
  - **Skippable?** Only if you also pass `--db=neon` or set `DB_PROVIDER=neon`

### 1.4 · `--db=neon`

- **Neon** — <https://console.neon.tech>
  - **Why**: serverless Postgres (HTTP driver)
  - **Time**: 1 min
  - **Needs**: a project + the connection string (`postgres://user:pass@ep-xxx.neon.tech/neondb?sslmode=require`) → `DATABASE_URL`
  - **Migrations**: `pnpm drizzle-kit push` (replaces `supabase db push`)

### 1.5 · `--deploy-target=vercel` (default)

- **Vercel** — <https://vercel.com/signup>
  - **Time**: 1 min
- **Cloudflare** (optional, for WAF rules + Pages alternate) — <https://dash.cloudflare.com/sign-up>
  - **Why**: apply `cloudflare-rules.json` WAF rules
  - **Time**: 2 min
  - **Skippable?** Yes — the `cloudflare-waf` GitHub Actions job is skipped if `CF_API_TOKEN` is empty

### 1.6 · `--deploy-target=none`

- **No deploy provider is configured.** You'll run `pnpm build && pnpm start` yourself (Docker, Fly, Railway, Cloudflare Pages manual setup, etc.).
- GitHub Actions deploy workflow was **deleted** during scaffold. To re-add it: copy `templates/_shared/.github/workflows/deploy-shared.yml` back from the repo root.

### 1.7 · Always needed (any combination)

- **Toss Payments** — <https://tosspayments.com> (only if you use `/pricing` page)
  - **Why**: billing
  - **Time**: 5 min (corp info required)
  - **Skippable?** Yes — `/pricing` page renders but billing buttons 500 if `TOSS_SECRET_KEY` is empty

---

## 2 · Install deps

> ⚠️ This scaffold uses **pnpm** (the `workspace:*` protocol in `package.json` is pnpm-only). **Don't run `npm install`** — it fails with `EUNSUPPORTEDPROTOCOL`.

```bash
# Install pnpm if you don't have it (one-time)
npm install -g pnpm

cd <dir>                                     # the folder you scaffolded into
pnpm install
```

---

## 3 · Fill in `.env.local`

The scaffolded `.env.example` has **only the keys your adapter choice needs**. Open `<dir>/.env.example` to see them. Common cases:

### 3.1 · `--auth=clerk` (default)

```bash
cp .env.example .env.local
$EDITOR .env.local
```

| Key | Source |
|---|---|
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk → API Keys → Publishable (`pk_test_...`) |
| `CLERK_SECRET_KEY` | Clerk → API Keys → Secret (`sk_test_...`) |
| `CLERK_WEBHOOK_SECRET` | Clerk → Webhooks → endpoint signing secret (`whsec_...`) |

### 3.2 · `--auth=none`

No Clerk keys. Skip this section.

### 3.3 · `--db=supabase` (default)

| Key | Source |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Settings → API → Project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase → Settings → API → Publishable (`sb_publishable_...`) |
| `SUPABASE_SECRET_KEY` | Supabase → Settings → API → Secret (`sb_secret_...`) |
| `SUPABASE_JWKS_URL` | (only if `--auth=clerk`) Supabase → Authentication → Sign In/Up → Third Party Auth → Add provider → Clerk → paste Clerk JWKS URL |

**Wire Clerk as Supabase third-party auth** (only relevant if `--auth=clerk --db=supabase`):
1. In Supabase dashboard → **Authentication → Sign In/Up → Third Party Auth → Add provider → Clerk**.
2. Paste your Clerk **JWKS URL**:
   - Dev: `https://<your-frontend-api>.clerk.accounts.dev/.well-known/jwks.json`
   - Prod: `https://clerk.<your-domain>/.well-known/jwks.json`
3. Find your frontend API at <https://dashboard.clerk.com> → **API Keys** → "Show frontend API" (or derive from `pk_test_xxx` → `xxx.clerk.accounts.dev`).
4. Save the URL into `SUPABASE_JWKS_URL` in `.env.local`.

After this, RLS policies can read the Clerk user id via `auth.jwt() ->> 'sub'`.

### 3.4 · `--db=neon`

| Key | Source |
|---|---|
| `DATABASE_URL` | Neon → Connection Details → pooled connection string |

Optional overrides:
| Key | When |
|---|---|
| `NEON_DATABASE_URL` | alias for `DATABASE_URL` (both checked) |
| `POSTGRES_URL` | another alias (all three checked, first one set wins) |

### 3.5 · `--deploy-target=vercel` (default)

These keys go into **GitHub Actions secrets** (not `.env.local`) — `setup.sh` sets them for you in §4.

| Key | Source |
|---|---|
| `VERCEL_TOKEN` | Vercel → Account Settings → Tokens |
| `VERCEL_ORG_ID` | Vercel → Account Settings → General → Your ID |
| `VERCEL_PROJECT_ID` | Auto-generated by Vercel on first project import (no manual paste needed) |
| `CF_API_TOKEN` | Cloudflare → My Profile → API Tokens (Edit zone WAF template) |
| `CF_ZONE_ID` | Cloudflare → domain overview → right column → Zone ID |
| `SUPABASE_ACCESS_TOKEN` | Supabase → account/tokens → Generate new token |
| `SUPABASE_PROJECT_REF` | Supabase → project → Settings → General → Reference ID |

> These are the **7 deploy secrets** listed in `docs/DEPLOY_SECRETS.md` (the SSOT). They must all be set for the GitHub Actions deploy workflow to run cleanly; missing any one skips the matching job with a `Missing token` warning.

### 3.6 · `--deploy-target=none`

No deploy provider secrets needed.

---

## 4 · Link backend + push migrations + set GitHub secrets

Only run the commands for **your** `--db` and `--deploy-target` choice. Skip the rest.

### 4.1 · `--db=supabase`

```bash
supabase login                              # one-time, paste access token
supabase link --project-ref <your-ref>      # links this repo to the Supabase project
supabase db push                            # applies migrations from supabase/migrations/
supabase functions deploy billing           # deploys the Edge Function
```

### 4.2 · `--db=neon`

```bash
pnpm drizzle-kit push                       # applies schema to Neon (no migrations folder)
```

### 4.3 · `--deploy-target=vercel`

```bash
gh auth login                               # one-time
./scripts/setup.sh                          # sets 7 GitHub Actions secrets + creates repo + pushes
./scripts/setup.sh --check                  # verifies prereqs (dry-run; no mutation)
./scripts/setup.sh --dry-run                # prints what would happen (safe to re-run)
```

### 4.4 · `--deploy-target=none`

No GitHub Actions deploy configured. Push to GitHub yourself:

```bash
git remote add origin git@github.com:<you>/<repo>.git
git push -u origin main
```

Then deploy `pnpm build` output via your platform of choice.

---

## 5 · First deploy

### 5.1 · `--deploy-target=vercel`

First-time only: visit Vercel → **Add New → Project** → select your repo → accept auto-detected Next.js build → **Deploy**.

Subsequent pushes auto-deploy. Watch progress:

```bash
gh run watch
```

4 jobs run in parallel:
- `vercel-deploy` — Next.js build + push to Vercel
- `cloudflare-pages-deploy` — alternate deploy target (skipped if `CF_API_TOKEN` is empty)
- `supabase-functions` — deploys `billing` Edge Function (skipped if `--db=neon`)
- `cloudflare-waf` — applies WAF rules from `cloudflare-rules.json` (skipped if `CF_API_TOKEN` is empty)

### 5.2 · `--deploy-target=none`

```bash
pnpm build
pnpm start                                  # production server on :3000
```

Or push the `.next/` output to your platform (Docker / Fly / Railway / etc.).

---

## 6 · Adding a new adapter (advanced)

If `--auth=none` and `--db=neon` don't cover your case, the adapter pattern makes it cheap to add new backends:

### 6.1 · New auth provider (e.g. NextAuth, Auth0, Supabase Auth)

1. Create `templates/_shared/adapters/auth/<provider>.ts`:

```ts
import type { AuthAdapter } from './types';

export class NextAuthAdapter implements AuthAdapter {
  readonly kind = 'nextauth' as const;
  // implement getUserId/getUser/getToken/requireUserId/useUser/useToken
  // implement Provider/SignInButton/SignUpButton/SignOutButton/UserButton
}

export const nextAuthAdapter = new NextAuthAdapter();
```

2. Register in `templates/_shared/adapters/auth/index.ts#detectKind()`:

```ts
if (env.AUTH_PROVIDER === 'nextauth') return 'nextauth';
```

3. Consumer code is unchanged — it calls `getAuthAdapter()` and the factory returns your adapter.

### 6.2 · New DB provider (e.g. PlanetScale, D1, Prisma+Postgres)

Same shape — create `templates/_shared/adapters/db/<provider>.ts` implementing the `DbAdapter` interface, register in the factory's `detectKind()`.

### 6.3 · Adapter pattern contract

See `templates/_shared/adapters/<auth|db>/types.ts` for the full interface. Each method's behavior is documented inline.

---

## 7 · What you should see (verify each step)

- `https://<your-project>.vercel.app` returns 200 with your landing page (only if `--deploy-target=vercel`)
- `supabase functions list --project-ref $SUPABASE_PROJECT_REF` shows `billing` deployed (only if `--db=supabase`)
- Cloudflare dashboard → your zone → **Security → WAF → Custom Rules** shows 6 rules (only if `CF_API_TOKEN` set + `--deploy-target=vercel`)
- `/pricing` page renders (always); billing buttons work only if `TOSS_SECRET_KEY` is set

---

## 8 · Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `pnpm install` fails with `EUNSUPPORTEDPROTOCOL: workspace:*` | ran `npm install` instead | use `pnpm install` — the `workspace:*` protocol is pnpm-only |
| `auth.getUserId()` returns `null` even after sign-in | `AUTH_PROVIDER` mismatch | check `.env.local` for `AUTH_PROVIDER=none` override; remove or set to `clerk` |
| `auth.getUser()` returns Clerk user but Supabase RLS rejects | JWKS URL not wired | re-do §3.3 step 6 (paste JWKS URL into Supabase dashboard) |
| `db.from('plans').select()` returns `error: NeonDbAdapter query execution not yet implemented` | Neon adapter MVP scope | tracked as follow-up; for now, use Drizzle directly or wait for next adapter release |
| `db.auth.getUser()` returns `data: null` even with valid Clerk JWT | DB adapter is Neon (`auth.getUser()` is Supabase-only) | Neon adapter doesn't proxy Supabase auth — use Clerk's `auth.getUser()` separately |
| Vercel deploy fails with `Missing token` | GitHub secret not set | re-run `./scripts/setup.sh` (it re-sets all 7 secrets) |
| First push doesn't trigger the deploy workflow | repo isn't on the default branch | `git branch -M main && git push -u origin main` |

---

## 9 · Time estimate (by adapter combination)

| `--auth` | `--db` | `--deploy-target` | Total time |
|---|---|---|---|
| `clerk` | `supabase` | `vercel` | ~15 min |
| `clerk` | `supabase` | `none` | ~10 min |
| `clerk` | `neon` | `vercel` | ~12 min |
| `clerk` | `neon` | `none` | ~8 min |
| `none` | `supabase` | `vercel` | ~12 min |
| `none` | `supabase` | `none` | ~7 min |
| `none` | `neon` | `vercel` | ~10 min |
| `none` | `neon` | `none` | ~5 min |
