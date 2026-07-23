from firmware_lookup.providers.edimax import (
    DOWNLOAD_LIST_URL_TEMPLATE, PRODUCT_LIST_URL, EdimaxProvider,
)

CATALOG_HTML = (
    '<option value="" selected="selected" disabled="disabled">--</option>'
    '<option value="gs-5424plc_v2" data="smb_switches_onvif_conformant">'
    'GS-5424PLC V2</option>'
    '<option value="gs-5424plc_v3" data="smb_switches_onvif_conformant">'
    'GS-5424PLC V3</option>'
)

FIRMWARE_HTML = (
    '<div id="d_firmware"></div><h3>Firmware</h3>'
    '<table><tbody><tr>'
    '<td>GS-5424PLC V2 Firmware Version 1.0.9 '
    '<a href="/some/release-note.pdf">Release note</a> '
    '(Version : 1.0.9) '
    '<span style="font-size:1.4rem;color:#999;">2021-12-16</span></td>'
    '</tr></tbody></table>'
)

NO_FIRMWARE_HTML = (
    '<div id="d_datasheet"></div><h3>Datasheet</h3>'
    '<table><tbody><tr><td>GS-5424PLC V3 Datasheet</td></tr></tbody></table>'
)


def test_no_model_given(mock_get_text):
    p = EdimaxProvider()
    mock_get_text(p, {})
    r = p.get_latest_firmware("Edimax", "", "1.0")
    assert r.status.value == "cannot_determine"


def test_catalog_fetch_failure(mock_get_text):
    p = EdimaxProvider()
    mock_get_text(p, {})
    r = p.get_latest_firmware("Edimax", "GS-5424PLC V2", "1.0.0")
    assert r.status.value == "cannot_determine"


def test_real_markup_resolves_correct_model_and_version(mock_get_text):
    """Regression guard for a real mistake caught live: an earlier
    version of this provider was registered as 'no viable path' after
    testing only GS-5424PLC V3 (which genuinely has no firmware) and
    over-generalizing to the whole vendor -- a user's real screenshot
    of GS-5424PLC V2's firmware page proved that wrong. Confirms V2
    resolves to real version 1.0.9 via the real two-step public API."""
    p = EdimaxProvider()
    download_url = DOWNLOAD_LIST_URL_TEMPLATE.format(
        slug="gs-5424plc_v2", category="smb_switches_onvif_conformant",
    )
    mock_get_text(p, {
        PRODUCT_LIST_URL: CATALOG_HTML,
        download_url: FIRMWARE_HTML,
    })
    r = p.get_latest_firmware("Edimax", "GS-5424PLC V2", "1.0.0")
    assert r.status.value == "ok"
    assert r.latest_version == "1.0.9"


def test_real_model_with_no_firmware_section_returns_model_not_found(mock_get_text):
    """Regression guard for the real, confirmed HONEST gap: GS-5424PLC
    V3 genuinely has zero Firmware section on its real download-list
    page (re-verified live through the correct endpoint) -- this must
    stay model_not_found, not be mistaken for a bug and "fixed" into
    fabricating a version."""
    p = EdimaxProvider()
    download_url = DOWNLOAD_LIST_URL_TEMPLATE.format(
        slug="gs-5424plc_v3", category="smb_switches_onvif_conformant",
    )
    mock_get_text(p, {
        PRODUCT_LIST_URL: CATALOG_HTML,
        download_url: NO_FIRMWARE_HTML,
    })
    r = p.get_latest_firmware("Edimax", "GS-5424PLC V3", "1.0.0")
    assert r.status.value == "model_not_found"


def test_unmatched_model_returns_model_not_found(mock_get_text):
    p = EdimaxProvider()
    mock_get_text(p, {PRODUCT_LIST_URL: CATALOG_HTML})
    r = p.get_latest_firmware("Edimax", "TotallyFakeEdimaxModel", "1.0")
    assert r.status.value == "model_not_found"
