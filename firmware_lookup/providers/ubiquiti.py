"""
Ubiquiti UniFi -- public JSON firmware API, no login.

Source: https://fw-update.ui.com/api/firmware?filter=eq~~channel~~release
This is the same API Ubiquiti's own controller software polls for
updates. We filter to UniFi switch platform prefixes and pick the newest
release version, optionally matched to a specific model/platform.

Model resolution order (only falls through to model_not_found after ALL
of these fail):
  1. Marketing name / alias -> platform code(s) via the curated
     ubiquiti_platform_map.py, intersected with codes actually present
     in THIS run's live API response. A unique hit is High confidence.
     If a marketing name's mapped codes include >1 present live, that's
     a genuine hardware-revision ambiguity -> ambiguous_model (never
     guessed between).
  2. Fall back to matching the raw platform code directly (covers users
     who type the internal SKU, e.g. "US24PL2").
  3. model_not_found -- never silently answer with a vendor-wide guess
     for a model that was actually named but not resolved.
"""
from __future__ import annotations

import logging
import re
from typing import Optional

from firmware_lookup.http_client import FirmwareHttpClient
from firmware_lookup.matching import find_ambiguous_candidates, match_model
from firmware_lookup.providers.base import BrowserAuthenticatedProvider
from firmware_lookup.providers.ubiquiti_platform_map import (
    UNIFI_ALIASES, UNIFI_SWITCH_PLATFORM_MAP,
)
from firmware_lookup.result import (
    Confidence, FirmwareResult, ambiguous_model, ok_result,
)
from firmware_lookup.versioning import is_update_available, parse_version

logger = logging.getLogger("firmware_lookup.providers.ubiquiti")

API = (
    "https://fw-update.ui.com/api/firmware"
    "?filter=eq~~channel~~release&limit=2000"
)
NOTES_URL = "https://community.ui.com/releases?platform=unifi-switching"
SWITCH_PREFIXES = ("US", "USL", "USW", "USC", "USXG", "USAGG", "S2")


def _resolve_via_marketing_map(
    model: str, live_platforms: set[str],
) -> tuple[list[str], str]:
    """Returns (codes_present_live, method). method is "exact"/"normalized"/
    "contains"/"fuzzy" (from matching the marketing-name catalog),
    "ambiguous" (matched a name but >1 of its codes are live), or "none"."""
    catalog = list(UNIFI_SWITCH_PLATFORM_MAP.keys()) + list(UNIFI_ALIASES.keys())
    matched, score, method = match_model(model, catalog)
    if method == "ambiguous":
        return [], "ambiguous"
    if not matched:
        return [], "none"
    canonical = UNIFI_ALIASES.get(matched, matched)
    codes = UNIFI_SWITCH_PLATFORM_MAP.get(canonical, [])
    present = [c for c in codes if c in live_platforms]
    if len(present) > 1:
        return present, "ambiguous"
    return present, method


class UbiquitiProvider(BrowserAuthenticatedProvider):
    # Real account/download portal -- verified live. Login is a SAFETY
    # NET only: Ubiquiti's public firmware API below is the vendor's
    # own official data (the same API their controller software polls),
    # tried first. This login path is UNVERIFIED and best-effort, added
    # per explicit user request so there's a real fallback instead of a
    # dead end.
    HOME_URL = "https://account.ui.com"

    def __init__(self):
        super().__init__("Ubiquiti", self.HOME_URL)
        self.http = FirmwareHttpClient("ubiquiti")

    def check_public_source(
        self, vendor: str, model: str, current_version: str,
    ) -> Optional[FirmwareResult]:
        data = self.http.get_json(API)
        if not data:
            return None
        firmwares = data.get("_embedded", {}).get("firmware", [])

        platforms: dict[str, list[str]] = {}
        best_overall: tuple[str, str] = ("", "")  # (version, platform)
        for f in firmwares:
            plat = f.get("platform") or ""
            prod = (f.get("product") or "").lower()
            if not (plat.startswith(SWITCH_PREFIXES) or "switch" in prod):
                continue
            ver = re.sub(r"[+].*$", "", (f.get("version") or "").lstrip("v"))
            if not re.match(r"^\d+\.\d+", ver):
                continue
            platforms.setdefault(plat, []).append(ver)
            if parse_version(ver) and (
                not best_overall[0] or parse_version(ver) > parse_version(best_overall[0])
            ):
                best_overall = (ver, plat)

        if not platforms:
            return None

        if not model:
            # No model given at all -- a vendor-wide "latest" answer is a
            # reasonable, honestly-labeled fallback (Low confidence).
            return ok_result(
                vendor=vendor, model=model, current_version=current_version,
                latest_version=best_overall[0], source_url=NOTES_URL,
                confidence=Confidence.LOW, retrieval_method="public_api",
                update_available=is_update_available(current_version, best_overall[0]),
            )

        # 1. Marketing-name/alias map, intersected with live platforms.
        mapped_codes, map_method = _resolve_via_marketing_map(model, set(platforms.keys()))
        if map_method == "ambiguous":
            candidates = mapped_codes or find_ambiguous_candidates(
                model, list(UNIFI_SWITCH_PLATFORM_MAP.keys()) + list(UNIFI_ALIASES.keys()),
            )
            return ambiguous_model(vendor, model, current_version, candidates, retrieval_method="public_api")
        if len(mapped_codes) == 1:
            plat = mapped_codes[0]
            latest = max(platforms[plat], key=lambda v: parse_version(v).parts)
            return ok_result(
                vendor=vendor, model=model, current_version=current_version,
                latest_version=latest, source_url=NOTES_URL,
                confidence=Confidence.HIGH, retrieval_method="public_api",
                update_available=is_update_available(current_version, latest),
            )

        # 2. Fall back to matching the raw platform code directly.
        matched_platform, score, method = match_model(model, list(platforms.keys()))
        if method == "ambiguous":
            return ambiguous_model(
                vendor, model, current_version,
                find_ambiguous_candidates(model, list(platforms.keys())),
                retrieval_method="public_api",
            )
        if matched_platform:
            latest = max(platforms[matched_platform], key=lambda v: parse_version(v).parts)
            confidence = Confidence.HIGH if method in ("exact", "normalized", "contains") else Confidence.MEDIUM
            return ok_result(
                vendor=vendor, model=model, current_version=current_version,
                latest_version=latest, source_url=NOTES_URL,
                confidence=confidence, retrieval_method="public_api",
                update_available=is_update_available(current_version, latest),
            )

        # 3. Both resolution paths failed -- honest "not found", never a
        # guess. Return None (not model_not_found directly) so this
        # falls through to the login safety net instead of dead-ending.
        return None
