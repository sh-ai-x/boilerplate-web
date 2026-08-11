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
    if not author_login:
        return False
    login = author_login.lower()
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
    comments = fetch_comments(pr_number)
    for c in reversed(comments):
        if not is_claude_bot(c.get("author", "")):
            continue
        v = first_verdict(c.get("body", ""))
        if v:
            return v
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
