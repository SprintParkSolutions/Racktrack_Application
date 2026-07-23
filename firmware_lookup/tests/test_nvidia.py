from firmware_lookup.providers.nvidia import BASE, SITEMAP_URL, NvidiaProvider
from firmware_lookup.tests.conftest import sample_html


def test_uses_sitemap_not_brute_force(mock_get_text):
    """Regression guard for Item 2: only the sitemap + the single highest
    slug's page should be requested -- never a brute-forced range."""
    p = NvidiaProvider()
    requested = []

    def fake_get_text(url, **kw):
        requested.append(url)
        if url == SITEMAP_URL:
            return sample_html("nvidia_sitemap.xml")
        if url == f"{BASE}/cumulus-linux-516/Whats-New/":
            return sample_html("nvidia_whats_new.html")
        return None

    p.http.get_text = fake_get_text
    r = p.get_latest_firmware("NVIDIA", "Cumulus Linux", "5.9.0")
    assert r.status.value == "ok"
    assert r.latest_version == "5.16.5"
    assert r.confidence.value == "Medium"
    # Exactly 2 requests: sitemap + the one highest-ranked slug's page.
    assert requested == [SITEMAP_URL, f"{BASE}/cumulus-linux-516/Whats-New/"]


def test_sitemap_fetch_failure(mock_get_text):
    p = NvidiaProvider()
    mock_get_text(p, {})
    # check_public_source() must return None (not a direct status) on
    # failure so the login safety net gets a chance.
    assert p.check_public_source("NVIDIA", "Cumulus Linux", "5.9.0") is None


def test_falls_back_to_next_slug_on_parse_failure(mock_get_text):
    p = NvidiaProvider()

    def fake_get_text(url, **kw):
        if url == SITEMAP_URL:
            return sample_html("nvidia_sitemap.xml")
        if url == f"{BASE}/cumulus-linux-516/Whats-New/":
            return "<html>no matching header here</html>"
        if url == f"{BASE}/cumulus-linux-59/Whats-New/":
            return "<h2>What's New in Cumulus Linux 5.9.0</h2>"
        return None

    p.http.get_text = fake_get_text
    r = p.get_latest_firmware("NVIDIA", "Cumulus Linux", "5.0.0")
    assert r.status.value == "ok"
    assert r.latest_version == "5.9.0"
