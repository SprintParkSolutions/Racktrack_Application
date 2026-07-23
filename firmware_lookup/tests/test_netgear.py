from firmware_lookup.providers.netgear import SITEMAP_URL, NetgearProvider
from firmware_lookup.tests.conftest import sample_html


def test_valid_model_picks_max_version(mock_get_text):
    p = NetgearProvider()
    mock_get_text(p, {SITEMAP_URL: sample_html("netgear_sitemap.xml")})
    r = p.get_latest_firmware("NETGEAR", "GS108Ev3", "1.0.0")
    assert r.status.value == "ok"
    assert r.latest_version == "2.00.12"  # not 2.00.09 (older entry)
    assert r.confidence.value == "High"


def test_another_valid_model(mock_get_text):
    p = NetgearProvider()
    mock_get_text(p, {SITEMAP_URL: sample_html("netgear_sitemap.xml")})
    r = p.get_latest_firmware("NETGEAR", "GS110EMX", "1.0.0.1")
    assert r.status.value == "ok"
    assert r.latest_version == "1.0.0.6"


def test_invalid_model_not_found(mock_get_text):
    p = NetgearProvider()
    mock_get_text(p, {SITEMAP_URL: sample_html("netgear_sitemap.xml")})
    # check_public_source() must return None (not a direct status) on a
    # genuine no-match so the login safety net gets a chance.
    assert p.check_public_source("NETGEAR", "TotallyFakeNetgearModel9999", "1.0") is None


def test_no_model_given(mock_get_text):
    p = NetgearProvider()
    mock_get_text(p, {SITEMAP_URL: sample_html("netgear_sitemap.xml")})
    assert p.check_public_source("NETGEAR", "", "1.0") is None


def test_sitemap_fetch_failure(mock_get_text):
    p = NetgearProvider()
    mock_get_text(p, {})
    assert p.check_public_source("NETGEAR", "GS108Ev3", "1.0") is None


def test_malformed_sitemap(mock_get_text):
    p = NetgearProvider()
    mock_get_text(p, {SITEMAP_URL: "<notxml"})
    assert p.check_public_source("NETGEAR", "GS108Ev3", "1.0") is None
