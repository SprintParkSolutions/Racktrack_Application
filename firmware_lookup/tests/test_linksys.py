import pytest


@pytest.fixture(autouse=True)
def no_live_browser_calls(monkeypatch):
    """Linksys's support catalog requires a real Playwright browser
    with stealth flags (headless-Chromium fingerprint detection was
    found live to cause a false 403 -- same class of bug as Signamax).
    Autouse + raising immediately keeps every test in this file fast
    and deterministic, while the real regexes are tested directly
    below via _MODEL_LINK_RE / _FIRMWARE_RE."""
    import playwright.sync_api as sync_api_mod

    def fake_sync_playwright():
        raise RuntimeError("no live browser calls in tests")

    monkeypatch.setattr(sync_api_mod, "sync_playwright", fake_sync_playwright)


def test_no_model_given():
    from firmware_lookup.providers.linksys import LinksysProvider

    p = LinksysProvider()
    r = p.get_latest_firmware("Linksys", "", "1.0")
    assert r.status.value == "cannot_determine"


def test_unexpected_browser_error_returns_cannot_determine_not_raise():
    from firmware_lookup.providers.linksys import LinksysProvider

    p = LinksysProvider()
    r = p.get_latest_firmware("Linksys", "LGS310C", "1.0.0")
    assert r.status.value == "cannot_determine"


def test_model_link_re_real_markup():
    """Regression guard: the category page's link text is literally
    'Linksys <MODEL> Support' -- a separate near-identical '<MODEL>
    FAQs' link also exists per model and must NOT match."""
    from firmware_lookup.providers.linksys import _MODEL_LINK_RE

    assert _MODEL_LINK_RE.match("Linksys LGS310C Support").group(1) == "LGS310C"
    assert _MODEL_LINK_RE.match("Linksys LGS310C FAQs") is None


def test_firmware_regex_parses_real_rendered_text_variant_one():
    """Regression guard for the real mistake caught live: an earlier
    version of this provider was registered as 'no viable path' after
    checking a DIFFERENT article (LGS328C's, which genuinely has no
    Downloads section -- it links only a fake UI Simulator instead). A
    user's push to keep investigating (starting from our own fallback
    link rather than a guessed URL) found LGS310C's and LGS352C's real
    articles DO have a genuine, differentiated Firmware section --
    matched against RENDERED TEXT (page.inner_text), the same shape
    LGS310C's <p><span> markup renders to."""
    from firmware_lookup.providers.linksys import _FIRMWARE_RE

    text = "LGS310C Downloads\nFirmware\nVer. 1.01.02.02\nLatest Date: 6/02/2022"
    m = _FIRMWARE_RE.search(text)
    assert m is not None
    assert m.group(1) == "1.01.02.02"
    assert m.group(2) == "6/02/2022"


def test_firmware_regex_parses_real_rendered_text_variant_two():
    """Regression guard for a SECOND real bug caught testing the fix
    above: LGS352C's real Downloads block uses <li> list items, not
    LGS310C's <p><span> paragraphs -- a raw-HTML regex tuned to one
    structure silently failed on the other, model_not_found-ing a
    model that genuinely has real data. Matching rendered text instead
    of markup covers both real structures with one pattern."""
    from firmware_lookup.providers.linksys import _FIRMWARE_RE

    text = "LGS352C Downloads\nFirmware\nVer. 1.01.02.01\nLatest Date: 5/30/2023"
    m = _FIRMWARE_RE.search(text)
    assert m is not None
    assert m.group(1) == "1.01.02.01"
    assert m.group(2) == "5/30/2023"


def test_firmware_regex_no_match_for_genuine_gap():
    """Regression guard for the real, confirmed HONEST gap: LGS328C's
    article has no Downloads/Firmware section at all -- must stay
    model_not_found, not be mistaken for a bug."""
    from firmware_lookup.providers.linksys import _FIRMWARE_RE

    text = "Setup Guide\nFirmware\nReboot\nReset"
    assert _FIRMWARE_RE.search(text) is None
