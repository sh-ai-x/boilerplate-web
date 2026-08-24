#!/usr/bin/env bash
#
# scripts/setup.sh - post-scaffold one-step setup for the saas boilerplate.
#
# Reads .env.local, links to Supabase, deploys migrations + Edge Functions,
# creates a GitHub repo (if needed), pushes, and sets the 7 GitHub Actions
# secrets required by templates/saas/.github/workflows/deploy.yml.
#
# Idempotent: re-runs are safe (re-link is a no-op, re-push is fine,
# gh secret set overwrites). If you want to print without mutating,
# pass --dry-run. If you want to verify prereqs only, pass --check.
#
# Usage:
#   ./scripts/setup.sh           # do the work
#   ./scripts/setup.sh --dry-run # print commands without executing
#   ./scripts/setup.sh --check   # verify prereqs only
#
# See SETUP.md for the full step-by-step walkthrough + dashboard URLs.

set -euo pipefail

ACTION="run"
if [[ "${1:-}" == "--dry-run" ]]; then ACTION="dry-run"; fi
if [[ "${1:-}" == "--check"   ]]; then ACTION="check";  fi

# Resolve paths
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT"

# 7 secrets names (single source of truth: ../../docs/DEPLOY_SECRETS.md SSOT)
SECRETS=(VERCEL_TOKEN VERCEL_ORG_ID VERCEL_PROJECT_ID CF_API_TOKEN CF_ZONE_ID SUPABASE_ACCESS_TOKEN SUPABASE_PROJECT_REF)

# Emit command for --dry-run mode. Operator can copy-paste into terminal.
emit() { echo "+ $*"; }

run() {
  if [[ "$ACTION" == "dry-run" ]]; then
    emit "$@"
  else
    eval "$@"
  fi
}

# Load .env.local into shell vars (used by Supabase + gh steps).
load_env() {
  if [[ ! -f .env.local ]]; then
    echo "  X .env.local missing - copy .env.example -> .env.local and fill in the 7 keys."
    return 1
  fi
  # shellcheck disable=SC1091
  set -a; source .env.local; set +a
  for s in "${SECRETS[@]}"; do
    if [[ -z "${!s:-}" ]]; then
      echo "  X .env.local missing required key: $s"
      return 1
    fi
  done
  return 0
}

# Prereq checks: tool installed + authenticated + .env.local valid.
check_prereqs() {
  local failed=0
  echo "-- prereq checks ($ACTION mode) --"
  for cmd in gh supabase git jq; do
    if command -v "$cmd" >/dev/null 2>&1; then
      echo "  ok $cmd installed"
    else
      echo "  X $cmd missing - install from SETUP.md step 6-7"
      failed=1
    fi
  done
  if gh auth status >/dev/null 2>&1; then
    echo "  ok gh authenticated"
  else
    echo "  X gh not authenticated - run 'gh auth login' first"
    failed=1
  fi
  if supabase projects list >/dev/null 2>&1; then
    echo "  ok supabase authenticated"
  else
    echo "  X supabase not authenticated - run 'supabase login' first"
    failed=1
  fi
  if load_env; then
    echo "  ok .env.local: all 7 required keys present"
  else
    failed=1
  fi
  if [[ "$failed" -ne 0 ]]; then
    echo ""
    echo "X One or more prereqs failed. See SETUP.md before re-running."
    return 1
  fi
  echo ""
  return 0
}

step_supabase_link() {
  if [[ -n "${SUPABASE_PROJECT_REF:-}" ]]; then
    run "supabase link --project-ref \"$SUPABASE_PROJECT_REF\""
  fi
}

step_supabase_dbpush() {
  # No-op if there's nothing to push.
  if compgen -G "supabase/migrations/*.sql" >/dev/null; then
    run "supabase db push"
  fi
}

step_supabase_functions_deploy() {
  # For saas, deploy the `billing` Edge Function.
  for fn in billing; do
    if [[ -d "supabase/functions/$fn" ]]; then
      run "supabase functions deploy \"$fn\" --project-ref \"$SUPABASE_PROJECT_REF\""
    fi
  done
}

step_git_init() {
  if [[ ! -d .git ]]; then
    run "git init"
    run "git checkout -b main 2>/dev/null || git branch -M main"
    run "git add -A"
    run "git commit -m \"feat: scaffolded saas via create-boilerplate-web\""
  else
    echo "  -- git repo already exists - skipping init"
  fi
}

step_gh_repo_create() {
  local repo_name="${GH_REPO_NAME:-$(basename "$ROOT")}"
  local org="${GH_REPO_ORG:-}"
  local visibility="${GH_REPO_VISIBILITY:-private}"
  if [[ -n "$org" ]]; then
    run "gh repo create \"$org/$repo_name\" --$visibility --source=. --remote=origin --push"
  else
    run "gh repo create \"$repo_name\" --$visibility --source=. --remote=origin --push"
  fi
}

step_gh_secret_set() {
  local target="${GH_REPO_TARGET:-}"
  if [[ -z "$target" ]]; then
    if gh repo view >/dev/null 2>&1; then
      target="$(gh repo view --json nameWithOwner --jq .nameWithOwner)"
    else
      echo "  X could not determine GH_REPO_TARGET - set it manually (e.g. export GH_REPO_TARGET=OWNER/REPO)"
      return 1
    fi
  fi
  for s in "${SECRETS[@]}"; do
    local value="${!s}"
    run "gh secret set \"$s\" --body \"$value\" --repo \"$target\""
  done
  if [[ "$ACTION" != "dry-run" ]]; then
    echo "  -- verify with: gh secret list --repo \"$target\""
  fi
}

main() {
  if ! check_prereqs; then exit 1; fi
  echo "-- setup steps ($ACTION mode) --"
  step_supabase_link
  step_supabase_dbpush
  step_supabase_functions_deploy
  step_git_init
  step_gh_repo_create
  step_gh_secret_set
  if [[ "$ACTION" == "dry-run" ]]; then
    echo ""
    echo "Dry-run complete. Re-run without --dry-run to execute."
  else
    echo ""
    echo "ok setup.sh finished."
    echo "  Next: import your GitHub repo on Vercel (one-time) and push."
    echo "  See SETUP.md step 8 for the auto-deploy workflow."
  fi
}

main
