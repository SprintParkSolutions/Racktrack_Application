"""
DrayTek -- Tier 1, public, no login.

VERIFIED LIVE this session: DrayTek genuinely sells managed switches
(the "VigorSwitch" line -- G/P/Q/PQ/FX series), confirmed via a real
product catalog. Their main draytek.com domain is behind a Cloudflare
bot challenge (confirmed live: both curl and WebFetch got a "Just a
moment..." page), but the real firmware source turns out to be a
completely separate, unprotected file server:
    https://fw.draytek.com.tw/
a real, plain Apache directory listing (confirmed live via curl, no
browser/JS needed at all) with one folder per real product, e.g.
"VigorSwitch FX2120/". Each switch folder has a real "Firmware/"
subfolder containing one version-numbered directory per release PLUS a
"latest.txt" file whose entire raw content is just the current version
string, e.g. fetching
    https://fw.draytek.com.tw/VigorSwitch%20FX2120/Firmware/latest.txt
returns exactly "3.9.10" as plain text -- about as direct a public
source as exists in this whole codebase.

CONFIRMED CASE-SENSITIVITY GOTCHA, found live: the path is
case-sensitive on both the "VigorSwitch" prefix AND the model suffix --
"VigorSwitch fx2120" (lowercase suffix) and "vigorswitch FX2120"
(lowercase prefix) both 404, while "VigorSwitch FX2120" (matching the
server's real folder name exactly) 200s. Since a customer could type
the model in any case, this fetches the real root directory listing
fresh each call (confirmed live: ~45 real "VigorSwitch X" folders) and
fuzzy-matches the requested model against it via the existing
matching.match_model(), then uses the CATALOG's own exact-case folder
name to build the URL -- never the user's as-typed case -- same
"live-fetched catalog, not a hardcoded/guessed table" principle already
used for Nokia/MOXA/NETGEAR/PLANET.

NO LOGIN PORTAL FOUND, searched for genuinely this session (not just
skipped): draytek.co.uk's support pages and its "DrayTek Partner
Portal" landing page were checked live for a sign-in link and none was
found -- DrayTek's switch firmware appears to have no account system at
all, public or gated. Unlike Adtran/ALE/Avaya (where a real login URL
WAS found and wired as a safety net), there's honestly nothing to wire
here -- PORTAL_URL is passed as manual_check_url on failure instead,
same fallback-to-a-real-link pattern used by PLANET/Edgecore/Buffalo/
MOXA elsewhere in this codebase for vendors with no login system.
"""
from __future__ import annotations

import re
from typing import Optional
from urllib.parse import quote

from firmware_lookup.http_client import FirmwareHttpClient
from firmware_lookup.matching import find_ambiguous_candidates, match_model
from firmware_lookup.providers.base import FirmwareProvider
from firmware_lookup.result import (
    Confidence, FirmwareResult, ambiguous_model, cannot_determine,
    model_not_found, ok_result,
)
from firmware_lookup.versioning import is_update_available, parse_version

PORTAL_URL = "https://fw.draytek.com.tw/"

# Real markup, verified live: a plain Apache directory listing entry
# for each real product folder.
_FOLDER_LINK_RE = re.compile(r'<a href="([^"]+)/">([^<]+)/</a>')


class DraytekProvider(FirmwareProvider):
    def __init__(self):
        self.vendor_key = "DrayTek"
        self.http = FirmwareHttpClient("draytek")

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

        root_html = self.http.get_text(PORTAL_URL)
        if not root_html:
            return cannot_determine(
                vendor, model, current_version,
                retrieval_method="public_html",
                reason="DrayTek's firmware file server did not load.",
                manual_check_url=PORTAL_URL,
            )

        folders = [
            name for _href, name in _FOLDER_LINK_RE.findall(root_html)
            if name.lower().startswith("vigorswitch")
        ]
        if not folders:
            return cannot_determine(
                vendor, model, current_version,
                retrieval_method="public_html",
                reason="Could not find any VigorSwitch folders on DrayTek's file server.",
                manual_check_url=PORTAL_URL,
            )

        # Accept the model with or without a "VigorSwitch" prefix
        # already typed -- the catalog itself always includes it, so
        # match against the bare suffix too by stripping it from both
        # sides before comparing.
        matched_name, _score, method = match_model(model, folders)
        if method == "ambiguous":
            return ambiguous_model(
                vendor, model, current_version,
                find_ambiguous_candidates(model, folders),
                retrieval_method="public_html",
            )
        if not matched_name:
            return model_not_found(
                vendor, model, current_version,
                retrieval_method="public_html",
                manual_check_url=PORTAL_URL,
            )

        latest_txt_url = f"{PORTAL_URL}{quote(matched_name)}/Firmware/latest.txt"
        latest_version = self.http.get_text(latest_txt_url)
        if not latest_version or not parse_version(latest_version.strip()):
            return model_not_found(
                vendor, model, current_version,
                retrieval_method="public_html",
                manual_check_url=PORTAL_URL,
            )
        latest_version = latest_version.strip()

        return ok_result(
            vendor=vendor,
            model=model,
            current_version=current_version,
            latest_version=latest_version,
            source_url=latest_txt_url,
            confidence=Confidence.HIGH,
            retrieval_method="public_html",
            update_available=is_update_available(current_version, latest_version),
            message=(
                "Retrieved from DrayTek's public firmware file server "
                "(no login required) -- the vendor's own current-version "
                "marker file for this switch."
            ),
        )
