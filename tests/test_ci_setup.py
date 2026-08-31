"""test_ci_setup.py — contract tests for lib/ci_setup.py module.

This module is imported by bin/review-local.sh (and other local-CI
scripts) to resolve CI_REVIEW_PROVIDER + provider-specific API keys
from .env / process env. The module was previously only shipped
through the dev-harness-kit plugin marketplace, but bin/ scripts in
the consumer repo also import from it via `sys.path.insert(0, 'lib')`,
so it must be committed to the repo root.

Repro for the missing-module bug:
  $ python3 -c "from ci_setup import read_provider"
  ModuleNotFoundError: No module named 'ci_setup'

Contract:
  - read_provider(repo_root) -> str
      resolves CI_REVIEW_PROVIDER in order:
        1. process env CI_REVIEW_PROVIDER (highest priority)
        2. <repo_root>/.env CI_REVIEW_PROVIDER
        3. <repo_root>/.env.example CI_REVIEW_PROVIDER
        4. "anthropic" (default; matches the local-judge fallback used
           in bin/review-local.sh's provider_config defaults)

  - read_env_key(env_path, key) -> str
      parses a .env-style file for `key=value`. Tolerates:
        - lines starting with '#'
        - blank lines
        - quoted values ("..." / '...')
        - whitespace around '='
      Returns "" if the file or key is missing.

  - required_secrets_for_provider(provider) -> tuple[str, ...]
      returns (DEV_KIT_GITHUB_TOKEN, <PROVIDER>_API_KEY) in that
      order. Provider keys allowed: minimax, anthropic, deepseek.
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "lib"))

from ci_setup import read_provider, read_env_key, required_secrets_for_provider  # noqa: E402


# --- read_provider ----------------------------------------------------------


def test_read_provider_returns_default_when_no_env(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("CI_REVIEW_PROVIDER", raising=False)
    assert read_provider(tmp_path) == "anthropic"


def test_read_provider_env_var_wins_over_env_file(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CI_REVIEW_PROVIDER", "deepseek")
    (tmp_path / ".env").write_text("CI_REVIEW_PROVIDER=minimax\n")
    assert read_provider(tmp_path) == "deepseek"


def test_read_provider_falls_back_to_dotenv(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("CI_REVIEW_PROVIDER", raising=False)
    (tmp_path / ".env").write_text("CI_REVIEW_PROVIDER=minimax\n")
    assert read_provider(tmp_path) == "minimax"


def test_read_provider_falls_back_to_env_example(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("CI_REVIEW_PROVIDER", raising=False)
    (tmp_path / ".env.example").write_text("CI_REVIEW_PROVIDER=deepseek\n")
    assert read_provider(tmp_path) == "deepseek"


# --- read_env_key -----------------------------------------------------------


def test_read_env_key_missing_file(tmp_path: Path) -> None:
    assert read_env_key(tmp_path / ".env", "X") == ""


def test_read_env_key_basic(tmp_path: Path) -> None:
    (tmp_path / ".env").write_text("FOO=bar\nBAZ=qux\n")
    assert read_env_key(tmp_path / ".env", "FOO") == "bar"
    assert read_env_key(tmp_path / ".env", "BAZ") == "qux"


def test_read_env_key_quoted(tmp_path: Path) -> None:
    (tmp_path / ".env").write_text('FOO="bar baz"\nZAP=\'q"ux\'\n')
    assert read_env_key(tmp_path / ".env", "FOO") == "bar baz"
    assert read_env_key(tmp_path / ".env", "ZAP") == 'q"ux'


def test_read_env_key_handles_comments_and_blank_lines(tmp_path: Path) -> None:
    (tmp_path / ".env").write_text(
        "# comment\n"
        "\n"
        "FOO=bar\n"
        "  # indented comment\n"
    )
    assert read_env_key(tmp_path / ".env", "FOO") == "bar"


def test_read_env_key_missing_key(tmp_path: Path) -> None:
    (tmp_path / ".env").write_text("FOO=bar\n")
    assert read_env_key(tmp_path / ".env", "MISSING") == ""


# --- required_secrets_for_provider ------------------------------------------


def test_required_secrets_minimax() -> None:
    assert required_secrets_for_provider("minimax") == ("DEV_KIT_GITHUB_TOKEN", "MINIMAX_API_KEY")


def test_required_secrets_anthropic() -> None:
    assert required_secrets_for_provider("anthropic") == (
        "DEV_KIT_GITHUB_TOKEN",
        "ANTHROPIC_API_KEY",
    )


def test_required_secrets_deepseek() -> None:
    assert required_secrets_for_provider("deepseek") == ("DEV_KIT_GITHUB_TOKEN", "DEEPSEEK_API_KEY")


def test_required_secrets_unknown_provider_raises() -> None:
    with pytest.raises(ValueError, match="unknown provider"):
        required_secrets_for_provider("openai")
