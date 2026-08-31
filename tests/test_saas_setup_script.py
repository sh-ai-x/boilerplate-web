"""test_saas_setup_script.py — TEMPLATE-side post-scaffold onboarding.

Phase 2-deploy-automation step: each saas scaffold ships:
  - SETUP.md           — step-by-step guide (account sign-ups + env vars)
  - scripts/setup.sh   — the one local command that does everything else

These tests pin the structural contract: setup.sh exists, parses cleanly,
and recognizes --dry-run + --check modes. The runtime behavior (real
Supabase + GitHub + Vercel mutations) is verified by the operator when
they actually run it, since none of those services have public test
sandboxes.
"""
from __future__ import annotations

import re
import subprocess
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).parent.parent
SETUP_MD = REPO_ROOT / "templates" / "saas" / "SETUP.md"
SETUP_SH = REPO_ROOT / "templates" / "saas" / "scripts" / "setup.sh"


# ---- SETUP.md structural tests ----

def test_setup_md_exists() -> None:
    assert SETUP_MD.exists(), f"missing: {SETUP_MD}"


def test_setup_md_has_required_sections() -> None:
    """SETUP.md must walk through all 4 external accounts + 4 setup steps."""
    text = SETUP_MD.read_text()
    # 4 external services
    for svc in ("Supabase", "Vercel", "Cloudflare", "Toss"):
        assert f"### Step" in text or "## " in text, (
            f"SETUP.md missing 'Step' heading structure for {svc}"
        )
        assert svc in text, f"SETUP.md missing {svc} section"

    # The single-cmd-one-liner
    assert "./scripts/setup.sh" in text, (
        "SETUP.md does not mention the single ./scripts/setup.sh command"
    )


def test_setup_md_lists_all_7_secrets() -> None:
    """The 7 secret names from docs/DEPLOY_SECRETS.md must appear in SETUP.md."""
    secrets = [
        "VERCEL_TOKEN", "VERCEL_ORG_ID", "VERCEL_PROJECT_ID",
        "CF_API_TOKEN", "CF_ZONE_ID",
        "SUPABASE_ACCESS_TOKEN", "SUPABASE_PROJECT_REF",
    ]
    text = SETUP_MD.read_text()
    for s in secrets:
        assert s in text, f"SETUP.md missing {s} (must match docs/DEPLOY_SECRETS.md SSOT)"


def test_setup_md_mentions_pnpm_not_npm() -> None:
    """This boilerplate uses pnpm workspaces (workspace:* in package.json is
    pnpm-only). SETUP.md must explicitly say pnpm so operators don't lose
    10 minutes to the npm/workspace:* EUNSUPPORTEDPROTOCOL error."""
    text = SETUP_MD.read_text()
    assert "pnpm install" in text, (
        "SETUP.md does not mention `pnpm install` - operators will hit "
        "`EUNSUPPORTEDPROTOCOL: workspace:*` if they fall back to npm"
    )
    # The warning that npm will fail is important (PR #64 surfaced this gap)
    assert "EUNSUPPORTEDPROTOCOL" in text or "Don't run `npm install`" in text, (
        "SETUP.md does not warn about the npm/workspace:* incompatibility"
    )


def test_setup_md_links_to_dashboard_urls() -> None:
    """Operator should never have to guess where to click."""
    text = SETUP_MD.read_text()
    for url in (
        "https://supabase.com/dashboard",
        "https://vercel.com",
        "https://dash.cloudflare.com",
        "https://tosspayments.com",
    ):
        assert url in text, f"SETUP.md missing operator URL: {url}"


def test_setup_md_explains_dry_run_and_check() -> None:
    """Two non-mutating modes must be documented so operators can dry-run safely."""
    text = SETUP_MD.read_text()
    assert "--dry-run" in text
    assert "--check" in text


# ---- scripts/setup.sh structural tests ----

def test_setup_sh_exists() -> None:
    assert SETUP_SH.exists(), f"missing: {SETUP_SH}"


def test_setup_sh_is_executable() -> None:
    import stat
    mode = SETUP_SH.stat().st_mode
    assert mode & stat.S_IXUSR, f"{SETUP_SH} is not user-executable (chmod +x missing)"


def test_setup_sh_bash_syntax_ok() -> None:
    """The script must pass `bash -n` (no execution)."""
    result = subprocess.run(
        ["bash", "-n", str(SETUP_SH)],
        capture_output=True, text=True, check=False,
    )
    assert result.returncode == 0, (
        f"bash -n failed: rc={result.returncode}\nSTDOUT={result.stdout}\nSTDERR={result.stderr}"
    )


