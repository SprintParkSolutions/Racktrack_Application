import pytest

from firmware_lookup.providers.extreme import ExtremeProvider


@pytest.fixture(autouse=True)
def no_live_browser_calls(monkeypatch):
    """Extreme's check_public_source() (see providers/extreme.py) makes
    a REAL Playwright browser call for ExtremeXOS/Switch Engine models
    before falling back to login -- same pattern as Cisco/Aruba/Juniper
    elsewhere in this suite. Autouse + raising immediately keeps every
    test in this file fast and deterministic (no live network calls)
    while still exercising the real fallback-to-login code path, since
    check_public_source() catches this and returns None either way."""
    import playwright.sync_api as sync_api_mod

    def fake_sync_playwright():
        raise RuntimeError("no live browser calls in tests")

    monkeypatch.setattr(sync_api_mod, "sync_playwright", fake_sync_playwright)


def test_check_public_source_empty_model_returns_none():
    p = ExtremeProvider()
    assert p.check_public_source("Extreme", "", "1.0") is None


def test_matches_extremexos():
    """HONESTY FLAG (see module docstring): Extreme's switch catalog
    spans several different operating systems (ExtremeXOS/Switch
    Engine, VOSS, Fabric Engine, WiNG) and no live, citable mapping from
    bare model numbers to which OS a given switch runs was found this
    session -- matching is deliberately scoped to models that EXPLICITLY
    name ExtremeXOS or Switch Engine, not a guessed model-number
    pattern that risks attributing the wrong OS's version to a switch."""
    from firmware_lookup.providers.extreme import _matches_extremexos

    assert _matches_extremexos("X670 ExtremeXOS") is True
    assert _matches_extremexos("Switch Engine 5420") is True
    assert _matches_extremexos("extremexos") is True
    assert _matches_extremexos("5420") is False
    assert _matches_extremexos("X670") is False
    assert _matches_extremexos("VOSS 5520") is False
    assert _matches_extremexos("") is False


def test_check_public_source_non_matching_model_returns_none():
    p = ExtremeProvider()
    assert p.check_public_source("Extreme", "5420", "33.0.0") is None


def test_extract_title_version():
    from firmware_lookup.providers.extreme import _extract_title_version

    assert _extract_title_version("ExtremeXOS v33.7.1 Release Notes") == "33.7.1"
    assert _extract_title_version("No version here") is None


def test_index_option_and_doc_link_parse_real_markup_shape():
    """Regression guard for the real markup found live: the main
    documentation index's <select> has an "ExtremeXOS" option pointing
    at the CURRENT version's page (fetched dynamically so a future
    version bump doesn't need a code change), and that page's own
    document list has a real, dated Release Notes entry. Exercises the
    actual parsing regexes against minimal fixtures shaped exactly like
    the real pages, without any browser or network call."""
    from firmware_lookup.providers.extreme import (
        _DOC_LINK_RE, _EXTREMEXOS_OPTION_RE,
    )

    index_html = (
        '<option value="https://x/extremexos-33-7-1/">\n'
        "\t\t\t\t\t\t\t\t\t\t\t\tExtremeXOS\t\t\t\t\t\t\t\t\t\t\t</option>"
    )
    option_match = _EXTREMEXOS_OPTION_RE.search(index_html)
    assert option_match.group(1) == "https://x/extremexos-33-7-1/"

    version_html = (
        '<a target="_blank" href="https://x/notes.html" class="c-doc-list__doc">'
        '<div class="c-doc-list__content o-clip-sm">'
        '<h4 class="c-doc-list__title">\n\t\t\t\t\t\t\t\t\t\t\tExtremeXOS v33.7.1 '
        "Release Notes\t\t\t\t\t\t\t\t\t\t\t</h4>"
    )
    doc_matches = _DOC_LINK_RE.findall(version_html)
    assert doc_matches == [
        ("https://x/notes.html", "ExtremeXOS v33.7.1 Release Notes"),
    ]


def test_check_public_source_missing_playwright_returns_none_not_raise(monkeypatch):
    import builtins
    real_import = builtins.__import__

    def fake_import(name, *args, **kwargs):
        if name == "playwright.sync_api" or name.startswith("playwright"):
            raise ImportError("no playwright")
        return real_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", fake_import)
    p = ExtremeProvider()
    assert p.check_public_source("Extreme", "X670 ExtremeXOS", "32.0.0") is None


def test_check_public_source_unexpected_browser_error_never_raises():
    # no_live_browser_calls (autouse) already makes sync_playwright()
    # raise -- confirms check_public_source() catches it and returns
    # None instead of propagating.
    p = ExtremeProvider()
    assert p.check_public_source("Extreme", "X670 ExtremeXOS", "32.0.0") is None
