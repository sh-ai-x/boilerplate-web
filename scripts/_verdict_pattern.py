"""Shared `Verdict: <value>` regex for the LLM-review parsers.

Both `scripts/extract-verdict.py` (parses anthropics/claude-code-action@v1's
output file) and `scripts/extract-verdict-from-comment.py` (the issue #625
fallback that parses the PR's claude[bot] comment thread) need to detect
the canonical verdict line. Review finding from PR #49 (commit 4f502ea +
follow-up): keep ONE source of truth so the two parsers cannot diverge.

Contract (matched across both parsers):
  - Anchored whole-line match (MULTILINE `^...$`).
  - Captures one of: `Approve`, `Changes Requested`, `Blocked`.
  - Rejects bold-wrapped (`**Verdict:** X`), lowercase (`verdict: x`),
    and mid-sentence tokens.

If you change the pattern string here, both parsers pick up the new
shape automatically — no manual sync required.
"""
from __future__ import annotations

import re

VERDICT_RE = re.compile(
    r"^\s*Verdict:\s*(Approve|Blocked|Changes Requested)\s*$",
    re.MULTILINE,
)
