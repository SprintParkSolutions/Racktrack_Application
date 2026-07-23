"""
NETGEAR -- public knowledge-base sitemap, no login.

VERIFIED LIVE this session: kb.netgear.com/robots.txt advertises
`Sitemap: https://kb.netgear.com/sitemap` -- a real, public sitemap
(~5.8MB) listing every NETGEAR KB article. Many of these are firmware
announcement articles following an exact, regular URL pattern:
    kb.netgear.com/<id>/<MODEL>-Firmware-Version-<dashed-version>
e.g. confirmed real: "000038650/GS108Ev3-Firmware-Version-2-00-12",
"000038656/GS748Tv4-Firmware-Version-5-4-2-30". Multiple historical
version articles exist per model (confirmed GS108Ev3 has both an earlier
"2-00-09" and later "2-00-12" entry), proving version progression really
is tracked this way -- we take the max per model.

The literal substring "-Firmware-Version-" is a fixed, reliable delimiter:
everything before it (within the URL's last path segment) is the model
slug, everything after (with dashes converted to dots) is the version.

netgear.com's own product/support pages are a client-rendered SPA with
zero server-rendered firmware content (verified separately) -- this KB
sitemap is the only viable official static source found.
"""
from __future__ import annotations

import logging
import re
from typing import Optional

from firmware_lookup.http_client import FirmwareHttpClient
from firmware_lookup.matching import find_ambiguous_candidates, match_model
from firmware_lookup.providers.base import BrowserAuthenticatedProvider
from firmware_lookup.result import (
    FirmwareResult, Confidence, ambiguous_model, ok_result,
)
from firmware_lookup.versioning import is_update_available, parse_version

logger = logging.getLogger("firmware_lookup.providers.netgear")

SITEMAP_URL = "https://kb.netgear.com/sitemap"
DELIM = "-Firmware-Version-"
_URL_BLOCK_RE = re.compile(r"<url>(.*?)</url>", re.DOTALL)
_LOC_RE = re.compile(r"<loc>([^<]+)</loc>")
_ARTICLE_RE = re.compile(
    r"kb\.netgear\.com/\d+/([A-Za-z0-9]+)" + re.escape(DELIM) + r"([\d\-]+)$"
)


def _parse_entries(xml: str) -> dict[str, list[tuple[str, str]]]:
    """Returns {model_slug: [(version, article_url), ...]}."""
    entries: dict[str, list[tuple[str, str]]] = {}
    for block in _URL_BLOCK_RE.findall(xml):
        loc_m = _LOC_RE.search(block)
        if not loc_m:
            continue
        loc = loc_m.group(1).rstrip("/")
        art_m = _ARTICLE_RE.search(loc)
        if not art_m:
            continue
        model_raw, ver_dashed = art_m.groups()
        version = ver_dashed.replace("-", ".")
        entries.setdefault(model_raw, []).append((version, loc))
    return entries


class NetgearProvider(BrowserAuthenticatedProvider):
    # Real support hub -- verified live. Login is a SAFETY NET only:
    # NETGEAR's KB sitemap below is the vendor's own official data,
    # tried first. This login path is UNVERIFIED and best-effort, added
    # per explicit user request so there's a real fallback instead of a
    # dead end.
    HOME_URL = "https://www.netgear.com/support/"

    def __init__(self):
        super().__init__("NETGEAR", self.HOME_URL)
        # ~5.8MB sitemap: longer read timeout, and a longer TTL than the
        # default since a KB sitemap of this size doesn't need refreshing
        # every few hours to stay useful.
        self.http = FirmwareHttpClient(
            "netgear", ttl_seconds=24 * 3600, timeout=(5, 30),
        )

    def check_public_source(
        self, vendor: str, model: str, current_version: str,
    ) -> Optional[FirmwareResult]:
        xml = self.http.get_text(SITEMAP_URL)
        if not xml:
            return None

        entries = _parse_entries(xml)
        if not entries:
            return None

        if not model:
            return None

        catalog = list(entries.keys())
        matched, score, method = match_model(model, catalog)
        if method == "ambiguous":
            # A genuinely different situation from "couldn't find
            # anything" -- login wouldn't resolve which candidate is
            # right, so this is a real, immediate answer, not a
            # fall-through.
            return ambiguous_model(
                vendor, model, current_version,
                find_ambiguous_candidates(model, catalog),
                retrieval_method="docs_site_sitemap",
            )
        if not matched:
            return None

        latest_ver, article_url = max(
            entries[matched], key=lambda t: parse_version(t[0]).parts,
        )
        confidence = Confidence.HIGH if method in ("exact", "normalized") else Confidence.MEDIUM

        return ok_result(
            vendor=vendor,
            model=model,
            current_version=current_version,
            latest_version=latest_ver,
            source_url=article_url,
            confidence=confidence,
            retrieval_method="docs_site_sitemap",
            update_available=is_update_available(current_version, latest_ver),
            message=(
                "Sourced from NETGEAR's knowledge-base firmware-announcement "
                "articles, not a dedicated per-model download API -- NETGEAR "
                "may not publish a KB article for every firmware revision."
            ),
        )
