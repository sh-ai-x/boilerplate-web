"""test_deploy_secrets_doc.py — regression for the deploy-secrets SSOT.

The deploy-automation phase (phase 2) gates everything on the canonical
7-secret list in docs/DEPLOY_SECRETS.md. The CLI post-install checklist
and every per-template deploy.yml cite these exact names; a rename in
the doc must propagate to both call sites in the same PR. This test
pins the contract by parsing the markdown table via stdlib regex.
"""
from __future__ import annotations

import re
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).parent.parent
DOC = REPO_ROOT / "docs" / "DEPLOY_SECRETS.md"

EXPECTED_SECRETS = [
    "VERCEL_TOKEN",
    "VERCEL_ORG_ID",
    "VERCEL_PROJECT_ID",
    "CF_API_TOKEN",
    "CF_ZONE_ID",
    "SUPABASE_ACCESS_TOKEN",
    "SUPABASE_PROJECT_REF",
]


def _extract_secret_table(doc_text: str) -> list[tuple[str, str, str, str]]:
    """Parse the canonical secret-name table.

    Each row is a markdown line of shape:
        | `<NAME>` | <where> | <required for> | <applies to> |
    Returns the 4-tuple per row (whitespace trimmed).
    """
    rows: list[tuple[str, str, str, str]] = []
    row_re = re.compile(
        r"^\|\s+`([^`]+)`\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*$",
        re.MULTILINE,
    )
    for match in row_re.finditer(doc_text):
        rows.append(
            (
                match.group(1).strip(),
                match.group(2).strip(),
                match.group(3).strip(),
                match.group(4).strip(),
            )
        )
    return rows


@pytest.fixture(scope="module")
def doc_text() -> str:
    assert DOC.exists(), f"docs/DEPLOY_SECRETS.md missing at {DOC}"
    return DOC.read_text()


@pytest.fixture(scope="module")
def secret_table(doc_text: str) -> list[tuple[str, str, str, str]]:
    rows = _extract_secret_table(doc_text)
    assert rows, "docs/DEPLOY_SECRETS.md has no secret rows in canonical table form"
    return rows


def test_doc_exists() -> None:
    """AC1: docs/DEPLOY_SECRETS.md exists at the canonical path."""
    assert DOC.exists(), f"missing: {DOC}"


def test_doc_has_exactly_seven_secrets(secret_table: list[tuple[str, str, str, str]]) -> None:
    """AC3: the table lists exactly the 7 canonical secret names (no more, no less)."""
    names = [r[0] for r in secret_table]
    assert len(names) == 7, f"expected 7 secrets, got {len(names)}: {names}"
    assert sorted(names) == sorted(EXPECTED_SECRETS), (
        f"secret-name mismatch.\n"
        f"  expected: {sorted(EXPECTED_SECRETS)}\n"
        f"  got:      {sorted(names)}\n"
        f"  diff:     {set(EXPECTED_SECRETS) ^ set(names)}"
    )


def test_every_secret_row_has_four_populated_columns(
    secret_table: list[tuple[str, str, str, str]],
) -> None:
    """Every row's 4 columns (name / where / required for / applies to) is non-empty."""
    for row in secret_table:
        name, where, required_for, applies_to = row
        assert name, f"empty secret name in row {row!r}"
        assert where, f"empty 'where to get it' for secret {name!r}"
        assert required_for, f"empty 'required for' for secret {name!r}"
        assert applies_to, f"empty 'applies to template' for secret {name!r}"


def test_doc_has_setting_instructions(doc_text: str) -> None:
    """The doc must include a `gh secret set` example block."""
    assert "gh secret set" in doc_text, (
        "docs/DEPLOY_SECRETS.md is missing the 'gh secret set' runbook block"
    )


def test_doc_has_verification_instructions(doc_text: str) -> None:
    """The doc must include a 'gh secret list' verification step."""
    assert "gh secret list" in doc_text, (
        "docs/DEPLOY_SECRETS.md is missing the 'gh secret list' verification step"
    )


def test_doc_canonical_secret_names_in_order(doc_text: str) -> None:
    """The 7 names must appear in the doc in their canonical order."""
    positions = []
    for name in EXPECTED_SECRETS:
        pattern = rf"`{re.escape(name)}`"
        m = re.search(pattern, doc_text)
        assert m, f"secret {name!r} not found in backtick-wrapped form in {DOC}"
        positions.append(m.start())
    assert positions == sorted(positions), (
        f"secrets appear out of canonical order: {positions}"
    )
