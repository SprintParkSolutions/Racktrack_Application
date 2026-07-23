"""
TRENDnet -- Tier 1, public, no login.

VERIFIED LIVE this session: trendnet.com's own site search
(https://www.trendnet.com/search/default.asp?q=<model>) is a real,
plain-HTTP endpoint (no browser needed) that returns real links to a
per-product support page:
    https://www.trendnet.com/support/support-detail.asp?prod=<id>_<MODEL>
where <id> is an internal numeric product ID -- NOT a mechanical
transform of the model name alone, so this always discovers it fresh
via the real search rather than guessing/hardcoding it.

Real markup, confirmed live on the support-detail page for
prod=265_TEG-284WS:
    <strong>Firmware  Version: </strong>v3.01.029<br>
    <strong>Release Date: </strong>05/2025<br>
(note the real double-space typo in "Firmware  Version:" -- present in
the vendor's own markup, matched tolerantly here).

CONFIRMED DATA-SOURCE TRAP, found live: a separate, also-public raw
directory listing at https://downloads.trendnet.com/<MODEL>/firmware/
looks like a simpler alternative (no numeric ID needed) but was
confirmed STALE/INCOMPLETE for at least one real model -- for
TEG-284WS its newest listed file was dated 2023-06-27 (v3.01.024),
while the real support-detail page's own "Firmware Version" field
showed v3.01.029 (05/2025), a file genuinely absent from that
directory. The support-detail page (fetched below) is authoritative;
the raw directory listing is NOT used as this provider's source.

CONFIRMED REAL AMBIGUITY, found live: searching some model names (e.g.
"TEG-284WS") returns MULTIPLE distinct product IDs for what looks like
the exact same model string (prod=260_TEG-284WS, 255_TEG-284WS,
265_TEG-284WS) -- almost certainly different hardware revisions
TRENDnet tracks as separate support pages under the same model name,
with no revision marker in the search result title to disambiguate.
Other models (e.g. TPE-3102WS) return exactly one match. Rather than
guessing which hardware revision's firmware applies, multiple distinct
product IDs for the same requested model name are surfaced honestly as
ambiguous_model() -- never picked arbitrarily.
"""
from __future__ import annotations

import re
from typing import Optional
from urllib.parse import quote

from firmware_lookup.http_client import FirmwareHttpClient
from firmware_lookup.providers.base import FirmwareProvider
from firmware_lookup.result import (
    Confidence, FirmwareResult, ambiguous_model, cannot_determine,
    model_not_found, ok_result,
)
from firmware_lookup.versioning import is_update_available

SEARCH_URL_TEMPLATE = "https://www.trendnet.com/search/default.asp?q={model}"
PORTAL_URL = "https://www.trendnet.com/support/"

# Real markup, verified live: each search result links a per-product
# support-detail page whose query string embeds an internal numeric ID
# and the model name together.
_RESULT_LINK_RE = re.compile(
    r'href="https://www\.trendnet\.com/support/support-detail\.asp\?prod=(\d+)_([^"]+)"'
)
# Real markup, verified live (note the vendor's own real double-space
# typo in "Firmware  Version:").
_FIRMWARE_VERSION_RE = re.compile(
    r"Firmware\s+Version:\s*</strong>\s*v?([\d.]+)\s*<br>\s*"
    r"<strong>\s*Release Date:\s*</strong>\s*([^<]*)<br>",
)


class TrendnetProvider(FirmwareProvider):
    def __init__(self):
        self.vendor_key = "TRENDnet"
        self.http = FirmwareHttpClient("trendnet")

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

        search_url = SEARCH_URL_TEMPLATE.format(model=quote(model.strip()))
        search_html = self.http.get_text(search_url)
        if not search_html:
            return cannot_determine(
                vendor, model, current_version,
                retrieval_method="public_html",
                reason="TRENDnet's search page did not load.",
                manual_check_url=PORTAL_URL,
            )

        norm_model = model.strip().lower()
        matches = [
            (prod_id, matched_model)
            for prod_id, matched_model in _RESULT_LINK_RE.findall(search_html)
            if matched_model.lower() == norm_model
        ]
        # De-duplicate identical (id, model) pairs the search page might
        # repeat (e.g. once per matching document on the page).
        distinct_ids = sorted({prod_id for prod_id, _ in matches})
        if not distinct_ids:
            return model_not_found(
                vendor, model, current_version,
                retrieval_method="public_html",
                manual_check_url=PORTAL_URL,
            )
        if len(distinct_ids) > 1:
            # Confirmed live for TEG-284WS: multiple distinct product
            # IDs (almost certainly different hardware revisions) share
            # this exact model name with no revision marker to
            # disambiguate -- never guess which one.
            return ambiguous_model(
                vendor, model, current_version,
                [f"{model} (product id {pid})" for pid in distinct_ids],
                retrieval_method="public_html",
            )

        prod_id, matched_model = distinct_ids[0], matches[0][1]
        detail_url = (
            f"https://www.trendnet.com/support/support-detail.asp"
            f"?prod={prod_id}_{matched_model}"
        )
        detail_html = self.http.get_text(detail_url)
        if not detail_html:
            return cannot_determine(
                vendor, model, current_version,
                retrieval_method="public_html",
                reason="TRENDnet's support page did not load.",
                manual_check_url=PORTAL_URL,
            )

        version_match = _FIRMWARE_VERSION_RE.search(detail_html)
        if not version_match:
            return model_not_found(
                vendor, model, current_version,
                retrieval_method="public_html",
                manual_check_url=PORTAL_URL,
            )
        latest_version = version_match.group(1).strip()
        release_date = version_match.group(2).strip()

        return ok_result(
            vendor=vendor,
            model=model,
            current_version=current_version,
            latest_version=latest_version,
            source_url=detail_url,
            confidence=Confidence.HIGH,
            retrieval_method="public_html",
            update_available=is_update_available(current_version, latest_version),
            message=(
                "Retrieved from TRENDnet's public support page (no "
                f"login required) -- Firmware Version field, released "
                f"{release_date}."
            ),
        )
