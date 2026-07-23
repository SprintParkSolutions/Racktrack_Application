import pytest


@pytest.fixture(autouse=True)
def no_live_browser_calls(monkeypatch):
    """WAGO's get_latest_firmware() makes a REAL Playwright browser
    call (the Download Center is an Angular SPA, confirmed live plain
    curl only returns the app shell). Autouse + raising immediately
    keeps every test in this file fast and deterministic."""
    import playwright.sync_api as sync_api_mod

    def fake_sync_playwright():
        raise RuntimeError("no live browser calls in tests")

    monkeypatch.setattr(sync_api_mod, "sync_playwright", fake_sync_playwright)


def test_no_model_given():
    from firmware_lookup.providers.wago import WagoProvider

    p = WagoProvider()
    r = p.get_latest_firmware("WAGO", "", "1.0")
    assert r.status.value == "cannot_determine"


def test_unexpected_browser_error_returns_cannot_determine_not_raise():
    from firmware_lookup.providers.wago import WagoProvider

    p = WagoProvider()
    r = p.get_latest_firmware("WAGO", "852-303", "1.0.0")
    assert r.status.value == "cannot_determine"


def test_firmware_regex_parses_real_markup():
    """Regression guard for the real markup found live on WAGO's
    Download Center: the version text is followed (across intervening
    icon markup) by the release-date div's own automationid."""
    from firmware_lookup.providers.wago import _FIRMWARE_RE

    html = (
        '<div>Version 1.2.8 (S1) </div>'
        '<div automationid="artifactReleaseDate" id="artifactReleaseDate" '
        'class="artifact-release-date"><span>Release Date 2026-03-23</span></div>'
    )
    m = _FIRMWARE_RE.search(html)
    assert m is not None
    assert m.group(1) == "1.2.8"
    assert m.group(2) == "2026-03-23"


def test_firmware_regex_no_match_returns_none():
    from firmware_lookup.providers.wago import _FIRMWARE_RE

    assert _FIRMWARE_RE.search("<html>no firmware here</html>") is None
