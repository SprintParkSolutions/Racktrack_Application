import pytest

from firmware_lookup.providers.huawei import HuaweiProvider


@pytest.fixture(autouse=True)
def no_live_browser_calls(monkeypatch):
    """Huawei's check_public_source() (see providers/huawei.py) makes a
    REAL Playwright browser call for S-series switch models before
    falling back to login -- same pattern as Cisco/Extreme/Nokia
    elsewhere in this suite. Autouse + raising immediately keeps every
    test in this file fast and deterministic (no live network calls)
    while still exercising the real fallback-to-login code path, since
    check_public_source() catches this and returns None either way."""
    import playwright.sync_api as sync_api_mod

    def fake_sync_playwright():
        raise RuntimeError("no live browser calls in tests")

    monkeypatch.setattr(sync_api_mod, "sync_playwright", fake_sync_playwright)


def test_check_public_source_empty_model_returns_none():
    p = HuaweiProvider()
    assert p.check_public_source("Huawei", "", "1.0") is None


def test_model_family():
    from firmware_lookup.providers.huawei import _model_family

    assert _model_family("S5731-H48T4XC") == "57"
    assert _model_family("S2700-18TP-SI-AC") == "27"
    assert _model_family("") is None
    assert _model_family("no digits here") is None


def test_series_families():
    """CONFIRMED real finding: Huawei groups multiple related model
    numbers into one combined series page, e.g. "S3700&S5700&S6700
    Series" -- families are derived from whichever 4-digit numbers are
    actually embedded in the real series name, not a maintained list."""
    from firmware_lookup.providers.huawei import _series_families

    assert _series_families("S3700&S5700&S6700 Series") == {"37", "57", "67"}
    assert _series_families("S1700&S2700 Series") == {"17", "27"}
    assert _series_families("No numbers here") == set()


def test_extract_version():
    from firmware_lookup.providers.huawei import _extract_version

    assert _extract_version(
        "S3700&S5700&S6700 V600R025C00SPC500",
    ) == "V600R025C00SPC500"
    assert _extract_version(
        "S3700&S5700&S6700 V600R025SPH120",
    ) == "V600R025SPH120"
    assert _extract_version("No version here") is None


def test_check_public_source_non_matching_model_returns_none():
    p = HuaweiProvider()
    assert p.check_public_source("Huawei", "no digits at all", "1.0") is None


def test_series_link_and_version_row_parse_real_markup_shape():
    """Regression guard for the real markup found live: the category
    page lists every switch series as a real <a class="offering-node
    ellipsis">, and a series' own /software page lists real dated
    version/patch table rows (Element-UI table: link, one empty spacer
    cell, Status, Publication Date). Exercises the actual parsing
    regexes against minimal fixtures shaped exactly like the real
    pages, without any browser or network call."""
    from firmware_lookup.providers.huawei import (
        _SERIES_LINK_RE, _VERSION_ROW_RE,
    )

    category_html = (
        '<a data-v-x="" class="offering-node ellipsis" '
        'href="/enterprise/en/switches/s3700-s5700-s6700-pid-259602657">'
        "S3700&amp;S5700&amp;S6700 Series</a>"
    )
    series = _SERIES_LINK_RE.findall(category_html)
    assert series == [
        (
            "/enterprise/en/switches/s3700-s5700-s6700-pid-259602657",
            "S3700&amp;S5700&amp;S6700 Series",
        ),
    ]

    software_html = (
        '<a href="/x/software/266036543" target="_blank" rel="noopener">'
        "S3700&amp;S5700&amp;S6700 V600R025C00SPC500</a>"
        '<img alt="RECOMMEND"><!----><!----></div></td>'
        '<td><div class="cell"><!----></div></td>'
        '<td><div class="cell"><!---->Valid</div></td>'
        '<td><div class="cell"><!---->2025-10-09</div>'
    )
    rows = _VERSION_ROW_RE.findall(software_html)
    assert rows == [
        (
            "/x/software/266036543",
            "S3700&amp;S5700&amp;S6700 V600R025C00SPC500",
            "Valid",
            "2025-10-09",
        ),
    ]


def test_check_public_source_missing_playwright_returns_none_not_raise(monkeypatch):
    import builtins
    real_import = builtins.__import__

    def fake_import(name, *args, **kwargs):
        if name == "playwright.sync_api" or name.startswith("playwright"):
            raise ImportError("no playwright")
        return real_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", fake_import)
    p = HuaweiProvider()
    assert p.check_public_source("Huawei", "S5731-H", "V600R024") is None


def test_check_public_source_unexpected_browser_error_never_raises():
    # no_live_browser_calls (autouse) already makes sync_playwright()
    # raise -- confirms check_public_source() catches it and returns
    # None instead of propagating.
    p = HuaweiProvider()
    assert p.check_public_source("Huawei", "S5731-H", "V600R024") is None
