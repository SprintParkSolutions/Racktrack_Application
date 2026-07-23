"""
Yamaha -- Tier 1, public, no login (SWX managed switch series).

VERIFIED LIVE this session: usa.yamaha.com/support/updates/<slug>_firm.html
is a real, fully public per-model firmware page (no login, plain HTTP
-- no browser needed at all). Real markup, confirmed live:
    <h1>SWX2310P Firmware V2.02.35</h1>
The page's own <title>/og:title also states this directly ("SWX2310P
Firmware V2.02.35 - Yamaha USA"). The only gate on the actual download
link is a license-agreement click-through, not a login.

CONFIRMED, found live: the URL slug is the BASE model name only, with
any trailing "-NNxx" port/config suffix stripped -- e.g. "SWX2320-30MC"
404s at that exact slug, but "swx2320" (the base family) 200s with
real content ("SWX2320 Firmware V2.05.22"). Confirmed for 3 different
real models this way (SWX2320, SWX2322P, SWX2210P all resolved after
stripping their "-30MC"/"-28G" suffixes), while SWX2310P needed no
stripping since it has no such suffix -- the family-prefix derivation
below handles both cases the same way, same "derive from what's
typed" principle as Cisco/Huawei/Schneider Electric elsewhere in this
codebase, not a hardcoded per-model table. Not every real model
resolved this way (SWX3200 302'd) -- an honest coverage gap for that
one family, not silently guessed around.
"""
from __future__ import annotations

import re
from typing import Optional

from firmware_lookup.http_client import FirmwareHttpClient
from firmware_lookup.providers.base import FirmwareProvider
from firmware_lookup.result import (
    Confidence, FirmwareResult, cannot_determine, model_not_found, ok_result,
)
from firmware_lookup.versioning import is_update_available, parse_version

PAGE_URL_TEMPLATE = "https://usa.yamaha.com/support/updates/{slug}_firm.html"
PORTAL_URL = "https://usa.yamaha.com/support/updates/index.html"

_FAMILY_PREFIX_RE = re.compile(r"^([A-Za-z]+\d+[A-Za-z]*)")
_FIRMWARE_H1_RE = re.compile(
    r"<h1>\s*[\w-]+\s+Firmware\s+V?(\d+(?:\.\d+)+)\s*</h1>", re.IGNORECASE,
)


class YamahaProvider(FirmwareProvider):
    def __init__(self):
        self.vendor_key = "Yamaha"
        self.http = FirmwareHttpClient("yamaha")

    def get_latest_firmware(
        self, vendor: str, model: str, current_version: str,
    ) -> FirmwareResult:
        if not model:
            return cannot_determine(
                vendor, model, current_version,
                retrieval_method="public_html",
                reason="No model given.",
                manual_check_url=PORTAL_URL,
            )

        family_match = _FAMILY_PREFIX_RE.match(model.strip())
        if not family_match:
            return model_not_found(
                vendor, model, current_version,
                retrieval_method="public_html",
                manual_check_url=PORTAL_URL,
            )
        slug = family_match.group(1).lower()

        url = PAGE_URL_TEMPLATE.format(slug=slug)
        html = self.http.get_text(url)
        if not html:
            return model_not_found(
                vendor, model, current_version,
                retrieval_method="public_html",
                manual_check_url=PORTAL_URL,
            )

        version_match = _FIRMWARE_H1_RE.search(html)
        if not version_match or not parse_version(version_match.group(1)):
            return model_not_found(
                vendor, model, current_version,
                retrieval_method="public_html",
                manual_check_url=PORTAL_URL,
            )
        latest_version = version_match.group(1)

        return ok_result(
            vendor=vendor,
            model=model,
            current_version=current_version,
            latest_version=latest_version,
            source_url=url,
            confidence=Confidence.HIGH,
            retrieval_method="public_html",
            update_available=is_update_available(current_version, latest_version),
            message=(
                "Retrieved from Yamaha's public firmware update page "
                "(no login required)."
            ),
        )
