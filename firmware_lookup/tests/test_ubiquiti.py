from firmware_lookup.providers.ubiquiti import API, UbiquitiProvider


def _fake_api_response(entries):
    """entries: list of (platform, version)"""
    return {
        "_embedded": {
            "firmware": [
                {"platform": plat, "product": "unifi-firmware", "version": f"v{ver}"}
                for plat, ver in entries
            ]
        }
    }


def test_marketing_name_resolves_via_platform_map(mock_get_json):
    p = UbiquitiProvider()
    mock_get_json(p, {API: _fake_api_response([
        ("US24P250", "6.2.14"), ("US24P250", "6.5.0"),
    ])})
    r = p.get_latest_firmware("Ubiquiti", "USW-24-PoE", "6.0.0")
    assert r.status.value == "ok"
    assert r.latest_version == "6.5.0"
    assert r.confidence.value == "High"


def test_raw_platform_code_still_works(mock_get_json):
    p = UbiquitiProvider()
    mock_get_json(p, {API: _fake_api_response([("US24PL2", "6.2.14")])})
    r = p.get_latest_firmware("Ubiquiti", "US24PL2", "6.0.0")
    assert r.status.value == "ok"
    assert r.latest_version == "6.2.14"


def test_fake_model_refused_never_guesses(mock_get_json):
    p = UbiquitiProvider()
    mock_get_json(p, {API: _fake_api_response([("US24P250", "6.5.0")])})
    # check_public_source() must return None (not a direct status) on a
    # genuine no-match so the login safety net gets a chance -- never a
    # silent guess either way.
    assert p.check_public_source("Ubiquiti", "TotallyFakeModel9999", "1.0") is None


def test_no_model_gives_low_confidence_vendor_wide(mock_get_json):
    p = UbiquitiProvider()
    mock_get_json(p, {API: _fake_api_response([("US24P250", "6.5.0")])})
    r = p.get_latest_firmware("Ubiquiti", "", "1.0")
    assert r.status.value == "ok"
    assert r.confidence.value == "Low"


def test_network_failure(mock_get_json):
    p = UbiquitiProvider()
    mock_get_json(p, {})
    assert p.check_public_source("Ubiquiti", "USW-24-PoE", "1.0") is None
