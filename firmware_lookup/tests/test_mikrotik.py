from firmware_lookup.providers.mikrotik import BASE, MikroTikProvider


def _fake_mikrotik_server(stable_pointer="7.12.1", ceiling_minor=20, ceiling_patch=3,
                           testing_pointer=None):
    """Simulates MikroTik's real (buggy) setup: NEWEST7.stable is stuck
    at `stable_pointer`, but CHANGELOG files actually exist all the way
    up to major.<ceiling_minor>.<ceiling_patch>."""
    major = int(stable_pointer.split(".")[0])

    def fake_get_text(url, **kw):
        if url == f"{BASE}/NEWEST7.stable":
            return f"{stable_pointer} 1700221125"
        if url == f"{BASE}/NEWEST7.testing":
            return f"{testing_pointer} 1700221125" if testing_pointer else f"{stable_pointer} 1700221125"
        if url.endswith("/CHANGELOG"):
            version = url[len(BASE) + 1: -len("/CHANGELOG")]
            parts = version.split(".")
            minor = int(parts[1])
            patch = int(parts[2]) if len(parts) > 2 else 0
            if minor > ceiling_minor or (minor == ceiling_minor and patch > ceiling_patch):
                return None  # 404
            return f"What's new in {version} (2026-May-25 12:05):\n*) fake entry;"
        return None

    return fake_get_text


def test_discovers_ceiling_past_stale_pointer(mock_get_text_fn):
    """Regression guard for Item 1: even though the stable pointer is
    stuck at 7.12.1, real CHANGELOGs exist up to 7.20.3 -- must discover
    that, not trust the stale pointer."""
    p = MikroTikProvider()
    mock_get_text_fn(p, _fake_mikrotik_server(ceiling_minor=20, ceiling_patch=3))
    r = p.get_latest_firmware("MikroTik", "RB5009", "7.15")
    assert r.status.value == "ok"
    assert r.latest_version == "7.20.3"
    assert r.confidence.value == "High"
    assert "Channel: stable" in r.message


def test_bare_minor_no_patch(mock_get_text_fn):
    p = MikroTikProvider()
    mock_get_text_fn(p, _fake_mikrotik_server(ceiling_minor=15, ceiling_patch=0))
    r = p.get_latest_firmware("MikroTik", "RB5009", "7.10")
    assert r.latest_version == "7.15"


def test_current_ahead_of_stable_names_testing_channel(mock_get_text_fn):
    p = MikroTikProvider()
    mock_get_text_fn(p, _fake_mikrotik_server(
        ceiling_minor=15, ceiling_patch=0, testing_pointer="7.30.0",
    ))
    r = p.get_latest_firmware("MikroTik", "RB5009", "7.25.0")
    assert r.status.value == "ok"
    assert r.update_available is False
    assert "testing channel currently shows 7.30.0" in r.message


def test_network_failure(mock_get_text):
    p = MikroTikProvider()
    mock_get_text(p, {})  # pointer fetch fails
    # check_public_source() must return None (not a direct status) on
    # failure so the login safety net gets a chance -- see base.py.
    assert p.check_public_source("MikroTik", "RB5009", "7.15") is None
