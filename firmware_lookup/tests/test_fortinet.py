from firmware_lookup.providers.fortinet import DOCS_URL, FortinetProvider
from firmware_lookup.tests.conftest import sample_html


def test_exact_patch_version_extracted(mock_get_text):
    p = FortinetProvider()
    mock_get_text(p, {DOCS_URL: sample_html("fortinet_product_page.html")})
    r = p.get_latest_firmware("Fortinet", "FortiSwitch 224E", "7.2.0")
    assert r.status.value == "ok"
    assert r.latest_version == "8.0.0"
    assert r.confidence.value == "High"
    assert "patch-level" in r.message.lower()


def test_major_minor_only_when_no_patch_links(mock_get_text):
    p = FortinetProvider()
    mock_get_text(p, {DOCS_URL: sample_html("fortinet_major_minor_only.html")})
    r = p.get_latest_firmware("Fortinet", "FortiSwitch 224E", "7.2.0")
    assert r.status.value == "ok"
    assert r.latest_version == "7.6"
    assert r.confidence.value == "Medium"
    assert "not an invented patch number" in r.message


def test_no_public_page_falls_through_to_auth_required(mock_get_text):
    p = FortinetProvider()
    mock_get_text(p, {})  # page fetch fails entirely
    r = p.get_latest_firmware("Fortinet", "FortiSwitch 224E", "7.2.0")
    assert r.status.value == "auth_required"


def test_malformed_page_falls_through(mock_get_text):
    p = FortinetProvider()
    mock_get_text(p, {DOCS_URL: "<html>nothing useful</html>"})
    r = p.get_latest_firmware("Fortinet", "FortiSwitch 224E", "7.2.0")
    assert r.status.value == "auth_required"
