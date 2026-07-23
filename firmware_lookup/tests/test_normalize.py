import pytest

from firmware_lookup.normalize import normalize_vendor


@pytest.mark.parametrize("raw,expected", [
    ("Juniper Networks", "Juniper"),
    ("Arista Networks", "Arista"),
    ("Dell Technologies", "Dell"),
    ("HPE Aruba Networking", "Aruba"),
    ("Ubiquiti Networks", "Ubiquiti"),
    ("Buffalo Technology", "Buffalo"),
    ("Buffalo", "Buffalo"),
    ("cisco", "Cisco"),
    ("MIKROTIK", "MikroTik"),
    ("  Juniper  ", "Juniper"),
])
def test_known_aliases_resolve(raw, expected):
    assert normalize_vendor(raw) == expected


def test_unrecognized_vendor_returns_none_not_raises():
    assert normalize_vendor("Totally Unknown Vendor Corp") is None
    assert normalize_vendor("") is None
    assert normalize_vendor(None) is None


def test_every_registered_provider_has_a_working_alias():
    """Regression guard for a real bug found live: EtherWAN, Korenix,
    and StarTech were registered as real providers (with a real
    manual_check_url each) but had NO normalize.py alias for their own
    canonical name -- normalize_vendor() silently returned None for
    them, so the orchestrator fell through to its generic
    not_implemented() with no link at all, even though the provider
    itself had a real, correct one. A provider that exists but can
    never actually be reached by name is effectively dead code -- this
    confirms every canonical PROVIDERS key resolves back to itself
    (case-insensitively), the same way a customer would type it."""
    from firmware_lookup.providers import build_providers

    for canonical_name in build_providers():
        assert normalize_vendor(canonical_name) == canonical_name, (
            f"{canonical_name!r} is registered as a provider but has no "
            f"working normalize.py alias for its own name -- it can "
            f"never actually be looked up."
        )
