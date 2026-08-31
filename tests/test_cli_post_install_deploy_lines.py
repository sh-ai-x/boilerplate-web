"""test_cli_post_install_deploy_lines.py — the CLI checklist must point at deploy workflows.

Phase 2-deploy-automation step 2 adds 2 lines per CHECKLISTS entry in
cli/lib/post-install.js:
  1. Set 7 GitHub repo secrets (see docs/DEPLOY_SECRETS.md): gh secret set ...
  2. Push to main: triggers templates/<type>/.github/workflows/deploy.yml (…)

Both lines must appear for all 3 templates (saas, shop, portfolio).
The saas + shop rows additionally still must mention supabase functions
deploy (regression safety for tests/cli.test.js:50).
"""
from __future__ import annotations

import re
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).parent.parent
POST_INSTALL_JS = REPO_ROOT / "cli" / "lib" / "post-install.js"

CHECKLISTS_REQUIRED_LINES = [
    "Set 7 GitHub repo secrets",
    "gh secret set VERCEL_TOKEN VERCEL_ORG_ID VERCEL_PROJECT_ID CF_API_TOKEN CF_ZONE_ID SUPABASE_ACCESS_TOKEN SUPABASE_PROJECT_REF",
    "docs/DEPLOY_SECRETS.md",
    "Push to main",
    "templates/saas/.github/workflows/deploy.yml",
    "templates/shop/.github/workflows/deploy.yml",
    "templates/portfolio/.github/workflows/deploy.yml",
]


@pytest.fixture(scope="module")
def post_install_text() -> str:
    return POST_INSTALL_JS.read_text()


def test_post_install_js_exists() -> None:
    assert POST_INSTALL_JS.exists(), f"missing: {POST_INSTALL_JS}"


def test_required_deploy_lines_present_in_checklists(post_install_text: str) -> None:
    for line in CHECKLISTS_REQUIRED_LINES:
        assert line in post_install_text, (
            f"cli/lib/post-install.js missing required line: {line!r}"
        )


def test_every_template_checklist_contains_gh_secret_line(post_install_text: str) -> None:
    pattern = "gh secret set VERCEL_TOKEN VERCEL_ORG_ID VERCEL_PROJECT_ID CF_API_TOKEN CF_ZONE_ID SUPABASE_ACCESS_TOKEN SUPABASE_PROJECT_REF"
    assert post_install_text.count(pattern) >= 3, (
        f"expected 3+ occurrences of gh secret set line, got {post_install_text.count(pattern)}"
    )


def test_every_template_checklist_contains_push_to_main_line(post_install_text: str) -> None:
    for tpl in ("saas", "shop", "portfolio"):
        pattern = f"templates/{tpl}/.github/workflows/deploy.yml"
        occurrences = post_install_text.count(pattern)
        assert occurrences >= 1, (
            f"{tpl}/deploy.yml path not referenced in cli/lib/post-install.js"
        )


def test_regression_shop_and_saas_keep_functions_deploy(post_install_text: str) -> None:
    assert "supabase functions deploy billing" in post_install_text, (
        "saas checklist must still mention `supabase functions deploy billing`"
    )
    assert "supabase functions deploy toss-pay" in post_install_text, (
        "shop checklist must still mention `supabase functions deploy toss-pay`"
    )


def test_portfolio_checklist_has_no_functions_deploy(post_install_text: str) -> None:
    m = re.search(r"portfolio:\s*\[(.*?)\],", post_install_text, re.DOTALL)
    assert m, "portfolio checklist block not found in cli/lib/post-install.js"
    portfolio_block = m.group(1)
    assert "supabase functions deploy" not in portfolio_block, (
        "portfolio checklist must NOT mention supabase functions deploy (no Edge Functions)"
    )


def test_saas_and_shop_checklist_mention_functions_deploy(post_install_text: str) -> None:
    for tpl in ("saas", "shop"):
        m = re.search(rf"{tpl}:\s*\[(.*?)\],", post_install_text, re.DOTALL)
        assert m, f"{tpl} checklist block not found"
        block = m.group(1)
        assert "supabase functions deploy" in block, (
            f"{tpl} checklist must still mention `supabase functions deploy`"
        )
