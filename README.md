# boilerplate-web

> `npx create-boilerplate-web <folder> --type=<saas|shop|portfolio>` —
> scaffold a Next.js + Supabase + Cloudflare + Toss template into a target folder.

This repo is the source-of-truth for the `create-boilerplate-web` CLI and
three independently-buildable templates. Pick the type that matches what you
are shipping, scaffold it into a fresh folder, and customize from there.

## What this is

- **A smart-clone CLI** that targets a sub-folder of this repo via `degit`.
  No full-repo clones. Type validation happens before the network call.
- **Three production-grade templates** that share a common `_shared` infra
  package (Supabase client factories, Google-OAuth-only auth, optional
  Cloudflare Turnstile component).
- **A Toss-only payment path** with the Toss API call isolated to Supabase
  Edge Functions. Prices live in a database table; clients can never inject
  an amount.

## Install & Scaffold (npm)

The fastest way to scaffold a new project is via `npx`:

```bash
# SaaS template (Next.js + Supabase + Cloudflare + Toss billing-key)
npx create-boilerplate-web my-saas-app --type=saas
cd my-saas-app
npm install
cp .env.example .env.local
```

```bash
# Shop template (Next.js + Supabase + Cloudflare + Toss single-payment)
npx create-boilerplate-web my-shop --type=shop
cd my-shop
npm install
```

```bash
# Portfolio template (Next.js + Supabase + MDX + Google OAuth write — no payment, no Cloudflare WAF)
npx create-boilerplate-web my-portfolio --type=portfolio
cd my-portfolio
npm install
```

The CLI downloads only the template sub-folder (not the whole repo), rewrites `package.json#name`, and prints a numbered post-install checklist (`supabase link`, `supabase db push`, `supabase functions deploy`). See the [Quick-start](#quick-start) section below for the full per-template setup flow.

### Requirements

- Node.js ≥ 18
- npm ≥ 9 (`npx` ships with npm)
- A Supabase project (free tier is enough; you'll wire the project-ref in step 2 of the post-install checklist)
- A Cloudflare account (only for saas + shop templates; portfolio doesn't need it)
- A Toss Payments sandbox account (only for saas + shop templates)
- A Google OAuth client (only needed for saas + portfolio; shop uses Toss-only checkout)

## Quick-start

```bash
# SaaS template — recurring billing via Toss billing-key
npx create-boilerplate-web my-saas --type=saas

# Shop template — single-payment + encrypted shipping via pgsodium
npx create-boilerplate-web my-shop --type=shop

# Portfolio template — MDX portfolio + Google-auth guestbook (no payment)
npx create-boilerplate-web my-portfolio --type=portfolio
```

Each command clones `templates/<type>` from this repo (not the full repo),
rewrites the target `package.json` name to the folder basename, runs
`npm install`, and prints a numbered Supabase / Cloudflare setup checklist.

## Template matrix

| Template   | Auth          | Payment                | Encryption      | Turnstile | WAF rules |
|------------|---------------|------------------------|-----------------|-----------|-----------|
| `saas`     | Google OAuth  | Toss billing-key       | (DB at-rest)    | Yes       | Yes       |
| `shop`     | Google OAuth  | Toss single-payment    | pgsodium TDE    | Yes       | Yes       |
| `portfolio`| Google OAuth  | — (none)               | —               | No        | No        |

## Env-var matrix

| Env var                          | Used by                          | Required?      |
|----------------------------------|----------------------------------|----------------|
| `NEXT_PUBLIC_SUPABASE_URL`       | all 3 templates                  | Yes            |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY`  | all 3 templates                  | Yes            |
| `SUPABASE_SERVICE_ROLE_KEY`      | saas, shop, portfolio (admin paths) | Yes         |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | saas, shop                       | saas+shop only |
| `TURNSTILE_SECRET_KEY`           | saas, shop                       | saas+shop only |
| `TOSS_SECRET_KEY`                | saas, shop                       | saas+shop only |
| `TOSS_AUTH_KEY`                  | saas                             | saas only      |

## Architecture

```
                       ┌─────────────────┐
   Browser  ────HTTPS──│   Next.js app   │  (Vercel / Cloudflare Pages)
                       │  /pricing, etc. │
                       └────────┬────────┘
                                │ service-role / user JWT
                                ▼
                       ┌─────────────────┐
                       │  Supabase Edge  │  (Deno runtime)
                       │  Function       │  ──→ Toss Payments API
                       │  billing | pay  │  ──→ Cloudflare Turnstile verify
                       └────────┬────────┘
                                │
                                ▼
                       ┌─────────────────┐
                       │  Supabase       │
                       │  Postgres + RLS │
                       └─────────────────┘
                                ▲
                                │ WAF: rate-limit, geo, scanner-UA
                       ┌────────┴────────┐
                       │   Cloudflare    │  (WAF + Turnstile widget)
                       └─────────────────┘
```

## Security non-goals (links)

Per the PRD non-goals, this boilerplate deliberately does **NOT** include:

1. Email/password or magic-link authentication. Google OAuth is the only
   sign-in path. See
   [.prd/decision-log.md §3 non-goal #1](.prd/decision-log.md#gate-3-non-goals).
2. Payment providers beyond Toss. See
   [.prd/decision-log.md §3 non-goal #2](.prd/decision-log.md#gate-3-non-goals).
3. Multi-tenant Supabase. Each user brings their own Supabase project. See
   [.prd/decision-log.md §3 non-goal #3](.prd/decision-log.md#gate-3-non-goals).

## License

MIT
