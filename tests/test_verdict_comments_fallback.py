"""test_verdict_comments_fallback.py — pins the contract for review.yml's
PARSE_FAILED fallback path. The script is referenced from review.yml
line 418 + _verdict_from_comment.py line 727 (Issue #625 retry-loop).
If it disappears, review.yml's gate hard-fails with exit 127, which is
the bug that surfaced on PR #64.

Phase 2-deploy-automation step: drop the missing helper into the
monorepo + pin its contract here so future template refreshes can't
silently remove it.
"""
from __future__ import annotations

import json
import re
import subprocess
import tempfile
from pathlib import Path

REPO_ROOT = Path(__file__).parent.parent
SCRIPT = REPO_ROOT / ".github" / "workflows" / "_verdict_comments_fallback.sh"


def test_script_exists() -> None:
    assert SCRIPT.exists(), (
        f"missing: {SCRIPT} (review.yml calls it on line 418; missing file = exit 127)"
    )


def test_script_is_executable() -> None:
    import stat
    mode = SCRIPT.stat().st_mode
    assert mode & stat.S_IXUSR, f"{SCRIPT} is not executable (chmod +x missing)"


def test_script_bash_syntax_ok() -> None:
    import subprocess
    result = subprocess.run(
        ["bash", "-n", str(SCRIPT)],
        capture_output=True, text=True, check=False,
    )
    assert result.returncode == 0, (
        f"bash -n failed: rc={result.returncode}\nSTDOUT={result.stdout}\nSTDERR={result.stderr}"
    )


def test_script_uses_strict_mode() -> None:
    """Defensive: any line that doesn't `set -euo pipefail` would fail this test.
    Review.yml's gate runs this script under `set -e`; a missing strict-mode
    line would let silent failures propagate up."""
    text = SCRIPT.read_text()
    assert "set -euo pipefail" in text, (
        f"{SCRIPT} does not enable strict mode (set -euo pipefail)"
    )


def test_script_validates_required_env_vars() -> None:
    """The script must refuse to run without CUTOFF + PR_NUMBER — otherwise
    silent misreads of stale verdicts."""
    text = SCRIPT.read_text()
    assert '"${CUTOFF:?_' in text or 'CUTOFF:?_' in text, (
        f"{SCRIPT} does not validate :CUTOFF env"
    )
    assert 'PR_NUMBER:?_' in text, (
        f"{SCRIPT} does not validate :PR_NUMBER env"
    )


def test_review_yml_references_script_at_existing_path() -> None:
    """Pin: the reference site in review.yml must point at the file we ship."""
    review_yml = (REPO_ROOT / ".github" / "workflows" / "review.yml").read_text()
    assert "_verdict_comments_fallback.sh" in review_yml, (
        "review.yml no longer references _verdict_comments_fallback.sh — "
        "either the gate is now self-contained (update this test) OR "
        "a refactor removed the reference by mistake"
    )
    # The reference must resolve to a path that exists in the repo.
    for match in re.finditer(
        r"workflows/_verdict_comments_fallback\.sh", review_yml
    ):
        assert SCRIPT.exists(), (
            f"review.yml references _verdict_comments_fallback.sh but {SCRIPT} is missing"
        )


# --- jq regex pinning (Issue #625 + #244 trust-bound) ----------------------


def _extract_jq_filter() -> str:
    """Extract the literal jq filter the script passes to `gh pr view ... --jq`.

    The script embeds a single-quoted jq program; regex pulls out the
    contents. We pass that EXACT string to jq from a Python subprocess
    so the test exercises the same byte sequence the production workflow
    will.
    """
    text = SCRIPT.read_text()
    m = re.search(r"--jq\s+'(.+?)'", text, re.DOTALL)
    assert m, f"could not find --jq '...' in {SCRIPT}"
    return m.group(1)


