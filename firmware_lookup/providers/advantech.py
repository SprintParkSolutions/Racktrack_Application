"""
Advantech -- Tier 2 base (for the login safety net), with a real,
verified public source for industrial managed switch (EKI-series)
firmware that needs NO login at all.

VERIFIED LIVE this session: advantech.com's support search
(https://www.advantech.com/en/search/?q=<model>&st=support&sst=Firmware)
is a real, JS-rendered page (confirmed via a real headless-browser
fetch -- a plain curl/WebFetch of it returns only the page shell, no
results) that returns a real link to a per-series firmware detail page,
e.g. searching "EKI-7712E-4F" returns exactly one match:
    /en/support/details/firmware?id=1-18U05WB
Confirmed this search URL pattern by finding the REAL navigation path a
human follows: a product page's "Technical Downloads" link opens
exactly this search URL in a new tab (captured live via Playwright's
request/page interception, not guessed).

The firmware detail page itself is ALSO JS-rendered (confirmed live: a
plain curl fetch of it returns only prose upgrade-notes text, no
structured list -- the real download list only appears after
Playwright renders it). Real markup, confirmed live for
id=1-18U05WB (EKI-7712 Series):
    <a href="https://downloadt.advantech.com/download/downloadsr.aspx?File_Id=...">
      <div class="downloadItem clearfix">
        <div class="downloadTXT">
          <h4 class="downloadTitle">Firmware and MIB for EKI-7712 Series v1.02.03</h4>
          <span class="date">2023-04-20</span>
Confirmed live the real list is in ASCENDING date order (oldest first),
e.g. EKI-7712's real 6-entry history ran 2017-11-24 (v1.00.97) up to
2024-04-18 (v1.02.03_IncludeLoader) in that exact order -- so the LAST
row parsed is the newest, not the first (opposite of most other
vendors' pages here, called out explicitly since it's easy to get
backwards).

NO LOGIN GATE on the version data itself -- confirmed live there's only
a barcode-entry widget on the actual download button ("enter your
barcode to get this file"), tied to a physical unit's serial number,
not an account. Version numbers, release dates, and upgrade notes are
all fully public.

LOGIN SAFETY NET: if the search returns no firmware detail link for a
given model (a model not in Advantech's EKI switch lineup, or some
future account-gated change), this falls through to a real
browser-assisted login rather than dead-ending -- same pattern as every
other Tier-2 vendor here. HOME_URL is Advantech's own real SSO entry
point, confirmed live: https://www.advantech.com/en/sso/login (found
via a real "Log In" link on advantech.com/en/support) 302-redirects to
https://membership.advantech.com/en/login -- Advantech's genuine
membership login. CONFIRMED BAD LEAD, recorded honestly: a plausible-
looking "myadvantech.com" was checked first and turned out to be an
unrelated parked domain-for-sale page, not a real Advantech property --
using the real advantech.com-hosted SSO link instead. UNVERIFIED end-
to-end (no test account available), same honesty flag as every other
vendor using the generic authenticated path in providers/base.py.
"""
from __future__ import annotations

import re
from typing import Optional
from urllib.parse import quote

from firmware_lookup.providers.base import BrowserAuthenticatedProvider
from firmware_lookup.result import Confidence, FirmwareResult, ok_result
from firmware_lookup.versioning import is_update_available, parse_version

PORTAL_URL = "https://www.advantech.com/en/support"
HOME_URL = "https://www.advantech.com/en/sso/login"

SEARCH_URL_TEMPLATE = (
    "https://www.advantech.com/en/search/?q={model}&st=support&sst=Firmware"
)

# Real markup, verified live: the search-results page links a matching
# series' firmware detail page with this exact path shape.
_FIRMWARE_DETAIL_LINK_RE = re.compile(
    r'href="(/en/support/details/firmware\?id=[^"]+)"'
)
# Real markup, verified live on the firmware detail page itself.
_DOWNLOAD_ROW_RE = re.compile(
    r'<h4 class="downloadTitle">([^<]+)</h4>\s*<span class="date">([^<]+)</span>',
)
_VERSION_TOKEN_RE = re.compile(r"[Vv](\d+(?:\.\d+)+(?:_\w+)?)")


class AdvantechProvider(BrowserAuthenticatedProvider):
    HOME_URL = HOME_URL

    def __init__(self):
        super().__init__("Advantech", PORTAL_URL)

    def check_public_source(
        self, vendor: str, model: str, current_version: str,
    ) -> Optional[FirmwareResult]:
        if not model:
            return None

        try:
            from playwright.sync_api import sync_playwright
        except ImportError:
            return None

        try:
            with sync_playwright() as playwright:
                browser = playwright.chromium.launch(headless=True)
                try:
                    page = browser.new_page()
                    result = self._extract_firmware_version(
                        page, vendor, model, current_version,
                    )
                finally:
                    browser.close()
        except Exception:
            return None

        return result

    def _extract_firmware_version(
        self, page, vendor: str, model: str, current_version: str,
    ) -> Optional[FirmwareResult]:
        search_url = SEARCH_URL_TEMPLATE.format(model=quote(model.strip()))
        page.goto(search_url, wait_until="domcontentloaded", timeout=20000)
        page.wait_for_timeout(2000)
        search_html = page.content()

        detail_match = _FIRMWARE_DETAIL_LINK_RE.search(search_html)
        if not detail_match:
            return None
        detail_url = "https://www.advantech.com" + detail_match.group(1).replace("&amp;", "&")

        page.goto(detail_url, wait_until="domcontentloaded", timeout=20000)
        page.wait_for_timeout(2000)
        detail_html = page.content()

        rows = _DOWNLOAD_ROW_RE.findall(detail_html)
        if not rows:
            return None

        # Confirmed live: rows are in ASCENDING date order -- the LAST
        # row is the newest, not the first.
        latest_title, latest_date = rows[-1]
        version_match = _VERSION_TOKEN_RE.search(latest_title)
        if not version_match or not parse_version(version_match.group(1)):
            return None
        latest_version = version_match.group(1)

        return ok_result(
            vendor=vendor,
            model=model,
            current_version=current_version,
            latest_version=latest_version,
            source_url=detail_url,
            confidence=Confidence.HIGH,
            retrieval_method="public_browser",
            update_available=is_update_available(current_version, latest_version),
            message=(
                "Retrieved from Advantech's public support search (no "
                f"login required) -- the newest Firmware entry, released "
                f"{latest_date.strip()}. The actual download file needs "
                "a product barcode to unlock (tied to a physical unit's "
                "serial number, not an account), but the version/date "
                "itself is public."
            ),
        )
