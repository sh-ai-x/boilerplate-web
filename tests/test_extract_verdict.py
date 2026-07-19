"""Regression tests for scripts/extract-verdict.py.

Pin file-format quirks of anthropics/claude-code-action@v1 so the
gate's hard-fail contract is not silently violated.

Background: on PR #26, the action's `writeExecutionFile` writes a
pretty-printed JSON ARRAY (one element per message), but the previous
parser treated it as JSON-lines. Result: every line that started with
`{` was an opening brace alone, json.loads failed, and the parser
silently returned "" — letting the severity gate default to "Approve"
on a security verdict of `Verdict: Blocked` (14 findings, 3 critical).
These cases pin both formats and the surrounding robustness contract.
"""
from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
SCRIPT = REPO_ROOT / "scripts" / "extract-verdict.py"


def _run_parser(path: Path) -> str:
    import subprocess

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


class TestExtractVerdict(unittest.TestCase):
    def setUp(self) -> None:
        import tempfile

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

    # --- the regression that masked PR #26's Blocked verdict -------

    def test_pretty_printed_json_array_with_blocked(self) -> None:
        """Pretty-printed JSON array (current claude-code-action format).

        Mirrors the actual `claude-execution-output.json` shape produced
        by `writeExecutionFile` (base-action/src/execution-file.ts:
        `JSON.stringify(messages, null, 2)`).
        """
        path = self._write(
            "exec.json",
            [
                {
                    "type": "system",
                    "subtype": "init",
                    "model": "MiniMax-M3[1m]",
                },
                {
                    "type": "assistant",
                    "message": {
                        "role": "assistant",
                        "content": [
                            {
                                "type": "text",
                                "text": "I will run the security review now.",
                            }
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
                                "text": (
                                    "Verdict: Blocked\n\n"
                                    "| Category | Findings |\n"
                                    "|---|---:|\n"
                                    "| A01 | 2 |\n"
                                ),
                            }
                        ],
                    },
                },
            ],
        )
        self.assertEqual(_run_parser(path), "Blocked")

    def test_pretty_printed_json_array_with_approve(self) -> None:
        path = self._write(
            "exec-approve.json",
            [
                {
                    "type": "assistant",
                    "message": {
                        "role": "assistant",
                        "content": [
                            {"type": "text", "text": "Verdict: Approve"}
                        ],
                    },
                }
            ],
        )
        self.assertEqual(_run_parser(path), "Approve")

    def test_pretty_printed_json_array_with_changes_requested(self) -> None:
        path = self._write(
            "exec-cr.json",
            [
                {
                    "type": "assistant",
                    "message": {
                        "role": "assistant",
                        "content": [
                            {
                                "type": "text",
                                "text": "Verdict: Changes Requested",
                            }
                        ],
                    },
                }
            ],
        )
        self.assertEqual(_run_parser(path), "Changes Requested")

    # --- backward compatibility: NDJSON / JSON-lines (older writers) -

    def test_ndjson_format_still_works(self) -> None:
        lines = [
            {"type": "user", "message": {"role": "user", "content": "go"}},
            {
                "type": "assistant",
                "message": {
                    "role": "assistant",
                    "content": [
                        {"type": "text", "text": "Verdict: Blocked"}
                    ],
                },
            },
        ]
        path = self.tmp / "ndjson.json"
        path.write_text("\n".join(json.dumps(l) for l in lines) + "\n", encoding="utf-8")
        self.assertEqual(_run_parser(path), "Blocked")

    # --- robustness: missing / wrong-format / no-verdict inputs -----

    def test_missing_file_returns_empty(self) -> None:
        missing = self.tmp / "absent.json"
        self.assertEqual(_run_parser(missing), "")

    def test_html_error_page_returns_empty(self) -> None:
        path = self._write("err.html", "<html><body>404 Not Found</body></html>")
        self.assertEqual(_run_parser(path), "")

    def test_empty_file_returns_empty(self) -> None:
        path = self._write("empty.json", "")
        self.assertEqual(_run_parser(path), "")

    def test_array_without_verdict_returns_empty(self) -> None:
        path = self._write(
            "no-verdict.json",
            [
                {
                    "type": "assistant",
                    "message": {
                        "role": "assistant",
                        "content": [
                            {"type": "text", "text": "No verdict here."}
                        ],
                    },
                }
            ],
        )
        self.assertEqual(_run_parser(path), "")

    def test_only_system_messages_returns_empty(self) -> None:
        path = self._write(
            "system-only.json",
            [{"type": "system", "subtype": "init", "model": "MiniMax-M3[1m]"}],
        )
        self.assertEqual(_run_parser(path), "")

    # --- last-verdict-wins (the gate must use the FINAL verdict) ----

    def test_uses_last_assistant_verdict(self) -> None:
        path = self._write(
            "two-verdicts.json",
            [
                {
                    "type": "assistant",
                    "message": {
                        "role": "assistant",
                        "content": [
                            {"type": "text", "text": "Verdict: Approve"}
                        ],
                    },
                },
                {
                    "type": "assistant",
                    "message": {
                        "role": "assistant",
                        "content": [
                            {"type": "text", "text": "Verdict: Blocked"}
                        ],
                    },
                },
            ],
        )
        self.assertEqual(_run_parser(path), "Blocked")

    # --- malformed JSON must not crash, must return empty -----------

    def test_malformed_array_returns_empty(self) -> None:
        path = self._write("broken.json", "[ { this is not valid json")
        self.assertEqual(_run_parser(path), "")

    # --- verdict inside a string content (alternative wrapper) ------

    def test_string_content_with_verdict(self) -> None:
        path = self._write(
            "str-content.json",
            [
                {
                    "type": "assistant",
                    "message": {
                        "role": "assistant",
                        "content": "Verdict: Changes Requested",
                    },
                }
            ],
        )
        self.assertEqual(_run_parser(path), "Changes Requested")


if __name__ == "__main__":
    unittest.main(verbosity=2)
