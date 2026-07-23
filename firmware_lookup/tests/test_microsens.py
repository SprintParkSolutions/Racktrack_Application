from firmware_lookup.providers.microsens import DIRECTORY_URL, MicrosensProvider

DIRECTORY_HTML = (
    '<li><h4><strong><a href="https://www.microsens.com/de/produkt/6-port-gbe-micro-switch-g6" '
    'target="_blank">MS440200M-G6+</a></strong></h4></li>'
    '<li><h4><strong><a href="https://www.microsens.com/de/produkt/6-port-gbe-micro-switch-g6" '
    'target="_blank">MS440201M-G6+</a></strong></h4></li>'
)

PRODUCT_HTML = (
    '<div class="secureDownloadArea secureIcon">'
    '<div class="secureDownloadAreaImage"><div class="secureClosed">'
    '<img src="/fileadmin/templates/img/iconset/icon-s-login-closed.svg"></div></div>'
    '<div class="secureDownloadAreaLink">Firmware G6 v10.8.4</div></div>'
    '<div class="secureDownloadArea secureIcon">'
    '<div class="secureDownloadAreaImage"><div class="secureClosed">'
    '<img src="/fileadmin/templates/img/iconset/icon-s-login-closed.svg"></div></div>'
    '<div class="secureDownloadAreaLink">Firmware G6 v10.8.4 Patch 1</div></div>'
)


def test_no_model_given(mock_get_text):
    p = MicrosensProvider()
    mock_get_text(p, {})
    r = p.get_latest_firmware("MICROSENS", "", "1.0")
    assert r.status.value == "cannot_determine"


def test_directory_fetch_failure(mock_get_text):
    p = MicrosensProvider()
    mock_get_text(p, {})
    r = p.get_latest_firmware("MICROSENS", "MS440200M-G6+", "10.0.0")
    assert r.status.value == "cannot_determine"


def test_real_markup_resolves_first_entry_in_page_order(mock_get_text):
    """Regression guard for the real markup found live, and the
    deliberate HONESTY-FLAG design choice: takes the FIRST firmware
    entry in the page's own order (not the highest parsed version),
    since a real product page can list divergent hardware-revision
    firmware branches that shouldn't be compared by version number
    alone."""
    p = MicrosensProvider()
    product_url = "https://www.microsens.com/product/6-port-gbe-micro-switch-g6"
    mock_get_text(p, {
        DIRECTORY_URL: DIRECTORY_HTML,
        product_url: PRODUCT_HTML,
    })
    r = p.get_latest_firmware("MICROSENS", "MS440200M-G6+", "10.8.2c")
    assert r.status.value == "ok"
    assert r.latest_version == "10.8.4"
    assert r.source_url == product_url


def test_unmatched_model_returns_model_not_found(mock_get_text):
    p = MicrosensProvider()
    mock_get_text(p, {DIRECTORY_URL: DIRECTORY_HTML})
    r = p.get_latest_firmware("MICROSENS", "TotallyFakeItemNumber", "1.0")
    assert r.status.value == "model_not_found"


def test_product_page_with_no_firmware_entries_returns_model_not_found(mock_get_text):
    p = MicrosensProvider()
    product_url = "https://www.microsens.com/product/6-port-gbe-micro-switch-g6"
    mock_get_text(p, {
        DIRECTORY_URL: DIRECTORY_HTML,
        product_url: "<html>no firmware section here</html>",
    })
    r = p.get_latest_firmware("MICROSENS", "MS440200M-G6+", "1.0")
    assert r.status.value == "model_not_found"
