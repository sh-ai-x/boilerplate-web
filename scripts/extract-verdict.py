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
/home/runner/work/_temp/claude-execution-output.json or
$RUNNER_TEMP/claude-execution-output.json) and extracts the LAST
"Verdict: <value>" from ANY of these locations:
  1. assistant message text blocks (the prompt contract)
  2. assistant tool_use input fields (when the agent posts the comment
     via Bash(gh pr comment:*) or mcp__github_inline_comment, the
     Verdict is in the tool_use input.body string, NOT in a text block)
  3. tool_result output content (the response from the tool call)
  4. result message output (the final result of the action)

The action's output is a JSON-lines stream of messages (init, user,
assistant, result, etc.). The assistant messages contain the model's
text output; the verdict may appear in a text block, a tool_use input,
or a tool_result output depending on how the agent chose to post it.

Robustness:
- If the file is missing, exits 0 with no output (caller falls back).
- If the file is HTML (e.g. 404 from a redirect), exits 0 with no output
  (caller falls back). Detected by checking the first non-blank
  character.
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


def _collect_texts_from_content(content) -> list[str]:
    """Pull all text fragments out of an assistant `content` field.

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
    """Return all text fragments from a single message, regardless of
    the message type. Looks at assistant messages' content blocks, at
    standalone tool_result messages (the response from a tool call
    can be a top-level message or nested in an assistant message), and
    at the final `result` message which sometimes carries the last
    assistant text.
    """
    if not isinstance(msg, dict):
        return []
    texts: list[str] = []
    mtype = msg.get("type")
    # assistant messages: content in message.content (SDK) or content (some wrappers)
    if mtype == "assistant":
        content = msg.get("message", {}).get("content")
        if content is None:
            content = msg.get("content")
        texts.extend(_collect_texts_from_content(content))
    # standalone tool_result messages: the action emits one of these per
    # tool call. Its content list holds the tool's response, which may
    # include a text block that echoes the Verdict (e.g. when the tool
    # response stringifies the posted comment body).
    elif mtype == "tool_result":
        texts.extend(_collect_texts_from_content(msg.get("content")))
    # result messages: the action's final result. The Verdict may be
    # echoed in the result text.
    elif mtype == "result":
        result = msg.get("result")
        if isinstance(result, str):
            texts.append(result)
        elif isinstance(result, dict):
            # The result may contain a `content` field with the final
            # assistant text.
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


def extract(path: Path) -> str:
    if not path.exists():
        return ""
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return ""
    # Bail early if the file looks like an HTML error page (network
    # failure, 404, etc.). JSON-lines from claude-code-action NEVER
    # starts with '<'. The 1KB peek is enough to detect any HTML/XML
    # payload.
    peek = text.lstrip()[:1024]
    if peek.startswith("<") or peek.lower().startswith("<?xml"):
        return ""
    # Also bail if the file is suspiciously small or empty.
    if len(text) < 10:
        return ""
    last_verdict = ""
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        # Bail on any non-{ line — JSON-lines is strict.
        if not line.startswith("{"):
            continue
        try:
            msg = json.loads(line)
        except json.JSONDecodeError:
            continue
        if not isinstance(msg, dict):
            continue
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
    # ALWAYS print to stdout (empty if not found). Caller uses stdout
    # to decide whether to use the file verdict or fall back.
    if verdict:
        print(verdict)
    return 0


if __name__ == "__main__":
    sys.exit(main())
