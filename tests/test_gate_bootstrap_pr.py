"""test_gate_bootstrap_pr.py — regression for the severity gate's bootstrap-PR handling.

Verifies that .github/workflows/review.yml's severity gate differentiates
between:

  (a) Bootstrap-PR case — PR modifies .github/workflows/* and the AI agent
      refuses to run by design. The gate should warn + treat as Approve.
      The human gate (branch protection / REVIEW_REQUIRED) is what actually
      blocks merge, not a missing agent verdict.

  (b) Install-broken case — PR does NOT modify workflows but agent_ran=
      false anyway. This is the canonical install-broken signature (issue
      #212-C1): hard-fail with the remediation message.

Background: PR #26 hit the bootstrap-PR case and the gate's earlier
hard-fail on agent_ran=false blocked the entire CI pipeline, requiring a
human to merge workflow changes first. But the bootstrap case is
inherent to ANY PR that touches .github/workflows/* — the claude-code-
action refuses to review its own workflow changes by design. Hard-failing
on the bootstrap case creates a chicken-and-egg problem (the gate
cannot approve the change it needs to fix its own chicken-and-egg
behavior). The fix differentiates the two cases by querying the PR's
changed files.

This test pins the contract by parsing the workflow YAML via stdlib
(text-based extraction; PyYAML is intentionally avoided so the test
runs in the CI pytest env that only installs pytest). The bash logic
itself is exercised end-to-end by the CI workflow (this test pins the
structural contract; CI exercises the runtime contract).
"""
from __future__ import annotations

import re
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).parent.parent
WORKFLOW = REPO_ROOT / ".github" / "workflows" / "review.yml"


def _extract_run_block(workflow_text: str, step_name: str) -> str:
    """Find the `run:` block of a step whose `name:` matches step_name.

    In .github/workflows/review.yml, steps are listed under each job's
    `steps:` key with `- name: <name>` at 6 spaces and `run: |` at 8
    spaces. The block's content is indented 2 more spaces (10 spaces).
    The block ends at the next sibling key — either another
    `- name:` at 6 spaces or a key like `env:`/`if:` at 4 spaces.
    """
    name_re = re.compile(
        r"^      - name:\s+" + re.escape(step_name) + r"\s*$",
        re.MULTILINE,
    )
    name_match = name_re.search(workflow_text)
    if not name_match:
        raise AssertionError(f"step name not found: {step_name!r}")
    after = workflow_text[name_match.end():]
    run_re = re.compile(r"^        run:\s*\|\s*$", re.MULTILINE)
    run_match = run_re.search(after)
    if not run_match:
        raise AssertionError(f"run: block not found after step {step_name!r}")
    block_start = name_match.end() + run_match.end()
    rest = workflow_text[block_start:]
    # The block ends at a sibling step (`      - name:`) or a key at
    # the parent level (e.g. `    env:` at 4 spaces).
    sibling_re = re.compile(
        r"^(      - |    [A-Za-z][A-Za-z0-9_-]*:)",
        re.MULTILINE,
    )
    sibling_match = sibling_re.search(rest)
    if sibling_match:
        return rest[: sibling_match.start()]
    return rest


class TestGateBootstrapPR(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        if not WORKFLOW.exists():
            raise FileNotFoundError(f"workflow missing: {WORKFLOW}")
        cls.workflow_text = WORKFLOW.read_text()

    def test_combined_gate_step_exists(self) -> None:
        """The 'Combined verdict gate' step must exist in the gate job."""
        self.assertIn("Combined verdict gate", self.workflow_text)
        self.assertIn("needs: [review, security]", self.workflow_text)

    def _combined_gate_script(self) -> str:
        return _extract_run_block(self.workflow_text, "Combined verdict gate")

    def test_gate_script_has_bootstrap_pr_detection(self) -> None:
        """The gate must query the PR's changed files to detect bootstrap case."""
        script = self._combined_gate_script()
        self.assertIn("/pulls/", script)
        self.assertIn("/files", script)
        self.assertIn(".github/workflows/", script)
        self.assertIn("jq", script)
        self.assertIn("pr_touches_workflow", script)
        self.assertIn("-gt 0", script)

    def test_gate_script_warns_on_bootstrap_case(self) -> None:
        """The bootstrap branch must emit ::warning:: and exit 0 (Approve)."""
        script = self._combined_gate_script()
        bootstrap_match = re.search(
            r"pr_touches_workflow.*?\n(.*?)echo \"::error::review\+security gate: AI agent was skipped\"",
            script,
            re.DOTALL,
        )
        self.assertIsNotNone(
            bootstrap_match,
            "bootstrap-PR branch not found before the install-broken hard-fail",
        )
        bootstrap_block = bootstrap_match.group(1)
        self.assertIn("::warning::", bootstrap_block)
        self.assertRegex(bootstrap_block, r"Approve\)\s*exit 0")

    def test_gate_script_keeps_install_broken_hard_fail(self) -> None:
        """The install-broken hard-fail must still exist (after the bootstrap branch)."""
        script = self._combined_gate_script()
        self.assertIn(
            "DEV_KIT_GITHUB_TOKEN missing, action rate-limit, plugin",
            script,
            "install-broken remediation message not found",
        )
        self.assertIn("exit 1", script)

    def test_gate_env_has_pr_number(self) -> None:
        """The gate job env must include PR_NUMBER (used by bootstrap detection)."""
        self.assertIn("      PR_NUMBER:", self.workflow_text)
        # And it must be referenced inside the gate job's env block.
        gate_block_match = re.search(
            r"^  gate:\s*\n(?:^    [^\n]*\n)+",
            self.workflow_text,
            re.MULTILINE,
        )
        self.assertIsNotNone(gate_block_match, "gate job not found")
        self.assertIn("PR_NUMBER:", gate_block_match.group(0))

    def test_extract_step_sets_agent_ran_false_for_workflow_fallback(self) -> None:
        """Sanity: the review Extract step still sets agent_ran=false in the
        workflow-fallback branch (so the bootstrap case reaches the gate's
        bootstrap-detection branch).
        """
        extract_script = _extract_run_block(self.workflow_text, "Extract review verdict")
        self.assertIn("agent_ran=false", extract_script)
        self.assertIn("verdict=Approve", extract_script)


if __name__ == "__main__":
    unittest.main()
