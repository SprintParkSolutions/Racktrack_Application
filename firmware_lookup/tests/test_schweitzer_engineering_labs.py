import pytest


@pytest.fixture(autouse=True)
def no_live_browser_calls(monkeypatch):
    """SEL's firmware finder (selinc.com/products/firmware/) is a real
    AngularJS SPA requiring a real Playwright browser -- an earlier
    non-browser fetch wrongly flagged this page as bot-walled; a real
    headless render loads it fine. Autouse + raising immediately keeps
    every test in this file fast and deterministic (no live network
    calls), while the real DOM-parsing logic is tested directly below
    via _parse_result_table()."""
    import playwright.sync_api as sync_api_mod

    def fake_sync_playwright():
        raise RuntimeError("no live browser calls in tests")

    monkeypatch.setattr(sync_api_mod, "sync_playwright", fake_sync_playwright)


def test_no_model_given():
    from firmware_lookup.providers.schweitzer_engineering_labs import (
        SchweitzerEngineeringLabsProvider,
    )

    p = SchweitzerEngineeringLabsProvider()
    r = p.get_latest_firmware("Schweitzer Engineering Laboratories", "", "1.0")
    assert r.status.value == "cannot_determine"


def test_unexpected_browser_error_returns_cannot_determine_not_raise():
    from firmware_lookup.providers.schweitzer_engineering_labs import (
        SchweitzerEngineeringLabsProvider,
    )

    p = SchweitzerEngineeringLabsProvider()
    r = p.get_latest_firmware(
        "Schweitzer Engineering Laboratories", "SEL-2740S", "R100-V0",
    )
    assert r.status.value == "cannot_determine"


def test_parse_result_table_real_markup():
    """Regression guard for the real markup found live: Playwright's
    inner_text() on the results table renders as tab-separated rows,
    confirmed live for SEL-2740S -> Revision R113-V2, dated 6/8/26."""
    from firmware_lookup.providers.schweitzer_engineering_labs import (
        _parse_result_table,
    )

    table_text = (
        "Product\tRevision\tFirmware ID\tDate Available\tSerial Number\n"
        "SEL-2740S\tR113-V2\tSEL-2740S-R113-V2-Z001001-D20260601\t6/8/26\t~1261700001"
    )
    result = _parse_result_table(table_text, "SEL-2740S")
    assert result == ("R113-V2", "6/8/26")


def test_parse_result_table_no_matching_row_returns_none():
    from firmware_lookup.providers.schweitzer_engineering_labs import (
        _parse_result_table,
    )

    table_text = "Product\tRevision\tFirmware ID\tDate Available\tSerial Number"
    assert _parse_result_table(table_text, "SEL-2740S") is None
