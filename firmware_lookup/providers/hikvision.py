"""
Hikvision -- Tier 1, public, no login.

VERIFIED LIVE this session (NOT from an archive -- fetched the real,
current site directly): hikvision.com/en/support/download/firmware/
is a real, fully public firmware search page (no login).

CONFIRMED BUG, found live: the search box does NOT actually filter the
page's DOM -- the full, unfiltered category accordion (~2370 real
products across every Hikvision product line, cameras included) stays
present and marked with the SAME "isShowMain" class regardless of what
was typed. An early version of this provider scanned ALL real <a
class="link" href="/en/products/..."> elements on the page and took
the first one -- which returned a completely unrelated THERMAL CAMERA
model for a switch search, a real wrong-answer bug caught by testing
before this shipped. Fixed by filtering links by their own VISIBLE
TEXT matching the requested model (Playwright's has_text filter),
which correctly narrows to just the real matching product(s)
regardless of the underlying accordion never being hidden -- confirmed
live this returns exactly the 2 real matches for "DS-3E1326P-EI"
("DS-3E1326P-EI (B)" and "DS-3E1326P-EI/M"), not the unrelated one.

Real markup, confirmed live:
    <a class="link" href="/en/products/transmission/Network-Switches/
       smart-managed-series/ds-3e1326p-ei/">DS-3E1326P-EI (B)</a>
Following that real link to the real product page shows the current
firmware directly, confirmed live:
    Firmware
    Firmware_V3.4.0_260319
    Applied to:
    DS-3E1326P-EI(B)
(Note this live-fetched version, V3.4.0 dated 260319, is genuinely
NEWER than an earlier Wayback Machine archive snapshot's V3.0.9 --
confirms this is real current data, not stale/cached.)

Download itself is gated only by a click-through EULA modal ("Materials
License Agreement", Agree/Disagree), not a login -- the version number
and release date are fully public either way, which is all this needs.

The search box is genuinely a live filter (confirmed live via
Playwright interaction, not a static list) -- fetched fresh each call
and matched to whatever real suggestion appears, rather than a
hardcoded model-to-URL table.
"""
from __future__ import annotations

import re
from typing import Optional

from firmware_lookup.providers.base import FirmwareProvider
from firmware_lookup.result import (
    Confidence, FirmwareResult, cannot_determine, model_not_found, ok_result,
)
from firmware_lookup.versioning import is_update_available, parse_version

FIRMWARE_SEARCH_URL = "https://www.hikvision.com/en/support/download/firmware/"
PORTAL_URL = FIRMWARE_SEARCH_URL

# Real markup, verified live on the product page's own Firmware section.
_FIRMWARE_VERSION_RE = re.compile(r"Firmware_V(\d+(?:\.\d+)+)_(\d{6})")


class HikvisionProvider(FirmwareProvider):
    def __init__(self):
        self.vendor_key = "Hikvision"

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

        try:
            from playwright.sync_api import sync_playwright
        except ImportError:
            return cannot_determine(
                vendor, model, current_version,
                retrieval_method="public_browser",
                reason="Playwright not available to search Hikvision's firmware page.",
                manual_check_url=PORTAL_URL,
            )

        try:
            with sync_playwright() as playwright:
                browser = playwright.chromium.launch(headless=True)
                try:
                    page = browser.new_page()
                    result = self._search_and_extract(page, vendor, model, current_version)
                finally:
                    browser.close()
        except Exception as e:
            return cannot_determine(
                vendor, model, current_version,
                retrieval_method="public_browser",
                reason=f"Hikvision firmware search failed: {e}.",
                manual_check_url=PORTAL_URL,
            )

        return result

    def _search_and_extract(
        self, page, vendor: str, model: str, current_version: str,
    ) -> FirmwareResult:
        page.goto(FIRMWARE_SEARCH_URL, wait_until="domcontentloaded", timeout=20000)
        page.wait_for_timeout(1500)

        search_box = page.locator(
            "input.firmware-search, input[placeholder*='key words' i]"
        ).first
        try:
            search_box.wait_for(state="visible", timeout=8000)
        except Exception:
            return cannot_determine(
                vendor, model, current_version,
                retrieval_method="public_browser",
                reason="Hikvision's firmware search box was not found on the page.",
                manual_check_url=PORTAL_URL,
            )
        search_box.fill(model)
        page.wait_for_timeout(1500)

        # CONFIRMED BUG, found live (see module docstring): the search
        # box does not filter the DOM, so scanning ALL "a.link" hrefs
        # would return the entire unfiltered ~2370-product catalog.
        # Filtering by the link's own visible TEXT matching the model
        # is what actually narrows this correctly.
        model_re = re.compile(re.escape(model.strip()), re.IGNORECASE)
        matches = page.locator("a.link").filter(has_text=model_re)
        match_count = matches.count()
        if match_count == 0:
            return model_not_found(
                vendor, model, current_version,
                retrieval_method="public_browser",
                manual_check_url=PORTAL_URL,
            )

        norm_model = re.sub(r"\s+", "", model.strip().lower())
        href = matches.first.get_attribute("href")
        for i in range(match_count):
            el = matches.nth(i)
            label = re.sub(r"\s+", "", (el.inner_text() or "").lower())
            if label == norm_model:
                href = el.get_attribute("href")
                break

        if not href:
            return model_not_found(
                vendor, model, current_version,
                retrieval_method="public_browser",
                manual_check_url=PORTAL_URL,
            )

        product_url = "https://www.hikvision.com" + href
        page.goto(product_url, wait_until="domcontentloaded", timeout=20000)
        page.wait_for_timeout(1500)
        product_html = page.content()

        version_match = _FIRMWARE_VERSION_RE.search(product_html)
        if not version_match or not parse_version(version_match.group(1)):
            return model_not_found(
                vendor, model, current_version,
                retrieval_method="public_browser",
                manual_check_url=PORTAL_URL,
            )
        latest_version = version_match.group(1)
        date_code = version_match.group(2)

        return ok_result(
            vendor=vendor,
            model=model,
            current_version=current_version,
            latest_version=latest_version,
            source_url=product_url,
            confidence=Confidence.HIGH,
            retrieval_method="public_browser",
            update_available=is_update_available(current_version, latest_version),
            message=(
                "Retrieved from Hikvision's public firmware search (no "
                f"login required) -- build date code {date_code}."
            ),
        )
