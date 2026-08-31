"""test_deploy_workflows_present.py — contract for the per-template deploy workflows.

Phase 2-deploy-automation adds:
  - templates/_shared/.github/workflows/deploy-shared.yml (composite reusable action)
  - templates/saas/.github/workflows/deploy.yml (full job set)
  - templates/shop/.github/workflows/deploy.yml (full job set; function-list: toss-pay)
  - templates/portfolio/.github/workflows/deploy.yml (no WAF, no functions jobs)

This test asserts the workflows are structurally present with the expected job names.
Action SHA pinning is asserted in test_deploy_workflows_actions_sha_pinned.py.
Secrets enumeration is asserted in test_deploy_workflows_secrets.py.
"""
from __future__ import annotations

import re
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).parent.parent

WORKFLOWS = {
    "saas": REPO_ROOT / "templates" / "saas" / ".github" / "workflows" / "deploy.yml",
    "shop": REPO_ROOT / "templates" / "shop" / ".github" / "workflows" / "deploy.yml",
    "portfolio": REPO_ROOT / "templates" / "portfolio" / ".github" / "workflows" / "deploy.yml",
    "_shared": REPO_ROOT / "templates" / "_shared" / ".github" / "workflows" / "deploy-shared.yml",
}

# Expected job names per template. `deploy-shared` is the shared composite job that
# all 3 per-template workflows call. saas + shop add supabase-functions + cloudflare-waf.
EXPECTED_JOBS = {
    "saas": {"deploy-shared", "supabase-functions", "cloudflare-waf"},
    "shop": {"deploy-shared", "supabase-functions", "cloudflare-waf"},
    "portfolio": {"deploy-shared"},  # no WAF, no functions (no payment surface)
}


@pytest.mark.parametrize("tpl,path", list(WORKFLOWS.items()))
def test_workflow_file_exists(tpl: str, path: Path) -> None:
    assert path.exists(), f"missing workflow file: {path}"


@pytest.mark.parametrize("tpl,path", [(t, p) for t, p in WORKFLOWS.items() if t != "_shared"])
def test_workflow_has_required_jobs(tpl: str, path: Path) -> None:
    text = path.read_text()
    expected = EXPECTED_JOBS[tpl]
    for job in expected:
        assert re.search(rf"^  {re.escape(job)}:", text, re.MULTILINE), (
            f"{tpl}/deploy.yml missing required job: {job!r}"
        )


def test_shared_composite_is_workflow_call() -> None:
    """deploy-shared.yml must be a workflow_call composite (reusable across deploy.yml files)."""
    text = WORKFLOWS["_shared"].read_text()
    assert "workflow_call" in text, (
        "deploy-shared.yml must declare `on: workflow_call:` (composite reusable action)"
    )


def test_per_template_deploys_invoke_shared_composite() -> None:
    """Each per-template deploy.yml must call the shared composite via `uses:`."""
    for tpl in ("saas", "shop", "portfolio"):
        text = WORKFLOWS[tpl].read_text()
        assert "_shared/.github/workflows/deploy-shared.yml" in text, (
            f"{tpl}/deploy.yml does not reference the composite deploy-shared.yml"
        )


def test_only_saas_and_shop_have_cloudflare_waf_job() -> None:
    """Portfolio MUST NOT have a cloudflare-waf job (no payment surface)."""
    portfolio_text = WORKFLOWS["portfolio"].read_text()
    assert "cloudflare-waf:" not in portfolio_text, (
        "portfolio/deploy.yml has a cloudflare-waf job but portfolio has no payment surface"
    )
    saas_text = WORKFLOWS["saas"].read_text()
    assert "cloudflare-waf:" in saas_text
    shop_text = WORKFLOWS["shop"].read_text()
    assert "cloudflare-waf:" in shop_text


def test_only_saas_and_shop_have_supabase_functions_job() -> None:
    """Portfolio MUST NOT have a supabase-functions job (no Edge Functions)."""
    portfolio_text = WORKFLOWS["portfolio"].read_text()
    assert "supabase-functions:" not in portfolio_text, (
        "portfolio/deploy.yml has a supabase-functions job but portfolio has no Edge Functions"
    )
    saas_text = WORKFLOWS["saas"].read_text()
    assert "supabase-functions:" in saas_text
    shop_text = WORKFLOWS["shop"].read_text()
    assert "supabase-functions:" in shop_text
