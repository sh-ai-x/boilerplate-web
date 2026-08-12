# Releasing create-boilerplate-web

This guide describes how maintainers cut a release of the
`create-boilerplate-web` npm package. The project follows **trunk-based
development** on `main`: every release is a semver tag pushed to `main`, and
the publish workflow runs automatically. There is **no** `release/*` branch
pattern.

---

## 0. Prerequisite: verify the publish workflow exists

This guide assumes `.github/workflows/publish.yml` is present on `main`
(step 2 of the `1-cli-distribution` plan: `ci-publish-workflow`). If it is
not yet merged, **stop here and merge it first** — otherwise §2 will
push a tag that fires nothing, and §3's `workflow_dispatch` recovery
points at the same missing workflow.

Sanity check before tagging:

```bash
gh workflow list --repo "$REPO" | grep -i publish
```

A working setup prints at least one row with `publish` in the name. An
empty result means the publish workflow has not landed yet; do not
proceed to §2.

To verify which step owns the workflow, see
`phases/1-cli-distribution/index.json` (look for `step: 2` with
`name: ci-publish-workflow`); its `status` should be `completed` before
this guide is followed.

---

## 1. Decide the next semver bump

`package.json` ships as `0.1.0` and evolves under semver rules:

| Bump  | When                                                                |
|-------|---------------------------------------------------------------------|
| patch | Backwards-compatible bug fixes (default for `0.0.x` → `0.0.y`).      |
| minor | New backwards-compatible functionality (default for `0.x.0` → `0.y`). |
| major | Breaking changes to CLI flags, output shape, or template layout.    |

For the `0.x` line we treat every release as either `patch` (bug fix) or
`minor` (new template / new behavior); reserve `major` for a true, breaking
rewrite of the CLI surface.

---

## 2. Standard release flow (tag-on-main)

1. **Bump version in `package.json`** to `v0.X.Y` per semver (see the table
   above). Keep `name` as `create-boilerplate-web`.

   ```bash
   # example for a minor bump 0.1.0 -> 0.2.0
   npm version minor --no-git-tag-version
   ```

2. **Refresh the CLI bundle** so the committed `cli/` source matches the
   about-to-be-published `dist/cli.js`:

   ```bash
   npm run build:cli
   ```

   The bundle is a **build artifact**: it is generated from `cli/`, shipped
   to npm via the `files` allow-list, and intentionally **not** committed to
   `main` (see `.gitignore`). Do not commit `dist/cli.js` to the main
   branch — it is regenerated per release.

3. **Commit the version bump on `main`** with a conventional message:

   ```bash
   git add package.json
   git commit -m "chore(release): v0.X.Y"
   ```

4. **Tag the commit and push** — this is what actually triggers publish:

   ```bash
   git tag v0.X.Y
   git push origin main
   git push origin v0.X.Y
   ```

   The push of the `v0.X.Y` tag fires the
   `.github/workflows/publish.yml` job (created in step 2 of the
   `1-cli-distribution` plan). That workflow rebuilds `dist/cli.js`,
   publishes to npm using OIDC trusted publishing via
   `npm publish --provenance --access public`, and links the build provenance
   attestation back to this repository.

5. **Verify the new version appears on npm**:

   ```
   https://www.npmjs.com/package/create-boilerplate-web
   ```

   The new `v0.X.Y` must be listed within a few minutes of the tag push.
   If it is not, see the `workflow_dispatch` fallback below.

---

## 3. Manual `workflow_dispatch` fallback (recovery only)

If the auto-publish did **not** fire on tag push — for example because the
tag was created while the workflow was disabled, GitHub Actions was
temporarily down, or OIDC credentials expired — you can re-run the publish
manually.

The publish workflow also declares a `workflow_dispatch` event. Trigger it
from the GitHub UI (Actions → Publish create-boilerplate-web → Run workflow)
or via the CLI:

```bash
gh workflow run publish.yml --ref main
```

The `workflow_dispatch` run executes the exact same job body as the tag push:
it rebuilds `dist/cli.js` and runs
`npm publish --provenance --access public`. Always re-check
`package.json` first to confirm the version you intend to publish is still the
HEAD of `main`; if a stale tag-triggered run was queued, cancel it before
re-running via `workflow_dispatch`.

> **Do not** fall back to a manual `npm publish` against a token.
> OIDC trusted publishing is the project's standard — rolling back to a
> legacy `NODE_AUTH_TOKEN` would reintroduce the very secret-rotation risk
> this flow is designed to remove.

---

## 4. Checklist

Before pushing the tag, confirm:

- [ ] `package.json` `version` matches the tag (`v0.X.Y`).
- [ ] `npm run build:cli` regenerated `dist/cli.js` locally without errors.
- [ ] `dist/` is **not** staged (`git status` shows it ignored).
- [ ] `templates/_shared/`, `templates/saas/`, `templates/shop/`,
      `templates/portfolio/` are unchanged (those are scope-frozen by the
      `1-cli-distribution` plan).
- [ ] The corresponding GitHub Release notes / changelog entry exists.

After the tag push:

- [ ] `https://www.npmjs.com/package/create-boilerplate-web` lists `v0.X.Y`.
- [ ] The Actions run shows `publish-provenance` succeeded and attached the
      provenance attestation to the npm package metadata.
