import pytest


@pytest.fixture(autouse=True)
def no_live_browser_calls(monkeypatch):
    """Allied Telesis's search/canonical-URL discovery and datasheet
    PDF fetch both require a real stealth-launched Playwright browser
    (confirmed live -- headless-fingerprint detection on the HTML
    pages, and a real rate/volume-triggered soft-block on the PDF
    assets when fetched via a plain, non-browser HTTP client). Autouse
    + raising immediately keeps every test in this file fast and
    deterministic, while the real discovery/parsing logic is tested
    directly below via pure helper functions."""
    import playwright.sync_api as sync_api_mod

    def fake_sync_playwright():
        raise RuntimeError("no live browser calls in tests")

    monkeypatch.setattr(sync_api_mod, "sync_playwright", fake_sync_playwright)


def test_no_model_falls_through_to_login():
    from firmware_lookup.providers.allied_telesis import AlliedTelesisProvider

    p = AlliedTelesisProvider()
    r = p.get_latest_firmware("Allied Telesis", "", "1.0")
    assert r.status.value == "auth_required"


def test_playwright_missing_falls_through_to_login(monkeypatch):
    """check_public_source() catches the browser failure and returns
    None (fall through), never raises -- login becomes the final
    answer since no session exists in tests."""
    from firmware_lookup.providers.allied_telesis import AlliedTelesisProvider

    p = AlliedTelesisProvider()
    r = p.get_latest_firmware("Allied Telesis", "x560-28YSQ", "1.0")
    assert r.status.value == "auth_required"


def test_version_regex_parses_real_datasheet_text():
    """Regression guard for the real mistake caught live: alliedtelesis.com
    initially looked headless-blocked/login-only. A user pointed at a
    real product category page and said the datasheet mentions
    firmware -- checked live and confirmed multiple real series
    (x560-28YSQ, x980 Series, SwitchBlade x908 GEN3, SwitchBlade x8100
    Series, x550 Series, x930 Series) share the real spec line
    'AlliedWare Plus Operating System Version 5.5.6' (a real
    shared-OS fact, not fake placeholder data like the Linksys/Signamax
    false positives)."""
    from firmware_lookup.providers.allied_telesis import _VERSION_RE

    text = (
        "5 | x560 Series Datasheet AlliedTelesis.com STANDARDS & "
        "PROTOCOLS AlliedWare Plus Operating System  Version 5.5.6 "
        "Authentication RFC 1321 MD5 Message-Digest algorithm"
    )
    m = _VERSION_RE.search(text)
    assert m is not None
    assert m.group(1) == "5.5.6"


def test_version_regex_no_match_for_genuine_gap():
    """Regression guard for the real, confirmed HONEST gap: GS950 V2
    Series's datasheet has no 'AlliedWare Plus Operating System
    Version' line at all (only a generic 'Firmware upgrade by FTP and
    HTTP' feature bullet) -- must fall through to login, not be
    mistaken for a bug."""
    from firmware_lookup.providers.allied_telesis import _VERSION_RE

    text = (
        "SNMP trap view LLDP Firmware upgrade by FTP and HTTP "
        "Configuration backup/restore by FTP and HTTP"
    )
    assert _VERSION_RE.search(text) is None


def test_find_first_relevant_result_respects_real_ranking_order():
    """Regression guard for a real bug caught live: an earlier version
    scanned for a datasheet PDF match across the WHOLE result list
    before ever checking for a product/series page, in a separate
    pass -- ignoring the vendor's own real ranking. For 'SwitchBlade
    x8106', that returned a lower-ranked, WRONG datasheet (an alternate
    CFC400 controller-card configuration, version 5.4.8) instead of
    the correctly top-ranked /product/sbx8106/ page (whose real
    canonical series page's only datasheet is the CFC960 one, version
    5.5.6). This test reproduces that exact real ordering: the
    /product/ page appears BEFORE two datasheet PDFs, so it must win."""
    from firmware_lookup.providers.allied_telesis import (
        _find_first_relevant_result,
    )

    items = [
        {"href": "https://www.alliedtelesis.com/us/en/products/switches/", "text": "Switches"},
        {"href": "https://www.alliedtelesis.com/us/en/product/sbx8106/", "text": "SwitchBlade x8106"},
        {
            "href": "https://www.alliedtelesis.com/wp-content/uploads/2026/05/ati-sbx8100-cfc400-ds.pdf",
            "text": "Datasheet: SwitchBlade x8100 Series with CFC400 Controller",
        },
        {
            "href": "https://www.alliedtelesis.com/wp-content/uploads/2026/05/ati-sbx8100-cfc960-ds.pdf",
            "text": "Datasheet: SwitchBlade® x8100 Series with CFC960 Controller",
        },
    ]
    kind, url = _find_first_relevant_result(items)
    assert kind == "page"
    assert url == "https://www.alliedtelesis.com/us/en/product/sbx8106/"


