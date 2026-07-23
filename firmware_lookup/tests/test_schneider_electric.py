import pytest


@pytest.fixture(autouse=True)
def no_live_browser_calls(monkeypatch):
    """SchneiderElectricProvider makes a REAL Playwright browser call
    (confirmed live this domain blocks plain curl/WebFetch, needs a
    real browser). Autouse + raising immediately keeps every test in
    this file fast and deterministic."""
    import playwright.sync_api as sync_api_mod

    def fake_sync_playwright():
        raise RuntimeError("no live browser calls in tests")

    monkeypatch.setattr(sync_api_mod, "sync_playwright", fake_sync_playwright)


def test_no_model_given():
    from firmware_lookup.providers.schneider_electric import SchneiderElectricProvider

    p = SchneiderElectricProvider()
    r = p.get_latest_firmware("Schneider Electric", "", "9.0")
    assert r.status.value == "cannot_determine"


def test_unexpected_browser_error_returns_cannot_determine_not_raise():
    from firmware_lookup.providers.schneider_electric import SchneiderElectricProvider

    p = SchneiderElectricProvider()
    r = p.get_latest_firmware("Schneider Electric", "TCSESM083F23F0", "9.0")
    assert r.status.value == "cannot_determine"


def test_family_prefix_regex_derives_series_from_full_sku():
    """Regression guard: confirmed live the real document page only
    resolves at the SERIES level (e.g. 'TCSESM'), not a full SKU
    ('TCSESM083F23F0' 404s) -- the family prefix must be derived from
    whatever the customer typed, same principle as Cisco/Huawei's
    family-slug derivation elsewhere in this codebase."""
    from firmware_lookup.providers.schneider_electric import _FAMILY_PREFIX_RE

    assert _FAMILY_PREFIX_RE.match("TCSESM083F23F0").group(1) == "TCSESM"
    assert _FAMILY_PREFIX_RE.match("TCSESM-E").group(1) == "TCSESM-E"
    assert _FAMILY_PREFIX_RE.match("TCSESM103F2LG0").group(1) == "TCSESM"


def test_firmware_entry_regex_parses_real_page_text():
    """Regression guard for the real text found live: 'Firmware
    <=SV09.11' on the ConneXium document page."""
    from firmware_lookup.providers.schneider_electric import _FIRMWARE_ENTRY_RE

    text = "Modicon Switch TCSESM Firmware <=SV09.11\n\nDate: Dec 01 2020"
    m = _FIRMWARE_ENTRY_RE.search(text)
    assert m is not None
    assert m.group(1) == "09.11"
