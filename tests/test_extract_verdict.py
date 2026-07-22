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

    # A newer claude-code-action version may emit a list-shaped `result`
    # (a content-block array) instead of a str/dict. The parser must walk it,
    # otherwise the verdict is silently dropped and the gate falls back to a
    # stale comment.
    def test_result_message_list_of_content_blocks_with_blocked(self) -> None:
        path = self._write(
            self.tmp / "exec.json",
            json.dumps(
                {
                    "type": "result",
                    "result": [
                        {"type": "text", "text": "Security review summary."},
                        {"type": "text", "text": "Verdict: Blocked (1 critical)"},
                    ],
                }
            )
            + "\n",
        )
        self.assertEqual(_run_parser(path), "Blocked")

    def test_result_message_list_of_strings_with_approve(self) -> None:
        path = self._write(
            self.tmp / "exec.json",
            json.dumps(
                {
                    "type": "result",
                    "result": ["chatter", "Verdict: Approve"],
                }
            )
            + "\n",
        )
        self.assertEqual(_run_parser(path), "Approve")

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
    # A10/F1: the previous contract returned "" for ANY non-extractable case.
    # That made the workflow's extract step default the gate to Approve when
    # the parser failed — silently flipping a real Blocked verdict to
    # Approve. The new contract is:
    #   - file MISSING                       → ""  (cancelled-job tolerance)
    #   - file EXISTS but parse fails        → PARSE_FAILED sentinel
    #   - file EXISTS and verdict extracted  → Approve|Blocked|Changes Requested
    # The sentinel is a non-empty, non-Verdict value that the gate's
    # unparseable-verdict handler treats as ::warning:: + non-blocking —
    # making the failure visible without flipping the merge to Approve.

    def test_missing_file_returns_empty(self) -> None:
        # File missing is the ONLY case where empty stdout is correct. The
        # workflow's cancelled-job / transient-backend branch reads empty
        # stdout and falls back to PR-comment lookup (or default-Approve
        # with ::warning::). This is the documented tolerance for transient
        # backend issues — NOT for failed parses.
        missing = self.tmp / "absent.json"
        self.assertEqual(_run_parser(missing), "")

    def test_html_error_page_returns_parse_failed_sentinel(self) -> None:
        # The action produced a file (so it ran) but the contents are an
        # HTML error page (e.g. 404 from a redirect). Old behavior: empty
        # stdout → workflow defaults to Approve. New behavior: sentinel.
        path = self._write(self.tmp / "err.html", "<html><body>404 Not Found</body></html>")
        self.assertEqual(_run_parser(path), "PARSE_FAILED")

    def test_empty_file_returns_parse_failed_sentinel(self) -> None:
        # The action produced a 0-byte file (or one shorter than 10 chars).
        # The file exists, so the action did run; we just got nothing
        # parseable. Sentinel, not empty.
        path = self._write(self.tmp / "empty.json", "")
        self.assertEqual(_run_parser(path), "PARSE_FAILED")

    def test_short_truncated_file_returns_parse_failed_sentinel(self) -> None:
        # Anything shorter than the 10-char guard returns the sentinel.
        # This is the "truncated mid-write" case: the action was still
        # streaming its output when the runner killed it.
        path = self._write(self.tmp / "short.json", "abc")
        self.assertEqual(_run_parser(path), "PARSE_FAILED")

    def test_no_verdict_anywhere_returns_parse_failed_sentinel(self) -> None:
        # File parsed cleanly but contained no `Verdict:` line. The agent
        # either timed out, ran out of tool calls, or never reached the
        # verdict-emission step. Old behavior: empty → fail-open Approve.
        # New behavior: sentinel → unparseable verdict → ::warning::.
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
        self.assertEqual(_run_parser(path), "PARSE_FAILED")

    def test_malformed_json_returns_parse_failed_sentinel(self) -> None:
        # File looks like JSON but doesn't parse. Old behavior: empty.
        # New behavior: sentinel.
        path = self._write(self.tmp / "bad.json", "[this is not valid json")
        self.assertEqual(_run_parser(path), "PARSE_FAILED")

    def test_sentinel_is_not_one_of_the_three_known_verdicts(self) -> None:
        # Pin the sentinel's identity: it MUST NOT collide with any of the
        # three valid verdict values, otherwise the gate would treat a
        # genuine parse failure as a real Blocked/Approve verdict and
        # silently Approve or hard-block on parser misbehavior.
        path = self._write(self.tmp / "err.html", "<html>oops</html>")
        result = _run_parser(path)
        self.assertNotIn(result, ("Approve", "Blocked", "Changes Requested"))
        self.assertEqual(result, "PARSE_FAILED")

    # --- the pretty-printed JSON array format (commit 899c16b) -------
    # This is what anthropics/claude-code-action@v1 actually writes:
    # `JSON.stringify(messages, null, 2)`. Treating this as JSON-lines
    # fails because each line is a partial JSON object.

    def test_pretty_printed_json_array_with_blocked(self) -> None:
        # Match the exact shape that triggered the PR #26 false-positive.
        msgs = [
            {"type": "system", "subtype": "init", "model": "MiniMax-M3[1m]"},
            {
                "type": "assistant",
                "message": {
                    "role": "assistant",
                    "content": [
                        {"type": "text", "text": "I will run the security review now."},
                    ],
                },
            },
            {
                "type": "assistant",
                "message": {
                    "role": "assistant",
                    "content": [
                        {
                            "type": "text",
                            "text": "Verdict: Blocked\n\nSecurity summary...",
                        },
                    ],
                },
            },
        ]
        path = self._write(self.tmp / "pretty.json", json.dumps(msgs, indent=2))
        self.assertEqual(_run_parser(path), "Blocked")

    def test_pretty_printed_json_array_with_approve(self) -> None:
        msgs = [
            {
                "type": "assistant",
                "message": {
                    "role": "assistant",
                    "content": [{"type": "text", "text": "Verdict: Approve"}],
                },
            },
        ]
        path = self._write(self.tmp / "pretty-approve.json", json.dumps(msgs, indent=2))
        self.assertEqual(_run_parser(path), "Approve")

    def test_pretty_printed_json_array_with_tool_use(self) -> None:
        # The critical case: pretty-printed array where the verdict is
        # in a tool_use input.command, NOT in a text block.
        msgs = [
            {
                "type": "assistant",
                "message": {
                    "role": "assistant",
                    "content": [
                        {
                            "type": "tool_use",
                            "name": "Bash",
                            "input": {
                                "command": "gh pr comment 29 --body $'Verdict: Blocked\\n\\nDetails.'"
                            },
                        }
                    ],
                },
            },
        ]
        path = self.tmp / "pretty-tool-use.json"
        path.write_text(json.dumps(msgs, indent=2), encoding="utf-8")
        self.assertEqual(_run_parser(path), "Blocked")


if __name__ == "__main__":
    unittest.main(verbosity=2)
