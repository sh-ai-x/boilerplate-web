# Step 4: portfolio template — portfolio_items + guestbook schema, MDX render, Google-auth write — no payment, no Turnstile

## Status
**pending** — last update: 2026-07-16T00:00:00Z

## Read first
- `/PRD.md`
- `.prd/decision-log.md`
- `phases/0-mvp/step0.md`
- `phases/0-mvp/step1.md`
- `templates/_shared/`

## Task

Directory: `templates/portfolio/`.

- `templates/portfolio/package.json` — depends on `@boilerplate-web/shared`, `@next/mdx`, `gray-matter`. NO `@supabase/supabase-js` server-side calls outside the client wrapper.
- `templates/portfolio/supabase/migrations/0001_init.sql`:
  - `portfolio_items (id uuid pk, slug text unique, title text, content_mdx text not null, published_at timestamptz, created_at timestamptz default now())`
  - `guestbook_entries (id uuid pk, user_id uuid not null references auth.users(id), message text not null check (length(message) <= 1000), created_at timestamptz default now())`
  - RLS: `portfolio_items` readable by anon + authenticated (public portfolio); writable by admin role. `guestbook_entries` readable by all; insertable only by authenticated users (`auth.uid() IS NOT NULL`); users can delete their own entries (`auth.uid() = user_id`); admin can delete any.
- `templates/portfolio/app/portfolio/page.tsx` — list of `portfolio_items` from DB; uses MDX render.
- `templates/portfolio/app/portfolio/[slug]/page.tsx` — single-item render; passes `content_mdx` to `@next/mdx` remote-bound renderer.
- `templates/portfolio/app/guestbook/page.tsx` — list + signed-in Google user can post. Form has only a textarea + Google sign-in button (from `_shared`).
- `templates/portfolio/app/guestbook/actions.ts` — server action: `INSERT INTO guestbook_entries (user_id, message) VALUES (auth.uid(), $message)`. Length check (≤1000 chars) both client-side and via DB constraint.

Non-negotiable rules:
- Portfolio template MUST NOT import Toss, Turnstile, or any payment code (Gate 3 non-goal #2; dead code = L4 violation).
- Auth is Google-OAuth only, via `_shared/auth/GoogleSignInButton`. No email/password.
- MDX content is stored as `text` in DB; no file-based content (pure DB-driven portfolio).

## Acceptance Criteria
```bash
# AC1: portfolio template builds
pnpm --filter portfolio build && echo "AC1 ok"
# AC2: NO Toss code anywhere in portfolio
grep -rE 'toss|TossPayments' templates/portfolio/ && exit 1
# AC3: NO Turnstile code anywhere in portfolio
grep -rE 'turnstile|Turnstile' templates/portfolio/ && exit 1
# AC4: portfolio uses shared GoogleSignInButton (no local email/password form)
grep -rE 'type="(email|password)"' templates/portfolio/ && exit 1
# AC5: portfolio tests pass (MDX render + guestbook insert w/ auth + guestbook length check)
pnpm --filter portfolio test 2>&1 | tail -10
# AC6: migration applies
supabase db reset --linked 2>&1 | tail -5 || echo "AC6 skipped — CI will run"
```

## Verification & Status Update (REQUIRED before claiming done)
1. Run AC1–AC6. Quote exit codes.
2. Update `phases/0-mvp/index.json` step 4 → `completed`/`error`/`blocked`.
3. Emit the two HTML-comment markers as the last two lines.

## Don't
- Don't import Toss or Turnstile code (L4 dead-code prohibition + non-goal #2).
- Don't add an email/password form to the guestbook (non-goal #1).
- Don't read MDX content from the filesystem — DB only.
- Don't edit files outside `templates/portfolio/` and `phases/0-mvp/`.