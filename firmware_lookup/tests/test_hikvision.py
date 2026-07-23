import pytest


@pytest.fixture(autouse=True)
def no_live_browser_calls(monkeypatch):
    """Hikvision's get_latest_firmware() makes a REAL Playwright browser
    call (search box interaction + product page navigation, confirmed
    live). Autouse + raising immediately keeps every test in this file
    fast and deterministic."""
    import playwright.sync_api as sync_api_mod

    def fake_sync_playwright():
        raise RuntimeError("no live browser calls in tests")

    monkeypatch.setattr(sync_api_mod, "sync_playwright", fake_sync_playwright)


def test_no_model_given():
    from firmware_lookup.providers.hikvision import HikvisionProvider

    p = HikvisionProvider()
    r = p.get_latest_firmware("Hikvision", "", "1.0")
    assert r.status.value == "cannot_determine"


def test_unexpected_browser_error_returns_cannot_determine_not_raise():
    from firmware_lookup.providers.hikvision import HikvisionProvider

    p = HikvisionProvider()
    r = p.get_latest_firmware("Hikvision", "DS-3E1326P-EI", "3.0.0")
    assert r.status.value == "cannot_determine"


def test_firmware_version_regex_parses_real_markup():
    """Regression guard for the real text found live on the product
    page's own Firmware section."""
    from firmware_lookup.providers.hikvision import _FIRMWARE_VERSION_RE

    text = "Firmware\nFirmware_V3.4.0_260319\nApplied to:\nDS-3E1326P-EI(B)"
    m = _FIRMWARE_VERSION_RE.search(text)
    assert m is not None
    assert m.group(1) == "3.4.0"
    assert m.group(2) == "260319"


def test_firmware_version_regex_no_match_returns_none():
    from firmware_lookup.providers.hikvision import _FIRMWARE_VERSION_RE

    assert _FIRMWARE_VERSION_RE.search("<html>no firmware here</html>") is None
