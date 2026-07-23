import pytest


@pytest.fixture(autouse=True)
def no_live_browser_calls(monkeypatch):
    """IP Infusion's check_public_source() (see providers/ip_infusion.py)
    makes a REAL Playwright browser call before falling back to login --
    same pattern as Extreme/QNAP elsewhere in this suite."""
    import playwright.sync_api as sync_api_mod

    def fake_sync_playwright():
        raise RuntimeError("no live browser calls in tests")

    monkeypatch.setattr(sync_api_mod, "sync_playwright", fake_sync_playwright)


def test_check_public_source_unexpected_browser_error_never_raises():
    from firmware_lookup.providers.ip_infusion import IPInfusionProvider

    p = IPInfusionProvider()
    # Deliberately ignores the model field (see module docstring SCOPE
    # NOTE: IP Infusion sells an OS, not per-model hardware) -- still
    # must degrade safely when the browser call fails.
    assert p.check_public_source("IP Infusion", "AnyModel", "6.6") is None


def test_ga_version_regex_parses_real_page_text():
    """Regression guard for the real text found live on IP Infusion's
    public release-history page."""
    from firmware_lookup.providers.ip_infusion import _GA_VERSION_RE

    text = (
        "OcNOS 7.0\nOcNOS 7.0 is the broadest network OS release...\n"
        "OcNOS 6.6.1\nOcNOS 6.6.1 is the designated Long-Term Support release...\n"
        "OcNOS 6.6\nOcNOS 6.6 introduced the foundational SR-MPLS..."
    )
    matches = _GA_VERSION_RE.findall(text)
    assert "7.0" in matches
    assert "6.6.1" in matches
    assert "6.6" in matches


def test_ga_version_regex_picks_highest_parsed_version():
    from firmware_lookup.versioning import parse_version

    versions = ["6.6", "6.6.1", "7.0"]
    versions.sort(key=lambda v: parse_version(v), reverse=True)
    assert versions[0] == "7.0"
