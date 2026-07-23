#!/usr/bin/env python3
"""
extract-verdict.py — extract the LLM review/security verdict from
anthropics/claude-code-action@v1's output file.

ROOT-CAUSE FIX HISTORY:
  1. (commit 29b0e49) the previous post-script extracted the verdict by
     grepping PR comments for "Verdict: <value>". That works ONLY when
     the agent actually posts a comment with a "Verdict:" line. When the
     agent posts an inline comment (mcp__github_inline_comment) or no
     comment at all, the post-script falls back to a stale comment from
     a previous run, causing the severity gate to flip-flop.
  2. (commit 899c16b) anthropics/claude-code-action@v1's
     writeExecutionFile does `JSON.stringify(messages, null, 2)` — a
     pretty-printed JSON array. Treating the file as JSON-lines made
     every opening-brace line fail to parse, so the script silently
     returned '' for every run, and the gate defaulted to Approve
     despite a real Blocked.
  3. (this commit) The agent posts its verdict via a tool_use
     (Bash(gh pr comment:*) or mcp__github_*_comment). The Verdict
     string lives in the tool_use input.body or input.command field,
     NOT in an assistant text block. The file parser only looked at
     text blocks, so it always returned empty for tool_use-based
     verdicts.

This script now:
  1. Parses the file as a pretty-printed JSON array (with NDJSON
     fallback for backward compat with older action versions).
  2. Walks every assistant message, tool_use input field, tool_result
     output, and result message output.
  3. Extracts the LAST `Verdict: <value>` line from any of these
     locations.

Robustness:
- If the file is missing, exits 0 with no output (caller falls back).
- If the file is HTML (e.g. 404 from a redirect), exits 0 with no output.
- If the file is JSON but has no Verdict, exits 0 with no output.
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


def _collect_texts_from_content(content) -> list[str]:
    """Pull all text fragments out of an assistant `content` field, a
    tool_result's content, or any other list-of-content-blocks.

    Handles three shapes:
      - list of content blocks (claude-code SDK): each block may be
        {"type": "text", "text": "..."} or a tool_use / tool_result.
      - bare string (some wrappers).
      - anything else → no text.
    """
    if isinstance(content, list):
        out: list[str] = []
        for block in content:
            if isinstance(block, dict):
                btype = block.get("type")
                if btype == "text":
                    out.append(str(block.get("text", "")))
                elif btype == "tool_use":
                    # The Verdict may be in the tool_use input.
                    # For Bash: input.command contains the gh pr comment body.
                    # For mcp__github_inline_comment: input.body contains it.
                    # For mcp__github_add_issue_comment: input.body contains it.
                    inp = block.get("input")
                    if isinstance(inp, dict):
                        for key in ("body", "command"):
                            v = inp.get(key)
                            if isinstance(v, str):
                                out.append(v)
                elif btype == "tool_result":
                    # The tool_result may contain the comment body as
                    # text content (when echoing back the gh pr comment
                    # result) or as a JSON-encoded string.
                    tr = block.get("content")
                    if isinstance(tr, list):
                        for item in tr:
                            if isinstance(item, dict) and item.get("type") == "text":
                                out.append(str(item.get("text", "")))
                            elif isinstance(item, str):
                                out.append(item)
                    elif isinstance(tr, str):
                        out.append(tr)
            elif isinstance(block, str):
                out.append(block)
        return out
    if isinstance(content, str):
        return [content]
    return []


def _collect_texts_from_msg(msg: dict) -> list[str]:
    """Return all text fragments from a single message. Looks at
    assistant messages' content blocks, at standalone tool_result
    messages (the response from a tool call can be a top-level
    message or nested in an assistant message), and at the final
    `result` message which sometimes carries the last assistant text.
    """
    if not isinstance(msg, dict):
        return []
    texts: list[str] = []
    mtype = msg.get("type")
    if mtype == "assistant":
        content = msg.get("message", {}).get("content")
        if content is None:
            content = msg.get("content")
        texts.extend(_collect_texts_from_content(content))
    elif mtype == "tool_result":
        texts.extend(_collect_texts_from_content(msg.get("content")))
    elif mtype == "result":
        result = msg.get("result")
        if isinstance(result, str):
            texts.append(result)
        elif isinstance(result, dict):
            for key in ("content", "text", "output"):
                v = result.get(key)
                if isinstance(v, str):
                    texts.append(v)
                elif isinstance(v, list):
                    for item in v:
                        if isinstance(item, dict) and item.get("type") == "text":
                            texts.append(str(item.get("text", "")))
                        elif isinstance(item, str):
                            texts.append(item)
    return texts


def _iter_messages_from_text(text: str):
    """Yield each message object from the file, regardless of format.

    Supports two formats produced by anthropics/claude-code-action@v1:
      1. Pretty-printed JSON array (current): the action saves
         `JSON.stringify(messages, null, 2)` — a single JSON array of
         message objects, pretty-printed with each field on its own
         line.
      2. NDJSON / JSON-lines (older versions, some wrappers): one
         JSON object per line.

    The pretty-printed array starts with `[` (possibly preceded by
    whitespace); the NDJSON format starts directly with `{`.
    """
    stripped = text.lstrip()
    if stripped.startswith("["):
        # Format 1: JSON array. Use json.loads on the whole text.
        try:
            data = json.loads(text)
        except json.JSONDecodeError:
            return
        if isinstance(data, list):
            for m in data:
                yield m
        return
    # Format 2: NDJSON. Each non-empty line that starts with `{`.
    for line in text.splitlines():
        line = line.strip()
        if not line or not line.startswith("{"):
            continue
        try:
            yield json.loads(line)
        except json.JSONDecodeError:
            continue


def extract(path: Path) -> str:
    if not path.exists():
        return ""
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return ""
    # Bail early if the file looks like an HTML error page (network
    # failure, 404, etc.).
    peek = text.lstrip()[:1024]
    if peek.startswith("<") or peek.lower().startswith("<?xml"):
        return ""
    if len(text) < 10:
        return ""
    last_verdict = ""
    for msg in _iter_messages_from_text(text):
        for t in _collect_texts_from_msg(msg):
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
    if verdict:
        print(verdict)
    return 0


if __name__ == "__main__":
    sys.exit(main())
