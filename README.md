# boilerplate-web

Web boilerplate starter.

## What this is

A minimal, opinionated scaffold for shipping web apps with first-class
dev tooling. Combines a strict Claude/Codex rule source (`CLAUDE.md` /
`AGENTS.md`), a TDD/SDD-driven phase plan (`PRD.md` + `phases/`),
and a GitHub Actions CI pipeline installed by `dev-kit:ci-setup`.

## Repository layout

| Path | Purpose |
| --- | --- |
| `CLAUDE.md`, `AGENTS.md` | Project rule source (shared between Claude Code and Codex) |
| `PRD.md` | Single source of truth for product requirements |
| `phases/<n>-<slug>/` | Per-phase plans, step outputs, and decision logs |
| `.dev-kit/ci-config.json` | Marker that gates `dev-kit:build`; written by `ci-setup` |
| `.github/workflows/` | CI, review, and auto-fix workflows |
| `scripts/` | Local CI entrypoints mirrored from `.github/workflows/` |
| `tests/` | Regression tests for the rule hooks |

## Local CI

```
bash scripts/ci-local.sh    # validate + test + (act -l if installed)
```

## CI readiness

`/dev-kit:ci-doctor` audits whether the three workflow files, the
provider marker, the secrets, and `gh auth` are all in place. Run it
after `bootstrap-full` or before opening the first PR.

## License

MIT
