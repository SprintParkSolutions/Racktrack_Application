"""
Westermo -- Tier 2 base (for the login safety net), with a real,
verified public source for per-model firmware version info.

VERIFIED LIVE this session: westermo.com/support/product-support/<slug>
is a real, fully public per-model support page (no login) that shows
the CURRENT firmware version directly, e.g. confirmed live for L106-F2G:
    <h4>Firmware</h4>
    <li class="file-type-fallback file-type-zip">
      <a class="register-to-download register-to-download-icon" ...>
        Firmware, WeOS v4.35.0, Release date 2026-06-09</a>
    </li>
Confirmed the model-to-URL transform is a plain, reliable, case-
insensitive lowercase of the model name (e.g. "L106-F2G" and
"l106-f2g" both 200, verified live for 3 different real models) -- a
mechanical transform, not a maintained slug table.

The version NUMBER itself is fully public; only the actual firmware
FILE download is gated -- but by an EMAIL-CAPTURE form ("Type your
email address... to receive an email including a download link"), not
an account login. That's a real, different gate shape from every other
vendor here, and not something this tool can or should automate (it
would mean submitting a real email address on the user's behalf) --
the version number itself is what's needed here, and that part is
genuinely public.

LOGIN SAFETY NET: a real, separate account-based login exists for a
"Partner Portal" (confirmed live: westermo.com/inside/login, Username/
Password fields, "Request a Partner Portal account") -- wired in as
the fallback per this project's rule, for the case a model isn't found
on the public per-model page at all. UNVERIFIED whether a Partner
Portal account actually exposes anything more for firmware lookups
specifically (no test account available) -- same honesty flag as every
other vendor using the generic authenticated path in providers/base.py.
"""
from __future__ import annotations

import re
from typing import Optional

from firmware_lookup.http_client import FirmwareHttpClient
from firmware_lookup.providers.base import BrowserAuthenticatedProvider
from firmware_lookup.result import Confidence, FirmwareResult, ok_result
from firmware_lookup.versioning import is_update_available, parse_version

PORTAL_URL_TEMPLATE = "https://www.westermo.com/support/product-support/{slug}"
HOME_URL = "https://www.westermo.com/inside/login"

# Real markup, verified live: the Firmware section's own real text,
# e.g. "Firmware, WeOS v4.35.0, Release date 2026-06-09".
_FIRMWARE_ENTRY_RE = re.compile(
    r"Firmware,\s*WeOS\s*v?(\d+(?:\.\d+)+),\s*Release date\s*([\d-]+)",
    re.IGNORECASE,
)


class WestermoProvider(BrowserAuthenticatedProvider):
    HOME_URL = HOME_URL

    def __init__(self):
        super().__init__("Westermo", PORTAL_URL_TEMPLATE)
        self.http = FirmwareHttpClient("westermo")

    def check_public_source(
        self, vendor: str, model: str, current_version: str,
    ) -> Optional[FirmwareResult]:
        if not model:
            return None

        slug = model.strip().lower()
        url = PORTAL_URL_TEMPLATE.format(slug=slug)
        html = self.http.get_text(url)
        if not html:
            return None

        match = _FIRMWARE_ENTRY_RE.search(html)
        if not match or not parse_version(match.group(1)):
            return None
        latest_version = match.group(1)
        release_date = match.group(2)

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
                "Retrieved from Westermo's public per-model support "
                f"page (no login required) -- WeOS firmware, released "
                f"{release_date}. The version number is public; the "
                "actual firmware file itself requires submitting an "
                "email address on Westermo's own site to receive a "
                "download link (not automated here)."
            ),
        )
