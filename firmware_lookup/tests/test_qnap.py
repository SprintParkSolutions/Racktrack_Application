import pytest


@pytest.fixture(autouse=True)
def no_live_browser_calls(monkeypatch):
    """QNAP's check_public_source() (see providers/qnap.py) makes a
    REAL Playwright browser call (the Download Center page is
    JS-rendered, confirmed live) before falling back to login -- same
    pattern as Extreme/Advantech elsewhere in this suite."""
    import playwright.sync_api as sync_api_mod

    def fake_sync_playwright():
        raise RuntimeError("no live browser calls in tests")

    monkeypatch.setattr(sync_api_mod, "sync_playwright", fake_sync_playwright)


def test_check_public_source_empty_model_returns_none():
    from firmware_lookup.providers.qnap import QnapProvider

    p = QnapProvider()
    assert p.check_public_source("QNAP", "", "1.0") is None


def test_check_public_source_unexpected_browser_error_never_raises():
    from firmware_lookup.providers.qnap import QnapProvider

    p = QnapProvider()
    assert p.check_public_source("QNAP", "QSW-M408-4C", "1.0.0") is None


def test_firmware_row_regex_parses_real_markup():
    """Regression guard for the real markup found live on QNAP's
    JS-rendered Download Center results table."""
    from firmware_lookup.providers.qnap import _FIRMWARE_ROW_RE, _VERSION_TOKEN_RE

    html = (
        '<p><strong>QSW-M408</strong></p>'
        '<p>Version: 1.3.2 build 20240528</p>'
        '<p>Published: 2025-02-19</p>'
    )
    m = _FIRMWARE_ROW_RE.search(html)
    assert m is not None
    assert m.group(1) == "1.3.2 build 20240528"
    assert m.group(2) == "2025-02-19"
    version_match = _VERSION_TOKEN_RE.search(m.group(1))
    assert version_match.group(0) == "1.3.2"


def test_firmware_row_regex_handles_combined_sku_entry():
    """Regression guard for a real combined-SKU entry found live
    (searching one specific SKU can resolve to a shared firmware
    family title covering several related SKUs) -- the Version/
    Published fields are still parsed correctly regardless of the
    title text."""
    from firmware_lookup.providers.qnap import _FIRMWARE_ROW_RE, _VERSION_TOKEN_RE

    html = (
        '<p><strong>QSW-M2106-4C/4S/R/PR</strong></p>'
        '<p>Version: 1.2.1 build 1909949</p>'
        '<p>Published: 2025-03-13</p>'
    )
    m = _FIRMWARE_ROW_RE.search(html)
    assert m is not None
    version_match = _VERSION_TOKEN_RE.search(m.group(1))
    assert version_match.group(0) == "1.2.1"
