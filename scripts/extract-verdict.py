#!/usr/bin/env python3
"""
extract-verdict.py — extract the LLM review/security verdict from
anthropics/claude-code-action@v1's output file.

ROOT-CAUSE FIX: the previous post-script extracted the verdict by grepping
PR comments for "Verdict: <value>". That works ONLY when the agent
actually posts a comment with a "Verdict:" line. When the agent posts an
inline comment (mcp__github_inline_comment) or no comment at all, the
post-script falls back to a stale comment from a previous run, causing
the severity gate to flip-flop between Approve / Changes Requested /
Blocked on every push.

This script reads the agent's full output (saved by the action to
/home/runner/work/_temp/claude-execution-output.json) and extracts the
LAST assistant text that contains "Verdict: <value>". The action's
output is a JSON-lines stream of messages (init, user, assistant,
result, etc.). The assistant messages contain the model's text output;
the verdict appears in the FINAL assistant message per the prompt
contract.

Usage:
  python3 extract-verdict.py <path-to-claude-execution-output.json>

Exits 0 on success (prints verdict to stdout: Approve|Blocked|Changes Requested).
Exits 1 if no verdict found.
"""
from __future__ import annotations
import json
import re
import sys
from pathlib import Path

VERDICT_RE = re.compile(r'Verdict:\s*(Approve|Blocked|Changes Requested)\b')


def extract(path: Path) -> str:
    if not path.exists():
        return ""
    last_verdict = ""
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return ""
    # The file is JSON-lines: one message per line. Walk every line, find
    # assistant messages, and remember the LAST "Verdict: X" seen. We
    # intentionally take the last one because the agent may discuss earlier
    # drafts that include "Verdict: <something>" before settling on the
    # final verdict at the end.
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except json.JSONDecodeError:
            continue
        if not isinstance(msg, dict):
            continue
        if msg.get("type") != "assistant":
            continue
        # Content can be in `message.content` (list of content blocks, claude-code SDK)
        # or directly in `content` (string, some wrappers).
        content = msg.get("message", {}).get("content")
        if content is None:
            content = msg.get("content")
        texts: list[str] = []
        if isinstance(content, list):
            for block in content:
                if isinstance(block, dict) and block.get("type") == "text":
                    texts.append(str(block.get("text", "")))
                elif isinstance(block, str):
                    texts.append(block)
        elif isinstance(content, str):
            texts.append(content)
        for t in texts:
            m = VERDICT_RE.search(t)
            if m:
                last_verdict = m.group(1)
    return last_verdict


def main() -> int:
    if len(sys.argv) != 2:
        print(f"usage: {sys.argv[0]} <claude-execution-output.json>", file=sys.stderr)
        return 2
    path = Path(sys.argv[1])
    verdict = extract(path)
    if not verdict:
        print(f"no verdict found in {path}", file=sys.stderr)
        return 1
    print(verdict)
    return 0


if __name__ == "__main__":
    sys.exit(main())
