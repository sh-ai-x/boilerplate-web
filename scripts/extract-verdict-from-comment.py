#!/usr/bin/env python3
"""Extract Verdict from the most recent claude-prefixed PR comment.

Usage:
    python3 scripts/extract-verdict-from-comment.py <pr_number>

Output:
    - empty string (no parseable verdict found)
    - "Approve" / "Changes Requested" / "Blocked"

Reads from `gh pr view <pr_number> --json comments --jq '.comments[].body'`,
finds comments where the author is a claude-prefixed bot
(claude[bot], claude-code-action[bot], dev-kit-ci[bot], etc.), and parses
the FIRST line of the comment body for the literal pattern `Verdict: <value>`.

This is the fallback path for issue #625 -- when
anthropics/claude-code-action@v1 with provider=minimax writes a
claude-execution-output.json that lacks the conversation stream
(no assistant messages, no result.result), the post-step falls back
to the PR conversation thread, which IS human-visible.
"""
from __future__ import annotations

import json
import re
import subprocess
import sys

VERDICT_RE = re.compile(r"^\s*Verdict:\s*(Approve|Changes Requested|Blocked)\s*$")


def is_claude_bot(author_login: str) -> bool:
    """Return True iff the comment author is a claude-prefixed agent bot.

    Anthropic's claude-code-action@v1 posts comments under the bare
    `claude` login (not `claude[bot]`); GitHub's bot-account suffix is
    optional on the GraphQL side. Accept both forms. Also accepts
    `dev-kit-ci[bot]`, `dev-kit-review[bot]`, etc.
    """
    if not author_login:
        return False
    login = author_login.lower()
    if login == "claude":
        return True
    if login.startswith("claude") and login.endswith("[bot]"):
        return True
    if login.startswith("dev-kit") and login.endswith("[bot]"):
        return True
    return False


def fetch_comments(pr_number: str) -> list:
    cmd = [
        "gh", "pr", "view", pr_number,
        "--json", "comments",
        "--jq", '.comments | map({author: .author.login, body: .body, createdAt: .createdAt})',
    ]
    try:
        out = subprocess.run(cmd, capture_output=True, text=True, check=True)
        return json.loads(out.stdout)
    except (subprocess.CalledProcessError, json.JSONDecodeError):
        return []


def first_verdict(body: str) -> str:
    """Return the first parseable Verdict: <value> line in body, or ''."""
    if not body:
        return ""
    for line in body.splitlines():
        m = VERDICT_RE.match(line)
        if m:
            return m.group(1)
    return ""


def main_with_arg(pr_number: str) -> str:
    """Return the parsed verdict (or "" if none); used by tests and main()."""
    import os, tempfile
    dbg = os.environ.get("EXTRACT_VERDICT_DEBUG_LOG", "/tmp/extract-verdict-from-comment.log")
    def _log(msg):
        try:
            with open(dbg, "a") as f:
                f.write(f"{msg}\n")
        except Exception:
            pass
    _log(f"=== invoke pr={pr_number} python={__import__('sys').version.split()[0]} gh_token_set={'GH_TOKEN' in os.environ} gh_user={'gh auth status 2>&1 >/dev/null; gh api /user -q .login 2>/dev/null' or 'unknown'} ===")
    try:
        comments = fetch_comments(pr_number)
        _log(f"fetch_comments returned {len(comments)} comments")
    except Exception as e:
        _log(f"fetch_comments raised: {type(e).__name__}: {e}")
        return ""
    for c in reversed(comments):
        author = c.get("author", "")
        if not is_claude_bot(author):
            continue
        v = first_verdict(c.get("body", ""))
        if v:
            _log(f"matched claude-bot verdict={v}")
            return v
    _log("no matching claude-bot verdict; returning empty")
    return ""


def main() -> int:
    if len(sys.argv) != 2:
        sys.stderr.write("usage: extract-verdict-from-comment.py <pr_number>\n")
        return 2
    verdict = main_with_arg(sys.argv[1])
    if verdict:
        print(verdict)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
