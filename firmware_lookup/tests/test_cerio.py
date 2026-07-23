import pytest


@pytest.fixture(autouse=True)
def no_live_browser_calls(monkeypatch):
    """CERIO's download portal requires a real Playwright browser
    (category-index discovery + a per-model page). Autouse + raising
    immediately keeps every test in this file fast and deterministic,
    while the real markup-parsing logic is tested directly below."""
    import playwright.sync_api as sync_api_mod

    def fake_sync_playwright():
        raise RuntimeError("no live browser calls in tests")

    monkeypatch.setattr(sync_api_mod, "sync_playwright", fake_sync_playwright)


def test_no_model_given():
    from firmware_lookup.providers.cerio import CerioProvider

    p = CerioProvider()
    r = p.get_latest_firmware("CERIO Corporation", "", "1.0")
    assert r.status.value == "cannot_determine"


def test_unexpected_browser_error_returns_cannot_determine_not_raise():
    from firmware_lookup.providers.cerio import CerioProvider

    p = CerioProvider()
    r = p.get_latest_firmware("CERIO Corporation", "CS-2424G-24P", "1.0.0")
    assert r.status.value == "cannot_determine"


def test_slug_re_real_url():
    """Regression guard: each real download-page href ends in
    /YYYY/MM/<slug>/, confirmed live for CS-2424G-24P (2017/04) and
    CS-1008XG (2025/03) -- different date prefixes, not a mechanical
    transform of the model number."""
    from firmware_lookup.providers.cerio import _SLUG_RE

    assert _SLUG_RE.search(
        "https://endl.cerio.cc/2017/04/cs-2424g-24p/",
    ).group(1) == "cs-2424g-24p"
    assert _SLUG_RE.search(
        "https://endl.cerio.cc/2025/03/cs-1008xg/",
    ).group(1) == "cs-1008xg"


def test_firmware_regex_parses_real_markup():
    """Regression guard for the real bug found live: a nested
    <span><span class="font">v1.0.2</span></span> structure needs
    (?:<[^>]+>)* to skip both opening tags, and (?:&nbsp;)? -- NOT
    &nbsp;? -- to make the whole entity optional (a bare '?' after
    '&nbsp;' only makes the trailing semicolon optional, matching
    nothing when no literal &nbsp; is present)."""
    from firmware_lookup.providers.cerio import _FIRMWARE_RE

    html = (
        'Firmware Download</span></strong></p>'
        '<table class="fortuna_table"><tbody>'
        '<tr style="height: 25px;"><th>Version</th><th>Published Date</th></tr>'
        '<tr style="height: 53px;">'
        '<td style="height: 53px;" height="59">'
        '<span style="font-family: arial;"><span class="font">v1.0.2</span></span></td>'
        '<td style="height: 53px;">'
        '<span style="font-family: arial;"><span class="font">2021.08.17</span></span></td>'
        "</tr>"
    )
    m = _FIRMWARE_RE.search(html)
    assert m is not None
    assert m.group(1) == "v1.0.2"
    assert m.group(2) == "2021.08.17"


def test_firmware_regex_no_match_returns_none():
    from firmware_lookup.providers.cerio import _FIRMWARE_RE

    assert _FIRMWARE_RE.search("<html>Specification only, no firmware</html>") is None
