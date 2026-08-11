#!/usr/bin/env bash
# scripts/e2e-scaffold-test.sh
#
# End-to-end scaffold test. Runs `node ./dist/cli.js` against a fresh temp
# dir for a single template type (saas|shop|portfolio) and asserts the
# scaffold produced a usable target.
#
# Usage:
#   bash scripts/e2e-scaffold-test.sh <type>
#
# Exit codes:
#   0   PASS — target dir exists, package.json was rewritten to the basename,
#            and the scaffolded target contains a populated app/ dir.
#  !=0  FAIL — see stderr for the failing step.
#
# The temp dir is removed on FAILURE (trap cleanup ERR) so partial
# scaffold state doesn't bleed between runs. On success, the dir is left
# in place so AC4's external assertions (`test -f .../package.json`
# followed by `node -e ...`) can inspect it after the script exits.
#
# Strict bash mode (set -euo pipefail) ensures any uncaught failure aborts
# the script with a non-zero exit, so AC4's `bash scripts/e2e-scaffold-test.sh
# saas && test -f /tmp/cbw-test-saas/package.json` chain fails fast.

set -euo pipefail

# --- preconditions ---------------------------------------------------------

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
TEMPLATE_TYPE="${1:?Usage: bash scripts/e2e-scaffold-test.sh <saas|shop|portfolio>}"

# m5 (A05): whitelist TEMPLATE_TYPE before composing TARGET. We only allow
# the three values the lockfile knows about; everything else is rejected
# at the shell layer so ${TARGET} never ends up interpolated into a
# `node -e` string or a CLI argv from user-controlled input. Centralizing
# this here (rather than in the JS layer) means the e2e script's command
# construction can rely on TEMPLATE_TYPE being safe.
case "${TEMPLATE_TYPE}" in
  saas|shop|portfolio) ;;
  *)
    echo "ERROR: TEMPLATE_TYPE must be one of saas|shop|portfolio (got '${TEMPLATE_TYPE}')" >&2
    exit 2
    ;;
esac

# LLM review r2 / M-8: predictable /tmp/cbw-test-<type> target was a
# symlink-pre-planting surface (CWE-377) — an attacker could pre-create
# /tmp/cbw-test-saas as a symlink to /etc before this script ran, and
# degit would happily write through it. Use mktemp -d for a fresh unique
# path each run, and clean it up on EXIT so leftover scaffolds don't
# accumulate. The mktemp suffix carries TEMPLATE_TYPE so the dir name is
# still informative in CI logs.
TARGET="$(mktemp -d -t "cbw-test-${TEMPLATE_TYPE}.XXXXXX")"

if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: node not on PATH" >&2
  exit 2
fi

# --- cleanup ----------------------------------------------------------------
#
# LLM review r2 / M-8 + / M-11: cleanup must fire on EXIT (not just ERR)
# so SIGINT/SIGTERM and explicit 'exit 1' paths also clean up. The trap
# is deterministic and never leaves the temp dir behind, regardless of
# whether the script exited 0 or non-zero.

cleanup() {
  rm -rf "${TARGET}" 2>/dev/null || true
}
trap cleanup EXIT

# --- run --------------------------------------------------------------------

echo ">> build:cli"
( cd "${REPO_ROOT}" && npm run --silent build:cli )

echo ">> scaffold ${TEMPLATE_TYPE} -> ${TARGET}"
# --skip-install keeps CI offline (no npm registry hit). The e2e test only
# asserts that the scaffold + name-rewrite produced a usable target dir;
# installing deps is out of scope here.
#
# M2 (A06): we used to pass `--force` which (silently) bypassed BOTH CWD
# containment AND TOCTOU symlink guards. The CLI now exposes two narrower
# flags: `--overwrite` (replace existing target dir) and `--allow-unsafe-path`
# (out-of-CWD / symlink-escape bypass). Our target is /tmp/cbw-test-<type>
# (out of CWD) and the dir does NOT pre-exist (cleanup() just ran), so we
# only need `--allow-unsafe-path`. `--overwrite` would be needed if the
# trap fired without cleanup, but on a fresh run the target doesn't exist
# yet and --allow-unsafe-path alone is sufficient.
# shellcheck disable=SC2086 # intentional: empty ${TARGET} would be a bug.
node "${REPO_ROOT}/dist/cli.js" "${TARGET}" --type="${TEMPLATE_TYPE}" --yes --allow-unsafe-path --skip-install

# --- assertions -------------------------------------------------------------

if [[ ! -d "${TARGET}" ]]; then
  echo "FAIL: target dir not created at ${TARGET}" >&2
  exit 1
fi

if [[ ! -f "${TARGET}/package.json" ]]; then
  echo "FAIL: ${TARGET}/package.json missing" >&2
  exit 1
fi

# m3 (A05): TEMPLATE_TYPE is whitelisted above so the node -e string is
# constructed from a known-safe value. We read package.json via the JS
# runtime (Node's require) rather than `jq`/`grep` so we exercise the
# actual JSON parser and not a string-substitution attack surface.
PKG_NAME="$(node -e "console.log(require('${TARGET}/package.json').name)")"
# LLM review r2 / M-8: TARGET is mktemp -d (random suffix). The scaffolded
# package.json name is the basename of TARGET, so derive the expected name
# from the actual TARGET path rather than the hardcoded prefix.
EXPECTED_NAME="$(basename "${TARGET}")"
if [[ "${PKG_NAME}" != "${EXPECTED_NAME}" ]]; then
  echo "FAIL: package.json name is '${PKG_NAME}', expected '${EXPECTED_NAME}'" >&2
  exit 1
fi

if [[ ! -d "${TARGET}/app" ]]; then
  echo "FAIL: ${TARGET}/app/ not populated" >&2
  exit 1
fi

# app/ must be non-empty — a populated scaffold always has at least one
# entry (layout.tsx, page.tsx, etc.).
if [[ -z "$(ls -A "${TARGET}/app" 2>/dev/null || true)" ]]; then
  echo "FAIL: ${TARGET}/app/ is empty" >&2
  exit 1
fi

echo "PASS: scaffold ${TEMPLATE_TYPE} OK (name='${PKG_NAME}', app/ populated)"