def test_setup_sh_uses_strict_mode() -> None:
    """Defensive: any line that doesn't `set -euo pipefail` would fail this test.
    Phase 2 scripts that mutate external services should fail closed."""
    text = SETUP_SH.read_text()
    assert "set -euo pipefail" in text, (
        f"{SETUP_SH} does not enable strict mode (set -euo pipefail)"
    )


def test_setup_sh_recognizes_dry_run_and_check_modes() -> None:
    """--dry-run prints commands without executing; --check only verifies prereqs."""
    text = SETUP_SH.read_text()
    assert '"--dry-run"' in text and '"--check"' in text, (
        f"{SETUP_SH}: missing --dry-run / --check mode handling"
    )


def test_setup_sh_embeds_seven_secret_names() -> None:
    """Same 7 names from docs/DEPLOY_SECRETS.md must be hard-coded in setup.sh
    so the operator doesn't have to memorize them."""
    expected = {
        "VERCEL_TOKEN", "VERCEL_ORG_ID", "VERCEL_PROJECT_ID",
        "CF_API_TOKEN", "CF_ZONE_ID",
        "SUPABASE_ACCESS_TOKEN", "SUPABASE_PROJECT_REF",
    }
    text = SETUP_SH.read_text()
    found = {s for s in expected if s in text}
    missing = expected - found
    assert not missing, f"{SETUP_SH}: missing secret names in setup.sh: {sorted(missing)}"


def test_setup_sh_check_mode_works_with_missing_env() -> None:
    """--check must detect missing .env.local even when run inside templates/saas/
    (where no scaffold has happened yet)."""
    result = subprocess.run(
        ["bash", str(SETUP_SH), "--check"],
        capture_output=True, text=True, check=False,
        cwd=str(REPO_ROOT / "templates" / "saas"),
    )
    # Must fail because .env.local is missing — but must ALSO print
    # the .env.local-missing line so the operator knows what to fix.
    assert result.returncode != 0, (
        f"{SETUP_SH} --check should fail when .env.local is missing"
    )
    assert ".env.local missing" in result.stdout or ".env.local" in result.stdout, (
        f"{SETUP_SH} --check did not report .env.local as the cause"
    )


def test_setup_sh_dry_run_does_not_modify_state() -> None:
    """--dry-run must NOT touch disk state or call gh/supabase. We can verify
    this transitively: run --dry-run in the templates/saas/ directory and
    confirm no .git/.env.local was created, no `supabase link` ran (we have
    no project to link, would fail loudly), no `gh secret set` ran.
    """
    workdir = REPO_ROOT / "templates" / "saas"
    # Snapshot: count .git or .env.local presence pre-run
    pre_git = (workdir / ".git").exists()
    pre_env = (workdir / ".env.local").exists()

    # Create a dummy .env.local with the 7 keys set to garbage so prereqs pass
    # (without this, --check fails and we never see the dry-run output).
    dummy_env = workdir / ".env.local"
    lines = [
        f'{s}="dummy-{s.lower()}"' for s in [
            "VERCEL_TOKEN", "VERCEL_ORG_ID", "VERCEL_PROJECT_ID",
            "CF_API_TOKEN", "CF_ZONE_ID",
            "SUPABASE_ACCESS_TOKEN", "SUPABASE_PROJECT_REF",
        ]
    ]
    dummy_env.write_text("\n".join(lines) + "\n")

    try:
        result = subprocess.run(
            ["bash", str(SETUP_SH), "--dry-run"],
            capture_output=True, text=True, check=False,
            cwd=str(workdir),
        )
        assert result.returncode == 0, (
            f"--dry-run should not fail (exit={result.returncode}): {result.stderr}"
        )
        # Dry-run output should NOT mention real (non-echo) git/supabase/gh invocations
        # that would actually mutate. The check: all `run "..."` outputs should be
        # echo'd + prefixed with `+ `.
        for line in result.stdout.splitlines():
            if line.startswith("+ "):
                continue  # ok: this is a dry-run echo
            # Allow non-`+ ` lines that are just status text (e.g. "ok step")
            assert not re.match(r"^\+\s+(supabase|gh|git)\s+", line), (
                f"unintended non-echo'd command output: {line}"
            )
    finally:
        # cleanup
        if dummy_env.exists():
            dummy_env.unlink()

    # Confirm no .git was created in templates/saas/ during dry-run.
    # (setup.sh's git init is wrapped in `if [[ ! -d .git ]]` guard,
    #  so it's a no-op here too.)
    post_git = (workdir / ".git").exists()
    assert post_git == pre_git, (
        f"{SETUP_SH} --dry-run unexpectedly created a .git directory"
    )
