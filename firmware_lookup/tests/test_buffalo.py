from firmware_lookup.providers.buffalo import PRODUCT_PAGE_URL, BuffaloProvider


def test_non_matching_model_returns_cannot_determine(mock_get_text):
    p = BuffaloProvider()
    mock_get_text(p, {})
    r = p.get_latest_firmware("Buffalo", "TeraStation 5010", "1.0")
    assert r.status.value == "cannot_determine"
    assert r.source_url == "https://buffaloamericas.com/support"


def test_no_model_given(mock_get_text):
    p = BuffaloProvider()
    mock_get_text(p, {})
    r = p.get_latest_firmware("Buffalo", "", "1.0")
    assert r.status.value == "cannot_determine"


def test_matches_buffalo_switch():
    """Real, live-confirmed scope: Buffalo's ENTIRE switch catalog is
    just the BS-MP20/BS-MP2008/BS-MP2012 family (confirmed by walking
    the real category tree) -- not a broad catalog needing fuzzy
    matching the way PLANET/Edgecore's much larger catalogs do."""
    from firmware_lookup.providers.buffalo import _matches_buffalo_switch

    assert _matches_buffalo_switch("BS-MP2008") is True
    assert _matches_buffalo_switch("BS-MP2012") is True
    assert _matches_buffalo_switch("BS-MP20") is True
    assert _matches_buffalo_switch("bs-mp2008") is True
    assert _matches_buffalo_switch("TeraStation 5010") is False
    assert _matches_buffalo_switch("") is False


def test_firmware_section_picks_highest_version_not_latest_date(mock_get_text):
    """Regression guard for a real, confirmed data quirk: the two real
    firmware rows found live have version 2.0.6.8 posted EARLIER
    (2018-05-22) than 2.0.5.3 (2018-05-29) -- yet the same table's own
    Notes column says to update to 2.0.5.2 BEFORE going to 2.0.6.8,
    confirming 2.0.6.8 is the actual later firmware in the real upgrade
    path despite its earlier post date. Sorting by date would silently
    give the wrong practical answer here -- sorts by parsed version
    instead. Also confirms a separate "Documentation" table (same
    row shape) is correctly excluded, so a manual's own version number
    is never mistaken for firmware."""
    html = (
        '<h3 class="firm">Firmware</h3>'
        '<table class="firm tbl-downloads"><tbody>'
        '<tr><td class="icon"></td><td class="file-link"></td>'
        '<td data-title="File Size"></td>'
        '<td data-title="Post Date">2018-05-29</td>'
        '<td data-title="Version">2.0.5.3</td>'
        '<td data-title="OS Support"></td><td data-title="Notes"></td></tr>'
        '<tr><td class="icon"></td><td class="file-link"></td>'
        '<td data-title="File Size"></td>'
        '<td data-title="Post Date">2018-05-22</td>'
        '<td data-title="Version">2.0.6.8</td>'
        '<td data-title="OS Support"></td><td data-title="Notes"></td></tr>'
        "</tbody></table>"
        '<h3 class="firm">Documentation</h3>'
        '<table class="firm tbl-downloads"><tbody>'
        '<tr><td class="icon"></td><td class="file-link"></td>'
        '<td data-title="File Size"></td>'
        '<td data-title="Post Date">2020-01-01</td>'
        '<td data-title="Version">9.9.9.9</td>'
        '<td data-title="OS Support"></td><td data-title="Notes"></td></tr>'
        "</tbody></table>"
    )
    p = BuffaloProvider()
    mock_get_text(p, {PRODUCT_PAGE_URL: html})
    r = p.get_latest_firmware("Buffalo", "BS-MP2012", "2.0.5.3")
    assert r.status.value == "ok"
    # Highest real parsed version among the Firmware table's own rows,
    # never the Documentation table's unrelated "9.9.9.9".
    assert r.latest_version == "2.0.6.8"


def test_page_fetch_failure(mock_get_text):
    p = BuffaloProvider()
    mock_get_text(p, {})
    r = p.get_latest_firmware("Buffalo", "BS-MP2012", "1.0")
    assert r.status.value == "cannot_determine"
