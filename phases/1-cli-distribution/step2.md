# Step 2: `.github/workflows/publish.yml` — OIDC trusted publishing to npm

## Status
**completed** — re-landed via `fix/1-cli-distribution-step2` (2026-08-19).

v1 (PR #46) and v2 (PR #51) both wrote this exact file and both passed every
AC locally, but the workflow itself was reverted out of each PR before merge
(PR #46 stalled on stale severity-gate verdicts; PR #51 merged only
`.nvmrc` + `index.json` bookkeeping, dropping `publish.yml` again). No AC
ever failed — the file just never survived to `main`. This pass restores
the same reviewed content unchanged and lands it for real.

## Read first
- `/PRD.md` (project-level: 1-cli-distribution deliverable = `npx create-boilerplate-web`)
- `phases/1-cli-distribution/index.json`
- `.github/RELEASING.md` (documents this exact tag-push + workflow_dispatch flow)
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
- **External prerequisite (cannot be automated from this repo):** the
  `create-boilerplate-web` package must already exist on npmjs.org with
  this GitHub repo + this workflow registered as a trusted publisher in
  npm's own settings, before the first tag push can succeed.

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
5. `npm run build:cli` — owned by step 1 (CLI bundle build).
6. `pnpm test` — project test suite via `node --test tests/`.
7. Post-build smoke check — verifies the bundled CLI is **executable**
   and prints `--help` containing the package name `create-boilerplate-web`.
   Smoke probes both `dist/cli.js` and `cli/dist/cli.js`.
8. `Derive npm dist-tag from ref` (see above).
9. `npm publish --provenance --access public`.

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
```
All nine must exit `0`.

## Don't
- Don't pass `github.ref_name` literally into `NPM_CONFIG_TAG` — derive
  the dist-tag from the ref (latest/rc/beta/alpha).
- Don't auto-publish to npm without an environment-based human gate;
  the `npm-publish` GitHub Environment must have required reviewers
  configured in repo settings before the first release.
- Don't reference `NPM_TOKEN` or `NODE_AUTH_TOKEN` — OIDC trusted
  publishing is the only auth path.
- Don't allow `workflow_dispatch` from arbitrary branches. Restrict it
  to `main`.
- Don't `cancel-in-progress: true` — a partial publish mid-cancel can
  leave the npm registry half-published.
- Don't let this file get dropped from a merge again — if a future PR
  touching `index.json` or `.nvmrc` conflicts with this file, resolve in
  favor of keeping `publish.yml`, don't silently revert it.
