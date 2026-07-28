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

# A08 / DoS hardening: anthropics/claude-code-action@v1's execution-file
# is produced by a CI step on GitHub Actions. In normal use it is well
# under 1 MiB, but a malformed/attacker-influenceable payload could be
# much larger or deeply nested. Bound the read so an OOM here does not
# take down the runner and turn the gate into a silent Approve.
_MAX_INPUT_BYTES = 2 * 1024 * 1024  # 2 MiB hard cap
_MAX_NESTING_DEPTH = 64  # json.loads default would happily recurse to ~1000


def _iter_messages(text: str):
    """Yield each message object from an already-read text blob.

    Pure: takes the file CONTENT, not the path, so the caller does the
    size precheck and the read.  Yields messages and falls silent on
    parse errors so the caller can decide whether to treat those as
    "no verdict" (legacy) or fail-closed (post-A10 hard contract).

    Supports two formats:
      1. Pretty-printed JSON array (current claude-code-action):
           [{"type":"assistant",...},{"type":"user",...}, ...]
      2. NDJSON / JSON-lines (older or alternative writers):
           {"type":"assistant",...}
           {"type":"user",...}
    """
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
    # Unknown leading char (e.g. HTML error page) — fall silent.


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
    # A08 / F2 — precheck size via stat() so we DO NOT call read_text()
    # on a pathologically large payload.  Cap is _MAX_INPUT_BYTES.
    try:
        size = path.stat().st_size
    except OSError:
        return ""
    if size > _MAX_INPUT_BYTES:
        # A10 / F2 — emit a stderr sentinel so the caller knows the cap
        # fired even though no verdict is on stdout.
        print(
            f"Install-Broken (input exceeds {_MAX_INPUT_BYTES} bytes; "
            f"refusing to parse to avoid OOM)",
            file=sys.stderr,
        )
        return ""
    # F3 — read once, pass the result to the pure parser helper instead
    # of letting the helper open the file again.
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
    for msg in _iter_messages(text):
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
    return last_verdict


def main() -> int:
    if len(sys.argv) != 2:
        print(f"usage: {sys.argv[0]} <claude-execution-output.json>", file=sys.stderr)
        return 2
    path = Path(sys.argv[1])
    if not path.exists():
        # A10: missing file — explicit non-zero + sentinel so the gate
        # does NOT fall open to the empty-verdict Approve default.
        print(f"Install-Broken (file-not-found: {path})", file=sys.stderr)
        return 1
    verdict = extract(path)
    if not verdict:
        # A10: parsed cleanly but agent produced no Verdict: line. Treat
        # as install-broken so the gate fails closed.
        print("Install-Broken (no-verdict-line-in-output)", file=sys.stderr)
        return 1
    print(verdict)
    return 0


if __name__ == "__main__":
    sys.exit(main())
