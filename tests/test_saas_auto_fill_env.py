"""test_saas_auto_fill_env.py - contract for templates/saas/scripts/auto-fill-env.sh.

The script auto-populates .env.local from MCP/API tokens when they're set
in the shell environment. With no tokens, it must leave .env.local
untouched (the operator fills it in by hand).

We test:
  1. Script exists in the template + is executable
  2. With no tokens: .env.local is unchanged after running
  3. With Supabase tokens (fake): Supabase API call attempts, then fails,
     but .env.local is still left untouched (the API didn't return data)
  4. Vercel + Cloudflare sections handle missing tokens gracefully
"""
from __future__ import annotations

import re
import subprocess
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).parent.parent
SCRIPT = REPO_ROOT / "templates" / "saas" / "scripts" / "auto-fill-env.sh"
TEMPLATE_ENV_EXAMPLE = REPO_ROOT / "templates" / "saas" / ".env.example"


def test_script_exists_and_is_executable() -> None:
    assert SCRIPT.exists(), f"missing: {SCRIPT}"
    import stat
    mode = SCRIPT.stat().st_mode
    assert mode & stat.S_IXUSR, f"{SCRIPT} is not executable (chmod +x missing)"


def test_script_has_bash_syntax() -> None:
    res = subprocess.run(
        ["bash", "-n", str(SCRIPT)], capture_output=True, text=True, check=False
    )
    assert res.returncode == 0, f"bash -n failed: {res.stderr}"


def test_script_references_mcp_token_env_vars() -> None:
    """The script should read these env vars:
    SUPABASE_ACCESS_TOKEN, SUPABASE_PROJECT_REF, VERCEL_TOKEN,
    CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID.
    """
    text = SCRIPT.read_text()
    for var in (
        "SUPABASE_ACCESS_TOKEN",
        "SUPABASE_PROJECT_REF",
        "VERCEL_TOKEN",
        "CLOUDFLARE_API_TOKEN",
        "CLOUDFLARE_ACCOUNT_ID",
    ):
        assert var in text, f"{SCRIPT} does not reference ${var}"


def test_script_uses_curl_not_other_deps() -> None:
    """The script must work on a fresh scaffold (no extra deps besides bash + curl + python3)."""
    text = SCRIPT.read_text()
    assert "curl " in text or "curl\n" in text, f"{SCRIPT} does not use curl"
    # Should NOT use jq or other non-portable tools
    for forbidden in (" | jq", "$(jq", "yarn ", "pnpm ", "npm "):
        assert forbidden not in text, f"{SCRIPT} uses forbidden tool: {forbidden!r}"


def test_no_env_vars_leaves_env_local_unchanged(tmp_path: Path) -> None:
    """If SUPABASE_ACCESS_TOKEN etc. are not set, the script must
    leave .env.local untouched (operator fills in by hand).
    """
    env_local = tmp_path / ".env.local"
    env_local.write_text(
        "NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co\n"
        "NEXT_PUBLIC_SUPABASE_ANON_KEY=placeholder\n"
    )
    env_file_in_target = tmp_path / "auto-fill-env.sh"
    env_file_in_target.write_text(SCRIPT.read_text())
    env_file_in_target.chmod(0o755)
    res = subprocess.run(
        [str(env_file_in_target)],
        cwd=tmp_path,
        env={},  # No tokens set
        capture_output=True, text=True, check=False,
    )
    assert res.returncode == 0, f"script exited with {res.returncode}: {res.stdout}\n{res.stderr}"
    assert "skipping" in res.stdout, (
        f"expected 'skipping' message in stdout; got: {res.stdout!r}"
    )
    after = env_local.read_text()
    assert after == (
        "NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co\n"
        "NEXT_PUBLIC_SUPABASE_ANON_KEY=placeholder\n"
    ), f".env.local was modified: {after!r}"


def test_with_fake_supabase_tokens_does_not_corrupt_env(tmp_path: Path) -> None:
    """If the operator passes fake tokens (e.g., a test scenario), the
    Supabase API call fails and the script falls through without
    overwriting .env.local values. The operator can then fill manually.
    """
    env_local = tmp_path / ".env.local"
    original = (
        "NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co\n"
        "NEXT_PUBLIC_SUPABASE_ANON_KEY=placeholder_anon\n"
    )
    env_local.write_text(original)
    env_file_in_target = tmp_path / "auto-fill-env.sh"
    env_file_in_target.write_text(SCRIPT.read_text())
    env_file_in_target.chmod(0o755)
    res = subprocess.run(
        [str(env_file_in_target)],
        cwd=tmp_path,
        env={
            "SUPABASE_ACCESS_TOKEN": "sbp_fake_token_for_pytest",
            "SUPABASE_PROJECT_REF": "fake_project_ref",
            "PATH": "/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin",
            "HOME": str(tmp_path),
        },
        capture_output=True, text=True, check=False,
    )
    assert res.returncode == 0, f"script crashed: {res.stdout}\n{res.stderr}"
    # The script should warn that the API call failed but exit cleanly.
    assert "could not fetch" in res.stdout or "skipping" in res.stdout
    after = env_local.read_text()
    # The placeholder URLs MUST NOT have been replaced with a real Supabase URL
    assert "YOUR_PROJECT" in after, (
        f"placeholder URL was overwritten despite API failure: {after!r}"
    )
    assert "placeholder_anon" in after, (
        f"placeholder anon was overwritten despite API failure: {after!r}"
    )


def test_setup_sh_includes_auto_fill_env_call() -> None:
    """setup.sh should invoke auto-fill-env.sh so the auto-fill happens
    before the rest of setup (especially before prereq checks that
    read .env.local)."""
    setup = (REPO_ROOT / "templates" / "saas" / "scripts" / "setup.sh").read_text()
    assert "auto-fill-env" in setup, (
        "setup.sh does not invoke auto-fill-env.sh - .env.local will not be "
        "auto-populated when MCP/API tokens are present"
    )
