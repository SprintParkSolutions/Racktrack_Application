"""
MICROSENS -- Tier 2 base (for the login safety net), with a real,
verified public source for per-model firmware VERSION text (the file
download itself is login-gated, but the version number is not).

VERIFIED LIVE this session: microsens.com/product/<slug> is a real,
fully public per-model product page (no login to VIEW) whose real
markup lists each firmware entry's version text directly, even though
the download icon itself is marked "secure":
    <div class="secureDownloadArea secureIcon">
      <div class="secureClosed"><img src=".../icon-s-login-closed.svg"></div>
      <div class="secureDownloadAreaLink">Firmware G6 v10.8.4</div>
    </div>
Confirmed live for the "6-Port GbE Micro Switch G6" product page, real
entries found in real page order: "Firmware G6 v10.8.4", "Firmware G6
v10.8.4 Patch 1", "Firmware G6 v10.8.2c", "Firmware G6 V12.8.2a -
since Hardware 2.0", "Firmware G6 V12.8.1 - since Hardware 2.0".

HONESTY FLAG, real and important: that same page lists TWO apparently
divergent firmware branches for what looks like one product (v10.x and
V12.x, the latter explicitly marked "since Hardware 2.0") -- meaning
different physical hardware revisions of the same model name can only
run different firmware trains, and picking the highest PARSED version
across both would risk recommending firmware a customer's actual
(older-hardware) unit can't run. Scoped conservatively here: takes the
FIRST real "Firmware <family> vX.Y.Z" entry in the page's own listed
order (not the highest parsed version), since page order is the
vendor's own presentation and picking across hardware branches by
version number alone is a genuine correctness risk this session didn't
have enough evidence to resolve safely.

Model-to-URL discovery: no direct model-to-slug transform found:
microsens.com/support/downloads/firmware is a real directory listing
every item number, each linking to its own /product/<slug> page --
confirmed live via the page's own text: "You can search for specific
item numbers... Clicking on the item number will take you directly to
the relevant product page." Fetched fresh each call and matched via
matching.match_model() against the directory's own real item numbers,
same "live-fetched catalog" principle as Nokia/MOXA/PLANET/DrayTek.

LOGIN SAFETY NET: no dedicated login URL exists -- confirmed live login
is a modal/request flow triggered from the download page itself, not a
separate URL, and search results indicate credentials are obtained by
emailing sales@microsens.de. Given there's no real URL to point a
browser-assisted login at, this stays a Tier-1-shaped provider (no
login fallback wired in) -- offering a fabricated login URL would be
worse than none at all.
"""
from __future__ import annotations

import re
from typing import Optional

from firmware_lookup.http_client import FirmwareHttpClient
from firmware_lookup.matching import find_ambiguous_candidates, match_model
from firmware_lookup.providers.base import FirmwareProvider
from firmware_lookup.result import (
    Confidence, FirmwareResult, ambiguous_model, cannot_determine,
    model_not_found, ok_result,
)
from firmware_lookup.versioning import is_update_available

DIRECTORY_URL = "https://www.microsens.com/support/downloads/firmware"
PORTAL_URL = DIRECTORY_URL

# Real markup, verified live: each item number in the directory links
# to its own real product page -- the directory's own links use the
# German path (/de/produkt/<slug>), confirmed live to redirect/serve
# the same real content as the English /product/<slug> path used for
# extraction below.
_ITEM_LINK_RE = re.compile(
    r'<a href="https://www\.microsens\.com/de/produkt/([^"]+)" target="_blank">'
    r'\s*([A-Za-z0-9+\-]+)\s*</a>',
)
# Real markup, verified live on the product page itself.
_FIRMWARE_ENTRY_RE = re.compile(
    r'secureDownloadAreaLink">\s*(Firmware\s+[^<]*?v(\d+(?:\.\d+)+\w*)[^<]*?)\s*</div>',
    re.IGNORECASE,
)


class MicrosensProvider(FirmwareProvider):
    def __init__(self):
        self.vendor_key = "MICROSENS"
        self.http = FirmwareHttpClient("microsens")

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

        directory_html = self.http.get_text(DIRECTORY_URL)
        if not directory_html:
            return cannot_determine(
                vendor, model, current_version,
                retrieval_method="public_html",
                reason="MICROSENS's firmware directory did not load.",
                manual_check_url=PORTAL_URL,
            )

        items = _ITEM_LINK_RE.findall(directory_html)
        catalog = {item_number: slug for slug, item_number in items}
        if not catalog:
            return cannot_determine(
                vendor, model, current_version,
                retrieval_method="public_html",
                reason="MICROSENS's firmware directory was empty.",
                manual_check_url=PORTAL_URL,
            )

        matched_item, _score, method = match_model(model, list(catalog.keys()))
        if method == "ambiguous":
            return ambiguous_model(
                vendor, model, current_version,
                find_ambiguous_candidates(model, list(catalog.keys())),
                retrieval_method="public_html",
            )
        if not matched_item:
            return model_not_found(
                vendor, model, current_version,
                retrieval_method="public_html",
                manual_check_url=PORTAL_URL,
            )

        product_url = "https://www.microsens.com/product/" + catalog[matched_item]
        product_html = self.http.get_text(product_url)
        if not product_html:
            return cannot_determine(
                vendor, model, current_version,
                retrieval_method="public_html",
                reason="MICROSENS's product page did not load.",
                manual_check_url=PORTAL_URL,
            )

        entries = _FIRMWARE_ENTRY_RE.findall(product_html)
        if not entries:
            return model_not_found(
                vendor, model, current_version,
                retrieval_method="public_html",
                manual_check_url=PORTAL_URL,
            )

        # First real entry in the page's own order -- see module
        # docstring HONESTY FLAG on why this doesn't sort by parsed
        # version across potentially different hardware branches.
        full_text, latest_version = entries[0]

        return ok_result(
            vendor=vendor,
            model=model,
            current_version=current_version,
            latest_version=latest_version,
            source_url=product_url,
            confidence=Confidence.MEDIUM,
            retrieval_method="public_html",
            update_available=is_update_available(current_version, latest_version),
            message=(
                "Retrieved from MICROSENS's public product page (no "
                f"login required to view) -- {full_text.strip()}. The "
                "actual firmware file itself is login-gated; only the "
                "version text is public."
            ),
        )
