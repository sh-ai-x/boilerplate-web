#!/usr/bin/env bash
# worktree-guard.sh — PreToolUse hook for Write|Edit|MultiEdit.
#
# Enforces .claude/rules/git-workflow.md "every task = new worktree" rule.
#
# Denies (exit 2):
#   Edit / Write / MultiEdit when the session cwd is the MAIN repo checkout
#   (the checkout that owns the .git directory at its root). Forces the
#   user to cut a worktree off origin/main before making any edits.
#
# Allows (exit 0):
#   Edits from inside ANY git worktree. The discriminator is
#   `git_dir == git_common_dir` which is robust to the worktree living
#   anywhere on disk (not just `.worktrees/`).
#   Edits in non-git directories — this hook is project-scoped.
#   Empty / probe payloads — nothing to gate.
#
# Fails closed (exit 2 with deny JSON) when `jq` is missing.
#
# The discriminator lives in hooks/lib/worktree-detect.sh so the
# three rule-hooks don't drift. See .claude/rules/git-workflow.md.

set -uo pipefail
INPUT="$(cat)"

# Source the shared worktree-detection helper.
# shellcheck source=lib/worktree-detect.sh
# shellcheck source=lib/payload-parse.sh
source "${BASH_SOURCE[0]%/*}/lib/worktree-detect.sh"
source "${BASH_SOURCE[0]%/*}/lib/payload-parse.sh"

# Fail CLOSED if jq is missing. Without jq we cannot parse the
# PreToolUse payload — silent fail-open would disable this rule.
if ! command -v jq >/dev/null 2>&1; then
  # Hand-built printf here (not the deny() helper from payload-parse.sh)
  # because deny() itself depends on jq. Self-contained fail-closed.
  printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"WORKTREE GUARD: jq is required by worktree-guard.sh but not installed. Install jq (apt/brew/apk) — without it, the worktree rule cannot be enforced."}}\n' >&2
  exit 2
fi

# Extract the target file path. If the payload is empty or has no
# file_path (e.g. a probe call with empty stdin), exit 0 — there is
# nothing to gate. This must run BEFORE the worktree-detect check so
# a probe call from any cwd (main checkout included) is a no-op.
FILE_PATH="$(printf '%s' "$INPUT" | jq -r '.tool_input.file_path // ""' 2>/dev/null)"
[ -z "$FILE_PATH" ] && exit 0

# Resolve the MAIN checkout root via git-common-dir (absolute, cwd-independent).
# This is the directory that owns the `.worktrees/<name>/` siblings, so the
# orch-branch detection below must anchor there instead of using a relative
# `.worktrees/...` path that silently miss-resolves when the hook runs from
# anywhere other than the main checkout (the original cwd-relative form was
# a fail-open when an attacker-controlled EDITOR / SPONSOR process invoked
# the hook from a sibling worktree).
MAIN_ROOT="$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null | xargs dirname)"
# Reset to "." when git-common-dir is unavailable (no .git) or the resolved
# root does not exist on disk. Using an explicit if/else to avoid the bash
# precedence trap where `[ -z ] || [ ! -d ] && X` parses as
# `[ -z ] || ([ ! -d ] && X)` — the empty-string arm short-circuits the
# `||` and the `&&` fallback never runs, leaving MAIN_ROOT="" and silently
# failing open the orch-branch check below.
if [ -z "$MAIN_ROOT" ] || [ ! -d "$MAIN_ROOT" ]; then
  MAIN_ROOT="."
fi

