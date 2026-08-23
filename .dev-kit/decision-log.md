# decision-log.md — phase 1-cli-distribution (replan)

## Interview consume gate
- 2026-08-23 — SKIPPED: `--skip-interview` flag present (backward-compat bypass; Phase 6 5-field contract not applicable to replan of an already-planned phase whose Gate 5/5 originally passed 2026-07-30).
- Defense-in-depth would have treated missing hand-off as `held`; explicit user override accepted.

## Gate 1 — frame (2026-08-23)
- goal: Ship `npx create-boilerplate-web <folder> --type=<saas|shop|portfolio>` as a published npm package with OIDC trusted publishing, so users can scaffold from any directory without cloning the repo first.
- target user: Solo indie hacker (extends 0-mvp persona) — runs `npx create-... my-saas --type=saas` from their home directory, not from a cloned boilerplate-web checkout.
- situation: Today the CLI only works via `node cli/index.js` inside a clone of boilerplate-web. Users have to git-clone the full repo (including templates + Edge Functions + tests) just to scaffold a new project.

## Gate 2 — validate (carry-forward from 2026-07-30 plan)
- evidence_count: 3 → PASS (independent signals already on file in original phases/1-cli-distribution decision-log).
- LTV × reachable / cost → value_score = 125.0 → PASS (threshold ≥ 3.0).
- ambiguity_score: 2 → PASS (threshold ≤ 3).
- Composite convergence: PASS. No re-loop; framing is unchanged (same package, same persona, same situation class).

## Gate 3 — non-goals (2026-08-23)
- Non-goal 1 — No non-npm install path (no JSR, no direct curl, no Homebrew).
  - Rationale: OIDC trusted publishing + npm provenance covers the security story; adding install paths multiplies the release surface.
  - Breach-response: If reviewer asks for curl install → open a `feat(install-alternatives)` PRD, do NOT add scripts to this phase.
- Non-goal 2 — No multi-template bundle (one `--type` per scaffold; users run `npx` twice for two templates).
  - Rationale: Templates are independent Next.js apps with separate deps and deploy targets; bundling them risks pulling in Edge Functions + Cloudflare config the user did not ask for.
  - Breach-response: If reviewer asks for one-shot multi-template → open `feat(multi-scaffold)`, do NOT graft into this phase.
- Non-goal 3 — No auto-update / self-update mechanism.
  - Rationale: npm's own update flow (`npm create ...@latest` or version tag) is the canonical channel; a custom updater duplicates it.
  - Breach-response: If reviewer asks for self-update → defer to npm-native; do NOT add a side-channel updater.

## Gate 4 — decompose (in progress)
