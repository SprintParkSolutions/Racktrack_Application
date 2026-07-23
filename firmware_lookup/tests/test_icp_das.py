import pytest


@pytest.fixture(autouse=True)
def no_live_browser_calls(monkeypatch):
    """ICP DAS's download center is JS-rendered and requires a real
    Playwright browser (confirmed live). Autouse + raising immediately
    keeps every test in this file fast and deterministic, while the
    real DOM-parsing logic is tested directly below via
    _parse_result_table()."""
    import playwright.sync_api as sync_api_mod

    def fake_sync_playwright():
        raise RuntimeError("no live browser calls in tests")

    monkeypatch.setattr(sync_api_mod, "sync_playwright", fake_sync_playwright)


def test_no_model_given():
    from firmware_lookup.providers.icp_das import IcpDasProvider

    p = IcpDasProvider()
    r = p.get_latest_firmware("ICP DAS", "", "1.0")
    assert r.status.value == "cannot_determine"


def test_unexpected_browser_error_returns_cannot_determine_not_raise():
    from firmware_lookup.providers.icp_das import IcpDasProvider

    p = IcpDasProvider()
    r = p.get_latest_firmware("ICP DAS", "iNS-306", "1.0.0")
    assert r.status.value == "cannot_determine"


def test_parse_result_table_real_markup():
    """Regression guard for the real markup found live: a genuine
    leading empty cell precedes FILE NAME/DESCRIPTION/MODEL/LAST
    UPDATE in the tab-separated data row, confirmed live for iNS-306
    -> DESCRIPTION 'Vol. iNS_F.2.25.01_EN', dated 2025-01-21."""
    from firmware_lookup.providers.icp_das import _parse_result_table

    table_text = (
        "FILE NAME\tDESCRIPTION\tMODEL\tLAST UPDATE\n\n"
        "\tIndustrial IoT Switch iNS-300 Series\tVol. iNS_F.2.25.01_EN\t"
        "iNS-306\t2025-01-21\nTOP"
    )
    result = _parse_result_table(table_text, "iNS-306")
    assert result == ("iNS_F.2.25.01_EN", "2025-01-21")


def test_parse_result_table_no_matching_row_returns_none():
    from firmware_lookup.providers.icp_das import _parse_result_table

    table_text = "FILE NAME\tDESCRIPTION\tMODEL\tLAST UPDATE"
    assert _parse_result_table(table_text, "NS-208") is None
