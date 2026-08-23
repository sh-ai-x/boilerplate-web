# Step 1: cli-bundle-build (cli/ → dist/cli.js via tsc/esbuild)

## Status
**pending** — last update: 2026-08-23T00:00:00Z

## Read first
- `/PRD.md`
- `.dev-kit/decision-log.md`
- `phases/1-cli-distribution/step0.md` — depends on its `dist/` allow-list
- `cli/index.js` and `cli/lib/*.js` — current CommonJS sources to bundle
- `package.json` — `scripts.build:cli` declared by step 0

## Task

Files to create / modify:
- `cli/tsconfig.json` — TypeScript config that compiles `cli/index.js` + `cli/lib/*.js` (the sources are `.js`, not `.ts`, so this is a JS-as-TS compile pass):
  - `"target": "ES2022"`
  - `"module": "commonjs"` (npm `bin` resolution expects CJS by default; ESM would need `"type": "module"` in package.json)
  - `"moduleResolution": "node"`
  - `"outDir": "../dist"`
  - `"rootDir": "."`
  - `"esModuleInterop": true`
  - `"allowJs": true`
  - `"declaration": false`
  - `"sourceMap": true`
  - `"include": ["index.js", "lib/**/*.js"]`
- `package.json` — wire the script that step 0 declared:
  - `"scripts.build:cli"`: `"tsc -p cli/tsconfig.json"`
  - `"scripts.build"`: `"npm run build:cli"`
  - `"scripts.prepublishOnly"`: `"npm run build:cli"` (npm runs this before `npm publish`; guarantees `dist/cli.js` exists in the tarball)
- `cli/index.js` (already exists from phase 0-mvp) — wrap the entry so the bundled output starts with `#!/usr/bin/env node` as its FIRST line (npm bin resolution requires this shebang to appear at byte 0 of the file). The current entry may not have the shebang; add it.
- Add `typescript` to `devDependencies` (not `dependencies` — it's a build-time tool, not runtime).

Non-negotiable rules:
- `dist/cli.js` MUST start with `#!/usr/bin/env node\n` (the shebang line). Without it, `npx create-boilerplate-web` fails with "no such file or directory" or "permission denied" depending on the user's shell.
- `tsc` MUST emit to `dist/` (the path step 0 declared in `package.json:bin` and `package.json:files`).
- `prepublishOnly` MUST run `build:cli` so the tarball always contains a fresh `dist/cli.js` — never publish a tarball with a stale or missing bundle.
- Do NOT switch to ESM (`"type": "module"` + `.mjs`) — the existing CLI is CJS and step 0 already declared `"type"` absent (defaults to CJS). Mixing ESM and CJS adds two failure modes.
- Do NOT use esbuild or rollup in this step — `tsc` is sufficient for a ~200-line CLI and keeps the build hermetic (one tool, no plugin chain).

## Acceptance Criteria
```bash
# AC1: tsc config exists and parses
test -f cli/tsconfig.json && node -e "JSON.parse(require('fs').readFileSync('cli/tsconfig.json','utf8'))"
# AC2: build:cli script produces dist/cli.js
npm run build:cli && test -f dist/cli.js
# AC3: dist/cli.js starts with the node shebang
head -1 dist/cli.js | grep -q '^#!/usr/bin/env node'
# AC4: prepublishOnly runs build:cli before publish
#     (verify the script key exists and references build:cli)
node -e "console.log(require('./package.json').scripts.prepublishOnly)" | grep -q 'build:cli'
# AC5: typescript is in devDependencies (not dependencies)
#     and devDependencies contains 'typescript'
node -e "const p=require('./package.json'); console.log('typescript' in (p.devDependencies||{}) && !('typescript' in (p.dependencies||{})))" | grep -q 'true'
# AC6: dist/ is gitignored (so the build artifact is never committed)
grep -q '^dist/$' .gitignore
```

## Verification & Status Update (REQUIRED before claiming done)
1. Run AC1–AC6 above. Quote each exit code in the reply.
2. Update `phases/1-cli-distribution/index.json` for THIS step:
   - **Success** → `"status": "completed"`, `"summary": "<one-line: tsc bundles cli/ → dist/cli.js, shebang on byte 0, prepublishOnly wired; AC1-AC6 green>"`
   - **Unrecoverable failure** → `"status": "error"`, `"error_message": "<which AC failed, exit code, last 3 lines>"`
   - **External dependency** → `"status": "blocked"`, `"blocked_reason": "<what's needed>"`, then STOP.
3. Emit EXACTLY these two HTML-comment markers as the last two lines of the final reply:

```
<!-- status: completed | error | blocked -->
<!-- summary: <one-line outcome> | error_message: <concrete error> | blocked_reason: <what's needed> -->
```

## Don't
- Don't switch to ESM (`"type": "module"`) — CJS keeps the contract minimal.
- Don't use esbuild / rollup / webpack — `tsc` is sufficient for ~200-line CLI and avoids plugin-chain risk.
- Don't omit the shebang — `npx create-boilerplate-web` silently fails without it.
- Don't add `typescript` to `dependencies` — build-time only.
- Don't commit `dist/cli.js` — `.gitignore` excludes it; release ships via tarball.
- Don't add new files outside the path scope declared in `## Read first` (no edits to root `CLAUDE.md`, no edits to other phases).
