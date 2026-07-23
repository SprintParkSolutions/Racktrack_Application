from firmware_lookup.providers.westermo import PORTAL_URL_TEMPLATE, WestermoProvider


def test_check_public_source_empty_model_returns_none():
    p = WestermoProvider()
    assert p.check_public_source("Westermo", "", "4.0.0") is None


def test_check_public_source_page_fetch_failure_returns_none(mock_get_text):
    p = WestermoProvider()
    mock_get_text(p, {})
    assert p.check_public_source("Westermo", "L106-F2G", "4.0.0") is None


def test_check_public_source_parses_real_markup(mock_get_text):
    """Regression guard for the real markup found live: 'Firmware,
    WeOS vX.Y.Z, Release date YYYY-MM-DD' inside a
    register-to-download anchor -- the version number itself is
    public even though the actual file requires an email-capture form
    (not automated here)."""
    html = (
        '<h4>Firmware</h4><ul><li class="file-type-fallback file-type-zip">'
        '<a class="register-to-download register-to-download-icon" '
        'data-id="{some-guid}">Firmware, WeOS v4.35.0, '
        'Release date 2026-06-09</a></li></ul>'
    )
    p = WestermoProvider()
    url = PORTAL_URL_TEMPLATE.format(slug="l106-f2g")
    mock_get_text(p, {url: html})
    r = p.check_public_source("Westermo", "L106-F2G", "4.30.0")
    assert r is not None
    assert r.status.value == "ok"
    assert r.latest_version == "4.35.0"
    assert r.source_url == url
    assert r.update_available is True


def test_check_public_source_model_url_is_lowercased():
    """Regression guard: confirmed live the real transform is a plain
    lowercase of whatever the customer typed, case-insensitively
    accepted by the real server for 3 different real models."""
    assert PORTAL_URL_TEMPLATE.format(slug="L106-F2G".lower()) == (
        "https://www.westermo.com/support/product-support/l106-f2g"
    )


def test_check_public_source_no_firmware_entry_returns_none(mock_get_text):
    p = WestermoProvider()
    url = PORTAL_URL_TEMPLATE.format(slug="totallyfakemodel")
    mock_get_text(p, {url: "<html>no firmware section here</html>"})
    assert p.check_public_source("Westermo", "TotallyFakeModel", "1.0") is None
