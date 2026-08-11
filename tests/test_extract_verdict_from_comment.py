"""Tests for scripts/extract-verdict-from-comment.py (issue #625 fallback).

Covers:
  - VERDICT_RE strict match (Approve / Changes Requested / Blocked)
  - is_claude_bot login suffix matching
  - first_verdict walks lines top-down, returns first match
  - end-to-end main() with mocked gh pr view
"""
from __future__ import annotations

import importlib.util
import json
import subprocess
import sys
from pathlib import Path
from unittest import mock

import pytest

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "extract-verdict-from-comment.py"

spec = importlib.util.spec_from_file_location("evfc", SCRIPT)
evfc = importlib.util.module_from_spec(spec)
spec.loader.exec_module(evfc)


class TestVerdictRegex:
    @pytest.mark.parametrize(
        "body,expected",
        [
            ("Verdict: Approve", "Approve"),
            ("Verdict: Changes Requested", "Changes Requested"),
            ("Verdict: Blocked", "Blocked"),
            ("Verdict: Approve\nMore text", "Approve"),
            ("Verdict: Approve\n\nDetails follow...", "Approve"),
            ("Some intro\nVerdict: Approve", "Approve"),
            ("verdict: approve", ""),  # lowercase rejected
            ("**Verdict:** Approve", ""),  # bold-wrapped rejected
            ("Verdict: Unknown", ""),  # unknown value rejected
            ("", ""),
            ("Just text, no verdict line.", ""),
        ],
    )
    def test_first_verdict(self, body: str, expected: str) -> None:
        assert evfc.first_verdict(body) == expected


class TestIsClaudeBot:
    @pytest.mark.parametrize(
        "login,expected",
        [
            ("claude[bot]", True),
            ("claude-code-action[bot]", True),
            ("claude-sonnet-4.5[bot]", True),
            ("claude", True),  # bare login (claude-code-action@v1 default)
            ("Claude", True),  # case-insensitive
            ("dev-kit-ci[bot]", True),
            ("dev-kit-review[bot]", True),
            ("sh-ai-x", False),
            ("github-actions", False),  # gate audit-comment author
            ("dependabot[bot]", False),  # not a claude-prefixed bot
            ("", False),
        ],
    )
    def test_bot_detection(self, login: str, expected: bool) -> None:
        assert evfc.is_claude_bot(login) is expected


class TestEndToEnd:
    def _mock_gh(self, comments: list) -> mock.MagicMock:
        """Return a mock that makes subprocess.run return JSON-encoded comments."""
        json_blob = json.dumps(
            [
                {
                    "author": c.get("author"),
                    "body": c["body"],
                    "createdAt": c.get("createdAt", "2026-01-01T00:00:00Z"),
                }
                for c in comments
            ]
        )
        m = mock.MagicMock()
        m.return_value = mock.Mock(stdout=json_blob, returncode=0)
        return m

    def test_returns_verdict_when_claude_bot_posted_it(self) -> None:
        comments = [
            {"author": "sh-ai-x", "body": "human reviewer comment"},
            {"author": "claude[bot]", "body": "Verdict: Approve\nAll clear."},
        ]
        with mock.patch.object(evfc.subprocess, "run", self._mock_gh(comments)):
            result = evfc.main_with_arg("49")  # type: ignore[attr-defined]
        assert result == "Approve"

    def test_skips_human_comments(self) -> None:
        comments = [
            {"author": "sh-ai-x", "body": "Verdict: Blocked"},  # human — skip
            {"author": "claude[bot]", "body": "Verdict: Changes Requested"},
        ]
        with mock.patch.object(evfc.subprocess, "run", self._mock_gh(comments)):
            result = evfc.main_with_arg("49")  # type: ignore[attr-defined]
        assert result == "Changes Requested"

    def test_returns_empty_when_no_claude_bot_comment(self) -> None:
        comments = [
            {"author": "sh-ai-x", "body": "Just a comment"},
        ]
        with mock.patch.object(evfc.subprocess, "run", self._mock_gh(comments)):
            result = evfc.main_with_arg("49")  # type: ignore[attr-defined]
        assert result == ""

    def test_picks_newest_claude_comment(self) -> None:
        """When multiple claude bots post, take the newest one."""
        comments = [
            {"author": "claude[bot]", "body": "Verdict: Approve", "createdAt": "2026-01-01"},
            {"author": "claude[bot]", "body": "Verdict: Blocked", "createdAt": "2026-01-02"},
        ]
        with mock.patch.object(evfc.subprocess, "run", self._mock_gh(comments)):
            result = evfc.main_with_arg("49")  # type: ignore[attr-defined]
        assert result == "Blocked"
