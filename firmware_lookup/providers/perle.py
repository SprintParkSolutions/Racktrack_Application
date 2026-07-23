"""
Perle Systems -- Tier 1, public, no login.

VERIFIED LIVE this session: perle.com/downloads/ (fetched via a real
browser -- confirmed live it's JS-populated, a plain curl/WebFetch of
it returns no product links) links exactly 5 real per-family switch
download pages, each a genuinely public "Documentation and Downloads"
page (no login):
    /downloads/industrial-switches.shtml            (IDS-100 Unmanaged)
    /downloads/industrial-managed-switches.shtml     (IDS-200 and IDS-400)
    /downloads/industrial-managed-switches-pro.shtml (IDS-300, IDS-500 & IDS-710 PRO)
    /downloads/ids-509-poe-switches.shtml            (IDS-509 PoE)
    /downloads/ids-710hp-poe-switches.shtml          (IDS-710HP PoE)
Each page's own <title>/JSON-LD "name" field names the real IDS-family
numbers it covers (e.g. "IDS-300, IDS-500 & IDS-710 Switches with PRO
Feature Set") -- fetched fresh each call and parsed for "IDS-<digits>
(HP)?" tokens rather than hardcoding this family->page mapping, same
"discover the real catalog live" principle used for Nokia/MOXA/PLANET.

CONFIRMED REAL WORDING VARIATION, found live: the firmware link's own
text differs by page -- "Download Comprehensive Firmware R2.1G8" on
the PRO/IDS-200/400 pages, but "Download PoE Firmware R2.1G8" on the
509/710HP PoE-specific pages. Matched here with a wording-tolerant
regex ("Download <anything> Firmware VERSION"), not a single fixed
phrase.

CONFIRMED HONEST GAP, found live: industrial-switches.shtml (IDS-100
Unmanaged) has NO firmware section at all on its real page -- unmanaged
switches genuinely have no upgradeable firmware, so model_not_found is
the correct answer for IDS-100 models, not a bug.

NO LOGIN PORTAL FOUND, searched for genuinely this session: a
plausible portal.perle.com (surfaced by a web search as an alleged
login) was checked live and does NOT resolve (DNS failure,
getaddrinfo ENOTFOUND) -- not a real, reachable Perle property.
Firmware for the switch families covered here appears to have no
account system at all, same as DrayTek elsewhere in this codebase --
PORTAL_URL is passed as manual_check_url on failure instead of a
fabricated login link.
"""
from __future__ import annotations

import re
from typing import Optional

from firmware_lookup.http_client import FirmwareHttpClient
from firmware_lookup.providers.base import FirmwareProvider
from firmware_lookup.result import (
    Confidence, FirmwareResult, cannot_determine, model_not_found, ok_result,
)
from firmware_lookup.versioning import is_update_available

DOWNLOADS_HUB_URL = "https://www.perle.com/downloads/"
PORTAL_URL = DOWNLOADS_HUB_URL

_SWITCH_PAGE_LINK_RE = re.compile(
    r'href="(/downloads/[^"]*switch[^"]*\.shtml)"', re.IGNORECASE,
)
_TITLE_RE = re.compile(r"<title>([^<]+)</title>")
_FAMILY_TOKEN_RE = re.compile(r"IDS-\d+(?:HP)?", re.IGNORECASE)
_FIRMWARE_VERSION_RE = re.compile(r"Download[^<]*Firmware\s+([A-Za-z0-9.]+)")


class PerleProvider(FirmwareProvider):
    def __init__(self):
        self.vendor_key = "Perle"
        self.http = FirmwareHttpClient("perle")

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
            page_urls = self._discover_switch_pages()
        except Exception as e:
            return cannot_determine(
                vendor, model, current_version,
                retrieval_method="public_browser",
                reason=f"Could not discover Perle's switch download pages: {e}.",
                manual_check_url=PORTAL_URL,
            )
        if not page_urls:
            return cannot_determine(
                vendor, model, current_version,
                retrieval_method="public_browser",
                reason="Perle's downloads hub did not load or had no switch pages.",
                manual_check_url=PORTAL_URL,
            )

        norm_model = model.upper()
        matched_url = None
        for page_url in page_urls:
            html = self.http.get_text(page_url)
            if not html:
                continue
            title_match = _TITLE_RE.search(html)
            title = title_match.group(1) if title_match else ""
            tokens = _FAMILY_TOKEN_RE.findall(title.upper())
            if any(token in norm_model for token in tokens):
                matched_url = page_url
                matched_html = html
                break

        if not matched_url:
            return model_not_found(
                vendor, model, current_version,
                retrieval_method="public_browser",
                manual_check_url=PORTAL_URL,
            )

        version_match = _FIRMWARE_VERSION_RE.search(matched_html)
        if not version_match:
            # Confirmed live for IDS-100 (Unmanaged): a real family page
            # can genuinely have no firmware section at all.
            return model_not_found(
                vendor, model, current_version,
                retrieval_method="public_browser",
                manual_check_url=PORTAL_URL,
            )
        latest_version = version_match.group(1)

        return ok_result(
            vendor=vendor,
            model=model,
            current_version=current_version,
            latest_version=latest_version,
            source_url=matched_url,
            confidence=Confidence.MEDIUM,
            retrieval_method="public_browser",
            update_available=is_update_available(current_version, latest_version),
            message=(
                "Retrieved from Perle's public Documentation and "
                "Downloads page for this switch family (no login "
                "required)."
            ),
        )

    def _discover_switch_pages(self) -> list[str]:
        """The downloads hub is JS-populated -- confirmed live a plain
        HTTP fetch returns no product links at all, so this needs one
        real Playwright render. The resulting 5 page URLs change rarely
        (a real, small, bounded vendor catalog, not a huge one), but are
        still discovered fresh each call rather than hardcoded."""
        from playwright.sync_api import sync_playwright

        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True)
            try:
                page = browser.new_page()
                page.goto(DOWNLOADS_HUB_URL, wait_until="domcontentloaded", timeout=20000)
                page.wait_for_timeout(2000)
                html = page.content()
            finally:
                browser.close()

        links = sorted({
            "https://www.perle.com" + href
            for href in _SWITCH_PAGE_LINK_RE.findall(html)
        })
        return links