# Orchestration branches (orch/*) are routing/analysis-only worktrees.
# Edits to protected paths (code, hooks, tests, manifests, plugins,
# and source extensions) are denied here so any code change still
# flows through a non-orchestration worktree
# (fix/|feat/|docs/|chore/|test/|refactor/|perf/|hotfix/). User
# handoff temp notes under .dev-kit/round-*/** remain writable so
# the orchestrator can leave round-N notes for the receiving client.
#
# B — branch detection goes via file_path extraction (NOT the
# parent-session cwd), because sub-agents running inside a nested
# worktree still inherit the parent's `git symbolic-ref --short HEAD`
# output of `main` — see the parent-cwd misfire notes. The previous
# version of this hook therefore always saw `main` and never fired
# the orch branch check; the file_path extraction below closes that
# gap by reading the branch from the worktree the file_path points
# into (the worktree IS a git linkfile, so `git -C <path>` resolves
# the correct branch without cd).
ORCH_BRANCH=""
if [[ "$FILE_PATH" =~ (\.worktrees/)([^/]+) ]] \
   && [[ "${BASH_REMATCH[2]}" != "." ]] \
   && [[ "${BASH_REMATCH[2]}" != ".." ]]; then
  WT_NAME="${BASH_REMATCH[2]}"
  # Resolve the worktree dir anchored at $MAIN_ROOT (cwd-independent).
  if [ -d "${MAIN_ROOT}/.worktrees/${WT_NAME}" ]; then
    # Capture git exit code so a failure is NOT silently swallowed as the
    # literal 'detached' string (which never matches orch/* and would
    # therefore silently skip the orch isolation check — the agent's
    # A10 'overloaded detached' finding). Treat a real detached HEAD as
    # 'detached' and a git failure as empty (skip the orch check).
    local_branch="$(git -C "${MAIN_ROOT}/.worktrees/${WT_NAME}" symbolic-ref --short HEAD 2>/dev/null)"
    if [ -z "$local_branch" ]; then
      # Distinguish "not a symbolic-ref" (real detached HEAD) from "git
      # failed" by re-running with explicit exit code capture.
      if git -C "${MAIN_ROOT}/.worktrees/${WT_NAME}" symbolic-ref --short HEAD >/dev/null 2>&1; then
        ORCH_BRANCH="detached"
      else
        # git itself failed (filesystem, perms, transient). Fail CLOSED
        # rather than fail-open: set ORCH_BRANCH to a sentinel that
        # matches the orch/* glob so the protected-path deny fires.
        # The orch check requires positive branch knowledge to skip;
        # without that knowledge we conservatively assume orch.
        # The agent's A06 finding recommended this direction.
        ORCH_BRANCH="orch/unknown-git-failure"
        printf '[worktree-guard] git symbolic-ref failed for %s; failing CLOSED on orch branch\n' "${MAIN_ROOT}/.worktrees/${WT_NAME}" >&2
      fi
    else
      ORCH_BRANCH="$local_branch"
    fi
  fi
