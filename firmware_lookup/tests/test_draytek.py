from firmware_lookup.providers.draytek import PORTAL_URL, DraytekProvider

ROOT_LISTING_HTML = (
    '<a href="VigorSwitch%20FX2120/">VigorSwitch FX2120/</a>'
    '<a href="VigorSwitch%20G2100/">VigorSwitch G2100/</a>'
    '<a href="VigorSwitch%20P2100/">VigorSwitch P2100/</a>'
    '<a href="Accessories/">Accessories/</a>'
)


def test_no_model_given(mock_get_text):
    p = DraytekProvider()
    mock_get_text(p, {})
    r = p.get_latest_firmware("DrayTek", "", "1.0")
    assert r.status.value == "cannot_determine"


def test_root_listing_fetch_failure(mock_get_text):
    p = DraytekProvider()
    mock_get_text(p, {})
    r = p.get_latest_firmware("DrayTek", "FX2120", "3.0.0")
    assert r.status.value == "cannot_determine"


def test_bare_model_number_matches_full_catalog_name(mock_get_text):
    """Regression guard: a customer typing just 'FX2120' (without the
    'VigorSwitch' prefix every real catalog folder has) must still
    resolve via matching.match_model()'s containment tier -- confirmed
    live this works since 'fx2120' is a whole-word substring of
    'vigorswitch fx2120' once normalized."""
    p = DraytekProvider()
    latest_url = f"{PORTAL_URL}VigorSwitch%20FX2120/Firmware/latest.txt"
    mock_get_text(p, {PORTAL_URL: ROOT_LISTING_HTML, latest_url: "3.9.10"})
    r = p.get_latest_firmware("DrayTek", "FX2120", "3.7.4")
    assert r.status.value == "ok"
    assert r.latest_version == "3.9.10"
    assert r.source_url == latest_url


def test_case_insensitive_full_name_still_resolves_exact_case_url(mock_get_text):
    """Regression guard for a real, confirmed case-sensitivity gotcha:
    fw.draytek.com.tw's paths are case-sensitive ('VigorSwitch fx2120'
    404s live even though 'VigorSwitch FX2120' 200s) -- so the URL must
    always be built from the CATALOG's own exact-case folder name, never
    the user's as-typed case."""
    p = DraytekProvider()
    latest_url = f"{PORTAL_URL}VigorSwitch%20FX2120/Firmware/latest.txt"
    mock_get_text(p, {PORTAL_URL: ROOT_LISTING_HTML, latest_url: "3.9.10"})
    r = p.get_latest_firmware("DrayTek", "vigorswitch fx2120", "3.7.4")
    assert r.status.value == "ok"
    assert r.source_url == latest_url


def test_unmatched_model_returns_model_not_found(mock_get_text):
    p = DraytekProvider()
    mock_get_text(p, {PORTAL_URL: ROOT_LISTING_HTML})
    r = p.get_latest_firmware("DrayTek", "TotallyFakeDraytekModel", "1.0")
    assert r.status.value == "model_not_found"


def test_latest_txt_fetch_failure_returns_model_not_found(mock_get_text):
    p = DraytekProvider()
    latest_url = f"{PORTAL_URL}VigorSwitch%20FX2120/Firmware/latest.txt"
    mock_get_text(p, {PORTAL_URL: ROOT_LISTING_HTML, latest_url: None})
    r = p.get_latest_firmware("DrayTek", "FX2120", "3.7.4")
    assert r.status.value == "model_not_found"
