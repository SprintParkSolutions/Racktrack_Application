"""
MikroTik RouterOS -- public changelog mirror, no login.

Channel pointer file: https://upgrade.mikrotik.com/routeros/NEWEST7.<channel>
Returns "<version> <unix-timestamp>". VERIFIED LIVE this project: the
NEWEST7.stable and NEWEST7.testing pointer files are STALE on MikroTik's
own server (Last-Modified stuck at Nov 2023, frozen at "7.12.1"), while
real releases have shipped well past that -- verified
.../7.23.2/CHANGELOG returns 200 and .../7.23.3/CHANGELOG 404s. NEWEST6.*
pointers DO tick live, proving the mechanism still works in general --
it's specifically the v7 pointer that's abandoned/broken on their side.

Fix: treat the pointer as a FLOOR hint only. Discover the true ceiling by
probing .../<version>/CHANGELOG existence (a real 200 body vs a 404),
which is the actual source of truth MikroTik's own site still serves.
Bounded algorithm (worst case ~16 requests cold, 0 on a cache hit since
these all flow through the normal TTL cache):
  1. exponentially expand the minor version until a 404
  2. binary-search the exact minor boundary
  3. linearly probe patch levels 0..N (capped) within that minor
"""
from __future__ import annotations

import logging
import re
from typing import Optional

from firmware_lookup.http_client import FirmwareHttpClient
from firmware_lookup.providers.base import BrowserAuthenticatedProvider
from firmware_lookup.result import Confidence, FirmwareResult, ok_result
from firmware_lookup.versioning import is_update_available, parse_version

logger = logging.getLogger("firmware_lookup.providers.mikrotik")

BASE = "https://upgrade.mikrotik.com/routeros"
CHANNEL_FILES = {
    "stable": "NEWEST7.stable",
    "long-term": "NEWEST7.long-term",
    "testing": "NEWEST7.testing",
}
MAX_PATCH_PROBE = 20
MAX_MINOR_EXPANSION_STEPS = 8


def _fetch_pointer(http: FirmwareHttpClient, channel_file: str) -> Optional[str]:
    """GET {BASE}/{channel_file}; parse the leading '<major>.<minor>...'
    version token. Returns None if unreadable or the placeholder '0.00'."""
    text = http.get_text(f"{BASE}/{channel_file}")
    if not text:
        return None
    token = text.strip().split()[0] if text.strip() else ""
    if not re.match(r"^[1-9]\d*\.\d+", token):
        return None
    return token


def _changelog_exists(http: FirmwareHttpClient, version: str) -> bool:
    text = http.get_text(f"{BASE}/{version}/CHANGELOG")
    return bool(text) and "what's new in" in text.lower()


def _minor_ceiling(http: FirmwareHttpClient, major: int, floor_minor: int) -> int:
    """Exponentially expand from a known-good floor_minor until a 404,
    then binary-search the exact boundary. Returns the highest minor
    confirmed to exist."""
    good = floor_minor
    step = 1
    probed = 0
    while probed < MAX_MINOR_EXPANSION_STEPS:
        candidate = good + step
        if _changelog_exists(http, f"{major}.{candidate}"):
            good = candidate
            step *= 2
        else:
            # candidate is a confirmed-bad upper bound -- binary search
            # between `good` (known good) and `candidate` (known bad).
            lo, hi = good, candidate
            while hi - lo > 1:
                mid = (lo + hi) // 2
                if _changelog_exists(http, f"{major}.{mid}"):
                    lo = mid
                else:
                    hi = mid
            return lo
        probed += 1
    return good


def _patch_ceiling(http: FirmwareHttpClient, major: int, minor: int) -> int:
    """Linear probe patch 0..MAX_PATCH_PROBE within the discovered minor,
    stop at the first 404. Patch 0 means the bare 'major.minor' release
    (no patch suffix)."""
    highest = 0
    for patch in range(1, MAX_PATCH_PROBE + 1):
        if _changelog_exists(http, f"{major}.{minor}.{patch}"):
            highest = patch
        else:
            break
    return highest


class MikroTikProvider(BrowserAuthenticatedProvider):
    # Real, human-browsable client area -- verified live (HTTP 200/301).
    # Login is a SAFETY NET only: MikroTik's public changelog probe below
    # is the vendor's own official data, tried first and used whenever
    # it succeeds. This login path is UNVERIFIED and best-effort (no
    # evidence logging in reveals anything the public probe doesn't) --
    # added so there's still a real fallback option instead of a dead
    # end if the public probe ever fails, per explicit user request.
    HOME_URL = "https://mikrotik.com/client"

    def __init__(self):
        super().__init__("MikroTik", self.HOME_URL)
        self.http = FirmwareHttpClient("mikrotik")

    def check_public_source(
        self, vendor: str, model: str, current_version: str,
    ) -> Optional[FirmwareResult]:
        stable_floor = _fetch_pointer(self.http, CHANNEL_FILES["stable"])
        if not stable_floor:
            return None

        floor_parsed = parse_version(stable_floor)
        if not floor_parsed or len(floor_parsed.parts) < 2:
            return None
        major, floor_minor = floor_parsed.parts[0][0], floor_parsed.parts[1][0]

        minor = _minor_ceiling(self.http, major, floor_minor)
        patch = _patch_ceiling(self.http, major, minor)
        latest_version = f"{major}.{minor}" if patch == 0 else f"{major}.{minor}.{patch}"
        source_url = f"{BASE}/{latest_version}/CHANGELOG"

        message = "Channel: stable."
        # "Never return a latest version older than current unless the
        # source explicitly indicates a newer channel" -- if the user's
        # current version is already ahead of our discovered stable
        # ceiling, check testing before just saying "up to date".
        cur_parsed = parse_version(current_version)
        latest_parsed = parse_version(latest_version)
        if cur_parsed and latest_parsed and cur_parsed > latest_parsed:
            testing = _fetch_pointer(self.http, CHANNEL_FILES["testing"])
            testing_parsed = parse_version(testing) if testing else None
            if testing_parsed and testing_parsed >= cur_parsed:
                message = (
                    f"Channel: stable (latest verified: {latest_version}). "
                    f"Your current version is ahead of stable -- the testing "
                    f"channel currently shows {testing}, which may be what "
                    f"you're running."
                )
            else:
                message = (
                    f"Channel: stable (latest verified: {latest_version}). "
                    f"Your current version {current_version} is ahead of "
                    f"the highest version we could verify on any channel."
                )

        return ok_result(
            vendor=vendor,
            model=model,
            current_version=current_version,
            latest_version=latest_version,
            source_url=source_url,
            confidence=Confidence.HIGH,
            retrieval_method="public_api_changelog_probe",
            update_available=is_update_available(current_version, latest_version),
            message=message,
        )
