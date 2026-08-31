"""test_deploy_workflows_scaffold_paths.py — scaffolded deploy.yml must not pin source-repo paths.

Phase 2-deploy-automation regression: per-template deploy.yml uses
`paths: templates/<type>/**` to filter on push events when the workflow
lives inside the boilerplate-web monorepo. After degit scaffolds
`templates/<type>/` into the user's target folder, the workflow lands
at `<root>/.github/workflows/deploy.yml` and the path filter no longer
matches (the user's repo doesn't have `templates/<type>/**`).

Fix: when degit scaffolds, the workflow's `paths:` line is stripped
from each per-template deploy.yml. (See `templates/<type>/.github/
workflows/deploy.yml` in this repo - already stripped.)

This test pins the contract: no per-template workflow may contain
`paths: templates/...` (source-repo paths) or any other path filter.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).parent.parent

PER_TEMPLATE_WORKFLOWS = [
    REPO_ROOT / "templates" / "saas" / ".github" / "workflows" / "deploy.yml",
    REPO_ROOT / "templates" / "shop" / ".github" / "workflows" / "deploy.yml",
    REPO_ROOT / "templates" / "portfolio" / ".github" / "workflows" / "deploy.yml",
]


@pytest.mark.parametrize("path", PER_TEMPLATE_WORKFLOWS)
def test_no_paths_filter_on_push(path: Path) -> None:
    assert path.exists(), f"missing: {path}"
    text = path.read_text()
    # Capture the entire `push:` block by anchoring on the literal
    # `push:` token and walking forward until the next sibling key (matches
    # at the same indentation as `push:`, i.e. 2-space indent below `on:`).
    push_re = re.compile(
        r"^  push:\n((?:^[ ]+[^\n]*\n|^\n)+?)(?=^  [a-z]|\Z)",
        re.MULTILINE,
    )
    match = push_re.search(text)
    assert match, f"{path}: no `push:` block found"
    inner = match.group(1)
    # Inner block contains the children of push:. No `paths:` filter allowed.
    assert "paths:" not in inner, (
        f"{path}: push block has a paths filter which won't match in the "
        f"scaffolded target (the user repo doesn't have templates/<type>/**)"
    )


@pytest.mark.parametrize("path", PER_TEMPLATE_WORKFLOWS)
def test_trigger_is_push_to_main(path: Path) -> None:
    text = path.read_text()
    assert "push:" in text and "branches: [main]" in text, (
        f"{path}: must trigger on push to main (no path filter)"
    )


def test_cloudflare_rules_json_shipped_with_paid_templates() -> None:
    """templates/saas/cloudflare-rules.json + templates/shop/cloudflare-rules.json must exist,
    because the cloudflare-waf job runs `jq 'length' cloudflare-rules.json` against
    the workdir root after degit scaffolds."""
    for tpl in ("saas", "shop"):
        rules = REPO_ROOT / "templates" / tpl / "cloudflare-rules.json"
        assert rules.exists(), f"{tpl}/cloudflare-rules.json missing (required by cloudflare-waf job)"
        data = json.loads(rules.read_text())
        assert isinstance(data, list), f"{tpl}/cloudflare-rules.json is not a JSON array"
        assert len(data) >= 5, f"{tpl}/cloudflare-rules.json has only {len(data)} rules (need >= 5)"
