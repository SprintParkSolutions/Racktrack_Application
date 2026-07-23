import json

from firmware_lookup.providers.ruijie import RuijieProvider

SAMPLE_RESPONSE = json.dumps({
    "code": 0,
    "data": {
        "records": [
            {
                "title": "Ruijie RG-S5000-E Series Simplified Gigabit Switch Datasheet",
                "subContentTypeName": "Product Datasheet",
                "urlAddress": "https://www.ruijie.com/en-global/resources/preview/s5000-e-series-datasheet",
            },
            {
                "title": "Ruijie RG-S5000-E Series Switches Release Notes, RGOS 11.4(1)B88 (V1.0)",
                "subContentTypeName": "Release Note",
                "urlAddress": "https://www.ruijie.com/en-global/resources/preview/5000e-b88-releasenote",
            },
            {
                "title": "Ruijie RG-S5000-E Series Switches Release Notes, RGOS 11.4(1)B88P2 (V1.0)",
                "subContentTypeName": "Release Note",
                "urlAddress": "https://www.ruijie.com/en-global/resources/preview/rg-s5000-e-series-switches-rgos-b88p2-configuration-guide-en",
            },
            {
                "title": "Ruijie RG-S5000-E Series Switches Release Notes, RGOS 11.4(1)B88P1 (V1.0)",
                "subContentTypeName": "Release Note",
                "urlAddress": "https://www.ruijie.com/en-global/resources/preview/ruijie-rg-s5000-e-series-switches-release-notes-rgos-11-4-1-b88p1",
            },
        ],
    },
})


def test_empty_model_returns_none():
    p = RuijieProvider()
    assert p.check_public_source("Ruijie", "", "11.4(1)B88") is None


def test_post_failure_returns_none(mock_post_text):
    p = RuijieProvider()
    mock_post_text(p, None)
    assert p.check_public_source("Ruijie", "RG-S5000-E", "11.4(1)B88") is None


def test_malformed_json_returns_none(mock_post_text):
    p = RuijieProvider()
    mock_post_text(p, "not json")
    assert p.check_public_source("Ruijie", "RG-S5000-E", "11.4(1)B88") is None


def test_picks_highest_rgos_version_among_release_notes(mock_post_text):
    """Regression guard for the real API shape found live: results mix
    datasheets/guides in with Release Notes, and multiple Release Notes
    exist per model (base + patch releases) -- only Release Note titles
    are scanned, and the HIGHEST parsed RGOS version wins, not the
    first/last one in the (updateTime-sorted, not version-sorted) API
    response order."""
    p = RuijieProvider()
    mock_post_text(p, SAMPLE_RESPONSE)
    r = p.check_public_source("Ruijie", "RG-S5000-E", "11.4(1)B88")
    assert r is not None
    assert r.status.value == "ok"
    assert r.latest_version == "11.4(1)B88P2"
    assert "b88p2" in r.source_url.lower()


def test_no_release_notes_returns_none(mock_post_text):
    response = json.dumps({
        "code": 0,
        "data": {"records": [
            {
                "title": "Ruijie RG-S5000-E Series Datasheet",
                "subContentTypeName": "Product Datasheet",
                "urlAddress": "https://example.com/datasheet",
            },
        ]},
    })
    p = RuijieProvider()
    mock_post_text(p, response)
    assert p.check_public_source("Ruijie", "RG-S5000-E", "11.4(1)B88") is None