fi
if [[ "$ORCH_BRANCH" == orch/* ]]; then
  # .dev-kit/round-*/** hand-off tmp notes are the ONLY writable paths
  # on an orchestration branch — short-circuit before main-deny so the
  # orchestrator can leave round-N notes even if cwd is main checkout.
  # Defense against path traversal (A01 critical in iter-9 review):
  # a crafted FILE_PATH like '/repo/.worktrees/orch-foo/.dev-kit/round-1/
  # ../../../../lib/evil.py' contains the literal .dev-kit/round-* text
  # and would match the regex below, but filesystem resolution lands
  # OUTSIDE the round tree and so defeats the orch isolation. Canonicalize
  # via realpath -m (no symlink resolution, just lexical normalization of
  # /../ and ./ segments), then verify the result still begins with
  # /.dev-kit/round- (segment boundary, not substring) before exempting.
  # realpath -m requires GNU realpath or BSD realpath; both behave
  # identically for lexical normalization. Fall back to the literal
  # substring match if realpath is unavailable so the exemption still
  # works on minimal PATH (mirrors the existing abspath() fallback in
  # lib/worktree-detect.sh).
  ROUND_OK=0
  # First-pass lexical match on the raw file_path so legitimate round-N
  # notes short-circuit without invoking python on every file. Realpath
  # / normpath canonicalization (pass 2) catches /../ traversal.
  for candidate in "$FILE_PATH" "./${FILE_PATH#/}"; do
    if [[ "$candidate" =~ (^|/)\.dev-kit/round-[^/]*(/|$) ]]; then
      ROUND_OK=1
      break
    fi
  done
  if [ "$ROUND_OK" = "1" ] && command -v python3 >/dev/null 2>&1; then
    # Normalize via python (available on every Claude Code host — Bash,
    # inline shell, and the agent itself all run python). Lexical
    # canonicalization collapses '/../' segments so '/repo/.worktrees/
    # orch-foo/.dev-kit/round-1/../../../../lib/evil.py' resolves to
    # '/repo/lib/evil.py' which is OUTSIDE the round tree. realpath -m
    # would also work but BSD realpath on macOS does not implement -m.
    REAL_FILE_PATH="$(python3 -c 'import os, sys; print(os.path.normpath(sys.argv[1]))' "$FILE_PATH" 2>/dev/null || printf '%s' "$FILE_PATH")"
    # After normpath the path must still BEGIN with /.dev-kit/round- at
    # a segment boundary (not as a substring of some other directory name).
    if [[ "$REAL_FILE_PATH" =~ (^|/)(\.dev-kit)/round-[^/]*(/|$) ]]; then
      ROUND_OK=1
    else
      ROUND_OK=0
    fi
  fi
  if [ "$ROUND_OK" = "1" ]; then
    exit 0
  fi
  # Anchor each directory-segment match with `/` boundaries so files like
  # `mylib`, `xxhooks`, `srctests` are NOT mis-detected as protected paths
  # (the prior unanchored `*lib|*hooks|*tests` glob over-matched any path
  # ending in those suffixes — only `lib/`, `hooks/`, `tests/`, etc. as
  # directory segments should be protected). `scripts/` and `cli/` are
  # included because they hold the policy-enforcing code for the CI
  # integration; without them an orch-branch could rewrite the validator.
  # The optional leading `[.]?` covers hidden directories (`.dev-kit/`,
  # `.github/`, `.claude/`) — without it the regex anchored on `(^|/)`
  # followed by the literal `dev-kit` would NOT match `.dev-kit/`
  # because the `.` between the anchor and the name is part of the
  # directory name, not the boundary. This is the agent's A01-2 finding.
  # Protected extensions include `.tsx/.jsx/.mjs/.cjs` so an orch branch
  # cannot edit React source outside the gated subtree (A01-1).
  if printf '%s' "$FILE_PATH" \
       | grep -qE '(^|/)[.]?(lib|hooks|skills|tests|templates|bin|dev-kit|scripts|cli|github|claude|codex)/' \
       || printf '%s' "$FILE_PATH" \
       | grep -qE '\.(py|sh|ts|js|tsx|jsx|mjs|cjs)$' \
       || printf '%s' "$FILE_PATH" \
       | grep -qE '(^|/)\.(codex-plugin|claude-plugin)'; then
    deny "ORCH ISOLATION" "code edits are forbidden in orch/* worktree (file_path=$FILE_PATH). Allowed paths only are .dev-kit/round-*/**. Move the change to a feature worktree."
  fi
fi

# Detect whether we are in the main checkout or a worktree. The lib
# function never returns 1 here because we just verified jq exists.
worktree_detect
case "$WORKTREE_DETECT" in
  worktree|outside|"") exit 0 ;;
  main) ;;
  *) exit 0 ;;
esac

# In main checkout → deny with actionable reason. The case statement
# and the deny() call below are byte-identical to the pre-PR-270
# version — only the MSG string content is updated to the
# deterministic env-var checklist + Iron Laws recap.
BRANCH="$(git symbolic-ref --short HEAD 2>/dev/null || echo detached)"
MSG="WORKTREE GUARD: editing in main checkout (branch='$BRANCH') is forbidden.

REQUIRED environment setup before retrying:
  git config --global dev-kit.orch.client=claude   # or codex
  git config --global dev-kit.orch.concurrency=single   # or parallel

Without these, abort this edit. Re-running without setting them will be denied.

Routing (after config is set):
  claude  + single   -> git worktree add -b <type>/<slug> .worktrees/<slug> origin/main
                        cd .worktrees/<slug>
                        open a Claude session there
  claude  + parallel -> same worktree, then fan out sub-agents via the Agent tool
  codex   + single   -> git worktree add ..., then spawn one sub-agent with cwd=<worktree>
  codex   + parallel -> spawn N sub-agents each with cwd=<worktree> and explicit task prompt

Hard rules (Iron Laws §1):
  L1: no prod code without verification artifact (test/contract/domain)
  L3: no completion claim without quoted exit codes / test counts
  L4: no TODO/FIXME/later/starting-point
  L5: no option list when not asked
  M push / commit / PR to main: forbidden
  M edit of code files in any worktree: forbidden (Tier 1 = orchestrator)
  Other worktrees are private to their T; entry is allowed ONLY for hand-off docs
   in .dev-kit/round-*/**."

  deny "WORKTREE GUARD" "$MSG"
