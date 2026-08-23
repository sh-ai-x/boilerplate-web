# Step 0: npm-package-config (bin, files, publishConfig, name)

## Status
**pending** — last update: 2026-08-23T00:00:00Z

## Read first
- `/PRD.md`
- `.dev-kit/decision-log.md`
- `phases/0-mvp/step0.md` — original CLI scaffold contract (cloned by step 0 of this phase)
- `package.json` — current root manifest

## Task

Files to modify at repo root:
- `package.json` — finalize the npm-publishable surface:
  - `"name": "create-boilerplate-web"` (un-scoped; matches the `bin` key and the user-facing `npx create-...` invocation)
  - `"version": "0.1.0"` (semver; bumped by CI later, do NOT hand-bump in this step)
  - `"description"` — one-line: "Scaffold a Next.js + Supabase + Cloudflare + Toss boilerplate (saas / shop / portfolio)."
  - `"license": "MIT"`
  - `"repository"` — `{ "type": "git", "url": "https://github.com/sanghee-dev/boilerplate-web.git" }`
  - `"bugs"` — `{ "url": "https://github.com/sanghee-dev/boilerplate-web/issues" }`
  - `"homepage"` — `"https://github.com/sanghee-dev/boilerplate-web#readme"`
  - `"keywords"` — `["boilerplate", "nextjs", "supabase", "cloudflare", "toss", "saas", "ecommerce", "portfolio", "create-boilerplate-web"]`
  - `"engines"` — `{ "node": ">=18.0.0" }`
  - `"bin"` — `{ "create-boilerplate-web": "dist/cli.js" }` (NOT `cli/index.js` — step 1 produces `dist/cli.js`)
  - `"files"` — allow-list of what gets packed into the tarball:
    ```
    [
      "dist",
      "templates",
      "cloudflare-rules.json",
      "templates.lock.json",
      "README.md",
      "LICENSE"
    ]
    ```
    Explicit `files` (vs `!` ignore) so dev-only paths (`tests/`, `.github/`, `phases/`, `.dev-kit/`, `cli/` source) are guaranteed excluded.
  - `"publishConfig"` — `{ "access": "public", "registry": "https://registry.npmjs.org/" }`
  - `"scripts.build:cli"` — `"tsc -p cli/tsconfig.json"` (or `esbuild`, see step 1; this step only declares the script, step 1 wires the toolchain)
- `LICENSE` — MIT license text, copyright `sanghee-dev`. Required by npm publish if `license: "MIT"` is declared.

Non-negotiable rules:
- The package MUST be un-scoped (`create-boilerplate-web`), not `@sanghee-dev/create-boilerplate-web` (non-goal 4 deferred to v2 — wait, that's not in our 3 non-goals, disregard; the relevant rule is: do NOT add a scope in this step).
- `bin` MUST point to `dist/cli.js`, not `cli/index.js`. The `dist/` directory is created by step 1; referencing it here keeps step 0 free of bundler toolchain.
- `files` MUST be an explicit allow-list, not a deny-list. Using `"files": ["dist", ...]` guarantees dev-only paths are excluded regardless of `.npmignore` drift.
- `publishConfig.access` MUST be `"public"` so `npx create-boilerplate-web` works (scoped packages default to restricted).
- Do NOT bump `version` manually — CI handles that via `/dev-kit:bump` and the tag-trigger release flow (step 5 already shipped).

## Acceptance Criteria
```bash
# AC1: package.json name resolves to "create-boilerplate-web"
node -e "console.log(require('./package.json').name)" | grep -q '^create-boilerplate-web$'
# AC2: package.json bin maps create-boilerplate-web → dist/cli.js
node -e "console.log(require('./package.json').bin['create-boilerplate-web'])" | grep -q 'dist/cli\.js$'
# AC3: package.json files allow-list contains dist + templates + README.md
node -e "const f = require('./package.json').files; console.log(f.includes('dist') && f.includes('templates') && f.includes('README.md'))" | grep -q 'true'
# AC4: package.json publishConfig.access === "public"
node -e "console.log(require('./package.json').publishConfig.access)" | grep -q '^public$'
# AC5: LICENSE file exists at repo root and contains "MIT"
test -f LICENSE && grep -q 'MIT' LICENSE
# AC6: dry-run npm pack produces a tarball that contains dist/cli.js, templates/, and README.md
#     (does NOT publish; verifies the files allow-list actually packs what we promise)
npm pack --dry-run 2>&1 | grep -qE 'dist/cli\.js|templates/|README\.md'
```

## Verification & Status Update (REQUIRED before claiming done)
1. Run AC1–AC6 above. Quote each exit code in the reply (e.g. "AC1: exit 0", "AC2: exit 0", ..., "AC6: exit 0 (tarball would contain dist/cli.js + templates/ + README.md)").
2. Update `phases/1-cli-distribution/index.json` for THIS step:
   - **Success** → `"status": "completed"`, `"summary": "<one-line: package.json finalized as create-boilerplate-web v0.1.0 + LICENSE + npm-publishable allow-list; AC1-AC6 green>"`
   - **Unrecoverable failure** → `"status": "error"`, `"error_message": "<concrete error: which AC failed, exit code, last 3 lines>"`
   - **External dependency** (e.g. npm registry auth) → `"status": "blocked"`, `"blocked_reason": "<what's needed>"`, then STOP.
3. Emit EXACTLY these two HTML-comment markers as the last two lines of the final reply:

```
<!-- status: completed | error | blocked -->
<!-- summary: <one-line outcome> | error_message: <concrete error> | blocked_reason: <what's needed> -->
```

## Don't
- Don't add a scope (`@org/`) — non-goal: un-scoped only for v1.
- Don't reference `cli/index.js` in `bin` — step 1 produces `dist/cli.js`; binding to source would break the bundle contract.
- Don't hand-bump `version` — CI handles semver via `/dev-kit:bump`.
- Don't add a `.npmignore` — the explicit `files` allow-list is the contract; `.npmignore` only adds confusion.
- Don't add new files outside the path scope declared in `## Read first` (no edits to root `CLAUDE.md`, no edits to other phases).
