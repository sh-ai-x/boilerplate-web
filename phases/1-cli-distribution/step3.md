# Step 3: CI matrix: end-to-end scaffold test for saas/shop/portfolio

## Status
**completed** — last update: 2026-07-30T16:03:58Z

## Read first
- `/PRD.md`
- `phases/1-cli-distribution/index.json`
- `phases/1-cli-distribution/step0.md` … `step2.md`
- `cli/` source (re-bundled as `dist/cli.js` in step 1)

## Task
- Add `scripts/e2e-scaffold-test.sh` at the repo root that:
  - Builds the CLI (`npm run build:cli`)
  - Runs `node ./dist/cli.js /tmp/cbw-test-$1 --type=$1` for the type argument (saas/shop/portfolio), against a fresh temp dir
  - Asserts the target exists, the package.json name is rewritten to the target basename, and the target dir contains a populated `app/` directory
  - Cleans up the temp dir on exit (trap EXIT)
  - Exits 0 on PASS, non-zero on FAIL
- Wire `scripts/e2e-scaffold-test.sh` into `package.json` as `"test:scaffold"` (`shellcheck`-clean, `bash` strict mode)
- Update `.github/workflows/ci.yml` (the existing CI workflow) to add a matrix job that runs `npm run test:scaffold` against `types: ['saas', 'shop', 'portfolio']`. Cross-platform: use `ubuntu-latest` only.

## Acceptance Criteria
```bash
# AC4: scaffold against a real package.json template resolves and rewrites name
bash scripts/e2e-scaffold-test.sh saas && test -f /tmp/cbw-test-saas/package.json
node -e "console.log(require('/tmp/cbw-test-saas/package.json').name)" | grep -q '^cbw-test-saas$'
# AC4.1: invalid --type rejected before any network call (existing AC3 from step 0, regression)
node scripts/e2e-scaffold-test.sh 2>/dev/null || echo "PASS — invalid type rejected"
```

## Verification & Status Update (REQUIRED before claiming done)

(Same Verification & Status Update block.)

## Don't
- Do not create a real network call against the public npm registry from CI. Reason: CI uses the bundled `dist/cli.js`, which depends on the in-repo `templates/*` directories only.
- Do not modify the existing `templates/_shared/`, `templates/saas/`, `templates/shop/`, `templates/portfolio/` content from this step. Reason: scope freeze.
- Do not delete the test temp dirs to satisfy a timeout — use `trap EXIT` cleanup. Reason: deterministic cleanup prevents `node_modules` build artifacts bleeding between runs.