def _run_jq_filter(jq_filter: str, fixture_json: str) -> list[dict]:
    """Run the script's exact jq filter against a fixture; return matching dicts.

    `jq` accepts bracket characters `[`/`]` UNESCAPED inside regex strings
    (a bracketed substring is a no-op character class). Passing the filter
    string directly (not via shell heredoc) preserves the bytes the script
    intends, so the test faithfully reproduces production behavior.

    Note: jq's `-e` flag exits non-zero when the LAST output value is
    false/null/empty-array. For "no matches" (empty stdout) the exit is 1,
    not 4, so we accept any rc in {0, 1} as "filter ran". A real jq
    compile/runtime error surfaces as rc>=2 with stderr text.
    """
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as f:
        f.write(fixture_json)
        path = f.name
    try:
        result = subprocess.run(
            ["jq", "-c", jq_filter, path],
            capture_output=True, text=True, check=False,
        )
        if result.returncode >= 2:
            raise AssertionError(
                f"jq compile/runtime error: rc={result.returncode}, "
                f"stderr={result.stderr!r}, filter={jq_filter!r}"
            )
        return [json.loads(line) for line in result.stdout.strip().splitlines() if line]
    finally:
        Path(path).unlink(missing_ok=True)


_BOT_LOGINS_FIXTURE = json.dumps({"comments": [
    {"author": {"login": "claude[bot]"}, "body": "Verdict: Approve", "createdAt": "2026-08-31T00:00:00Z"},
    {"author": {"login": "anthropic-ai[bot]"}, "body": "Verdict: Blocked", "createdAt": "2026-08-31T01:00:00Z"},
]})


_NON_BOT_LOGINS_FIXTURE = json.dumps({"comments": [
    {"author": {"login": "iamclaudette"}, "body": "Verdict: APPROVE-attacker", "createdAt": "2026-08-31T00:00:00Z"},
    {"author": {"login": "anthropic-fan"}, "body": "Verdict: Changes Requested", "createdAt": "2026-08-31T01:00:00Z"},
    {"author": {"login": "user1"}, "body": "Verdict: Approve", "createdAt": "2026-08-31T02:00:00Z"},
]})


def test_jq_filter_accepts_canonical_bot_logins() -> None:
    """The script's jq filter must accept the two real bot logins:
    `claude[bot]` and `anthropic-ai[bot]`. Previously the filter's
    `; i` flag was concatenated INSIDE the quoted regex, so jq treated
    it as a literal character and matched nothing. The fix moves the
    flag OUTSIDE the quotes (jq's documented regex signature)."""
    bodies = [m["body"] for m in _run_jq_filter(_extract_jq_filter(), _BOT_LOGINS_FIXTURE)]
    assert "Verdict: Approve" in bodies, "claude[bot] should be accepted"
    assert "Verdict: Blocked" in bodies, "anthropic-ai[bot] should be accepted"


def test_jq_filter_rejects_substring_injection() -> None:
    """Trust-bound: the filter must reject substrings that happen to
    contain the bot name (e.g. `iamclaudette`, `anthropic-fan`). The
    original unanchored `claude|anthropic|...` accepted these and was
    the source of the #244 stale-comment flap + injection risk. Per-branch
    anchors defeat the substring attack without needing jq-specific
    bracket-escape quirks."""
    bodies = [m["body"] for m in _run_jq_filter(_extract_jq_filter(), _NON_BOT_LOGINS_FIXTURE)]
    assert "Verdict: APPROVE-attacker" not in bodies, "iamclaudette must be rejected"
    assert "Verdict: Changes Requested" not in bodies, "anthropic-fan must be rejected"
    assert "Verdict: Approve" not in bodies, "user1 must be rejected"


def test_jq_filter_combined_fixture() -> None:
    """Sanity: combining bot + non-bot fixtures, only the bot bodies survive."""
    combined = json.dumps({"comments": [
        {"author": {"login": "claude[bot]"}, "body": "Verdict: Approve", "createdAt": "2026-08-31T00:00:00Z"},
        {"author": {"login": "iamclaudette"}, "body": "Verdict: APPROVE-attacker", "createdAt": "2026-08-31T01:00:00Z"},
    ]})
    bodies = [m["body"] for m in _run_jq_filter(_extract_jq_filter(), combined)]
    assert "Verdict: Approve" in bodies
    assert "Verdict: APPROVE-attacker" not in bodies
