"""ci_setup.py — CI provider + secret resolution for local-judge scripts.

This module is imported by `bin/review-local.sh` and `bin/set-provider.sh`
(via `sys.path.insert(0, 'lib')`) to resolve:

  - `CI_REVIEW_PROVIDER` from process env / `.env` / `.env.example`,
    defaulting to "anthropic" when nothing is configured.
  - Individual `.env` keys (`read_env_key`) — quoted-value tolerant.
  - Per-provider secret names (`required_secrets_for_provider`).

The contract is consumed by:
  - `bin/review-local.sh`:
      - `read_provider(repo_root)` → chosen provider name
      - `read_env_key(repo_root/.env, 'CI_REVIEW_PROVIDER')` → explicit flag
      - `required_secrets_for_provider(provider)` → env keys to look up
  - `bin/set-provider.sh` mirrors the same logic in bash for the
    `--show` path (see `read_provider_from_env_file` there).

Previously this module shipped only via the dev-harness-kit plugin
marketplace; the consumer repo (`boilerplate-web`) accidentally
referenced it from committed scripts but never committed the module
itself, leading to `ModuleNotFoundError: No module named 'ci_setup'`
on any operator who runs `bin/review-local.sh` without first
installing the marketplace. Committing it here closes the gap.

Tests: `tests/test_ci_setup.py`.
"""
from __future__ import annotations

import os
import re
from pathlib import Path

# Allowed provider names. Anything else -> ValueError at lookup time.
# Order is intentional: keep the production-default first for clarity
# in error messages.
_ALLOWED_PROVIDERS = ("anthropic", "minimax", "deepseek")
_DEFAULT_PROVIDER = "anthropic"

# (DEV_KIT_GITHUB_TOKEN, <PROVIDER>_API_KEY) — the only secret pair
# `bin/review-local.sh` reads per-provider. Cloning the dev-harness
# marketplace needs the GH token; the actual LLM call needs the
# provider's key. Adding a new provider is a one-line edit below.
_PROVIDER_SECRETS: dict[str, str] = {
    "anthropic": "ANTHROPIC_API_KEY",
    "minimax": "MINIMAX_API_KEY",
    "deepseek": "DEEPSEEK_API_KEY",
}


# --- read_provider ----------------------------------------------------------


def read_provider(repo_root: Path | str) -> str:
    """Return the configured CI review provider.

    Resolution order:
      1. process env `CI_REVIEW_PROVIDER` (highest priority)
      2. `<repo_root>/.env` `CI_REVIEW_PROVIDER`
      3. `<repo_root>/.env.example` `CI_REVIEW_PROVIDER`
      4. "anthropic" (default)
    """
    repo_root = Path(repo_root)
    env_value = os.environ.get("CI_REVIEW_PROVIDER", "").strip()
    if env_value:
        return env_value
    for candidate in (repo_root / ".env", repo_root / ".env.example"):
        v = read_env_key(candidate, "CI_REVIEW_PROVIDER")
        if v:
            return v
    return _DEFAULT_PROVIDER


# --- read_env_key -----------------------------------------------------------


# Match lines like `KEY=value`, `KEY="value"`, `KEY='value'`. The key
# group is restricted to env-var-safe characters; the value group
# accepts everything up to a trailing comment (anything after an
# unquoted `#`). Quoted values keep inner whitespace + nested quotes.
_LINE_RE = re.compile(
    r"""
    ^[ \t]*                          # leading whitespace
    (?P<key>[A-Za-z_][A-Za-z0-9_]*)  # env var name
    [ \t]*=[ \t]*                    # = with optional spaces
    (?:
        "(?P<dq>[^"]*)"              # double-quoted value
      |
        '(?P<sq>[^']*)'              # single-quoted value
      |
        (?P<bare>[^#\r\n]*)          # bare value (no `#` allowed)
    )
    [ \t]*(?:\#[^\r\n]*)?            # optional trailing comment
    [ \t]*$
    """,
    re.VERBOSE,
)


def read_env_key(env_path: Path | str, key: str) -> str:
    """Return the value of `key` in a `.env`-style file, or "".

    Tolerates `#` comments, blank lines, surrounding whitespace, and
    both single- and double-quoted values. Quoted values preserve
    inner whitespace and other special characters. Bare (unquoted)
    values are stripped of leading/trailing whitespace.

    The file is parsed as UTF-8 with replacement on decode errors so a
    binary-y `.env` (rare but seen in CI caches) doesn't crash the
    caller — we just return "".
    """
    path = Path(env_path)
    if not path.exists():
        return ""
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return ""
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        m = _LINE_RE.match(raw_line)
        if not m:
            continue
        if m.group("key") != key:
            continue
        if m.group("dq") is not None:
            return m.group("dq")
        if m.group("sq") is not None:
            return m.group("sq")
        return m.group("bare").strip()
    return ""


# --- required_secrets_for_provider ------------------------------------------


def required_secrets_for_provider(provider: str) -> tuple[str, ...]:
    """Return the env-var names `bin/review-local.sh` should look up.

    Always returns `(DEV_KIT_GITHUB_TOKEN, <PROVIDER>_API_KEY)` in
    that order. The GH token is needed by the marketplace-clone step;
    the provider key is needed by the LLM judge step. Unknown
    providers raise `ValueError` to surface typos early — the caller
    in `bin/review-local.sh` validates provider names first, but
    defense in depth is cheap.
    """
    if provider not in _PROVIDER_SECRETS:
        raise ValueError(
            f"unknown provider {provider!r}; allowed: {_ALLOWED_PROVIDERS}"
        )
    return ("DEV_KIT_GITHUB_TOKEN", _PROVIDER_SECRETS[provider])
