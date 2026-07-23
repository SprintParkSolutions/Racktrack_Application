"""
NVIDIA Cumulus Linux -- public docs site, no login.

VERIFIED LIVE: https://docs.nvidia.com/networking-ethernet-software/
sitemap.xml is a real, public sitemap listing every actual existing
cumulus-linux-NN documentation slug (confirmed set matches exactly what
brute-force probing found, with a confirmed ceiling of 516 and no 517+
present). Fetching this ONE sitemap and taking the max slug replaces
brute-forcing ~28 candidate slugs (most of which 404) -- typically 2
requests total instead of ~28, and it's TTL-cached like any other
request, satisfying "cache discovered versions" without new machinery.
"""
from __future__ import annotations

import logging
import re
from typing import Optional

from firmware_lookup.http_client import FirmwareHttpClient
from firmware_lookup.providers.base import BrowserAuthenticatedProvider
from firmware_lookup.result import Confidence, FirmwareResult, ok_result
from firmware_lookup.versioning import is_update_available, parse_version

logger = logging.getLogger("firmware_lookup.providers.nvidia")

BASE = "https://docs.nvidia.com/networking-ethernet-software"
SITEMAP_URL = f"{BASE}/sitemap.xml"
_SLUG_RE = re.compile(r"cumulus-linux-(\d+)")
HDR_RE = re.compile(
    r"What.{1,3}s New in Cumulus Linux\s+(\d+\.\d+(?:\.\d+)?)",
    re.IGNORECASE,
)
# How many of the highest-ranked slugs to try before giving up -- a small
# bound in case the single highest slug's page fails to parse for some
# reason (e.g. a doc restructure), without going back to brute force.
MAX_SLUG_ATTEMPTS = 3


def _slug_key(slug: str) -> tuple[int, int]:
    """'516' -> (5, 16); '59' -> (5, 9). First digit is major, the rest
    is minor (matches the site's own cumulus-linux-<major><minor> slug
    convention, verified against the real sitemap contents)."""
    return (int(slug[0]), int(slug[1:]))


def _discover_slugs(http: FirmwareHttpClient) -> list[str]:
    xml = http.get_text(SITEMAP_URL)
    if not xml:
        return []
    slugs = sorted(set(_SLUG_RE.findall(xml)), key=_slug_key, reverse=True)
    return slugs


class NvidiaProvider(BrowserAuthenticatedProvider):
    # Real support portal -- verified live. Login is a SAFETY NET only:
    # NVIDIA's docs sitemap below is the vendor's own official data,
    # tried first. This login path is UNVERIFIED and best-effort, added
    # per explicit user request so there's a real fallback instead of a
    # dead end.
    HOME_URL = "https://support.nvidia.com"

    def __init__(self):
        super().__init__("NVIDIA", self.HOME_URL)
        self.http = FirmwareHttpClient("nvidia")

    def check_public_source(
        self, vendor: str, model: str, current_version: str,
    ) -> Optional[FirmwareResult]:
        slugs = _discover_slugs(self.http)
        if not slugs:
            return None

        best_version = ""
        best_url = ""
        for slug in slugs[:MAX_SLUG_ATTEMPTS]:
            url = f"{BASE}/cumulus-linux-{slug}/Whats-New/"
            html = self.http.get_text(url)
            if not html:
                continue
            for m in HDR_RE.finditer(html):
                ver = m.group(1)
                parsed = parse_version(ver)
                if parsed and (not best_version or parsed > parse_version(best_version)):
                    best_version, best_url = ver, url
            if best_version:
                break  # the highest-ranked slug that actually parsed -- stop

        if not best_version:
            return None

        return ok_result(
            vendor=vendor,
            model=model,
            current_version=current_version,
            latest_version=best_version,
            source_url=best_url,
            confidence=Confidence.MEDIUM,
            retrieval_method="docs_site_sitemap",
            update_available=is_update_available(current_version, best_version),
        )
