import pytest


@pytest.fixture(autouse=True)
def no_live_browser_calls(monkeypatch):
    """Advantech's check_public_source() (see providers/advantech.py)
    makes REAL Playwright browser calls (search page, then firmware
    detail page -- both genuinely JS-rendered, confirmed live) before
    falling back to login -- same pattern as Extreme/Aruba elsewhere in
    this suite. Autouse + raising immediately keeps every test in this
    file fast and deterministic while still exercising the real
    fallback-to-login code path."""
    import playwright.sync_api as sync_api_mod

    def fake_sync_playwright():
        raise RuntimeError("no live browser calls in tests")

    monkeypatch.setattr(sync_api_mod, "sync_playwright", fake_sync_playwright)


def test_check_public_source_empty_model_returns_none():
    from firmware_lookup.providers.advantech import AdvantechProvider

    p = AdvantechProvider()
    assert p.check_public_source("Advantech", "", "1.0") is None


def test_check_public_source_unexpected_browser_error_never_raises():
    from firmware_lookup.providers.advantech import AdvantechProvider

    p = AdvantechProvider()
    assert p.check_public_source("Advantech", "EKI-7712E-4F", "1.00.97") is None


def test_check_public_source_missing_playwright_returns_none_not_raise(monkeypatch):
    import builtins
    real_import = builtins.__import__

    def fake_import(name, *args, **kwargs):
        if name == "playwright.sync_api" or name.startswith("playwright"):
            raise ImportError("no playwright")
        return real_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", fake_import)
    from firmware_lookup.providers.advantech import AdvantechProvider

    p = AdvantechProvider()
    assert p.check_public_source("Advantech", "EKI-7712E-4F", "1.00.97") is None


def test_firmware_detail_link_regex_parses_real_search_markup():
    """Regression guard for the real search-results markup found live:
    a plain href to the firmware detail page, path-only (no host)."""
    from firmware_lookup.providers.advantech import _FIRMWARE_DETAIL_LINK_RE

    html = (
        '<a href="/en/support/details/firmware?id=1-18U05WB" '
        'data-tracking="">Firmware for EKI-7712 Series</a>'
    )
    m = _FIRMWARE_DETAIL_LINK_RE.search(html)
    assert m is not None
    assert m.group(1) == "/en/support/details/firmware?id=1-18U05WB"


def test_download_row_regex_parses_real_markup_and_picks_last_as_newest():
    """Regression guard for a real, confirmed data quirk: Advantech's
    real firmware detail page lists entries in ASCENDING date order
    (oldest first) -- confirmed live for EKI-7712's real 6-entry
    history (2017-11-24 through 2024-04-18). The LAST row parsed is the
    newest, opposite of most other vendors' pages -- sorting by the
    first row here would silently return the OLDEST firmware as
    "latest"."""
    from firmware_lookup.providers.advantech import _DOWNLOAD_ROW_RE, _VERSION_TOKEN_RE

    html = (
        '<h4 class="downloadTitle">Firmware and MIB for EKI-7712 Series v1.00.97</h4>'
        '<span class="date">2017-11-24</span>'
        '<h4 class="downloadTitle">Firmware and MIB for EKI-7712 Series v1.02.03</h4>'
        '<span class="date">2023-04-20</span>'
        '<h4 class="downloadTitle">Firmware and MIB for EKI-7712 series v1.02.03_IncludeLoader</h4>'
        '<span class="date">2024-04-18</span>'
    )
    rows = _DOWNLOAD_ROW_RE.findall(html)
    assert len(rows) == 3
    latest_title, latest_date = rows[-1]
    assert latest_date == "2024-04-18"
    version_match = _VERSION_TOKEN_RE.search(latest_title)
    assert version_match.group(1) == "1.02.03_IncludeLoader"
