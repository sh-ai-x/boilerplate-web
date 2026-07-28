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
    """Run extract-verdict.py; assert exit 0 and return stdout.

    For tests that assert the fail-closed contract (exit != 0 + stderr
    sentinel), use _run_parser_raw and check returncode + stderr
    directly instead of this helper.
    """
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


def _run_parser_raw(path: Path) -> subprocess.CompletedProcess:
    """Run extract-verdict.py without raising on non-zero.

    Returns the CompletedProcess so the caller can inspect returncode,
    stdout, and stderr — used by the A10 fail-closed tests.
    """
    import subprocess

    return subprocess.run(
        [sys.executable, str(SCRIPT), str(path)],
        capture_output=True,
        text=True,
        check=False,
    )


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

    # --- A10: fail-closed on missing / wrong-format / no-verdict inputs ---

    def test_missing_file_fails_closed(self) -> None:
        """A missing execution-output file MUST fail-closed (exit 1) with
        an Install-Broken sentinel so the gate does NOT fall open to the
        default Approve.  This pins the A10 hardening from the 26c review.
        """
        missing = self.tmp / "absent.json"
        result = _run_parser_raw(missing)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Install-Broken", result.stderr)

    def test_html_error_page_fails_closed(self) -> None:
        """An HTML 404 page (network error indicator) MUST fail-closed.

        Empty stdout is the only acceptable shape when the parser
        refuses to interpret HTML as JSON; the script used to silently
        return "" on stdout AND "" on stderr, masking install-broken as
        a no-verdict Approve default.
        """
        path = self._write("err.html", "<html><body>404 Not Found</body></html>")
        result = _run_parser_raw(path)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Install-Broken", result.stderr)

    def test_empty_file_fails_closed(self) -> None:
        path = self._write("empty.json", "")
        result = _run_parser_raw(path)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Install-Broken", result.stderr)

    def test_array_without_verdict_fails_closed(self) -> None:
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
        result = _run_parser_raw(path)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Install-Broken", result.stderr)

    def test_only_system_messages_fails_closed(self) -> None:
        path = self._write(
            "system-only.json",
            [{"type": "system", "subtype": "init", "model": "MiniMax-M3[1m]"}],
        )
        result = _run_parser_raw(path)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Install-Broken", result.stderr)

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

    # --- A10: malformed JSON must fail-closed (not silently empty) ---

    def test_malformed_array_fails_closed(self) -> None:
        path = self._write("broken.json", "[ { this is not valid json")
        result = _run_parser_raw(path)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Install-Broken", result.stderr)

    # --- A08 / DoS hardening: input size cap ------------------------

    def test_oversized_input_bails_with_stderr_and_empty_stdout(self) -> None:
        """A pathologically large payload must not OOM the runner.

        The script caps reads at 2 MiB via path.stat() (F2 — precheck
        fires before read_text).  On overflow it returns "" on stdout
        and emits an Install-Broken stderr line so the gate's
        parse-failure path is visible instead of silently defaulting to
        Approve.
        """
        import subprocess
        # Build a payload that would push past 2 MiB if read in full.
        # We use a single repeated object so json.loads would otherwise
        # happily parse it.
        big = "[" + ('{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"A"}]}},' * 200000) + "]"
        path = self.tmp / "big.json"
        path.write_text(big, encoding="utf-8")
        result = subprocess.run(
            [sys.executable, str(SCRIPT), str(path)],
            capture_output=True,
            text=True,
            check=False,
        )
        # A10: explicit non-zero + sentinel since the cap fired.
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(result.stdout.rstrip("\n"), "")
        self.assertIn("input exceeds", result.stderr)
        self.assertIn("Install-Broken", result.stderr)

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
