from firmware_lookup.providers.perle import PORTAL_URL, PerleProvider

PRO_PAGE_HTML = (
    "<title>IDS-300, IDS-500 &amp; IDS-710 Switches with PRO Feature Set | "
    "Documentation and Downloads</title>"
    '<a href="/downloads/software-download-agreement.aspx?id=ids-switch">'
    "Download Comprehensive Firmware R2.1G8</a>"
)
POE_PAGE_HTML = (
    "<title>IDS-509 PoE Switches | Documentation and Downloads</title>"
    '<a href="/downloads/software-download-agreement.aspx?id=ids-switch">'
    "Download PoE Firmware R2.1G8</a>"
)
UNMANAGED_PAGE_HTML = (
    "<title>IDS-100 Unmanaged Industrial Ethernet Switches | "
    "Documentation and Downloads</title>"
)

PRO_URL = "https://www.perle.com/downloads/industrial-managed-switches-pro.shtml"
POE_URL = "https://www.perle.com/downloads/ids-509-poe-switches.shtml"
UNMANAGED_URL = "https://www.perle.com/downloads/industrial-switches.shtml"


def test_no_model_given(mock_get_text):
    p = PerleProvider()
    mock_get_text(p, {})
    r = p.get_latest_firmware("Perle", "", "1.0")
    assert r.status.value == "cannot_determine"


def test_discovery_failure_returns_cannot_determine(monkeypatch, mock_get_text):
    p = PerleProvider()
    mock_get_text(p, {})

    def raise_discovery():
        raise RuntimeError("no live browser calls in tests")
    monkeypatch.setattr(p, "_discover_switch_pages", raise_discovery)

    r = p.get_latest_firmware("Perle", "IDS-710", "R2.0")
    assert r.status.value == "cannot_determine"
    assert r.source_url == PORTAL_URL or PORTAL_URL in (r.source_url or "")


def test_family_token_matches_pro_page_wording_variant(monkeypatch, mock_get_text):
    """Regression guard for the real wording difference found live: the
    PRO/base pages say 'Download Comprehensive Firmware X', while the
    PoE-specific pages say 'Download PoE Firmware X' -- both must be
    matched by the same wording-tolerant regex."""
    p = PerleProvider()
    monkeypatch.setattr(p, "_discover_switch_pages", lambda: [PRO_URL])
    mock_get_text(p, {PRO_URL: PRO_PAGE_HTML})
    r = p.get_latest_firmware("Perle", "IDS-710", "R2.0G0")
    assert r.status.value == "ok"
    assert r.latest_version == "R2.1G8"
    assert r.source_url == PRO_URL


def test_poe_wording_variant_matches(monkeypatch, mock_get_text):
    p = PerleProvider()
    monkeypatch.setattr(p, "_discover_switch_pages", lambda: [POE_URL])
    mock_get_text(p, {POE_URL: POE_PAGE_HTML})
    r = p.get_latest_firmware("Perle", "IDS-509-SFP", "R2.0G0")
    assert r.status.value == "ok"
    assert r.latest_version == "R2.1G8"


def test_unmanaged_family_with_no_firmware_section_returns_model_not_found(
    monkeypatch, mock_get_text,
):
    """Regression guard for a real, confirmed honest gap: IDS-100
    (Unmanaged) genuinely has no firmware section on its real page --
    model_not_found is correct here, not a bug."""
    p = PerleProvider()
    monkeypatch.setattr(p, "_discover_switch_pages", lambda: [UNMANAGED_URL])
    mock_get_text(p, {UNMANAGED_URL: UNMANAGED_PAGE_HTML})
    r = p.get_latest_firmware("Perle", "IDS-100", "1.0")
    assert r.status.value == "model_not_found"


def test_no_matching_family_returns_model_not_found(monkeypatch, mock_get_text):
    p = PerleProvider()
    monkeypatch.setattr(p, "_discover_switch_pages", lambda: [PRO_URL, POE_URL])
    mock_get_text(p, {PRO_URL: PRO_PAGE_HTML, POE_URL: POE_PAGE_HTML})
    r = p.get_latest_firmware("Perle", "TotallyFakePerleModel", "1.0")
    assert r.status.value == "model_not_found"
