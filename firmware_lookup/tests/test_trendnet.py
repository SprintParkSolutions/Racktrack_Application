from firmware_lookup.providers.trendnet import PORTAL_URL, TrendnetProvider

SEARCH_URL = "https://www.trendnet.com/search/default.asp?q=TPE-3102WS"
DETAIL_URL = "https://www.trendnet.com/support/support-detail.asp?prod=110_TPE-3102WS"

SEARCH_HTML_SINGLE = (
    '<a href="https://www.trendnet.com/support/support-detail.asp?prod=110_TPE-3102WS" '
    'class="g-color-primary g-font-size-16">8-Port PoE+ Web Smart Switch</a>'
)

DETAIL_HTML = (
    '<strong>Firmware  Version: </strong>v1.00.16<br> '
    '<strong>Release Date: </strong>04/2026<br><strong><br>Note:</strong>'
)


def test_no_model_given(mock_get_text):
    p = TrendnetProvider()
    mock_get_text(p, {})
    r = p.get_latest_firmware("TRENDnet", "", "1.0")
    assert r.status.value == "cannot_determine"


def test_search_fetch_failure(mock_get_text):
    p = TrendnetProvider()
    mock_get_text(p, {})
    r = p.get_latest_firmware("TRENDnet", "TPE-3102WS", "1.0")
    assert r.status.value == "cannot_determine"


def test_single_match_resolves_real_firmware_version(mock_get_text):
    """Regression guard for the real markup found live: the vendor's own
    page has a double-space typo ('Firmware  Version:') -- matched
    tolerantly here, not assumed to be a single space."""
    p = TrendnetProvider()
    mock_get_text(p, {SEARCH_URL: SEARCH_HTML_SINGLE, DETAIL_URL: DETAIL_HTML})
    r = p.get_latest_firmware("TRENDnet", "TPE-3102WS", "1.00.14")
    assert r.status.value == "ok"
    assert r.latest_version == "1.00.16"
    assert r.source_url == DETAIL_URL


def test_no_search_results_returns_model_not_found(mock_get_text):
    p = TrendnetProvider()
    mock_get_text(p, {SEARCH_URL: "<html>no results</html>"})
    r = p.get_latest_firmware("TRENDnet", "TPE-3102WS", "1.0")
    assert r.status.value == "model_not_found"


def test_multiple_distinct_product_ids_returns_ambiguous(mock_get_text):
    """Regression guard for a real, confirmed data quirk: searching
    'TEG-284WS' live returns THREE distinct internal product IDs
    (260/255/265) for what looks like the exact same model name --
    almost certainly different, undistinguished hardware revisions.
    Never guess between them; surface ambiguous_model() instead."""
    p = TrendnetProvider()
    search_url = "https://www.trendnet.com/search/default.asp?q=TEG-284WS"
    html = (
        '<a href="https://www.trendnet.com/support/support-detail.asp?prod=260_TEG-284WS">x</a>'
        '<a href="https://www.trendnet.com/support/support-detail.asp?prod=255_TEG-284WS">x</a>'
        '<a href="https://www.trendnet.com/support/support-detail.asp?prod=265_TEG-284WS">x</a>'
    )
    mock_get_text(p, {search_url: html})
    r = p.get_latest_firmware("TRENDnet", "TEG-284WS", "1.0")
    assert r.status.value == "ambiguous_model"


def test_detail_page_fetch_failure(mock_get_text):
    p = TrendnetProvider()
    mock_get_text(p, {SEARCH_URL: SEARCH_HTML_SINGLE, DETAIL_URL: None})
    r = p.get_latest_firmware("TRENDnet", "TPE-3102WS", "1.0")
    assert r.status.value == "cannot_determine"


def test_detail_page_missing_firmware_field_returns_model_not_found(mock_get_text):
    p = TrendnetProvider()
    mock_get_text(p, {SEARCH_URL: SEARCH_HTML_SINGLE, DETAIL_URL: "<html>no firmware section</html>"})
    r = p.get_latest_firmware("TRENDnet", "TPE-3102WS", "1.0")
    assert r.status.value == "model_not_found"
