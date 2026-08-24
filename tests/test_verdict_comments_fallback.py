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

import re
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
        # find the path literally adjacent — the github.workspace prefix
        # is runtime-only; in the repo the file lives at workflows/_verdict_comments_fallback.sh
        assert SCRIPT.exists(), (
            f"review.yml references _verdict_comments_fallback.sh but {SCRIPT} is missing"
        )
