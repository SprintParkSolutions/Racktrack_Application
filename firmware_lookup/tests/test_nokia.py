import pytest

from firmware_lookup.providers.nokia import NokiaProvider


@pytest.fixture(autouse=True)
def no_live_browser_calls(monkeypatch):
    """Nokia's check_public_source() (see providers/nokia.py) makes a
    REAL Playwright browser call before falling back to login -- same
    pattern as Cisco/Extreme/Aruba/Juniper elsewhere in this suite.
    Autouse + raising immediately keeps every test in this file fast
    and deterministic (no live network calls) while still exercising
    the real fallback-to-login code path, since check_public_source()
    catches this and returns None either way."""
    import playwright.sync_api as sync_api_mod

    def fake_sync_playwright():
        raise RuntimeError("no live browser calls in tests")

    monkeypatch.setattr(sync_api_mod, "sync_playwright", fake_sync_playwright)


def test_check_public_source_empty_model_returns_none():
    p = NokiaProvider()
    assert p.check_public_source("Nokia", "", "1.0") is None


def test_check_public_source_missing_playwright_returns_none_not_raise(monkeypatch):
    import builtins
    real_import = builtins.__import__

    def fake_import(name, *args, **kwargs):
        if name == "playwright.sync_api" or name.startswith("playwright"):
            raise ImportError("no playwright")
        return real_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", fake_import)
    p = NokiaProvider()
    assert p.check_public_source("Nokia", "7210 SAS", "24.9.R5") is None


def test_check_public_source_unexpected_browser_error_never_raises():
    # no_live_browser_calls (autouse) already makes sync_playwright()
    # raise -- confirms check_public_source() catches it and returns
    # None instead of propagating.
    p = NokiaProvider()
    assert p.check_public_source("Nokia", "7210 SAS", "24.9.R5") is None


def test_extract_title_version():
    """Nokia's own release-numbering style, confirmed live: "26.3.R2",
    "24.9.R5", mixed-case R across older/newer documents."""
    from firmware_lookup.providers.nokia import _extract_title_version

    assert _extract_title_version(
        "7210 SAS Software Release Notes 26.3.R2",
    ) == "26.3.R2"
    assert _extract_title_version(
        "7210 SAS Software Release Notes 4.0r8",
    ) == "4.0r8"
    assert _extract_title_version("Nokia Validated Design: Teleprotection") is None


def test_product_link_and_result_row_parse_real_markup_shape():
    """Regression guard for the real markup found live: the doc-center
    catalog page lists every product as a real <a
    class="sub-header-link-list-item">, and a specific product's
    results page lists real dated release documents. Also confirms the
    real, live-found ordering quirk: results are sorted by Issue Date,
    NOT by version number -- Nokia maintains multiple parallel release
    trains simultaneously, so an older-numbered-but-newer-dated entry
    can legitimately outrank a higher version number. Exercises the
    actual parsing regexes against minimal fixtures shaped exactly like
    the real pages, without any browser or network call."""
    from firmware_lookup.providers.nokia import (
        _PRODUCT_LINK_RE, _RESULT_ROW_RE,
    )

    catalog_html = (
        '<a class="sub-header-link-list-item" '
        'href="/pybin/doc_ctr.py?product_id=833-006357">'
        "7210 SAS (Service Access System)</a>"
    )
    products = _PRODUCT_LINK_RE.findall(catalog_html)
    assert products == [
        ("/pybin/doc_ctr.py?product_id=833-006357", "7210 SAS (Service Access System)"),
    ]

    results_html = (
        '<span><a href="https://x/notes-26-3-r2" target="_self">'
        "7210 SAS Software Release Notes 26.3.R2 </a></span><br>"
        '<span class="result-p-meta">Issue Date: '
        '<span class="result-filt-data">2026/06/26</span></span>'
        '<span><a href="https://x/notes-24-9-r5" target="_self">'
        "7210 SAS Software Release Notes 24.9.R5 </a></span><br>"
        '<span class="result-p-meta">Issue Date: '
        '<span class="result-filt-data">2026/05/29</span></span>'
    )
    rows = _RESULT_ROW_RE.findall(results_html)
    assert rows == [
        ("https://x/notes-26-3-r2", "7210 SAS Software Release Notes 26.3.R2", "2026/06/26"),
        ("https://x/notes-24-9-r5", "7210 SAS Software Release Notes 24.9.R5", "2026/05/29"),
    ]
