"""
Buffalo Americas -- Tier 1, public, no login.

CONFIRMED REVERSAL, found live 2026-07-16 (previously marked
not_implemented -- see unimplemented.py's prior entry, "Not researched
this round"): real public firmware data exists, no login required.

VERIFIED LIVE this session: buffaloamericas.com/products
    /multi-gigabit-business-switch
is a real, plain-HTTP-fetchable product page (no browser needed --
confirmed via a plain HTTP client) with a real jQuery-UI-tabs "Downloads"
panel containing a genuine "Firmware" table:
    <h3 class="firm">Firmware</h3>
    <table class="firm tbl-downloads">
      <tr><td data-title="Post Date">2018-05-29</td>
          <td data-title="Version">2.0.5.3</td>...</tr>
      <tr><td data-title="Post Date">2018-05-22</td>
          <td data-title="Version">2.0.6.8</td>...</tr>
    </table>

Scope, real and honest: Buffalo's ENTIRE switch catalog (confirmed live
by walking the real category tree: Products > Multi-Gigabit Switches >
10-Gigabit / Multi-Gigabit Switch) is genuinely just this ONE product
family page, covering the BS-MP20/BS-MP2008/BS-MP2012 series -- Buffalo
is primarily a NAS/storage vendor with a single small switch line, not a
broad switch catalog needing per-model discovery/matching the way
PLANET or Edgecore's much larger catalogs do. This is a real, narrow
scope grounded in what actually exists on their site, not an arbitrary
limitation.
"""
from __future__ import annotations

import re
from typing import Optional

from firmware_lookup.http_client import FirmwareHttpClient
from firmware_lookup.providers.base import FirmwareProvider
from firmware_lookup.result import Confidence, FirmwareResult, cannot_determine, ok_result
from firmware_lookup.versioning import is_update_available, parse_version

PORTAL_URL = "https://buffaloamericas.com/support"
PRODUCT_PAGE_URL = "https://buffaloamericas.com/products/multi-gigabit-business-switch"

# Real markup, verified live: the Firmware table is a distinct <table>
# right after its own <h3 class="firm">Firmware</h3> heading (a separate
# "Documentation" table with the same "firm tbl-downloads"-shaped rows
# follows it -- scoping to just the Firmware section's own table matters
# so a manual/readme "version" is never mistaken for firmware).
_FIRMWARE_SECTION_RE = re.compile(
    r'<h3 class="firm">Firmware</h3>\s*<table[^>]*>(.*?)</table>', re.DOTALL,
)
_ROW_RE = re.compile(
    r'<td data-title="Post Date">([^<]*)</td>\s*'
    r'<td data-title="Version">([^<]*)</td>',
)
_MODEL_PATTERN = re.compile(r"\bBS-?MP\s*-?\s*(20\d{2}|20)?\b", re.IGNORECASE)


def _matches_buffalo_switch(model: str) -> bool:
    return bool(_MODEL_PATTERN.search(model))


class BuffaloProvider(FirmwareProvider):
    def __init__(self):
        self.vendor_key = "Buffalo"
        self.http = FirmwareHttpClient("buffalo")

    def get_latest_firmware(
        self, vendor: str, model: str, current_version: str,
    ) -> FirmwareResult:
        if not model or not _matches_buffalo_switch(model):
            # No confident match for Buffalo's one real, verified switch
            # family (see module docstring) -- an honest "not found"
            # with the real support link, not a guess at other Buffalo
            # product lines (NAS, storage) never verified as switches.
            return cannot_determine(
                vendor, model, current_version,
                retrieval_method="public_html",
                reason=(
                    "Model doesn't match Buffalo's verified switch "
                    "family (BS-MP20/BS-MP2008/BS-MP2012)."
                ),
                manual_check_url=PORTAL_URL,
            )

        html = self.http.get_text(PRODUCT_PAGE_URL)
        if not html:
            return cannot_determine(
                vendor, model, current_version,
                retrieval_method="public_html",
                reason="Buffalo's product page did not load.",
                manual_check_url=PORTAL_URL,
            )

        section_match = _FIRMWARE_SECTION_RE.search(html)
        if not section_match:
            return cannot_determine(
                vendor, model, current_version,
                retrieval_method="public_html",
                reason="No Firmware section found on Buffalo's product page.",
                manual_check_url=PORTAL_URL,
            )

        rows = _ROW_RE.findall(section_match.group(1))
        if not rows:
            return cannot_determine(
                vendor, model, current_version,
                retrieval_method="public_html",
                reason="Firmware section had no entries.",
                manual_check_url=PORTAL_URL,
            )

        # CONFIRMED real-data quirk, found live: the two real firmware
        # rows (2.0.5.3 posted 2018-05-29, 2.0.6.8 posted 2018-05-22)
        # have version 2.0.6.8 dated EARLIER than 2.0.5.3 -- yet the
        # same table's own "Notes" column says to update to 2.0.5.2
        # BEFORE going to 2.0.6.8, meaning 2.0.6.8 is the actual later
        # firmware in the real upgrade path despite its earlier post
        # date. Sorting by date here would give the wrong practical
        # answer -- sort by the actual parsed version number instead
        # (Post Date is still reported in the message for context).
        parsed_rows = []
        for date, version in rows:
            version = version.strip()
            if not version:
                continue
            parsed = parse_version(version)
            if not parsed:
                continue
            parsed_rows.append((parsed, date.strip(), version))
        if not parsed_rows:
            return cannot_determine(
                vendor, model, current_version,
                retrieval_method="public_html",
                reason="No parseable firmware version found.",
                manual_check_url=PORTAL_URL,
            )
        parsed_rows.sort(key=lambda r: r[0], reverse=True)
        _parsed, latest_date, latest_version = parsed_rows[0]

        return ok_result(
            vendor=vendor,
            model=model,
            current_version=current_version,
            latest_version=latest_version,
            source_url=PRODUCT_PAGE_URL,
            confidence=Confidence.MEDIUM,
            retrieval_method="public_html",
            update_available=is_update_available(current_version, latest_version),
            message=(
                "Retrieved from Buffalo's public product page (no login "
                f"required) -- the most recent Firmware table entry "
                f"(posted {latest_date}). Covers the BS-MP20/BS-MP2008/"
                "BS-MP2012 switch family, Buffalo's only verified public "
                "switch product line."
            ),
        )
