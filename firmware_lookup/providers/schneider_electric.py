"""
Schneider Electric -- Tier 1, public, no login (ConneXium managed
switches only -- this vendor makes a huge range of other products not
covered here).

VERIFIED LIVE this session: se.com/us/en/download/document/
<SERIES>_Connexium_Switch/ is a real, fully public document page (no
login), confirmed via a real browser (this domain returns a 403 bot
block to plain curl/WebFetch, but a real headless Playwright browser
gets through fine, 200). Real content, confirmed live for the TCSESM
series:
    Modicon Switch TCSESM Firmware <=SV09.11
    Date: Dec 01 2020 | Type: Firmware
    Version: SV09.11
    Document Number: TCSESM_Connexium_Switch

CONFIRMED, found live: this URL only resolves at the SERIES level, not
a specific SKU -- "TCSESM" and "TCSESM-E" both 200, but the full SKU
"TCSESM083F23F0" 404s. Real ConneXium switches are always named
<SERIES><digits/suffix>, e.g. "TCSESM083F23F0" is series "TCSESM" with
an 083F23F0 port/config suffix -- so the real family prefix (leading
letters/hyphenated-letters before the first digit) is derived from
whatever the customer typed, the same "derive from what's typed, don't
hardcode a table" principle already used for Cisco/Huawei elsewhere in
this codebase.

Download is not gated at all -- the version/date is directly on the
public page, and file links are listed right there too (no login, no
click-through agreement even).

SCOPE: this only covers the ConneXium managed switch line specifically
(the URL template is hardcoded to "_Connexium_Switch") -- Schneider
Electric makes a vast range of other industrial products this doesn't
attempt to cover.
"""
from __future__ import annotations

import re
from typing import Optional

from firmware_lookup.providers.base import FirmwareProvider
from firmware_lookup.result import (
    Confidence, FirmwareResult, cannot_determine, model_not_found, ok_result,
)
from firmware_lookup.versioning import is_update_available, parse_version

DOC_URL_TEMPLATE = "https://www.se.com/us/en/download/document/{series}_Connexium_Switch/"
PORTAL_URL = "https://www.se.com/us/en/download/document/TCSESM_Connexium_Switch/"

_FAMILY_PREFIX_RE = re.compile(r"^([A-Za-z]+(?:-[A-Za-z]+)*)")
_FIRMWARE_ENTRY_RE = re.compile(
    r"Firmware\s*(?:<=)?\s*SV?(\d+(?:\.\d+)*)",
)
_DATE_RE = re.compile(r"Date:\s*([A-Za-z]+\s+\d+\s+\d{4})")


class SchneiderElectricProvider(FirmwareProvider):
    def __init__(self):
        self.vendor_key = "Schneider Electric"

    def get_latest_firmware(
        self, vendor: str, model: str, current_version: str,
    ) -> FirmwareResult:
        if not model:
            return cannot_determine(
                vendor, model, current_version,
                retrieval_method="public_browser",
                reason="No model given.",
                manual_check_url=PORTAL_URL,
            )

        family_match = _FAMILY_PREFIX_RE.match(model.strip())
        if not family_match:
            return model_not_found(
                vendor, model, current_version,
                retrieval_method="public_browser",
                manual_check_url=PORTAL_URL,
            )
        series = family_match.group(1).upper()

        try:
            from playwright.sync_api import sync_playwright
        except ImportError:
            return cannot_determine(
                vendor, model, current_version,
                retrieval_method="public_browser",
                reason="Playwright not available to load Schneider Electric's document page.",
                manual_check_url=PORTAL_URL,
            )

        url = DOC_URL_TEMPLATE.format(series=series)
        try:
            with sync_playwright() as playwright:
                browser = playwright.chromium.launch(headless=True)
                try:
                    page = browser.new_page()
                    resp = page.goto(url, wait_until="domcontentloaded", timeout=20000)
                    status = resp.status if resp else None
                    page.wait_for_timeout(1500)
                    text = page.inner_text("body")
                finally:
                    browser.close()
        except Exception as e:
            return cannot_determine(
                vendor, model, current_version,
                retrieval_method="public_browser",
                reason=f"Schneider Electric document page failed to load: {e}.",
                manual_check_url=PORTAL_URL,
            )

        if status == 404:
            return model_not_found(
                vendor, model, current_version,
                retrieval_method="public_browser",
                manual_check_url=PORTAL_URL,
            )

        version_match = _FIRMWARE_ENTRY_RE.search(text)
        if not version_match or not parse_version(version_match.group(1)):
            return model_not_found(
                vendor, model, current_version,
                retrieval_method="public_browser",
                manual_check_url=PORTAL_URL,
            )
        latest_version = version_match.group(1)
        date_match = _DATE_RE.search(text)
        date_str = date_match.group(1) if date_match else "unknown date"

        return ok_result(
            vendor=vendor,
            model=model,
            current_version=current_version,
            latest_version=latest_version,
            source_url=url,
            confidence=Confidence.MEDIUM,
            retrieval_method="public_browser",
            update_available=is_update_available(current_version, latest_version),
            message=(
                "Retrieved from Schneider Electric's public document "
                f"page for the {series} series (no login required), "
                f"dated {date_str}. Only covers ConneXium managed "
                "switches."
            ),
        )
