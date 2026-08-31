"""test_scaffold_includes_shared.py — saas/shop/portfolio all reference
@boilerplate-web/shared via workspace:*, so the CLI must also degit
templates/_shared/ + write a pnpm-workspace.yaml. Without this, the
operator's pnpm install fails with ERR_PNPM_WORKSPACE_PKG_NOT_FOUND.
"""
from __future__ import annotations

import re
import json
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).parent.parent
TARGET_DOWNLOAD = REPO_ROOT / "cli" / "lib" / "target-download.js"
LOCK = REPO_ROOT / "templates.lock.json"
POST_INSTALL = REPO_ROOT / "cli" / "lib" / "post-install.js"

EXPECTED_SECRETS = (
    "VERCEL_TOKEN",
    "VERCEL_ORG_ID",
    "VERCEL_PROJECT_ID",
    "CF_API_TOKEN",
    "CF_ZONE_ID",
    "SUPABASE_ACCESS_TOKEN",
    "SUPABASE_PROJECT_REF",
)


def test_lockfile_includes_shared_entry() -> None:
    data = json.loads(LOCK.read_text())
    assert "_shared" in data["templates"], (
        f"{LOCK} missing `templates._shared` entry - CLI cannot degit "
        f"the shared package without it"
    )
    assert data["templates"]["_shared"].endswith("_shared"), (
        f"templates._shared should reference the _shared dir path"
    )


def test_cli_reads_shared_entry_from_lock() -> None:
    text = TARGET_DOWNLOAD.read_text()
    assert "lock.templates._shared" in text, (
        f"{TARGET_DOWNLOAD} does not reference lock.templates._shared"
    )


def test_cli_writes_pnpm_workspace_yaml() -> None:
    text = TARGET_DOWNLOAD.read_text()
    # The CLI builds pnpm-workspace.yaml as a JS array of strings joined by
    # newline, then writes it via fs.writeFileSync. Assert:
    #   - pnpm-workspace.yaml filename is used
    #   - The 'packages:' header line is in the source
    #   - A '- .' package line (root) and '- _shared' package line exist
    #   - fs.writeFileSync is called with the yaml content + the path
    assert "pnpm-workspace.yaml" in text, (
        f"{TARGET_DOWNLOAD} does not reference pnpm-workspace.yaml"
    )
    assert "'packages:'" in text or '"packages:"' in text, (
        f"{TARGET_DOWNLOAD} wsYaml array missing 'packages:' header"
    )
    assert "'  - .'" in text or "'  -.'" in text or '"  - ."' in text, (
        f"{TARGET_DOWNLOAD} wsYaml array missing root package entry"
    )
    assert "'  - _shared'" in text or '"  - _shared"' in text, (
        f"{TARGET_DOWNLOAD} wsYaml array missing _shared package entry"
    )
    assert "writeFileSync" in text and "pnpm-workspace.yaml" in text, (
        f"{TARGET_DOWNLOAD} does not call writeFileSync on pnpm-workspace.yaml"
    )


def test_cli_clones_shared_via_degit() -> None:
    text = TARGET_DOWNLOAD.read_text()
    assert "sharedSrc" in text and "degit(sharedSrc" in text, (
        f"{TARGET_DOWNLOAD} does not degit the _shared subdir"
    )


def test_post_install_checklists_still_have_all_7_secrets() -> None:
    """Regression: the shared-fix patch must not have removed any of the
    7 GitHub repo secrets from the CLI checklist."""
    text = POST_INSTALL.read_text()
    for s in EXPECTED_SECRETS:
        assert text.count(s) >= 3, (
            f"{POST_INSTALL} has fewer than 3 occurrences of {s} "
            f"(expected 3: one per checklist)"
        )
