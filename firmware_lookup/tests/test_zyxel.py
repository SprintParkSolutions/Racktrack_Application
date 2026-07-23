from firmware_lookup.providers.zyxel import PORTAL_URL, ZyxelProvider


def test_check_public_source_no_model_given_returns_none(mock_get_text):
    p = ZyxelProvider()
    mock_get_text(p, {})
    assert p.check_public_source("Zyxel", "", "1.0") is None


def test_check_public_source_page_fetch_failure_returns_none(mock_get_text):
    p = ZyxelProvider()
    mock_get_text(p, {})
    assert p.check_public_source("Zyxel", "GS1900-24", "2.90(AAHL.1)C0") is None


def test_check_public_source_parses_real_markup_and_picks_newest_firmware(mock_get_text):
    """Regression guard for the real markup found live: a standard
    Drupal Views table mixing every document type for a model together
    (Firmware, MIB File, Declaration, User's Guide, Datasheet, etc.),
    newest-first within each type -- scoped to rows whose own Material
    column literally says "Firmware", taking the first (newest) one,
    never a Datasheet/Declaration/Guide version number."""
    html = (
        '<td class="views-field views-field-model-name">GS1900-24        </td>'
        '<td class="views-field views-field-nothing-2">Firmware        </td>'
        '<td class="views-field views-field-field-version">2.90(AAHL.2)C0        </td>'
        '<td class="views-field views-field-field-release-date">June 12, 2026        </td>'
        '<td class="views-field views-field-model-name">GS1900-24        </td>'
        '<td class="views-field views-field-nothing-2">MIB File        </td>'
        '<td class="views-field views-field-field-version">16        </td>'
        '<td class="views-field views-field-field-release-date">June 12, 2026        </td>'
        '<td class="views-field views-field-model-name">GS1900-24        </td>'
        '<td class="views-field views-field-nothing-2">Declaration        </td>'
        '<td class="views-field views-field-field-version">010.CE DoC and Warnings        </td>'
        '<td class="views-field views-field-field-release-date">July 30, 2025        </td>'
        '<td class="views-field views-field-model-name">GS1900-24        </td>'
        '<td class="views-field views-field-nothing-2">Firmware        </td>'
        '<td class="views-field views-field-field-version">2.90(AAHL.1)C0        </td>'
        '<td class="views-field views-field-field-release-date">March 25, 2025        </td>'
    )
    p = ZyxelProvider()
    url = f"{PORTAL_URL}?model=gs1900-24"
    mock_get_text(p, {url: html})
    r = p.check_public_source("Zyxel", "GS1900-24", "2.90(AAHL.0)C0")
    assert r is not None
    assert r.status.value == "ok"
    assert r.latest_version == "2.90(AAHL.2)C0"
    assert r.source_url == url


def test_check_public_source_no_firmware_rows_returns_none(mock_get_text):
    """No real Firmware-typed row for this model on the public page --
    falls through to login (returns None) rather than asserting
    model_not_found outright, since the model may just not be listed
    here yet or may need an authenticated view."""
    html = (
        '<td class="views-field views-field-model-name">FAKE        </td>'
        '<td class="views-field views-field-nothing-2">Datasheet        </td>'
        '<td class="views-field views-field-field-version">1        </td>'
        '<td class="views-field views-field-field-release-date">Jan 1, 2020        </td>'
    )
    p = ZyxelProvider()
    url = f"{PORTAL_URL}?model=totallyfakezyxelmodel"
    mock_get_text(p, {url: html})
    assert p.check_public_source("Zyxel", "TotallyFakeZyxelModel", "1.0") is None


def test_get_latest_firmware_falls_back_to_auth_required_when_no_session(mock_get_text):
    """End-to-end: no public match and no saved session on disk ->
    honest auth_required() with the real portal link, not a crash or a
    silent model_not_found. Matches the LoginGatedProvider contract."""
    p = ZyxelProvider()
    mock_get_text(p, {})
    r = p.get_latest_firmware("Zyxel", "TotallyFakeZyxelModel", "1.0")
    assert r.status.value == "auth_required"
    assert r.source_url == PORTAL_URL or PORTAL_URL in (r.source_url or "")
