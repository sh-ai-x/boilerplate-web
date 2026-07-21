"""Regression tests for scripts/extract-verdict.py.

Pin the file-format quirks of anthropics/claude-code-action@v1 so the
gate's verdict recovery is not silently broken.

Background: on PR #29, the gate repeatedly read the old "Blocked" from
a stale claude[bot] comment because the file parser only looked at
assistant text blocks, but the agent posts its verdict via a tool_use
(Bash(gh pr comment:*) or mcp__github_inline_comment). The Verdict
string lives in the tool_use input.body or tool_result output, not in
a text block. These cases pin both formats and the existing one.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
SCRIPT = REPO_ROOT / "scripts" / "extract-verdict.py"


def _run_parser(path: Path) -> str:
    result = subprocess.run(
        [sys.executable, str(SCRIPT), str(path)],
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        raise AssertionError(
            f"parser exited {result.returncode} on {path}\n"
            f"stdout={result.stdout!r}\nstderr={result.stderr!r}"
        )
    return result.stdout.rstrip("\n")


def _write(path: Path, content) -> Path:
    path.write_text(content, encoding="utf-8")
    return path


class TestExtractVerdict(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp = Path(self._tmp.name)

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def _write(self, name: str, content) -> Path:
        path = self.tmp / name
        if isinstance(content, str):
            path.write_text(content, encoding="utf-8")
        else:
            path.write_text(json.dumps(content, indent=2), encoding="utf-8")
        return path

    # --- the original assistant text-block path (PR #26 fix) -------

    def test_assistant_text_block_with_blocked(self) -> None:
        path = self._write(
            self.tmp / "exec.json",
            "\n".join(
                json.dumps(m)
                for m in [
                    {"type": "system", "subtype": "init"},
                    {
                        "type": "assistant",
                        "message": {
                            "role": "assistant",
                            "content": [{"type": "text", "text": "Verdict: Blocked\n\nDetails..."}],
                        },
                    },
                ]
            )
            + "\n",
        )
        self.assertEqual(_run_parser(path), "Blocked")

    def test_assistant_text_block_with_approve(self) -> None:
        path = self._write(
            self.tmp / "exec.json",
            json.dumps(
                {
                    "type": "assistant",
                    "message": {
                        "role": "assistant",
                        "content": [{"type": "text", "text": "All good. Verdict: Approve"}],
                    },
                }
            )
            + "\n",
        )
        self.assertEqual(_run_parser(path), "Approve")

    def test_assistant_text_block_with_changes_requested(self) -> None:
        path = self._write(
            self.tmp / "exec.json",
            json.dumps(
                {
                    "type": "assistant",
                    "message": {
                        "role": "assistant",
                        "content": [{"type": "text", "text": "Verdict: Changes Requested"}],
                    },
                }
            )
            + "\n",
        )
        self.assertEqual(_run_parser(path), "Changes Requested")

    # --- the new tool_use path (PR #29 fix) ----------------------------
    # This is the format the security agent actually uses: it posts the
    # comment via `Bash(gh pr comment:*)` with the body in the tool_use
    # input.command. The Verdict line lives inside the bash command
    # string, NOT in a text block.

    def test_tool_use_bash_gh_pr_comment_with_blocked(self) -> None:
        path = self._write(
            self.tmp / "exec.json",
            json.dumps(
                {
                    "type": "assistant",
                    "message": {
                        "role": "assistant",
                        "content": [
                            {
                                "type": "tool_use",
                                "name": "Bash",
                                "input": {
                                    "command": 'gh pr comment 29 --body "Verdict: Blocked\n\nSecurity summary..."'
                                },
                            }
                        ],
                    },
                }
            )
            + "\n",
        )
        self.assertEqual(_run_parser(path), "Blocked")

    def test_tool_use_bash_gh_pr_comment_with_approve(self) -> None:
        path = self._write(
            self.tmp / "exec.json",
            json.dumps(
                {
                    "type": "assistant",
                    "message": {
                        "role": "assistant",
                        "content": [
                            {
                                "type": "tool_use",
                                "name": "Bash",
                                "input": {
                                    "command": "gh pr comment 29 --body $'Verdict: Approve\\n\\nNo issues.'"
                                },
                            }
                        ],
                    },
                }
            )
            + "\n",
        )
        self.assertEqual(_run_parser(path), "Approve")

    def test_tool_use_inline_comment_with_blocked(self) -> None:
        path = self._write(
            self.tmp / "exec.json",
            json.dumps(
                {
                    "type": "assistant",
                    "message": {
                        "role": "assistant",
                        "content": [
                            {
                                "type": "tool_use",
                                "name": "mcp__github_inline_comment__create_inline_comment",
                                "input": {"body": "Verdict: Blocked\n\nDetails."},
                            }
                        ],
                    },
                }
            )
            + "\n",
        )
        self.assertEqual(_run_parser(path), "Blocked")

    # --- tool_result path: the result of the gh pr comment tool call ---

    def test_tool_result_text_content_with_approve(self) -> None:
        path = self._write(
            self.tmp / "exec.json",
            json.dumps(
                {
                    "type": "assistant",
                    "message": {
                        "role": "assistant",
                        "content": [
                            {
                                "type": "tool_result",
                                "content": [
                                    {"type": "text", "text": "Posted comment: Verdict: Approve"}
                                ],
                            }
                        ],
                    },
                }
            )
            + "\n",
        )
        self.assertEqual(_run_parser(path), "Approve")

    # --- result message path: the action's final result ---

    def test_result_message_output_with_blocked(self) -> None:
        path = self._write(
            self.tmp / "exec.json",
            json.dumps(
                {
                    "type": "result",
                    "result": "Final: Verdict: Blocked (4 critical, 4 major)",
                }
            )
            + "\n",
        )
        self.assertEqual(_run_parser(path), "Blocked")

    # --- last-verdict-wins behavior across all formats ------------------

    def test_uses_last_verdict_across_formats(self) -> None:
        # Three messages: Approve (text), then Blocked (tool_use), then
        # Approve (tool_result). Last one wins.
        path = self._write(
            self.tmp / "exec.json",
            "\n".join(
                json.dumps(m)
                for m in [
                    {
                        "type": "assistant",
                        "message": {
                            "content": [{"type": "text", "text": "Verdict: Approve"}],
                        },
                    },
                    {
                        "type": "assistant",
                        "message": {
                            "content": [
                                {
                                    "type": "tool_use",
                                    "name": "Bash",
                                    "input": {"command": "gh pr comment 29 --body 'Verdict: Blocked'"},
                                }
                            ],
                        },
                    },
                    {
                        "type": "tool_result",
                        "content": [{"type": "text", "text": "Verdict: Approve (final)"}],
                    },
                ]
            )
            + "\n",
        )
        self.assertEqual(_run_parser(path), "Approve")

    # --- robustness contract --------------------------------------------

    def test_missing_file_returns_empty(self) -> None:
        missing = self.tmp / "absent.json"
        self.assertEqual(_run_parser(missing), "")

    def test_html_error_page_returns_empty(self) -> None:
        path = self._write(self.tmp / "err.html", "<html><body>404 Not Found</body></html>")
        self.assertEqual(_run_parser(path), "")

    def test_empty_file_returns_empty(self) -> None:
        path = self._write(self.tmp / "empty.json", "")
        self.assertEqual(_run_parser(path), "")

    def test_no_verdict_anywhere_returns_empty(self) -> None:
        path = self._write(
            self.tmp / "no-verdict.json",
            json.dumps(
                {
                    "type": "assistant",
                    "message": {
                        "content": [{"type": "text", "text": "No verdict here, just chatter."}],
                    },
                }
            )
            + "\n",
        )
        self.assertEqual(_run_parser(path), "")


if __name__ == "__main__":
    unittest.main(verbosity=2)
