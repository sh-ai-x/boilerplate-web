#!/usr/bin/env python3
"""
extract-verdict.py — extract the LLM review/security verdict from
anthropics/claude-code-action@v1's output file.

ROOT-CAUSE FIX (issue: gate flapped Approve when agent posted a real
Blocked verdict on PR #26): the previous version treated the action's
output as JSON-lines, but the action writes a pretty-printed JSON
ARRAY (anthropics/claude-code-action@af0559ee4f514d1ef21826982bed13f7edc3c35e
base-action/src/execution-file.ts: `writeExecutionFile` does
`JSON.stringify(messages, null, 2)`). The previous splitlines() loop
json.loads'd each opening brace on its own, every decode failed, and
the script silently returned "" for every run — masking real Blocked
verdicts as default-approve-empty-file. PR #26's gate rubber-stamped
"Approve" while the agent had posted `Verdict: Blocked` (14 findings,
3 critical) on the PR.

Now: parse the file as a JSON array (with NDJSON fallback for
backward compat with older action versions that wrote one-message-per-
line). Walk each message, find the last assistant text containing a
verdict, return the verdict.

Robustness:
- If the file is missing, exits 0 with no output (caller falls back).
- If the file looks like HTML (404, network error), exits 0 with no
  output. Detected by checking the first non-blank character.
- If the file is JSON but has no Verdict, exits 0 with no output.
- If the file is unreadable, exits 0 with no output (caller falls back).
- Returns exit 0 (not 1) on "not found" so the bash || true at the
  call site can be simplified.

Usage:
  python3 extract-verdict.py <path-to-claude-execution-output.json>

Prints the verdict (Approve|Blocked|Changes Requested) to stdout if found.
Exits 0 always (no verdict on stdout = caller falls back).
"""
from __future__ import annotations
import json
import re
import sys
from pathlib import Path

VERDICT_RE = re.compile(r'Verdict:\s*(Approve|Blocked|Changes Requested)\b')


def _iter_messages(path: Path):
    """Yield each message object from the file.

    Supports two formats:
      1. Pretty-printed JSON array (current claude-code-action):
           [{"type":"assistant",...},{"type":"user",...}, ...]
      2. NDJSON / JSON-lines (older or alternative writers):
           {"type":"assistant",...}
           {"type":"user",...}
    """
    text = path.read_text(encoding="utf-8", errors="replace")
    stripped = text.lstrip()
    if not stripped:
        return
    if stripped.startswith("["):
        # Format 1: JSON array.
        try:
            data = json.loads(text)
        except json.JSONDecodeError:
            return
        if isinstance(data, list):
            for m in data:
                yield m
        return
    if stripped.startswith("{"):
        # Format 2: NDJSON (one JSON object per line).
        for line in text.splitlines():
            line = line.strip()
            if not line or not line.startswith("{"):
                continue
            try:
                yield json.loads(line)
            except json.JSONDecodeError:
                continue
        return
    # Unknown leading char (e.g. HTML error page) — bail.


def _collect_text(content) -> list[str]:
    """Pull all text fragments out of an assistant `content` field.

    Handles three shapes:
      - list of content blocks (claude-code SDK): each block may be
        {"type":"text","text":"..."} or a bare string.
      - bare string (some wrappers).
      - anything else → no text.
    """
    if isinstance(content, list):
        out: list[str] = []
        for block in content:
            if isinstance(block, dict) and block.get("type") == "text":
                out.append(str(block.get("text", "")))
            elif isinstance(block, str):
                out.append(block)
        return out
    if isinstance(content, str):
        return [content]
    return []


def extract(path: Path) -> str:
    if not path.exists():
        return ""
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return ""
    # Bail early if the file looks like an HTML error page.
    peek = text.lstrip()[:1024]
    if peek.startswith("<") or peek.lower().startswith("<?xml"):
        return ""
    # Also bail if the file is suspiciously small or empty.
    if len(text) < 10:
        return ""

    last_verdict = ""
    try:
        for msg in _iter_messages(path):
            if not isinstance(msg, dict):
                continue
            if msg.get("type") != "assistant":
                continue
            content = msg.get("message", {}).get("content")
            if content is None:
                content = msg.get("content")
            for t in _collect_text(content):
                m = VERDICT_RE.search(t)
                if m:
                    last_verdict = m.group(1)
    except OSError:
        return ""
    return last_verdict


def main() -> int:
    if len(sys.argv) != 2:
        print(f"usage: {sys.argv[0]} <claude-execution-output.json>", file=sys.stderr)
        return 2
    path = Path(sys.argv[1])
    verdict = extract(path)
    # ALWAYS print to stdout (empty if not found). Caller uses stdout
    # to decide whether to use the file verdict or fall back.
    if verdict:
        print(verdict)
    return 0


if __name__ == "__main__":
    sys.exit(main())
