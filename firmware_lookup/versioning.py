"""
Self-contained version parsing/comparison. No imports from the old
firmware.py — this module has zero coupling to the legacy system.

Handles: 17.3.4, 5.0.1, 10.2R3, 10.2R3-S2 (Junos), 4.31.2F (Arista EOS),
10.13.1000 (ArubaOS-CX), 5.7.0 (Cumulus), and classic Cisco IOS
parenthetical style like 15.2(7)E10.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Optional

_VERSION_TOKEN = re.compile(r"(\d+)([A-Za-z]*)")


@dataclass(frozen=True)
class Version:
    raw: str
    parts: tuple

    def __lt__(self, other: "Version") -> bool:
        return self.parts < other.parts

    def __le__(self, other: "Version") -> bool:
        return self.parts <= other.parts

    def __gt__(self, other: "Version") -> bool:
        return self.parts > other.parts

    def __ge__(self, other: "Version") -> bool:
        return self.parts >= other.parts

    def __eq__(self, other) -> bool:
        if not isinstance(other, Version):
            return NotImplemented
        return self.parts == other.parts

    def __hash__(self) -> int:
        return hash(self.parts)

    def __str__(self) -> str:
        return self.raw


def parse_version(s: str) -> Optional[Version]:
    """Parse a vendor firmware version string into a comparable Version.
    Returns None if no version-like tokens are found."""
    if not s or not isinstance(s, str):
        return None
    s = s.strip()
    # Classic Cisco IOS style "15.2(7)E10" -> normalize parens to dots so
    # "(7)" tokenizes as a plain numeric component instead of being skipped.
    normalized = re.sub(r"[()]", ".", s)
    tokens = _VERSION_TOKEN.findall(normalized)
    if not tokens:
        return None
    parts = []
    for num, letter in tokens:
        try:
            parts.append((int(num), letter.upper()))
        except ValueError:
            continue
    if not parts:
        return None
    return Version(raw=s, parts=tuple(parts))


def compare_versions(a: str, b: str) -> Optional[int]:
    """Compare two version strings. Returns -1, 0, 1, or None if either
    side is unparseable."""
    va, vb = parse_version(a), parse_version(b)
    if va is None or vb is None:
        return None
    if va < vb:
        return -1
    if va > vb:
        return 1
    return 0


def is_update_available(current: str, latest: str) -> Optional[bool]:
    """True/False, or None if either version couldn't be parsed — callers
    must treat None as 'cannot determine', never coerce it to False."""
    cmp = compare_versions(current, latest)
    if cmp is None:
        return None
    return cmp < 0
