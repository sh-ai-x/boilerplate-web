"""test_setup_html_present.py - TEMPLATE-side interactive HTML setup guide."""
from __future__ import annotations

import re
from html.parser import HTMLParser
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).parent.parent
SETUP_HTML = REPO_ROOT / "templates" / "saas" / "SETUP.html"

EXPECTED_ENV_VARS = [
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "NEXT_PUBLIC_TURNSTILE_SITE_KEY",
    "TURNSTILE_SECRET_KEY",
    "TOSS_SECRET_KEY",
    "TOSS_AUTH_KEY",
    "VERCEL_TOKEN",
    "VERCEL_ORG_ID",
    "CF_API_TOKEN",
    "CF_ZONE_ID",
    "SUPABASE_ACCESS_TOKEN",
    "SUPABASE_PROJECT_REF",
]


def test_setup_html_exists():
    assert SETUP_HTML.exists(), "missing: " + str(SETUP_HTML)


def test_setup_html_is_self_contained():
    text = SETUP_HTML.read_text()
    assert "<script src=" not in text, "should be single-file (no external scripts)"
    assert '<link rel="stylesheet" href=' not in text, "should be single-file (no external CSS)"
    assert "<style>" in text
    assert "<script>" in text


class _SectionCollector(HTMLParser):
    def __init__(self):
        super().__init__()
        self.sections = []
        self._in_section = False
        self._cur = {}

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "section" and a.get("class", "").startswith("step"):
            self._in_section = True
            self._cur = {"id": a.get("id", ""), "data-step": a.get("data-step", ""), "copy_buttons": 0, "check_inputs": 0}
            self.sections.append(self._cur)
        elif self._in_section:
            if tag == "button" and "data-copy" in a:
                self._cur["copy_buttons"] += 1
            if tag == "input" and "data-step-check" in a:
                self._cur["check_inputs"] += 1

    def handle_endtag(self, tag):
        if tag == "section" and self._in_section:
            self._in_section = False


def _parse_sections(text):
    pc = _SectionCollector()
    pc.feed(text)
    return pc.sections


@pytest.fixture(scope="module")
def setup_html_text():
    return SETUP_HTML.read_text()


@pytest.fixture(scope="module")
def setup_html_sections(setup_html_text):
    return _parse_sections(setup_html_text)


def test_setup_html_has_at_least_nine_steps(setup_html_sections):
    assert len(setup_html_sections) >= 9, "expected 9 sections, got " + str(len(setup_html_sections))


def test_each_step_has_copy_button(setup_html_sections):
    for sec in setup_html_sections:
        assert sec["copy_buttons"] >= 1, "step " + sec["data-step"] + " missing copy button"


def test_each_step_has_progress_checkbox(setup_html_sections):
    for sec in setup_html_sections:
        assert sec["check_inputs"] >= 1, "step " + sec["data-step"] + " missing checkbox"


def test_env_var_lookup_table_covers_all_13_keys(setup_html_text):
    for v in EXPECTED_ENV_VARS:
        assert v in setup_html_text, "missing env var: " + v


def test_setup_html_uses_localstorage_for_progress(setup_html_text):
    assert "localStorage" in setup_html_text


def test_setup_html_mentions_pnpm_not_npm(setup_html_text):
    assert "pnpm install" in setup_html_text, "missing pnpm install"


def test_setup_html_warns_about_npm_failure(setup_html_text):
    assert "EUNSUPPORTEDPROTOCOL" in setup_html_text or "Don't run" in setup_html_text


def test_setup_html_includes_watch_command(setup_html_text):
    assert "gh run watch" in setup_html_text
