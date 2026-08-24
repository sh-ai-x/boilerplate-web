"""test_deploy_docs_present.py — each template ships a DEPLOY.md operator guide.

Phase 2-deploy-automation step 3 adds templates/<type>/DEPLOY.md to each
template. The doc is the post-scaffold operator runbook: what to click in
Cloudflare, what to set in GitHub, what to expect on the first push.

Differences by template:
  - saas + shop: must reference their Edge Function name (billing, toss-pay)
  - saas + shop: must say Cloudflare WAF gets auto-applied
  - portfolio: must explicitly say NO Edge Functions and NO WAF
"""
from __future__ import annotations

from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).parent.parent

DOCS = {
    "saas": REPO_ROOT / "templates" / "saas" / "DEPLOY.md",
    "shop": REPO_ROOT / "templates" / "shop" / "DEPLOY.md",
    "portfolio": REPO_ROOT / "templates" / "portfolio" / "DEPLOY.md",
}


@pytest.mark.parametrize("tpl,path", list(DOCS.items()))
def test_doc_exists(tpl: str, path: Path) -> None:
    assert path.exists(), f"missing template DEPLOY.md: {path}"


@pytest.mark.parametrize("tpl,path", list(DOCS.items()))
def test_doc_has_required_sections(tpl: str, path: Path) -> None:
    """Every DEPLOY.md has the canonical 'Before first push' + 'After first push' sections."""
    text = path.read_text()
    assert "Before first push" in text, (
        f"{tpl}/DEPLOY.md missing 'Before first push' section"
    )
    assert "After first push" in text, (
        f"{tpl}/DEPLOY.md missing 'After first push' section"
    )


@pytest.mark.parametrize("tpl,path", list(DOCS.items()))
def test_doc_references_deploy_secrets_doc(tpl: str, path: Path) -> None:
    """All 3 docs must point operators at docs/DEPLOY_SECRETS.md (the SSOT for the 7 secrets)."""
    assert "docs/DEPLOY_SECRETS.md" in path.read_text(), (
        f"{tpl}/DEPLOY.md does not link to docs/DEPLOY_SECRETS.md"
    )


def test_saas_doc_references_billing_function() -> None:
    text = DOCS["saas"].read_text()
    assert "billing" in text, "saas/DEPLOY.md must reference the `billing` Edge Function"


def test_shop_doc_references_toss_pay_function() -> None:
    text = DOCS["shop"].read_text()
    assert "toss-pay" in text, "shop/DEPLOY.md must reference the `toss-pay` Edge Function"


def test_portfolio_doc_explicitly_disclaims_edge_functions_and_waf() -> None:
    text = DOCS["portfolio"].read_text().lower()
    assert "no edge functions" in text, (
        "portfolio/DEPLOY.md must explicitly say 'no Edge Functions'"
    )
    # WAF disclaimer - accept either "no WAF" or "no Cloudflare WAF"
    assert ("no waf" in text) or ("no cloudflare waf" in text), (
        "portfolio/DEPLOY.md must explicitly say 'no WAF' (or 'no Cloudflare WAF')"
    )


@pytest.mark.parametrize("tpl", ["saas", "shop"])
def test_paid_template_doc_mentions_cloudflare_waf(tpl: str) -> None:
    """saas + shop must say Cloudflare WAF gets applied during deploy."""
    text = DOCS[tpl].read_text()
    assert "cloudflare" in text.lower()
    assert "waf" in text.lower()
    assert "auto-appl" in text.lower() or "automatic" in text.lower() or "during deploy" in text.lower(), (
        f"{tpl}/DEPLOY.md must describe how Cloudflare WAF is auto-applied during deploy"
    )
