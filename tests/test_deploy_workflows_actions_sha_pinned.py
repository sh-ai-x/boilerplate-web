"""test_deploy_workflows_actions_sha_pinned.py — every `uses:` must be SHA-pinned.

Per the publish.yml / review.yml convention in this repo, all third-party
GitHub Actions referenced by the new deploy workflows MUST be pinned to
their 40-char hex commit SHA — never a tag (`@v4`) or branch (`@main`).
The ones in this repo already in use:
  - actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5 # v4
  - actions/setup-node@39370e3970a6d050c480ffad4ff0ed4d3fdee5af # v4
  - pnpm/action-setup@fe02b34f77f8bc703788d5817da081398fad5b2b # v4
Plus the three new ones introduced by phase 2:
  - amondnet/vercel-action
  - cloudflare/pages-action
  - supabase/setup-cli
"""
from __future__ import annotations

import re
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).parent.parent

SHA_PINNED_ACTIONS = {
    "actions/checkout": "34e114876b0b11c390a56381ad16ebd13914f8d5",
    "actions/setup-node": "39370e3970a6d050c480ffad4ff0ed4d3fdee5af",
    "pnpm/action-setup": "fe02b34f77f8bc703788d5817da081398fad5b2b",
}

WORKFLOW_PATHS = [
    REPO_ROOT / "templates" / "_shared" / ".github" / "workflows" / "deploy-shared.yml",
    REPO_ROOT / "templates" / "saas" / ".github" / "workflows" / "deploy.yml",
    REPO_ROOT / "templates" / "shop" / ".github" / "workflows" / "deploy.yml",
    REPO_ROOT / "templates" / "portfolio" / ".github" / "workflows" / "deploy.yml",
]


@pytest.mark.parametrize("path", WORKFLOW_PATHS)
def test_every_uses_is_sha_pinned(path: Path) -> None:
    """Every `uses: <owner>/<repo>@<ref>` line must use a 40-hex SHA (not a tag/branch)."""
    assert path.exists(), f"missing: {path}"
    text = path.read_text()
    uses_lines = re.findall(r"^\s*-?\s*uses:\s+([^#\n]+)", text, re.MULTILINE)
    assert uses_lines, f"{path}: no `uses:` lines found (workflow has no jobs?)"
    for line in uses_lines:
        ref = line.strip()
        if "@" not in ref:
            continue  # local `uses: ./...` reference; not a third-party pin
        action, pin = ref.rsplit("@", 1)
        assert re.fullmatch(r"[0-9a-f]{40}", pin), (
            f"{path}: `uses:` line {ref!r} is not SHA-pinned "
            f"(must be 40-hex SHA, not a tag/branch)"
        )


@pytest.mark.parametrize("path", WORKFLOW_PATHS)
def test_known_actions_use_pinned_shas_from_this_repo(path: Path) -> None:
    """actions that we already pin elsewhere in this repo (publish.yml / review.yml)
    must keep using the exact same SHA — drift detection."""
    text = path.read_text()
    for action, sha in SHA_PINNED_ACTIONS.items():
        if action in text:
            assert sha in text, (
                f"{path}: uses {action} but NOT at the canonical SHA {sha} "
                f"(drift vs publish.yml/review.yml)"
            )
