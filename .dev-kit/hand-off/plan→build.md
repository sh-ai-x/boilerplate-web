# plan → build hand-off

## Summary
Phase `0-mvp` for `boilerplate-web` (smart clone CLI + 3 Next.js + Supabase + Cloudflare + Toss templates) is planned. All 5 plan gates passed; PRD + phases + decision-log + loop-log emitted.

## Composite convergence
| Knob | Value | Threshold | Pass |
|---|---|---|---|
| evidence_count | 3 | ≥ 3 | ✅ |
| value_score | 9.375 | ≥ 3.0 | ✅ |
| ambiguity_score | 2 | ≤ 3 | ✅ |

## Artifacts
- `/PRD.md` — 6 sections (Frame, Validate, Non-goals, Phase plan, AC list, Hand-off).
- `/phases/0-mvp/index.json` — phase state machine, 7 steps, all `pending`.
- `/phases/0-mvp/step0.md` … `step6.md` — per-step Task + AC + Don't sections (pinned template).
- `/.prd/decision-log.md` — Ralph-loop trail (frame + 6 gate-2 cycles + gate-3 non-goals).
- `/.dev-kit/loop-log.json` — 6 narrowing cycles, `final_status: pass`.
- `/.dev-kit/hand-off/plan→build.md` — this file.

## Steps (dependency-first order)
| # | Slug | One-line intent |
|---:|------|-----------------|
| 0 | cli-scaffold | degit-based sub-folder CLI; rewrite package.json name; print post-install checklist |
| 1 | shared-infra | Supabase client wrappers + Google-only auth UI + Turnstile widget + env example |
| 2 | template-saas | plans/subscriptions schema + admin pricing + Toss billing-key Edge Function |
| 3 | template-shop | products/orders + pgsodium-encrypted shipping + Toss single-payment Edge Function |
| 4 | template-portfolio | portfolio_items + guestbook + MDX render; NO payment / NO Turnstile |
| 5 | cloudflare-waf | cloudflare-rules.json (≥ 5 rules on Edge Function paths) + per-template Turnstile config |
| 6 | deploy-guide | Root README + 3 per-template READMEs (Supabase / Cloudflare / Google OAuth / Toss) |

## Iron Laws enforced
- **L1**: every step's AC is an executable `bash` block with quoted exit codes.
- **L2**: build runner must reproduce a failed step before fixing (handled by `dev-kit:build-debug` sub-skill).
- **L3**: no completion claim without quoted exit codes (each step AC cites the exact command).
- **L4**: no TODO / FIXME / "we'll extend later" anywhere in the templates — verified by grep in steps 2/3/4/6.
- **L5**: no enumerated option lists in plan artifacts — single answer per non-goal, single AC command per criterion.

## Next invocation
```
/dev-kit:build
```
The build runner will read `phases/0-mvp/index.json`, take each step in order, cut a per-step worktree (`plan/boilerplate-cli-step<N>` off `plan/boilerplate-cli`), delegate to a sub-agent following `phases/0-mvp/step<N>.md`, parse the `<!-- status: ... -->` marker, and transition state.

## Worktree handoff
- **Plan worktree**: `/Users/sanghee/dev/boilerplate-web/.worktrees/boilerplate-cli` (branch `plan/boilerplate-cli`).
- **Per-step worktrees**: `plan/boilerplate-cli-step0` … `plan/boilerplate-cli-step6`, each cut off `plan/boilerplate-cli` at the start of its step.

## Pre-build sanity (recommended before invoking `/dev-kit:build`)
1. `git -C .worktrees/boilerplate-cli add -A && git commit -m "chore(plan): PRD + phases + decision-log for boilerplate-web 0-mvp"` — locks plan artifacts onto the branch.
2. Verify `phases/0-mvp/index.json` parses with `jq .`.
3. Verify each `phases/0-mvp/step<N>.md` contains a `## Acceptance Criteria` block with at least one `bash` code fence.
4. Verify `.dev-kit/ci-config.json` exists (marker required by `/dev-kit:build`); if missing, run `/dev-kit:ci-setup` first.