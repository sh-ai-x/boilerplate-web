#!/usr/bin/env bash
#
# .github/workflows/_verdict_comments_fallback.sh
#
# Issue #625 retry-loop fallback: when extract-verdict.py returns
# PARSE_FAILED (e.g. provider=minimax returned no assistant message
# envelope), this script polls the PR comments for the most recent
# claude-prefixed comment created AFTER $CUTOFF, parses its first
# `Verdict:` line, and echoes the verdict to stdout. Returns empty
# string when no comment matches.
#
# Called from review.yml + _verdict_from_comment.py context.
# Environment:
#   CUTOFF     ISO-8601 timestamp; comments older than this are skipped
#             (avoids resurrecting stale verdicts from older pushes)
#   JOB_NAME   used for log prefixes only
#   WORKSPACE  repository checkout path (the same path the caller uses)
# Required CLI:
#   gh (already on PATH in GH Actions runners)
set -euo pipefail

: "${CUTOFF:?_verdict_comments_fallback.sh requires CUTOFF (ISO-8601) env}"
: "${PR_NUMBER:?_verdict_comments_fallback.sh requires PR_NUMBER env}"
JOB_NAME="${JOB_NAME:-fallback}"
WORKSPACE="${WORKSPACE:-$PWD}"
MAX_TRIES="${MAX_TRIES:-6}"
SLEEP_SECONDS="${SLEEP_SECONDS:-5}"

for attempt in $(seq 1 "$MAX_TRIES"); do
  # JSON output: [{author:{login},body,createdAt}, ...] for THIS run's PR.
  comments_json=$(gh pr view "$PR_NUMBER" \
    --json comments \
    --jq '.comments[] | select(.author.login | test("claude|anthropic|claude\\[bot\\]|anthropic-ai\\[bot\\]; i")) | {body, createdAt}')

  # Find the most recent comment created at-or-after $CUTOFF whose
  # body has a `Verdict:` line. Multiple matches → take the newest.
  verdict=$(printf "%s\n" "$comments_json" \
    | python3 -c "
import json, os, sys, datetime
cutoff = datetime.datetime.fromisoformat(os.environ['CUTOFF'].replace('Z', '+00:00'))
data = sys.stdin.read().strip()
candidates = []
for line in data.splitlines():
    if not line.strip():
        continue
    obj = json.loads(line)
    created = datetime.datetime.fromisoformat(obj['createdAt'].replace('Z', '+00:00'))
    if created < cutoff:
        continue
    body = obj.get('body') or ''
    for line2 in body.splitlines():
        s = line2.strip()
        # Match lines like '**Verdict:** Approve' or 'Verdict: Changes Requested'.
        if s.lower().startswith('verdict'):
            # Take the value after the colon (or after the bold).
            if ':' in s:
                v = s.split(':', 1)[1].strip().strip('*').strip()
                if v:
                    candidates.append((created, v))
                    break
if not candidates:
    sys.exit(0)
candidates.sort(key=lambda t: t[0], reverse=True)
print(candidates[0][1])
")

  if [ -n "$verdict" ]; then
    echo "[$JOB_NAME] comments-fallback hit on attempt $attempt: $verdict" >&2
    echo "$verdict"
    exit 0
  fi

  if [ "$attempt" -lt "$MAX_TRIES" ]; then
    sleep "$SLEEP_SECONDS"
  fi
done

echo "[$JOB_NAME] comments-fallback gave up after $MAX_TRIES attempts (no claude-prefixed comment after $CUTOFF)" >&2
exit 0  # empty verdict = hard-fail in the gate (existing contract)
