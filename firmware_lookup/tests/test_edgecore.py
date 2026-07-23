from firmware_lookup.providers.edgecore import EdgecoreProvider


def test_no_model_given(mock_get_text):
    p = EdgecoreProvider()
    mock_get_text(p, {})
    r = p.get_latest_firmware("Edgecore", "", "1.0")
    assert r.status.value == "cannot_determine"


def test_page_fetch_failure(mock_get_text):
    p = EdgecoreProvider()
    mock_get_text(p, {})
    r = p.get_latest_firmware("Edgecore", "ECS4150", "1.0")
    assert r.status.value == "cannot_determine"
    assert r.source_url == "https://support.edge-core.com/hc/en-us"


def test_firmware_title_parses_all_real_format_variations():
    """Regression guard for real title formats confirmed live: several
    genuinely different shapes coexist on the same page --
    underscore-separated with/without a trailing ".bix", space-separated,
    an extra suffix between version and date (e.g. "_L3_Version"), and
    combined multi-SKU listings ("ECS4150-28T/28F/28P/54T/54P"). Also
    confirms non-firmware entries on the same page (a support FAQ
    article whose title happens to contain the word "version", a
    datasheet, a product image) are correctly excluded because none of
    them contain a real "V<digit>" version token -- not a maintained
    denylist that could go stale."""
    from firmware_lookup.providers.edgecore import _DATE_RE, _FIRMWARE_TITLE_RE

    cases = [
        ("ECS4150_V1.10.1.254.bix (2025/10/27)", ("ECS4150", "1.10.1.254")),
        ("ECS5550_V3.1.13.262.bix(2026/06/23)", ("ECS5550", "3.1.13.262")),
        (
            "ECS5520_V3.4.17.262_L3_Version (2026/06/26)",
            ("ECS5520", "3.4.17.262"),
        ),
        (
            "ECS4155/ECS4655_V2.1.10.262 (2026/07/15)",
            ("ECS4155/ECS4655", "2.1.10.262"),
        ),
        (
            "ECS4150-28T/28F/28P/54T/54P V5.1.14.262 (2026/6/23)",
            ("ECS4150-28T/28F/28P/54T/54P", "5.1.14.262"),
        ),
        ("ECS1100-5P_V1.0.2.5 Firmware", ("ECS1100-5P", "1.0.2.5")),
    ]
    for title, expected in cases:
        match = _FIRMWARE_TITLE_RE.match(title)
        assert match is not None, f"expected a match for {title!r}"
        assert match.groups() == expected

    non_firmware_titles = [
        "How to upgrade ECS4120 loader version to extend the ECC "
        "(Error Correcting code) support?",
        "ECS1020 Series Datasheet",
        "ECS1020-24T Product Image",
    ]
    for title in non_firmware_titles:
        assert _FIRMWARE_TITLE_RE.match(title) is None, (
            f"{title!r} should NOT look like a firmware entry"
        )

    # Real, live-confirmed quirk: a minority of entries (e.g. the
    # ECS1100 series) have no date at all.
    assert _DATE_RE.search("ECS1100-5P_V1.0.2.5 Firmware") is None
    assert _DATE_RE.search("ECS4150_V1.10.1.254.bix (2025/10/27)").groups() == (
        "2025", "10", "27",
    )


def test_normalize_and_model_containment_match():
    """Confirms the real matching approach: both sides normalized to
    bare alphanumerics and checked for containment -- handles combined
    multi-SKU listings (e.g. typing the specific "ECS4150-28T" SKU
    matches inside the combined "ECS4150-28T/28F/28P/54T/54P" listing)
    without needing to split every listing into individual SKUs."""
    from firmware_lookup.providers.edgecore import _normalize

    assert _normalize("ECS4150-28T") in _normalize(
        "ECS4150-28T/28F/28P/54T/54P",
    )
    assert _normalize("ECS4655") in _normalize("ECS4155/ECS4655")
    assert _normalize("ECS9999") not in _normalize("ECS4150")


def test_picks_newest_dated_entry_over_older_and_undated(mock_get_text):
    """Regression guard for the real ordering rule: multiple dated
    entries for the same series must be sorted newest-first (not just
    "first in document order", since the real page doesn't guarantee
    that), and an undated entry must never outrank a dated one."""
    from firmware_lookup.providers.edgecore import DOWNLOAD_CATEGORY_URL

    html = (
        '<a href="/a1" class="article-list-link" '
        'title="ECS9100_V1.0.0.100 (2024/01/01)">x</a>'
        '<a href="/a2" class="article-list-link" '
        'title="ECS9100_V1.2.0.100 (2026/03/15)">x</a>'
        '<a href="/a3" class="article-list-link" '
        'title="ECS9100_V0.9.0.50 Firmware">x</a>'
    )
    p = EdgecoreProvider()
    mock_get_text(p, {DOWNLOAD_CATEGORY_URL: html})
    r = p.get_latest_firmware("Edgecore", "ECS9100", "1.0.0.50")
    assert r.status.value == "ok"
    assert r.latest_version == "1.2.0.100"


def test_no_matching_model_returns_model_not_found(mock_get_text):
    from firmware_lookup.providers.edgecore import DOWNLOAD_CATEGORY_URL

    html = (
        '<a href="/a1" class="article-list-link" '
        'title="ECS4150_V1.10.1.254.bix (2025/10/27)">x</a>'
    )
    p = EdgecoreProvider()
    mock_get_text(p, {DOWNLOAD_CATEGORY_URL: html})
    r = p.get_latest_firmware("Edgecore", "TotallyFakeEdgecoreModel9999", "1.0")
    assert r.status.value == "model_not_found"
