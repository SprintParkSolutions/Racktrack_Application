from firmware_lookup.providers.tplink import BASE, TPLinkProvider
from firmware_lookup.tests.conftest import sample_html


def test_valid_model_latest_version(mock_get_text):
    p = TPLinkProvider()
    url = f"{BASE}/tl-sg1016de/"
    mock_get_text(p, {url: sample_html("tplink_download_page.html")})
    r = p.get_latest_firmware("TP-Link", "TL-SG1016DE", "1.0.0")
    assert r.status.value == "ok"
    assert r.latest_version == "1.0.1"
    assert r.update_available is True
    assert r.confidence.value == "High"


def test_already_up_to_date(mock_get_text):
    p = TPLinkProvider()
    url = f"{BASE}/tl-sg1016de/"
    mock_get_text(p, {url: sample_html("tplink_download_page.html")})
    r = p.get_latest_firmware("TP-Link", "TL-SG1016DE", "1.0.1")
    assert r.status.value == "ok"
    assert r.update_available is False


def test_no_model_given(mock_get_text):
    p = TPLinkProvider()
    mock_get_text(p, {})
    # check_public_source() must return None (not a direct status) on
    # failure so the login safety net gets a chance.
    assert p.check_public_source("TP-Link", "", "1.0.0") is None


def test_page_not_found(mock_get_text):
    p = TPLinkProvider()
    mock_get_text(p, {})  # get_text returns None for any URL
    assert p.check_public_source("TP-Link", "TL-NONEXISTENT", "1.0.0") is None


def test_malformed_page(mock_get_text):
    p = TPLinkProvider()
    url = f"{BASE}/tl-sg1016de/"
    mock_get_text(p, {url: "<html><body>nothing useful here</body></html>"})
    assert p.check_public_source("TP-Link", "TL-SG1016DE", "1.0.0") is None
