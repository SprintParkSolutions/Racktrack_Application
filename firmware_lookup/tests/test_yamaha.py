from firmware_lookup.providers.yamaha import PAGE_URL_TEMPLATE, YamahaProvider


def test_no_model_given(mock_get_text):
    p = YamahaProvider()
    mock_get_text(p, {})
    r = p.get_latest_firmware("Yamaha", "", "1.0")
    assert r.status.value == "cannot_determine"


def test_family_prefix_strips_port_config_suffix(mock_get_text):
    """Regression guard: confirmed live the real URL slug is the BASE
    model family only -- 'SWX2320-30MC' 404s at that exact slug, but
    the family prefix 'swx2320' (with the '-30MC' port/config suffix
    stripped) 200s with real content. Confirmed for 3 different real
    models this way."""
    p = YamahaProvider()
    html = "<h1>SWX2320 Firmware V2.05.22</h1>"
    url = PAGE_URL_TEMPLATE.format(slug="swx2320")
    mock_get_text(p, {url: html})
    r = p.get_latest_firmware("Yamaha", "SWX2320-30MC", "2.00.00")
    assert r.status.value == "ok"
    assert r.latest_version == "2.05.22"
    assert r.source_url == url


def test_model_with_no_suffix_used_as_is(mock_get_text):
    p = YamahaProvider()
    html = "<h1>SWX2310P Firmware V2.02.35</h1>"
    url = PAGE_URL_TEMPLATE.format(slug="swx2310p")
    mock_get_text(p, {url: html})
    r = p.get_latest_firmware("Yamaha", "SWX2310P", "2.00.00")
    assert r.status.value == "ok"
    assert r.latest_version == "2.02.35"


def test_page_fetch_failure_returns_model_not_found(mock_get_text):
    p = YamahaProvider()
    mock_get_text(p, {})
    r = p.get_latest_firmware("Yamaha", "SWX3200", "1.0")
    assert r.status.value == "model_not_found"
