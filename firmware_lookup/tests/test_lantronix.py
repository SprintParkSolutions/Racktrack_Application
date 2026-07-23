from firmware_lookup.providers.lantronix import (
    _FIRMWARE_SECTION_RE, _product_page_url, _VERSION_TOKEN_RE,
)


def test_product_page_url_is_a_plain_lowercase_transform():
    """Regression guard: confirmed live for 2 real models
    (SM24TBT4XPA, SM8TBT2SA) that the product URL is just the model
    lowercased, no other transform needed."""
    assert _product_page_url("SM24TBT4XPA") == "https://www.lantronix.com/products/sm24tbt4xpa/"
    assert _product_page_url("SM8TBT2SA") == "https://www.lantronix.com/products/sm8tbt2sa/"


def test_firmware_section_regex_isolates_locked_block_from_real_markup():
    """Regression guard for the real markup found live: the section is
    bounded so an adjacent 'Webinars' downloads-group is never scanned
    as if it were part of Firmware Downloads."""
    html = (
        '<div class="downloads-group">'
        '<div class="group-title">Firmware Downloads</div>'
        '<div class="group-items" style="display: none;">'
        '<div class="download"><div class="file-type locked"></div>'
        '<div class="title"><div class="wysiwyg-content"><p><span>'
        "Keep your products up to date by downloading the latest "
        "firmware. You must <a href=\"...\">log in or create a "
        "MyLantronix account</a> to download firmware.</span></p>"
        "</div></div></div></div></div>"
        '<div class="downloads-group">'
        '<div class="group-title">Webinars</div>'
        '<div class="group-items">99.99.99 should never be matched</div>'
        "</div>"
    )
    m = _FIRMWARE_SECTION_RE.search(html)
    assert m is not None
    section = m.group(1)
    assert "must" in section.lower() and "log in" in section.lower()
    assert "99.99.99" not in section


def test_version_token_regex_matches_plausible_firmware_string():
    """Regression guard for a real regex-boundary bug found repeatedly
    elsewhere in this codebase (Dell, Cisco Catalyst/Nexus): \\b doesn't
    exist between two \\w characters, so a naive \\b\\d+ pattern would
    silently skip the leading digit(s) whenever a 'v' immediately
    precedes them with no separator (e.g. 'v2.4.1' -> wrongly matching
    just '4.1'). The capturing group must exclude the 'v' itself."""
    assert _VERSION_TOKEN_RE.search("Firmware v2.4.1 available").group(1) == "2.4.1"
    assert _VERSION_TOKEN_RE.search("Firmware 2.4.1 available").group(1) == "2.4.1"
    assert _VERSION_TOKEN_RE.search("no version here") is None
