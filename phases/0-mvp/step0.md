# Step 0: CLI scaffold with degit sub-folder targeting + post-install hook

## Status
**pending** — last update: 2026-07-16T00:00:00Z

## Read first
- `/PRD.md`
- `.prd/decision-log.md`

## Task

Files to create at repo root:
- `cli/index.js` — entrypoint; reads `<targetFolder>` positional arg + `--type=<saas|shop|portfolio>` flag.
- `cli/lib/target-download.js` — uses `degit` (`github:sanghee-dev/boilerplate-web/templates/<type>`) to clone ONLY the sub-folder, not the whole repo. Validate `<type>` ∈ {saas, shop, portfolio} BEFORE the download.
- `cli/lib/rewrite.js` — read `<targetFolder>/package.json`, set `name` to the basename of `<targetFolder>`, leave all other fields intact.
- `cli/lib/post-install.js` — after `npm install` completes, print a numbered checklist: (1) `cp .env.example .env.local`, (2) `supabase link --project-ref <YOUR_REF>`, (3) `supabase db push`, (4) `supabase functions deploy <fn-name>`. Do NOT execute any of these — print only.
- Root `package.json` — `"bin": { "create-boilerplate-web": "cli/index.js" }`, `"type": "commonjs"`, dependencies `degit@^2.8`, `chalk@^5`.
- Root `README.md` — first section explains the `--type` flag and lists the 3 supported values.

Non-negotiable rules:
- The download MUST target the sub-folder only. A full-repo clone is a hard failure.
- `<type>` validation rejects unknown values BEFORE the network call.
- `rewrite.js` MUST NOT touch `dependencies`, `devDependencies`, or `scripts` keys — only `name`.

## Acceptance Criteria
```bash
# AC1: CLI scaffold runs end-to-end on a temp target with --type=saas
node cli/index.js /tmp/cbw-test-saas --type=saas && test -f /tmp/cbw-test-saas/package.json
# AC2: package.json name was rewritten to the target folder basename
node -e "console.log(require('/tmp/cbw-test-saas/package.json').name)" | grep -q '^cbw-test-saas$'
# AC3: --type=invalid rejected before any network call (no /tmp/cbw-test-bad created)
node cli/index.js /tmp/cbw-test-bad --type=invalid; test $? -ne 0 && test ! -d /tmp/cbw-test-bad
# AC4: sub-folder targeting — only templates/saas content copied, no root .git, no AGENTS.md
test ! -e /tmp/cbw-test-saas/AGENTS.md && test ! -e /tmp/cbw-test-saas/.git
# AC5: post-install checklist printed (look for 'supabase link' line)
node cli/index.js /tmp/cbw-test-shop --type=shop 2>&1 | grep -q 'supabase link'
```

## Verification & Status Update (REQUIRED before claiming done)
1. Run AC1–AC5 above. Quote each exit code in the reply (e.g. "AC1: exit 0", "AC2: exit 0", "AC3: exit 1 (invalid type, no dir created)").
2. Update `phases/0-mvp/index.json` for THIS step:
   - **Success** → `"status": "completed"`, `"summary": "<one-line: CLI scaffold + degit targeting + name rewrite + post-install checklist; AC1-AC5 green>"`
   - **Unrecoverable failure** → `"status": "error"`, `"error_message": "<concrete error: which AC failed, exit code, last 3 lines>"`
   - **External dependency** (e.g. npm registry rate-limit) → `"status": "blocked"`, `"blocked_reason": "<what's needed>"`, then STOP.
3. Emit EXACTLY these two HTML-comment markers as the last two lines of the final reply:

```
<!-- status: completed | error | blocked -->
<!-- summary: <one-line outcome> | error_message: <concrete error> | blocked_reason: <what's needed> -->
```

## Don't
- Don't `git clone` the master repo — defeats sub-folder targeting; use `degit`.
- Don't execute `supabase link` non-interactively in the post-install hook — print instructions only.
- Don't modify `dependencies`, `devDependencies`, or `scripts` in the target `package.json`; rewrite ONLY `name`.
- Don't add new files outside the path scope declared in `## Read first` (no edits to root `CLAUDE.md`, no edits to other phases).