def test_find_first_relevant_result_prefers_direct_datasheet_pdf_when_ranked_first():
    """Regression guard for a real case found live: searching a
    sub-component with no dedicated product page of its own (CFC960v2,
    the SwitchBlade x8100 Series' real control-fabric card) returns a
    top result that IS the datasheet PDF directly -- no HTML page to
    resolve at all. Confirmed live: 'Datasheet: SwitchBlade x8100
    Series with CFC960 Controller' links straight to
    ati-sbx8100-cfc960-ds.pdf, and it is the FIRST relevant result."""
    from firmware_lookup.providers.allied_telesis import (
        _find_first_relevant_result,
    )

    items = [
        {"href": "https://www.alliedtelesis.com/us/en/products/", "text": "Products"},
        {
            "href": "https://www.alliedtelesis.com/wp-content/uploads/2026/05/ati-sbx8100-cfc960-ds.pdf",
            "text": "Datasheet: SwitchBlade® x8100 Series with CFC960 Controller",
        },
    ]
    kind, url = _find_first_relevant_result(items)
    assert kind == "pdf"
    assert url.endswith("ati-sbx8100-cfc960-ds.pdf")


def test_find_first_relevant_result_falls_back_to_product_page():
    """Regression guard for the common case: an individual model WITH
    its own dedicated page (e.g. SBx8106, x930-28GTX -- confirmed live)
    has no direct datasheet PDF in its top search result, only a real
    /product/<slug>/ page link, which must then be visited to read its
    canonical URL."""
    from firmware_lookup.providers.allied_telesis import (
        _find_first_relevant_result,
    )

    items = [
        {"href": "https://www.alliedtelesis.com/us/en/products/switches/", "text": "Switches"},
        {"href": "https://www.alliedtelesis.com/us/en/product/x930-28gtx/", "text": "x930-28GTX"},
    ]
    kind, url = _find_first_relevant_result(items)
    assert kind == "page"
    assert url == "https://www.alliedtelesis.com/us/en/product/x930-28gtx/"


def test_find_first_relevant_result_no_match_returns_none():
    from firmware_lookup.providers.allied_telesis import (
        _find_first_relevant_result,
    )

    items = [
        {"href": "https://www.alliedtelesis.com/us/en/products/", "text": "Products"},
        {"href": "https://www.alliedtelesis.com/us/en/about/", "text": "About"},
    ]
    kind, url = _find_first_relevant_result(items)
    assert kind is None
    assert url is None


def test_product_or_series_page_regex_excludes_category_pages():
    """Regression guard: category/navigation pages like
    '/products/switches/data-center/' (plural 'products', a real
    top-level nav path) must NOT be mistaken for an individual
    '/product/<slug>/' or '/series/<slug>/' page."""
    from firmware_lookup.providers.allied_telesis import (
        _PRODUCT_OR_SERIES_PAGE_RE,
    )

    assert not _PRODUCT_OR_SERIES_PAGE_RE.search(
        "https://www.alliedtelesis.com/us/en/products/switches/data-center/",
    )
    assert not _PRODUCT_OR_SERIES_PAGE_RE.search(
        "https://www.alliedtelesis.com/us/en/products/selector/",
    )
    assert _PRODUCT_OR_SERIES_PAGE_RE.search(
        "https://www.alliedtelesis.com/us/en/product/sbx8106/",
    )
    assert _PRODUCT_OR_SERIES_PAGE_RE.search(
        "https://www.alliedtelesis.com/us/en/series/x930-series/",
    )
