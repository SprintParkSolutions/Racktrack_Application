"""
Edgecore Networks -- Tier 1, public, no login.

CONFIRMED REVERSAL, found live 2026-07-16 (previously marked
not_implemented -- see unimplemented.py's prior NOT_IMPLEMENTED_REASONS
entry, dated 2026-07-13, which claimed "No working /support, /software,
or /downloads path was found... firmware appears to be distributed to
OEM/partner accounts rather than published publicly"): that was wrong --
the real support site lives on a completely separate subdomain
(support.edge-core.com, a Zendesk help center) that the earlier search
never reached, not the main edge-core.com domain.

Real, live-verified source this session: a single real page lists EVERY
Enterprise Switch series' firmware history at once, no login, no search
needed at all -- confirmed via a plain HTTP client (no browser required):
  https://support.edge-core.com/hc/en-us/categories/
      360000729314-Enterprise-Switch-FW-Download
Real, dated entries confirmed live (a representative sample):
    ECS4150_V1.10.1.254.bix (2025/10/27)
    ECS5550_V3.1.13.262.bix (2026/06/23)
    ECS5520_V3.4.17.262_L3_Version (2026/06/26)
    ECS4155/ECS4655_V2.1.10.262 (2026/07/15)
    ECS4150-28T/28F/28P/54T/54P V5.1.14.262 (2026/6/23)

Real title format is NOT perfectly uniform (confirmed live, several real
variations): "MODEL_VX.Y.Z.bix (DATE)", "MODEL VX.Y.Z (DATE)" (space
instead of underscore), "MODEL_VX.Y.Z_L3_Version (DATE)" (extra suffix
between version and date), and combined multi-SKU listings like
"ECS4150-28T/28F/28P/54T/54P VX.Y.Z (DATE)". A minority of real entries
(e.g. ECS1100-5P_V1.0.2.5 Firmware) have NO date at all. Non-firmware
entries on the same page (a support FAQ article, product datasheets,
product images) never contain a "V<digit>" version token at all, so
requiring that pattern to match is what excludes them -- not a separate
denylist of article titles that could go stale.

Matching a typed model to a listing: both sides are normalized to
bare alphanumerics (uppercased, separators stripped) and checked for
containment -- handles the combined multi-SKU listings correctly (e.g.
"ECS4150-28T" typed matches inside the combined
"ECS4150-28T/28F/28P/54T/54P" listing) without needing to split each
listing into individual SKUs.

Confidence is Medium: this is a real, dated, official vendor listing,
but the title format's own inconsistency (see above) means the parsing
is pattern-based over free text, not a structured API.
"""
from __future__ import annotations

import re
from datetime import datetime
from typing import Optional

from firmware_lookup.http_client import FirmwareHttpClient
from firmware_lookup.providers.base import FirmwareProvider
from firmware_lookup.result import (
    Confidence, FirmwareResult, cannot_determine, model_not_found, ok_result,
)
from firmware_lookup.versioning import is_update_available

PORTAL_URL = "https://support.edge-core.com/hc/en-us"
DOWNLOAD_CATEGORY_URL = (
    "https://support.edge-core.com/hc/en-us/categories/"
    "360000729314-Enterprise-Switch-FW-Download"
)

# Real markup, verified live: every real download entry on the page is
# one of these links.
_ENTRY_RE = re.compile(r'href="([^"]+)" class="article-list-link" title="([^"]+)"')
# Real title shapes, confirmed live: "MODEL_VX.Y.Z(.bix)(_suffix) (DATE)"
# or "MODEL VX.Y.Z (DATE)" -- requiring the "V<digit>" token is what
# naturally excludes non-firmware entries (FAQ articles, datasheets,
# product images) on the same page without a separate denylist.
_FIRMWARE_TITLE_RE = re.compile(r"^([\w][\w/\-]*?)[\s_]+V(\d+(?:\.\d+)+)")
_DATE_RE = re.compile(r"\((\d{4})/(\d{1,2})/(\d{1,2})\)")


def _normalize(s: str) -> str:
    return re.sub(r"[^A-Z0-9]", "", s.upper())


def _parse_date(title: str) -> Optional[datetime]:
    match = _DATE_RE.search(title)
    if not match:
        return None
    year, month, day = (int(g) for g in match.groups())
    try:
        return datetime(year, month, day)
    except ValueError:
        return None


class EdgecoreProvider(FirmwareProvider):
    def __init__(self):
        self.vendor_key = "Edgecore"
        self.http = FirmwareHttpClient("edgecore")

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

        html = self.http.get_text(DOWNLOAD_CATEGORY_URL)
        if not html:
            return cannot_determine(
                vendor, model, current_version,
                retrieval_method="public_html",
                reason="Edgecore's firmware download page did not load.",
                manual_check_url=PORTAL_URL,
            )

        normalized_model = _normalize(model)
        candidates = []  # (date_or_None, href, title, version)
        for href, title in _ENTRY_RE.findall(html):
            fw_match = _FIRMWARE_TITLE_RE.match(title)
            if not fw_match:
                continue
            prefix, version = fw_match.groups()
            if normalized_model not in _normalize(prefix):
                continue
            candidates.append((_parse_date(title), href, title, version))

        if not candidates:
            return model_not_found(
                vendor, model, current_version,
                retrieval_method="public_html",
                manual_check_url=PORTAL_URL,
            )

        # Prefer dated entries (sorted newest first); undated entries
        # (a real minority case, e.g. ECS1100 series) sort last since
        # there's no way to compare them against dated ones.
        candidates.sort(key=lambda c: c[0] or datetime.min, reverse=True)
        _date, href, title, latest_version = candidates[0]
        source_url = href if href.startswith("http") else f"https://support.edge-core.com{href}"

        return ok_result(
            vendor=vendor,
            model=model,
            current_version=current_version,
            latest_version=latest_version,
            source_url=source_url,
            confidence=Confidence.MEDIUM,
            retrieval_method="public_html",
            update_available=is_update_available(current_version, latest_version),
            message=(
                "Retrieved from Edgecore's public support site (no login "
                f"required) -- the most recent matching entry: {title!r}."
            ),
        )
