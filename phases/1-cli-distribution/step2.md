# Step 2: `.github/workflows/publish.yml` — OIDC trusted publishing to npm

## Status
**in_review** (v2 refresh for PR #51) — last update: 2026-08-02T00:00:00Z

v1 was PR #46 (still OPEN on branch `plan/boilerplate-cli-distribution-step2`).
v2 reopens the step on `plan/boilerplate-cli-distribution-step2-v2` with
the 8 review blockers resolved: real dist-tag derivation from ref,
environment-gated approval, post-build CLI smoke check (no synthetic
`build:cli` prereq), `workflow_dispatch` restricted to `main`, refreshed
`delivered_via` metadata, and this narrative file.

## Read first
- `/PRD.md` (project-level: 1-cli-distribution deliverable = `npx create-boilerplate-web`)
- `phases/1-cli-distribution/index.json`
- `phases/1-cli-distribution/step2-output.json` (v1 ledger)
- `phases/0-mvp/step2.md` (convention reference for the per-step narrative + AC + Don't shape)
- `phases/0-mvp/step5.md` (Cloudflare-side gates — same approval-gate pattern via GitHub Environment)
- npm docs: https://docs.npmjs.com/trusted-publishers and https://docs.npmjs.com/generating-provenance-statements
- GitHub docs: https://docs.github.com/en/actions/deployment/targeting-different-environments/using-environments-for-deployment

## Task

A single workflow file: `.github/workflows/publish.yml`.

### Triggers
- `workflow_dispatch` — manual release from the GitHub UI on the default branch.
  **Branch-restricted to `main`** so a feature branch with an in-progress
  `version` bump cannot accidentally publish.
- `push` of tags matching `v*.*.*` — auto-release on semver tag push.

### Dist-tag derivation
Git ref names must NOT be passed through verbatim as npm dist-tags:
- `v1.2.3` → `latest`
- `v1.2.3-rc.1` → `rc`
- `v1.2.3-beta.4` → `beta`
- `v1.2.3-alpha.0` → `alpha`
- `v1.2.3-foo.bar` (anything unrecognised) → defaults to `latest`
  (safer than refusing the publish; a maintainer can `npm dist-tag rm` later)

This logic lives in a `Derive npm dist-tag from ref` step that writes
`tag=<latest|rc|beta|alpha>` to `$GITHUB_OUTPUT`. The `Publish to npm`
step consumes it via `NPM_CONFIG_TAG: ${{ steps.dist_tag.outputs.tag }}`.

### OIDC trusted publishing (no long-lived secret)
- Job declares `permissions: { contents: read, id-token: write }`.
- `npm publish --provenance --access public` runs against the configured
  npm trusted publisher for `create-boilerplate-web` on this repo.
- No `NPM_TOKEN`, no `NODE_AUTH_TOKEN`, no `~/.npmrc` checked into CI.

### Environment-based approval gate
The `publish` job declares:
```yaml
environment:
  name: npm-publish
  url: https://www.npmjs.com/package/create-boilerplate-web
```
Tag pushes as well as `workflow_dispatch` runs are required to deploy
into the `npm-publish` GitHub Environment, which is configured (out of
band, by the repo admin) with required reviewers = the maintainer.

### Build → test → smoke → publish
1. `actions/checkout` (SHA-pinned).
2. `actions/setup-node` v4 with Node `20` (SHA-pinned).
3. `pnpm/action-setup` (SHA-pinned) at version `9`.
4. `pnpm install --frozen-lockfile`.
5. `npm run build:cli` — owned by step 1 (CLI bundle build). This step
   trusts the script's contract from step 1.
6. `pnpm test` — project test suite via `node --test tests/`.
7. Post-build smoke check — verifies the bundled CLI is **executable**
   and prints `--help` containing the package name `create-boilerplate-web`.
   Smoke probes both `dist/cli.js` and `cli/dist/cli.js` (the two path
   conventions from step 0 / step 1), so it is robust either way.
8. `Derive npm dist-tag from ref` (see above).
9. `npm publish --provenance --access public`.

### SHA pinning
All third-party actions are referenced by full commit SHA:
- `actions/checkout@11d5960a326750d5838078e36cf38b85af677262`
- `actions/setup-node@39370e3970a6d050c480ffad4ff0ed4d3fdee5af`
- `pnpm/action-setup@fe02b34f77f8bc703788d5817da081398fad5b2b`

### Concurrency
`concurrency: { group: publish-${{ github.ref }}, cancel-in-progress: false }`.
Two publishes for the same tag never race; only one is in flight, and
later runs wait their turn rather than cancelling an in-flight registry
upload (which would leave the registry in a partial state).

## Acceptance Criteria
```bash
# AC3.1a: workflow file present
test -f .github/workflows/publish.yml
# AC3.1b: npm publish command present
grep -E 'npm publish' .github/workflows/publish.yml
# AC3.1c: OIDC id-token: write declared
grep -E 'id-token:[[:space:]]*write' .github/workflows/publish.yml
# AC3.1d: tag trigger pattern present
grep -qE 'tags:[[:space:]]*\[' .github/workflows/publish.yml && grep -q "'v\*\.\*\.\*'" .github/workflows/publish.yml
# AC3.2 : no NPM_TOKEN / NODE_AUTH_TOKEN (OIDC only)
! grep -E 'NPM_TOKEN|node-auth-token' .github/workflows/publish.yml
# AC3.3 : dist-tag derived, not literal ref_name
grep -qE 'steps\.dist_tag\.outputs\.tag' .github/workflows/publish.yml
# AC3.4 : npm-publish environment declared
grep -qE 'name:[[:space:]]*npm-publish' .github/workflows/publish.yml
# AC3.5 : workflow_dispatch restricted to main
grep -qE 'branches:[[:space:]]*\[main\]' .github/workflows/publish.yml
# AC3.6 : post-build smoke step exists
grep -qE 'Post-build smoke check' .github/workflows/publish.yml
# AC3.7 : YAML parses
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/publish.yml'))"
# AC3.8 : no synthetic `build:cli` prereq check
! grep -qE "build:cli not yet defined" .github/workflows/publish.yml
```
All ten must exit `0`.

## Verification & Status Update (REQUIRED before claiming done)
1. Run AC3.1a through AC3.8. Quote exit codes.
2. Update `phases/1-cli-distribution/index.json` step 2 → `completed`
   (already `completed` in v2; refresh `delivered_via` if commit SHA
   changes).
3. Emit the two HTML-comment markers as the last two lines of the
   completion commit.

## Don't
- Don't pass `github.ref_name` literally into `NPM_CONFIG_TAG` — derive
  the dist-tag from the ref (latest/rc/beta/alpha).
- Don't auto-publish to npm without an environment-based human gate;
  configure the `npm-publish` GitHub Environment with required reviewers
  in repo settings.
- Don't reference `NPM_TOKEN` or `NODE_AUTH_TOKEN` — OIDC trusted
  publishing is the only auth path.
- Don't run the synthetic `build:cli not yet defined` prereq in CI. The
  contract comes from step 1; trust `actions/setup-node` for Node and
  let the real `npm run build:cli` step fail loudly if the script is
  missing.
- Don't allow `workflow_dispatch` from arbitrary branches. Restrict it
  to `main` so an in-progress feature branch with a typo'd `version`
  can't accidentally publish.
- Don't `cancel-in-progress: true` — a partial publish mid-cancel can
  leave the npm registry half-published. Serialize via
  `cancel-in-progress: false` instead.
- Don't edit files outside `.github/workflows/publish.yml`,
  `phases/1-cli-distribution/`, `.nvmrc`, and `package.json` (the minor
  toolchain markers added in v2).
