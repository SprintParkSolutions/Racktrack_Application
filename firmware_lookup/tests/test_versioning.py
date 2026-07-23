"""
Version comparison coverage across every vendor format named in the
spec: Cisco, Juniper, Fortinet, Huawei, Aruba, NVIDIA, MikroTik, TP-Link,
NETGEAR, MOXA.
"""
import pytest

from firmware_lookup.versioning import (
    compare_versions, is_update_available, parse_version,
)


@pytest.mark.parametrize("older,newer", [
    # Cisco classic IOS parenthetical style
    ("15.2(7)E9", "15.2(7)E10"),
    ("15.2(6)E1", "15.2(7)E10"),
    # Juniper Junos
    ("18.4R1", "18.4R2"),
    ("18.4R1-S2", "18.4R1-S3"),
    # Fortinet
    ("7.0.5", "7.0.6"),
    ("7.6.7", "8.0.0"),
    # Huawei VRP
    ("V200R019C10SPC500", "V200R021C00SPC100"),
    ("V200R019C10", "V200R019C10SPC500"),
    # Aruba (ArubaOS-CX)
    ("10.13.1000", "10.13.1010"),
    # NVIDIA / Cumulus -- numeric, not string, sort (5.9 < 5.10 numerically)
    ("5.9.0", "5.10.0"),
    # MikroTik
    ("7.12.1", "7.23.2"),
    # TP-Link
    ("1.0.1", "1.0.2"),
    # NETGEAR
    ("2.00.09", "2.00.12"),
    ("5.4.2.9", "5.4.2.30"),
    # MOXA
    ("4.3", "4.4"),
])
def test_older_less_than_newer(older, newer):
    assert compare_versions(older, newer) == -1
    assert compare_versions(newer, older) == 1
    assert is_update_available(older, newer) is True
    assert is_update_available(newer, older) is False


def test_equal_versions():
    assert compare_versions("7.12.1", "7.12.1") == 0
    assert is_update_available("7.12.1", "7.12.1") is False


def test_unparseable_never_coerced():
    assert parse_version("") is None
    assert parse_version("not-a-version") is None
    assert compare_versions("garbage", "1.2.3") is None
    assert compare_versions("1.2.3", "garbage") is None
    assert is_update_available("garbage", "1.2.3") is None
    assert is_update_available("1.2.3", "garbage") is None
