from firmware_lookup.providers.moxa import URL, MoxaProvider
from firmware_lookup.tests.conftest import sample_html


def test_valid_model_latest_version(mock_get_text):
    p = MoxaProvider()
    mock_get_text(p, {URL: sample_html("moxa_support_page.html")})
    r = p.get_latest_firmware("MOXA", "ioLogik 2500", "4.0")
    assert r.status.value == "ok"
    assert r.latest_version == "4.3"
    assert r.confidence.value == "Medium"


def test_invalid_model_not_found(mock_get_text):
    p = MoxaProvider()
    mock_get_text(p, {URL: sample_html("moxa_support_page.html")})
    # check_public_source() must return None (not a direct status) on a
    # zero-candidate match so the login safety net gets a chance.
    assert p.check_public_source("MOXA", "TotallyFakeMoxaModel", "1.0") is None


def test_no_model_given(mock_get_text):
    p = MoxaProvider()
    mock_get_text(p, {URL: sample_html("moxa_support_page.html")})
    assert p.check_public_source("MOXA", "", "1.0") is None


def test_network_failure(mock_get_text):
    p = MoxaProvider()
    mock_get_text(p, {})  # page fetch fails
    assert p.check_public_source("MOXA", "ioLogik 2500", "4.0") is None


def test_malformed_page(mock_get_text):
    p = MoxaProvider()
    mock_get_text(p, {URL: "<html>nothing parseable</html>"})
    assert p.check_public_source("MOXA", "ioLogik 2500", "4.0") is None
