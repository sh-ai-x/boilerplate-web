"""test_deploy_workflows_secrets.py — every deploy workflow references all 7 secrets.

The 7 secrets are defined once in docs/DEPLOY_SECRETS.md and must be cited
verbatim by:
  - templates/_shared/.github/workflows/deploy-shared.yml in its `secrets:` block
    (top-level workflow_call input)
  - each per-template deploy.yml in the `secrets:` forwarding when invoking
    the composite (saas, shop, portfolio)

If a secret is missing from the shared composite, the per-template
forwarding won't have it to pass and the downstream job will silently
fail with empty env. If it's missing from a per-template forwarding,
the SAME. So we pin both ends.
"""
from __future__ import annotations

import re
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).parent.parent

EXPECTED_SECRETS = {
    "VERCEL_TOKEN",
    "VERCEL_ORG_ID",
    "VERCEL_PROJECT_ID",
    "CF_API_TOKEN",
    "CF_ZONE_ID",
    "SUPABASE_ACCESS_TOKEN",
    "SUPABASE_PROJECT_REF",
}

SHARED = REPO_ROOT / "templates" / "_shared" / ".github" / "workflows" / "deploy-shared.yml"
PER_TEMPLATE = {
    "saas": REPO_ROOT / "templates" / "saas" / ".github" / "workflows" / "deploy.yml",
    "shop": REPO_ROOT / "templates" / "shop" / ".github" / "workflows" / "deploy.yml",
    "portfolio": REPO_ROOT / "templates" / "portfolio" / ".github" / "workflows" / "deploy.yml",
}


def test_shared_composite_declares_all_seven_secrets() -> None:
    text = SHARED.read_text()
    for secret in EXPECTED_SECRETS:
        assert secret in text, (
            f"deploy-shared.yml does not declare secret {secret!r}"
        )
    assert "workflow_call" in text, "deploy-shared.yml must declare workflow_call trigger"


@pytest.mark.parametrize("tpl,path", list(PER_TEMPLATE.items()))
def test_per_template_workflow_forwards_all_seven_secrets(tpl: str, path: Path) -> None:
    text = path.read_text()
    for secret in EXPECTED_SECRETS:
        assert secret in text, (
            f"{tpl}/deploy.yml does not forward secret {secret!r} to the shared composite"
        )


def test_per_template_workflow_uses_secrets_call_form() -> None:
    for tpl, path in PER_TEMPLATE.items():
        text = path.read_text()
        assert "_shared/.github/workflows/deploy-shared.yml" in text, (
            f"{tpl}/deploy.yml does not call the shared composite"
        )
        deploy_shared_section = re.search(
            r"^  deploy-shared:[\s\S]+?(?=^  [a-z][a-z0-9-]*:|\Z)", text, re.MULTILINE
        )
        assert deploy_shared_section, (
            f"{tpl}/deploy.yml has no `deploy-shared:` job block"
        )
        assert "secrets:" in deploy_shared_section.group(0), (
            f"{tpl}/deploy.yml: deploy-shared job block has no `secrets:` forwarding"
        )
