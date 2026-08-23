# plan → build hand-off — phase 1-cli-distribution (replan)

## Summary
Phase `1-cli-distribution` for `boilerplate-web` (publish `create-boilerplate-web` to npm via OIDC trusted publishing) is replanned. All 5 plan gates passed (frames carried forward from the 2026-07-30 plan that originally cleared Gate 5/5). Step preambles for steps 0..4 are regenerated; step 5 was already shipped via PR #49.

## Composite convergence (carry-forward from 2026-07-30)
| Knob | Value | Threshold | Pass |
|---|---|---|---|
| evidence_count | 3 | ≥ 3 | ✅ |
| value_score | 125.0 | ≥ 3.0 | ✅ |
| ambiguity_score | 2 | ≤ 3 | ✅ |

## Artifacts emitted (2026-08-23, this worktree)
- `PRD-1-cli-distribution.md` — 6-section plan. Preserves `PRD.md` (0-mvp) untouched.
- `phases/1-cli-distribution/step0.md` … `step4.md` — per-step Task + AC + Don't sections (pinned template, 6 AC blocks each, ~80-100 lines per file).
- `.dev-kit/decision-log.md` — interview SKIPPED line + frame + carry-forward validate + 3 non-goals.
- `.dev-kit/hand-off/plan→build-1-cli-distribution.md` — this file.

## Steps (dependency-first order)
| # | Slug | One-line intent | Status |
|---:|------|-----------------|:---:|
| 0 | npm-package-config | bin=dist/cli.js + files allow-list + LICENSE + publishConfig.access=public | pending |
| 1 | cli-bundle-build | tsc bundles cli/ → dist/cli.js + shebang on byte 0 + prepublishOnly | pending |
| 2 | ci-publish-workflow | tag-trigger + OIDC (id-token: write) + npm ci + build:cli + --provenance --access public | pending |
| 3 | e2e-scaffold-test | matrix [saas,shop,portfolio] + --type=invalid negative case + dist/cli.js bundle | pending |
| 4 | readme-install-instructions | root README: npx install blocks for all 3 templates + Node≥18 requirement | pending |
| 5 | semver-tag-release | (already shipped via PR #49, commit 7cca42e, 2026-08-17) | **completed** |

## Iron Laws enforced
- **L1**: every step's AC is an executable `bash` block with quoted exit codes (3-7 AC per step).
- **L2**: build runner must reproduce a failed step before fixing (handled by `dev-kit:build-debug` sub-skill).
- **L3**: no completion claim without quoted exit codes (each step AC cites the exact command).
- **L4**: no TODO / FIXME / "we'll extend later" anywhere in the templates or workflow YAML — verified by grep in steps 0..4.
- **L5**: no enumerated option lists in plan artifacts — single answer per non-goal, single AC command per criterion.

## Next invocation
```
/dev-kit:build 1-cli-distribution
```
The build runner will read `phases/1-cli-distribution/index.json`, take each `pending` step in order, cut a per-step worktree (`plan/1-cli-distribution-replan-step<N>` off `plan/1-cli-distribution-replan`), delegate to a sub-agent following `phases/1-cli-distribution/step<N>.md`, parse the `<!-- status: ... -->` marker, and transition state. Step 5 will be skipped (status `completed`).

## Worktree handoff
- **Plan worktree**: `/Users/sanghee/dev/boilerplate-web/.worktrees/1-cli-distribution-replan` (branch `plan/1-cli-distribution-replan`, HEAD `c72fb63`).
- **Per-step worktrees**: `plan/1-cli-distribution-replan-step0` … `plan/1-cli-distribution-replan-step4`, each cut off `plan/1-cli-distribution-replan` at the start of its step.

## Pre-build sanity (recommended before invoking `/dev-kit:build`)
1. Verify `phases/1-cli-distribution/index.json` parses with `jq .`.
2. Verify each `phases/1-cli-distribution/step<N>.md` (N ∈ {0..4}) contains a `## Acceptance Criteria` block with at least one `bash` code fence.
3. Verify `.dev-kit/ci-config.json` exists (marker required by `/dev-kit:build`); if missing, run `/dev-kit:ci-setup` first.
4. Optional: refresh `phases/1-cli-distribution/index.json` `totals.completed` from 1 to 2 (step 5 was actually completed via PR #49 on 2026-08-17, but the totals field was never updated).

## Iron Law reminder for /dev-kit:build
- Build runs sequentially (dispatch classifier priority 1: dependency edge — step 1 depends on step 0's `dist/` declaration; step 2 depends on step 1's `dist/cli.js`; step 3 depends on step 1's bundle; step 4 is independent of steps 0-3 but reads the final `package.json#bin`).
- Each step emits the 2 HTML-comment markers on its last 2 lines (`<!-- status: ... -->` + `<!-- summary: ... | error_message: ... | blocked_reason: ... -->`).
- Step 5 will be skipped automatically (`status: completed` is in `SKIPPABLE_STATUSES`).
