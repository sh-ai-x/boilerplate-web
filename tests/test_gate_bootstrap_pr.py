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
        """Bootstrap-PR detection lives in the per-job `Detect bootstrap-PR fallback`
        step (id: fallback), not in the combined gate. The gate itself now
        reads `needs.<job>.outputs.agent_ran` (set by the per-job
        `Extract <skill> verdict` step's fallback branch to `false`) to
        short-circuit. This structural contract is the inverse of the
        pre-v0.3.247 layout (where the gate queried the PR's files
        directly) and is what allows the same gate logic to be reused
        across `pull_request` and `workflow_dispatch` event modes.
        """
        # The combined gate must read the bootstrap signal from job outputs
        # via `agent_ran`, not via a fresh `gh api /pulls/.../files` call.
        gate = self._combined_gate_script()
        self.assertIn("R_AGENT", gate)
        self.assertIn("S_AGENT", gate)
        self.assertIn("agent_ran", gate)

        # The bootstrap detection itself must live in a dedicated step
        # named `Detect bootstrap-PR fallback`, run after each agent job.
        self.assertIn("- name: Detect bootstrap-PR fallback", self.workflow_text)

        # That step must query the PR's files for `.github/workflows/`.
        detect = _extract_run_block(self.workflow_text, "Detect bootstrap-PR fallback")
        self.assertIn("gh pr diff", detect)
        self.assertIn("--name-only", detect)
        self.assertIn(".github/workflows/", detect)
        self.assertIn("needs_fallback", detect)

    def test_gate_script_warns_on_bootstrap_case(self) -> None:
        """The combined gate now hard-fails when `agent_ran=false` (the
        unambiguous signal that claude-code-action@v1's workflow-validation
        guard refused to run). The bootstrap case is therefore expressed as
        a hard-fail with the `AI agent was skipped` remediation, not as a
        warn+Approve branch in the gate. The fallback comment path still
        posts the `Verdict: Approve` audit comment via the per-job
        `Post fallback verdict comment` step, but the gate itself surfaces
        the install-broken remediation so the operator sees the issue.
        """
        gate = self._combined_gate_script()
        # The gate must short-circuit on agent_ran=false with the
        # `AI agent was skipped` message.
        self.assertIn("review+security gate: AI agent was skipped", gate)
        self.assertIn("R_AGENT", gate)
        self.assertIn('"false"', gate)
        self.assertRegex(gate, r"exit 1\b")

        # The companion `Post fallback verdict comment` step in each job
        # posts a `Verdict: Approve` audit comment so the gate's regex can
        # still parse a verdict from the comment thread.
        self.assertIn("- name: Post fallback verdict comment (review)", self.workflow_text)
        self.assertIn("- name: Post fallback verdict comment (security)", self.workflow_text)

    def test_gate_script_keeps_install_broken_hard_fail(self) -> None:
        """The install-broken hard-fail must still exist (after the bootstrap branch)."""
        script = self._combined_gate_script()
        # Updated for v0.3.247: the remediation message lists the four
        # concrete failure modes (DEV_KIT_GITHUB_TOKEN, MINIMAX/ANTHROPIC/
        # DEEPSEEK API key, plugin install, action rate-limit) instead of
        # the older single-line phrase.
        self.assertIn(
            "DEV_KIT_GITHUB_TOKEN secret missing or expired",
            script,
            "install-broken remediation message not found",
        )
        self.assertIn("MINIMAX_API_KEY / ANTHROPIC_API_KEY / DEEPSEEK_API_KEY missing", script)
        # Updated for v0.3.296: the action reference is now SHA-pinned
        # (`@558b1d6cab4085c7753fe402c10bef0fbb92ac7a # v1` in the workflow
        # source) instead of the unpinned `@v1` form. Match either so the
        # test is robust against future SHA-pin updates: the action name
        # (`anthropics/claude-code-action`) and the remediation token
        # (`rate-limit`) are the semantic content we want to assert on,
        # not the exact pin form.
        self.assertRegex(
            script,
            r"anthropics/claude-code-action@(?:\S+\s+#\s+v1|v1)\s+rate-limit",
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
