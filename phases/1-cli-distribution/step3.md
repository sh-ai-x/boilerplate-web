# Step 3: e2e-scaffold-test (CI matrix: saas/shop/portfolio)

## Status
**pending** — last update: 2026-08-23T00:00:00Z

## Read first
- `/PRD.md`
- `.dev-kit/decision-log.md`
- `phases/1-cli-distribution/step0.md` — package.json bin/entry
- `phases/1-cli-distribution/step1.md` — dist/cli.js bundle
- `phases/0-mvp/step0.md` — original CLI scaffold + post-install checklist (the contract this e2e test exercises)
- `templates/` — three template directories: saas, shop, portfolio
- `templates.lock.json` — pins which template versions ship with which CLI version

## Task

Files to create:
- `.github/workflows/e2e-scaffold.yml` — CI matrix that scaffolds each of the 3 templates into a fresh temp dir, asserts the expected files exist, and asserts `--type=invalid` is rejected:
  - `name: e2e-scaffold`
  - `on: pull_request:`, `push: branches: [main]`, `workflow_dispatch:`
  - `permissions: contents: read`
  - `jobs.test:`
    - `runs-on: ubuntu-latest`
    - `strategy.matrix: type: [saas, shop, portfolio]`
    - `steps:`
      1. `actions/checkout@v4`
      2. `actions/setup-node@v4` with `node-version: 20`
      3. `npm ci`
      4. `npm run build:cli` (build the bundle being shipped)
      5. `node dist/cli.js /tmp/e2e-${{ matrix.type }} --type=${{ matrix.type }}`
      6. Assert expected files exist: `test -f /tmp/e2e-${{ matrix.type }}/package.json && test -d /tmp/e2e-${{ matrix.type }}/app`
      7. Assert `package.json name` was rewritten to `e2e-${{ matrix.type }}`
- `.github/workflows/e2e-scaffold.yml` — additional step in the SAME job (not a separate job) that runs the negative case once per matrix tick (or in a separate job without matrix):
  - `node dist/cli.js /tmp/e2e-bad --type=invalid` should exit non-zero AND `/tmp/e2e-bad` should NOT exist.

Files to modify:
- None.

Non-negotiable rules:
- The e2e workflow MUST exercise the BUILT bundle (`dist/cli.js`), NOT `cli/index.js` directly. The whole point is to verify what `npm publish` actually ships.
- The e2e workflow MUST scaffold into a fresh `/tmp/...` directory per matrix tick — leftover state from a previous tick would mask real failures.
- The e2e workflow MUST include the negative case (`--type=invalid` rejection) — without it, a regression that allows unknown types to silently proceed would pass CI.
- The workflow MUST run on every PR and on every push to main (not just on tag) — this is the gate that protects against regressions BEFORE release, not just on release.
- Do NOT call `npm install` inside the scaffolded template (`/tmp/e2e-<type>/`) — that would require network and add 60-120s per matrix tick. The test asserts file STRUCTURE, not that the scaffolded app boots.

## Acceptance Criteria
```bash
# AC1: e2e-scaffold.yml exists at the canonical path
test -f .github/workflows/e2e-scaffold.yml
# AC2: workflow declares matrix with saas, shop, portfolio
grep -qE 'type:\s*\[\s*saas\s*,\s*shop\s*,\s*portfolio\s*\]' .github/workflows/e2e-scaffold.yml
# AC3: workflow runs dist/cli.js (the built bundle, not the source)
grep -qE 'node dist/cli\.js' .github/workflows/e2e-scaffold.yml
# AC4: workflow asserts package.json was created
grep -qE 'package\.json' .github/workflows/e2e-scaffold.yml
# AC5: workflow runs npm run build:cli before invoking dist/cli.js
grep -qE 'npm run build:cli' .github/workflows/e2e-scaffold.yml
# AC6: workflow triggers on pull_request AND push to main (not just on tag)
grep -qE 'pull_request:' .github/workflows/e2e-scaffold.yml
grep -qE 'branches:\s*\[\s*main\s*\]' .github/workflows/e2e-scaffold.yml
# AC7: workflow YAML parses (no syntax errors that would fail GitHub's validator)
node -e "console.log(require('fs').readFileSync('.github/workflows/e2e-scaffold.yml','utf8').length>200)"
# AC8: negative-case test for --type=invalid is wired (either in matrix or as a parallel step)
grep -qE 'invalid' .github/workflows/e2e-scaffold.yml
```

## Verification & Status Update (REQUIRED before claiming done)
1. Run AC1–AC8 above. Quote each exit code in the reply.
2. Update `phases/1-cli-distribution/index.json` for THIS step:
   - **Success** → `"status": "completed"`, `"summary": "<one-line: .github/workflows/e2e-scaffold.yml matrix [saas,shop,portfolio] + --type=invalid negative case + dist/cli.js bundle; AC1-AC8 green>"`
   - **Unrecoverable failure** → `"status": "error"`, `"error_message": "<which AC failed, exit code, last 3 lines>"`
   - **External dependency** (e.g. workflow needs GitHub-side npm registry auth to fetch templates from `templates.lock.json`) → `"status": "blocked"`, `"blocked_reason": "<what's needed>"`, then STOP.
3. Emit EXACTLY these two HTML-comment markers as the last two lines of the final reply:

```
<!-- status: completed | error | blocked -->
<!-- summary: <one-line outcome> | error_message: <concrete error> | blocked_reason: <what's needed> -->
```

## Don't
- Don't exercise `cli/index.js` (the source) — always exercise `dist/cli.js` (the bundle being shipped).
- Don't `npm install` inside the scaffolded template — that bloats the matrix tick by 60-120s with no added signal.
- Don't skip the `--type=invalid` negative case — it would let regressions pass CI.
- Don't trigger only on tag push — the e2e gate must run BEFORE merge, not just on release.
- Don't add new files outside the path scope declared in `## Read first` (no edits to root `CLAUDE.md`, no edits to other phases).
