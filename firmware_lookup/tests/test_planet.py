import pytest

from firmware_lookup.providers.planet import PlanetProvider


@pytest.fixture(autouse=True)
def no_live_browser_calls(monkeypatch):
    """PlanetProvider._fetch_model_catalog() makes a REAL Playwright
    browser call to discover the live model catalog before the actual
    results fetch (plain HTTP). Autouse + raising immediately keeps
    every test in this file fast and deterministic (no live network
    calls) while still exercising the real fallback path, since
    get_latest_firmware() catches this and degrades to
    cannot_determine() either way."""
    import playwright.sync_api as sync_api_mod

    def fake_sync_playwright():
        raise RuntimeError("no live browser calls in tests")

    monkeypatch.setattr(sync_api_mod, "sync_playwright", fake_sync_playwright)


def test_no_model_given():
    p = PlanetProvider()
    r = p.get_latest_firmware("PLANET", "", "1.0")
    assert r.status.value == "cannot_determine"


def test_catalog_fetch_failure_degrades_honestly():
    # no_live_browser_calls (autouse) makes the catalog discovery raise
    # -- confirms this degrades to cannot_determine() with the real
    # manual-check link, never a crash or a fabricated version.
    p = PlanetProvider()
    r = p.get_latest_firmware("PLANET", "AVS-4210-24HP4X", "1.0")
    assert r.status.value == "cannot_determine"
    assert r.source_url == "https://www.planet.com.tw/en/support/downloads"


def test_model_option_and_result_row_parse_real_markup_shape():
    """Regression guard for the real markup found live: the model
    <select> (populated client-side after choosing a category) lists
    every real switch model as a plain <option>, and the results page
    (a real, plain-HTTP-fetchable GET endpoint once a model slug is
    known -- confirmed live, no browser needed for this part) lists
    real dated firmware rows, Date/Model/Version columns in that order,
    sorted newest-first. Exercises the actual parsing regexes against
    minimal fixtures shaped exactly like the real pages, without any
    browser or network call."""
    from firmware_lookup.providers.planet import (
        _MODEL_OPTION_RE, _RESULT_ROW_RE,
    )

    catalog_html = (
        '<option value="">----------</option>'
        '<option value="avs-4210-24hp4x">AVS-4210-24HP4X (V1)</option>'
        '<option value="avs-4210-8hp2x">AVS-4210-8HP2X (V1)</option>'
    )
    options = _MODEL_OPTION_RE.findall(catalog_html)
    # The empty-value placeholder option ("----------") is correctly
    # excluded -- the regex requires a non-empty value, so it never
    # becomes a matchable "model".
    assert options == [
        ("avs-4210-24hp4x", "AVS-4210-24HP4X (V1)"),
        ("avs-4210-8hp2x", "AVS-4210-8HP2X (V1)"),
    ]

    results_html = (
        "<tbody>"
        '<tr>\n<td class="text-center align-middle">2026-01-30</td>\n'
        '<td class="text-center align-middle">AVS-4210-24HP4X</td>\n'
        '<td class="text-center align-middle">1.403b260107</td>\n'
        '<td class="text-left align-middle px-3">Fixed issues.</td></tr>'
        '<tr>\n<td class="text-center align-middle">2025-10-13</td>\n'
        '<td class="text-center align-middle">AVS-4210-24HP4X</td>\n'
        '<td class="text-center align-middle">1.403b250922</td>\n'
        "</tr></tbody>"
    )
    rows = _RESULT_ROW_RE.findall(results_html)
    assert rows == [
        ("2026-01-30", "AVS-4210-24HP4X", "1.403b260107"),
        ("2025-10-13", "AVS-4210-24HP4X", "1.403b250922"),
    ]


def test_missing_playwright_degrades_honestly(monkeypatch):
    import builtins
    real_import = builtins.__import__

    def fake_import(name, *args, **kwargs):
        if name == "playwright.sync_api" or name.startswith("playwright"):
            raise ImportError("no playwright")
        return real_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", fake_import)
    p = PlanetProvider()
    r = p.get_latest_firmware("PLANET", "AVS-4210-24HP4X", "1.0")
    assert r.status.value == "cannot_determine"
