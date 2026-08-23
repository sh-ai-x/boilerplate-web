# Step 4: readme-install-instructions (root README for `npx create-boilerplate-web`)

## Status
**pending** — last update: 2026-08-23T00:00:00Z

## Read first
- `/PRD.md`
- `.dev-kit/decision-log.md`
- `phases/1-cli-distribution/step0.md` — package name `create-boilerplate-web`
- `phases/0-mvp/step6.md` — original root README + per-template deploy READMEs (this step ADDS to the root README; doesn't replace it)
- `templates/saas/README.md`, `templates/shop/README.md`, `templates/portfolio/README.md` — already shipped via phase 0-mvp step 6

## Task

Files to modify:
- `README.md` — at the TOP (before the existing "Quick-start" section), add a new section:

```markdown
## Install & Scaffold (npm)

The fastest way to scaffold a new project is via `npx`:

\`\`\`bash
# SaaS template (Next.js + Supabase + Cloudflare + Toss billing-key)
npx create-boilerplate-web my-saas-app --type=saas
cd my-saas-app
npm install
cp .env.example .env.local
\`\`\`

\`\`\`bash
# Shop template (Next.js + Supabase + Cloudflare + Toss single-payment)
npx create-boilerplate-web my-shop --type=shop
cd my-shop
npm install
\`\`\`

\`\`\`bash
# Portfolio template (Next.js + Supabase + MDX + Google OAuth write — no payment, no Cloudflare WAF)
npx create-boilerplate-web my-portfolio --type=portfolio
cd my-portfolio
npm install
\`\`\`

The CLI downloads only the template sub-folder (not the whole repo), rewrites `package.json#name`, and prints a numbered post-install checklist (`supabase link`, `supabase db push`, `supabase functions deploy`). See the [Quick-start](#quick-start) section below for the full per-template setup flow.

### Requirements
- Node.js ≥ 18
- npm ≥ 9 (`npx` ships with npm)
- A Supabase project (free tier is enough; you'll wire the project-ref in step 2 of the post-install checklist)
- A Cloudflare account (only for saas + shop templates; portfolio doesn't need it)
- A Toss Payments sandbox account (only for saas + shop templates)
- A Google OAuth client (only needed for saas + portfolio; shop uses Toss-only checkout)
```

Files to create:
- None.

Non-negotiable rules:
- The new section MUST appear BEFORE the existing Quick-start section (the npm path is now the primary user journey, not the git-clone path).
- All 3 templates MUST have a copy-paste-ready code fence (`saas`, `shop`, `portfolio`) — without it, users have to guess the right `--type` value.
- The "Requirements" subsection MUST list Node.js ≥ 18 + npm ≥ 9 — without it, users on Node 16 hit ESM/CJS errors that look like CLI bugs.
- Do NOT remove or rewrite the existing Quick-start section — that's the path for users who want to hack on the templates themselves, and it ships with the repo (it's how the maintainers work). The new section ADDS to the README.
- Do NOT add a GIF/screenshot/demo link — there is no canonical demo URL yet, and a broken link would degrade trust.
- Do NOT mention pricing or signup fees — Toss billing is sandbox-only by default in v1.

## Acceptance Criteria
```bash
# AC1: README.md mentions the npm install command `npx create-boilerplate-web`
grep -q 'npx create-boilerplate-web' README.md
# AC2: README.md mentions all 3 --type values: saas, shop, portfolio
grep -q -- '--type=saas' README.md && grep -q -- '--type=shop' README.md && grep -q -- '--type=portfolio' README.md
# AC3: README.md declares Node.js ≥ 18 as a requirement
grep -qE 'Node\.js.*(>=|≥|greater than or equal to)\s*18' README.md
# AC4: the new "Install & Scaffold (npm)" section appears BEFORE the existing "Quick-start" section
node -e "
const fs = require('fs');
const md = fs.readFileSync('README.md', 'utf8');
const npmIdx = md.indexOf('Install & Scaffold');
const qsIdx  = md.indexOf('Quick-start');
console.log(npmIdx >= 0 && qsIdx >= 0 && npmIdx < qsIdx);
" | grep -q 'true'
# AC5: README.md still contains the original "Quick-start" section (we ADDED, not replaced)
grep -q 'Quick-start' README.md
# AC6: README.md still contains the per-template quick-start tables (saas / shop / portfolio matrix from step 6 of 0-mvp)
grep -q 'saas' README.md && grep -q 'shop' README.md && grep -q 'portfolio' README.md
```

## Verification & Status Update (REQUIRED before claiming done)
1. Run AC1–AC6 above. Quote each exit code in the reply.
2. Update `phases/1-cli-distribution/index.json` for THIS step:
   - **Success** → `"status": "completed"`, `"summary": "<one-line: README.md adds npx install path with all 3 --type copy-paste blocks + Node≥18 requirement, preserves existing Quick-start; AC1-AC6 green>"`
   - **Unrecoverable failure** → `"status": "error"`, `"error_message": "<which AC failed, exit code, last 3 lines>"`
   - **External dependency** (e.g. README rewrite needs a docs review from a non-engineer) → `"status": "blocked"`, `"blocked_reason": "<what's needed>"`, then STOP.
3. Emit EXACTLY these two HTML-comment markers as the last two lines of the final reply:

```
<!-- status: completed | error | blocked -->
<!-- summary: <one-line outcome> | error_message: <concrete error> | blocked_reason: <what's needed> -->
```

## Don't
- Don't remove the existing "Quick-start" section — it's the maintainer path; we ADD, not replace.
- Don't omit any of the 3 templates from the npm code fences — users on the wrong template would hit unclear errors.
- Don't hard-code a Node version older than 18 — Node 16 is EOL.
- Don't add a demo URL or GIF — there's no canonical demo yet; broken media degrades trust.
- Don't mention pricing or signup fees — Toss is sandbox-only in v1.
- Don't add new files outside the path scope declared in `## Read first` (no edits to root `CLAUDE.md`, no edits to other phases).
