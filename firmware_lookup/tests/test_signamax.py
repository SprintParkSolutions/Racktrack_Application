import pytest


@pytest.fixture(autouse=True)
def no_live_browser_calls(monkeypatch):
    """Signamax requires a real Playwright browser with stealth flags
    (headless-Chromium fingerprint detection was found live to cause a
    false 403 -- see providers/signamax.py's module docstring for the
    full correction story). Autouse + raising immediately keeps every
    test in this file fast and deterministic, while the real regex is
    tested directly below via _FIRMWARE_RE."""
    import playwright.sync_api as sync_api_mod

    def fake_sync_playwright():
        raise RuntimeError("no live browser calls in tests")

    monkeypatch.setattr(sync_api_mod, "sync_playwright", fake_sync_playwright)


def test_no_model_given():
    from firmware_lookup.providers.signamax import SignamaxProvider

    p = SignamaxProvider()
    r = p.get_latest_firmware("Signamax", "", "1.0")
    assert r.status.value == "cannot_determine"


def test_unexpected_browser_error_returns_cannot_determine_not_raise():
    from firmware_lookup.providers.signamax import SignamaxProvider

    p = SignamaxProvider()
    r = p.get_latest_firmware("Signamax", "C-500", "1.0.0")
    assert r.status.value == "cannot_determine"


def test_firmware_regex_parses_real_markup():
    """Regression guard for the real mistake caught live: an earlier
    version of this provider was registered as 'no viable path' after
    hitting a real HTTP 403 with both curl and a real headless
    Playwright browser -- a user's real screenshot of the C-500's
    firmware download link proved that wrong. The 403 turned out to be
    headless-fingerprint detection (fixed with stealth launch args),
    not a genuine bot wall. Confirms the regex parses the real 'Download
    Firmware V<version> (ZIP <size>) Revised <date>' line, verified
    live for 3 real models."""
    from firmware_lookup.providers.signamax import _FIRMWARE_RE

    cases = [
        ("Download Firmware V8.40.1384 (ZIP 17.3 MB) Revised 9-2019", "8.40.1384", "9-2019"),
        ("Download Firmware V1.0.2.6 (ZIP 7 MB) Revised 1-2021", "1.0.2.6", "1-2021"),
        ("Download Firmware V3.0.5 (ZIP) Revised 3-2024", "3.0.5", "3-2024"),
    ]
    for text, expected_version, expected_date in cases:
        m = _FIRMWARE_RE.search(text)
        assert m is not None
        assert m.group(1) == expected_version
        assert m.group(2) == expected_date


def test_firmware_regex_no_match_returns_none():
    from firmware_lookup.providers.signamax import _FIRMWARE_RE

    assert _FIRMWARE_RE.search("<html>no firmware download here</html>") is None


def test_series_key_real_model_names():
    """Regression guard for the real user report: typing the bare
    series name 'C-530' hit ambiguous_model even though every C-530
    port/PoE variant shares identical firmware (verified live across
    6 real C-530 models and 6 real C-300 models). _series_key()
    extracts the leading '<Letter>-<digits>' token used to detect
    same-series ambiguity."""
    from firmware_lookup.providers.signamax import _series_key

    assert _series_key("C-530 Series 24 Port PoE+ 10G Switch") == "C-530"
    assert _series_key("C-300 48 Port Gigabit Managed Switch") == "C-300"
    assert _series_key("I-300 16 Port Industrial Gigabit PoE+ Managed Switch") == "I-300"
    assert _series_key("no series prefix here") is None
