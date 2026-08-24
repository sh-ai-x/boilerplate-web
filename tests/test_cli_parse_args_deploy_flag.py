"""test_cli_parse_args_deploy_flag.py — the --deploy flag parses + defaults.

When the operator passes `--deploy`, parseArgs() must return `deploy: true`.
When omitted, `deploy: false`. The flag is library-pure - main() reads it
and prints the gh secret set hints; the CLI never shells out itself.
"""
from __future__ import annotations

import subprocess
import json
from pathlib import Path

REPO_ROOT = Path(__file__).parent.parent
NODE = "node"


def _run_node(code: str) -> str:
    result = subprocess.run(
        [NODE, "-e", code],
        cwd=str(REPO_ROOT),
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, (
        f"node -e failed: rc={result.returncode}\nSTDOUT={result.stdout}\nSTDERR={result.stderr}"
    )
    return result.stdout.strip()


def test_deploy_flag_absent_defaults_to_false() -> None:
    out = _run_node(
        "const r = require('./cli/lib/parse-args').parseArgs("
        "['node','cli.js','x','--type=saas']"
        "); console.log(JSON.stringify(r));"
    )
    parsed = json.loads(out)
    assert parsed.get("deploy") is False, (
        f"expected deploy=false (absent), got: {parsed.get('deploy')}"
    )


def test_deploy_flag_present_sets_true() -> None:
    out = _run_node(
        "const r = require('./cli/lib/parse-args').parseArgs("
        "['node','cli.js','x','--type=saas','--deploy']"
        "); console.log(JSON.stringify(r));"
    )
    parsed = json.loads(out)
    assert parsed.get("deploy") is True, (
        f"expected deploy=true (--deploy set), got: {parsed.get('deploy')}"
    )


def test_usage_string_includes_deploy() -> None:
    out = _run_node("console.log(require('./cli/lib/parse-args').USAGE);")
    assert "--deploy" in out, f"USAGE does not mention --deploy: {out!r}"


def test_deploy_not_parsed_as_positional() -> None:
    out = _run_node(
        "const r = require('./cli/lib/parse-args').parseArgs("
        "['node','cli.js','my-app','--type=saas','--deploy']"
        "); console.log(JSON.stringify(r));"
    )
    parsed = json.loads(out)
    assert parsed.get("targetFolder") == "my-app"
    assert parsed.get("deploy") is True
    assert parsed.get("type") == "saas"


def test_deploy_flag_does_not_trigger_deprecation_warning() -> None:
    """--deploy alone should NOT emit a deprecation warning (unlike --force)."""
    # Parse with --deploy only - no deprecation
    out = _run_node(
        "const r = require('./cli/lib/parse-args').parseArgs("
        "['node','cli.js','x','--type=saas','--deploy']"
        "); console.log(JSON.stringify(r));"
    )
    parsed = json.loads(out)
    assert parsed.get("deprecation") is None, (
        f"expected deprecation=null, got: {parsed.get('deprecation')}"
    )
