# Step 2: ci-publish-workflow (.github/workflows/publish.yml, OIDC trusted publishing)

## Status
**pending** — last update: 2026-08-23T00:00:00Z

## Read first
- `/PRD.md`
- `.dev-kit/decision-log.md`
- `phases/1-cli-distribution/step0.md` — package.json publishConfig
- `phases/1-cli-distribution/step1.md` — dist/cli.js + prepublishOnly
- `.github/workflows/` — existing workflow shape (review.yml, version-bump.yml)

## Task

Files to create:
- `.github/workflows/publish.yml` — tag-trigger publish workflow using npm OIDC trusted publishing (no long-lived NPM_TOKEN secret):
  - `name: publish`
  - `on: push: tags: ['v*']` — only runs on semver tags
  - `permissions: id-token: write` — required for OIDC
  - `contents: read`
  - `jobs.publish:`
    - `runs-on: ubuntu-latest`
    - `steps:`
      1. `actions/checkout@v4`
      2. `actions/setup-node@v4` with `node-version: 20` and `registry-url: https://registry.npmjs.org/`
      3. `npm ci` (deterministic install per package-lock.json)
      4. `npm run build:cli` (step 1 wired this script; guarantees dist/cli.js exists)
      5. `npm publish --provenance --access public` (OIDC + provenance attestation)
  - Optional `concurrency: group: publish-${{ github.ref_name }}, cancel-in-progress: false` to prevent concurrent publishes of the same tag

Files to modify:
- `.github/workflows/version-bump.yml` (if it currently auto-pushes to main without waiting on publish) — verify it doesn't race with publish.yml. The existing flow per the recent commit history is auto-bump on merged PR; that's fine as long as publish.yml only fires on `v*` tags, not on main pushes.

Non-negotiable rules:
- The workflow MUST use OIDC (`id-token: write` + npm's OIDC trusted publishing) — DO NOT use a long-lived `NPM_TOKEN` secret. OIDC is the modern, auditable, revocable path; long-lived secrets are the v1 anti-pattern we're explicitly avoiding.
- The workflow MUST run only on tag push (`tags: ['v*']`), NEVER on push to main. Running on main would publish every merged commit.
- The workflow MUST call `npm run build:cli` before `npm publish` — without this, a tarball could be published with a stale or missing `dist/cli.js`.
- `npm ci` (not `npm install`) — uses the lockfile for reproducible builds; `npm install` would silently update deps.
- `--provenance` MUST be passed to `npm publish` — generates the public provenance attestation link on the npm package page; required for the security story.
- `--access public` MUST be passed — required for un-scoped packages to be installable via `npx`.

## Acceptance Criteria
```bash
# AC1: publish.yml exists at the canonical path
test -f .github/workflows/publish.yml
# AC2: workflow triggers on tag push, NOT on push to main or pull_request
grep -qE '^\s*tags:\s*\[\s*.v\*.\s*\]' .github/workflows/publish.yml
grep -qE '^\s*pull_request:' .github/workflows/publish.yml && echo "FAIL: triggers on PR" && exit 1 || true
# AC3: id-token: write permission is declared (required for OIDC)
grep -q 'id-token: write' .github/workflows/publish.yml
# AC4: workflow uses actions/setup-node@v4 with registry-url
grep -qE 'actions/setup-node@.*registry-url' .github/workflows/publish.yml
# AC5: workflow calls npm ci (not npm install) — reproducible install
grep -qE '^\s*-\s*run:\s*npm ci' .github/workflows/publish.yml
# AC6: workflow calls npm run build:cli before npm publish
grep -qE 'npm run build:cli' .github/workflows/publish.yml
# AC7: workflow calls npm publish with --provenance and --access public
grep -qE 'npm publish.*--provenance' .github/workflows/publish.yml
grep -qE 'npm publish.*--access public' .github/workflows/publish.yml
# AC8: workflow YAML is parseable (GitHub Actions rejects malformed YAML at PR time)
node -e "const yaml=require('fs').readFileSync('.github/workflows/publish.yml','utf8'); console.log(yaml.split('\\n').length>5)"
```

## Verification & Status Update (REQUIRED before claiming done)
1. Run AC1–AC8 above. Quote each exit code in the reply.
2. Update `phases/1-cli-distribution/index.json` for THIS step:
   - **Success** → `"status": "completed"`, `"summary": "<one-line: .github/workflows/publish.yml tag-trigger + OIDC + provenance + npm ci + build:cli; AC1-AC8 green>"`
   - **Unrecoverable failure** → `"status": "error"`, `"error_message": "<which AC failed, exit code, last 3 lines>"`
   - **External dependency** (e.g. GitHub-side OIDC trust config not yet set on npmjs.com) → `"status": "blocked"`, `"blocked_reason": "<what's needed>"`, then STOP. (Note: OIDC trust must be configured once at https://www.npmjs.com/settings/.../publishing before the FIRST publish; subsequent runs are fully OIDC.)
3. Emit EXACTLY these two HTML-comment markers as the last two lines of the final reply:

```
<!-- status: completed | error | blocked -->
<!-- summary: <one-line outcome> | error_message: <concrete error> | blocked_reason: <what's needed> -->
```

## Don't
- Don't use a long-lived `NPM_TOKEN` secret — OIDC is the contract.
- Don't trigger on `push: branches: [main]` — every merged commit would publish.
- Don't use `npm install` — use `npm ci` for lockfile-deterministic installs.
- Don't omit `--provenance` — drops the public provenance attestation link.
- Don't omit `npm run build:cli` — tarball could ship with a stale `dist/cli.js`.
- Don't add new files outside the path scope declared in `## Read first` (no edits to root `CLAUDE.md`, no edits to other phases).
