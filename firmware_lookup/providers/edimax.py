"""
Edimax -- Tier 1, public, no login.

CORRECTED, found live after initially being registered as a dead end:
a user pointed at a REAL screenshot showing firmware for GS-5424PLC V2
that this provider's first version had missed entirely. Investigated
again live and found the actual, working mechanism -- the original
research had tested a DIFFERENT real model (GS-5424PLC V3, a newer
hardware revision) via the site's own AJAX API and genuinely found no
firmware there, then over-generalized that single real result to "no
firmware for switches" instead of checking other real models first.

VERIFIED LIVE this session, the REAL, working two-step public API (no
login, no browser needed -- both are plain HTTP JSON/HTML endpoints):
  1. Product catalog: GET edimax.com/edimax/product/ajax_product_admin/
     get_product_list_cb/2/smb_switches/0/show_all/ -- a real, complete
     54-entry catalog of every current switch model, each a real
     <option value="SLUG" data="CATEGORY">DISPLAY NAME</option>, e.g.
     <option value="gs-5424plc_v2" data="smb_switches_onvif_conformant">
     GS-5424PLC V2</option> -- fetched fresh each call, not hardcoded.
  2. Download list: GET edimax.com/edimax/download/ajax_download/
     get_download_list/2/global/download/{slug}/{category}/3/ -- real
     HTML fragment with a genuine Firmware table row when one exists,
     confirmed live for GS-5424PLC V2:
       "GS-5424PLC V2 Firmware Version 1.0.9 ... (Version : 1.0.9)
        2021-12-16"

CONFIRMED, real and honest: NOT every model has a firmware entry --
re-checked GS-5424PLC V3 through this SAME correct endpoint and
confirmed it genuinely has zero Firmware section (not even an empty
header), while V2 (an older hardware revision of the same product
family) does. This is a real per-model gap, not a coverage bug in this
provider -- model_not_found is the honest answer for V3 specifically.
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
from firmware_lookup.versioning import is_update_available, parse_version

PRODUCT_LIST_URL = (
    "https://www.edimax.com/edimax/product/ajax_product_admin/"
    "get_product_list_cb/2/smb_switches/0/show_all/"
)
DOWNLOAD_LIST_URL_TEMPLATE = (
    "https://www.edimax.com/edimax/download/ajax_download/"
    "get_download_list/2/global/download/{slug}/{category}/3/"
)
PORTAL_URL = "https://www.edimax.com/edimax/download/download/data/edimax/global/download/"

# Real markup, verified live: each catalog entry is a real <option>
# with its own slug and category.
_PRODUCT_OPTION_RE = re.compile(
    r'<option value="([^"]+)" data="([^"]+)">([^<]+)</option>',
)
# Real markup, verified live in the download-list fragment's own
# Firmware table row.
_FIRMWARE_ROW_RE = re.compile(
    r"Firmware Version\s*([\d.]+)[^<]*?(?:<a[^>]*>[^<]*</a>)?[^<]*?"
    r'<span[^>]*>\s*([\d-]+)\s*</span>',
)


class EdimaxProvider(FirmwareProvider):
    def __init__(self):
        self.vendor_key = "Edimax"
        self.http = FirmwareHttpClient("edimax")

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

        catalog_html = self.http.get_text(PRODUCT_LIST_URL)
        if not catalog_html:
            return cannot_determine(
                vendor, model, current_version,
                retrieval_method="public_html",
                reason="Edimax's product catalog did not load.",
                manual_check_url=PORTAL_URL,
            )

        entries = _PRODUCT_OPTION_RE.findall(catalog_html)
        catalog = {name: (slug, category) for slug, category, name in entries}
        if not catalog:
            return cannot_determine(
                vendor, model, current_version,
                retrieval_method="public_html",
                reason="Edimax's product catalog was empty.",
                manual_check_url=PORTAL_URL,
            )

        matched_name, _score, method = match_model(model, list(catalog.keys()))
        if method == "ambiguous":
            return ambiguous_model(
                vendor, model, current_version,
                find_ambiguous_candidates(model, list(catalog.keys())),
                retrieval_method="public_html",
            )
        if not matched_name:
            return model_not_found(
                vendor, model, current_version,
                retrieval_method="public_html",
                manual_check_url=PORTAL_URL,
            )

        slug, category = catalog[matched_name]
        download_url = DOWNLOAD_LIST_URL_TEMPLATE.format(slug=slug, category=category)
        download_html = self.http.get_text(download_url)
        if not download_html:
            return cannot_determine(
                vendor, model, current_version,
                retrieval_method="public_html",
                reason="Edimax's download list did not load.",
                manual_check_url=PORTAL_URL,
            )

        row_match = _FIRMWARE_ROW_RE.search(download_html)
        if not row_match or not parse_version(row_match.group(1)):
            # Confirmed live for real models (e.g. GS-5424PLC V3): a
            # genuine absence of any Firmware section, not a bug.
            return model_not_found(
                vendor, model, current_version,
                retrieval_method="public_html",
                manual_check_url=PORTAL_URL,
            )
        latest_version = row_match.group(1)
        release_date = row_match.group(2)

        source_url = (
            "https://www.edimax.com/edimax/download/download/data/edimax/"
            f"global/download/{category}/{slug}"
        )
        return ok_result(
            vendor=vendor,
            model=model,
            current_version=current_version,
            latest_version=latest_version,
            source_url=source_url,
            confidence=Confidence.HIGH,
            retrieval_method="public_html",
            update_available=is_update_available(current_version, latest_version),
            message=(
                "Retrieved from Edimax's public download system (no "
                f"login required) -- released {release_date}."
            ),
        )
