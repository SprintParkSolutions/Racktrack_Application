import pytest


@pytest.fixture(autouse=True)
def no_live_browser_calls(monkeypatch):
    """EnGenius's firmware finder requires a real Playwright browser
    (a search box + a separate per-product results page). Autouse +
    raising immediately keeps every test in this file fast and
    deterministic, while the real parsing logic is tested directly
    below via _extract_model_code() / _pick_latest_firmware_row()."""
    import playwright.sync_api as sync_api_mod

    def fake_sync_playwright():
        raise RuntimeError("no live browser calls in tests")

    monkeypatch.setattr(sync_api_mod, "sync_playwright", fake_sync_playwright)


def test_no_model_given():
    from firmware_lookup.providers.engenius import EnGeniusProvider

    p = EnGeniusProvider()
    r = p.get_latest_firmware("EnGenius", "", "1.0")
    assert r.status.value == "cannot_determine"


def test_unexpected_browser_error_returns_cannot_determine_not_raise():
    from firmware_lookup.providers.engenius import EnGeniusProvider

    p = EnGeniusProvider()
    r = p.get_latest_firmware("EnGenius", "ECS1528T", "1.0.0")
    assert r.status.value == "cannot_determine"


def test_extract_model_code_real_markup():
    """Regression guard for the real search-result link text found
    live: '<Series Name>\\n\\t\\t\\t\\t - <MODEL>\\n\\t\\t\\t\\t<Description>'."""
    from firmware_lookup.providers.engenius import _extract_model_code

    text = (
        "CloudSwitch L2Plus 24\n\t\t\t\t - ECS1528T\n\t\t\t\t"
        "Cloud Managed 24-Port Gigabit Switch with 4 SFP+ Ports"
    )
    assert _extract_model_code(text) == "ECS1528T"


def test_extract_model_code_no_match_returns_none():
    from firmware_lookup.providers.engenius import _extract_model_code

    assert _extract_model_code("no dash here at all") is None


def test_pick_latest_firmware_row_real_markup():
    """Regression guard for the real bug this session found live: a
    non-Firmware 'MIB' row is interleaved AFTER the second-newest
    Firmware row and BEFORE the actual newest one -- confirms
    selection must compare real Release Date values, not row order."""
    from firmware_lookup.providers.engenius import _pick_latest_firmware_row

    table_text = (
        "Type\tName\tVersion\tRelease Date\tDownload\tChecksum\n"
        "Firmware\tECS15XX-25XX_firmware v1.2.90-166.imag\tv1.2.90\tOctober 01, 2024\t \t\n"
        "Firmware\tECS15XX-25XX_firmware_v1.2.125-192.imag\tv1.2.125-192\tFebruary 12, 2026\t \t\n"
        "MIB\tENGENIUS_ECS_MIB\tv1.0\tJune 15, 2026\t\t\n"
        "Firmware\tECS15XX-25XX_firmware_1.2.130-193.imag\tv1.2.130-193\tMay 27, 2026\t \t"
    )
    assert _pick_latest_firmware_row(table_text) == ("v1.2.130-193", "May 27, 2026")


def test_pick_latest_firmware_row_no_firmware_rows_returns_none():
    from firmware_lookup.providers.engenius import _pick_latest_firmware_row

    table_text = "Type\tName\tVersion\tRelease Date\tDownload\tChecksum\nData Sheet\tFoo\tv1.0\tJune 05, 2025\t\t"
    assert _pick_latest_firmware_row(table_text) is None
