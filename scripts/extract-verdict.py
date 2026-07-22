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
- If the file is missing, exits 0 with no output (caller falls back —
  this is the "cancelled job / transient backend" tolerance).
- If the file exists but is HTML, empty, malformed, or contains no
  Verdict: line, prints the PARSE_FAILED sentinel on stdout (and a
  detailed reason on stderr). The downstream workflow's extract step
  only checks `[ -n "$file_verdict" ]` before defaulting the gate to
  `verdict="Approve"`. Returning empty here was a fail-open bug
  (A10/F1): a truncated or malformed agent output file would silently
  flip the gate to Approve even when the agent had actually posted a
  real Blocked verdict. The sentinel is a non-empty, non-Verdict
  value that the gate's unparseable-verdict handler treats as a
  non-blocking ::warning:: — making the failure visible without
  flipping the merge decision to Approve.
- Returns exit 0 (not 1) on "not found" so the bash || true at the
  call site can be simplified.

Usage:
  python3 extract-verdict.py <path-to-claude-execution-output.json>

Prints to stdout:
  - Approve|Blocked|Changes Requested if found
  - PARSE_FAILED if the file exists but no verdict could be extracted
  - (empty) only if the file does not exist (cancelled-job tolerance)

Exits 0 always.
"""
from __future__ import annotations
import json
import re
import sys
from pathlib import Path

VERDICT_RE = re.compile(r'Verdict:\s*(Approve|Blocked|Changes Requested)\b')

# A10/F1: when the parser cannot extract a verdict from a file that DOES
# exist (file is HTML, empty/too short, malformed JSON, or contains no
# `Verdict:` line), emit this sentinel on stdout instead of an empty string.
# The workflow's extract step branches on `[ -n "$file_verdict" ]`: an empty
# value falls through to a fail-open `verdict="Approve"` default. Empty
# stdout silently flips a failed parse to Approve — which is exactly the
# failure mode the security agent flagged in finding F1 ("Verdict parsing
# failures fail open to Approve").
#
# The sentinel is intentionally NOT one of {Approve, Blocked, Changes
# Requested} so the gate's existing unparseable-verdict branch fires:
#
#   if ! { [ "$worst" = "Approve" ] || [ "$worst" = "Changes Requested" ] \
#          || [ "$worst" = "Blocked" ]; }; then
#     echo "::warning::Unparseable verdict '$worst' ... treating as non-blocking."
#     exit 0
#   fi
#
# The result: a parse failure is visible in the run log (::warning::) and
# the gate does NOT silently Approve. The fix does not claim to *block*
# merge on parse failure — it claims to not fail open to Approve.
PARSE_FAILED_SENTINEL = "PARSE_FAILED"


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
        elif isinstance(result, list):
            # A newer action version may emit a list-shaped result (a
            # content-block array) directly. Walk it the same way as the
            # dict branch's list values so the verdict is not dropped.
            for item in result:
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
        # Cancelled-job / transient-backend tolerance: caller falls back to
        # the PR-comment lookup path. Empty stdout is the deliberate signal
        # for "no agent output file at all" — do NOT change this branch.
        return ""
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except OSError as exc:
        # File exists but is unreadable. This is a parse failure, not a
        # cancelled-job case: emit the sentinel so the workflow does not
        # silently default to Approve.
        print(f"extract-verdict: read_text failed: {exc}", file=sys.stderr)
        return PARSE_FAILED_SENTINEL
    # Bail early if the file looks like an HTML error page (network
    # failure, 404, etc.). The action produced a file but it is not a
    # parseable agent-output file — this is a parse failure, not a
    # cancelled-job case.
    peek = text.lstrip()[:1024]
    if peek.startswith("<") or peek.lower().startswith("<?xml"):
        print(
            f"extract-verdict: file looks like HTML/<?xml (first 64 chars: {peek[:64]!r}); "
            "action ran but output is not parseable",
            file=sys.stderr,
        )
        return PARSE_FAILED_SENTINEL
    if len(text) < 10:
        print(
            "extract-verdict: file is empty or too short (< 10 chars); "
            "action ran but output is not parseable",
            file=sys.stderr,
        )
        return PARSE_FAILED_SENTINEL
    last_verdict = ""
    for msg in _iter_messages_from_text(text):
        for t in _collect_texts_from_msg(msg):
            m = VERDICT_RE.search(t)
            if m:
                last_verdict = m.group(1)
    if not last_verdict:
        # File parsed cleanly but contained no `Verdict:` line. The agent
        # either timed out, ran out of tool calls, or never reached the
        # verdict-emission step. Still a parse failure (file exists,
        # expected signal absent) — emit the sentinel.
        print(
            "extract-verdict: file parsed but no `Verdict:` line was found; "
            "action ran but produced no verdict",
            file=sys.stderr,
        )
        return PARSE_FAILED_SENTINEL
    return last_verdict


def main() -> int:
    if len(sys.argv) != 2:
        print(f"usage: {sys.argv[0]} <claude-execution-output.json>", file=sys.stderr)
        return 2
    path = Path(sys.argv[1])
    verdict = extract(path)
    # Always print whatever extract() returns, including PARSE_FAILED.
    # The sentinel is the explicit signal "do NOT default to Approve".
    print(verdict)
    return 0


if __name__ == "__main__":
    sys.exit(main())
