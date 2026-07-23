"""
Lenovo -- public, no login required, but only reachable via Playwright's
FIREFOX engine, not Chromium.

CORRECTED, found live after initially being registered as genuinely
unreachable: support.lenovo.com IS still genuinely dead (confirmed
again 2026-07-22 -- both plain curl and Chromium time out completely,
0 bytes, matching the original 2026-07-17 finding). But a real user
screenshot showed a DIFFERENT, real, working domain --
datacentersupport.lenovo.com -- with a genuine, current firmware
download table for a real switch (NE2572, version 10.10.17.100, dated
08 Aug 2024).

CONFIRMED LIVE, the actual technical obstacle on that working domain:
Chromium (every other provider in this file uses Chromium) gets an
immediate net::ERR_HTTP2_PROTOCOL_ERROR on datacentersupport.lenovo.com
-- a real HTTP/2 negotiation failure specific to Chromium's stack, not
a bot-block (disabling HTTP/2 via a launch flag just makes it hang
instead). Playwright's FIREFOX engine has no such issue -- confirmed
live, loads cleanly, renders the real client-side-JS-populated firmware
table correctly. This is the one provider in this codebase that
deliberately launches playwright.firefox instead of playwright.chromium
for exactly this reason.

VERIFIED LIVE this session, the real, fully dynamic resolution chain
(no hardcoded model/product-ID mapping anywhere):
  1. https://datacentersupport.lenovo.com/us/en/search?query=<model> is
     a real, public search endpoint (no login) -- confirmed live,
     returns real product links for a real model number.
  2. Real product links in the results match
     /products/networking/<family>/<model-slug>/<product-id> (e.g.
     ".../rackswitch/ne2572/7159") -- the family segment ("rackswitch")
     and the numeric product-id are genuine per-product identifiers
     that cannot be derived from the model name alone, which is why
     search (not a URL-guess) is the resolution mechanism here, unlike
     EtherWAN's simpler "<model>-series" convention.
  3. That product URL's own real downloads tab,
     <product_url>/downloads/driver-list/component?name=Switch,
     renders (client-side JS, hence the Firefox requirement above) a
     real, dated firmware table -- confirmed live: newest-first by
     release date, e.g. "Lenovo Rackswitch NE2572 Firmware Update (For
     AnyOS)" at 10.10.17.100 (08 Aug 2024) ranked above older
     10.10.17.0 (17 May 2024) and 10.9.3.0 (2018) entries.
  4. A SEPARATE "... ONIE Firmware Update" entry exists on the same
     page for the SAME product -- this is a network boot-loader/
     installer image, not the switch OS firmware itself, and is
     explicitly excluded from the version scan (same category of
     exclusion as Cisco's FPGA/EPLD filter or Dell's diagnostics-tool
     filter elsewhere in this codebase).

***HONESTY FLAG***: verified end-to-end for exactly ONE real product
(NE2572). The `?name=Switch` component filter, the
"/downloads/driver-list/component" sub-path shape, and the "exclude
ONIE" rule are treated as generic here, but were only actually observed
once -- other Lenovo networking families/products may have a
differently-shaped downloads page. Also unverified: what happens when a
bare model number (e.g. "NE2572") matches MULTIPLE real "Type NNNN"
hardware variants in search results -- the first product-shaped result
is used (matching this project's established "trust the vendor's own
search ranking" precedent elsewhere), which may not always be the
Type variant the user actually has.
"""
from __future__ import annotations

import re
from typing import Optional

from firmware_lookup.providers.base import FirmwareProvider
from firmware_lookup.result import (
    Confidence, FirmwareResult, cannot_determine, model_not_found, ok_result,
)
from firmware_lookup.versioning import is_update_available, parse_version

PORTAL_URL = "https://datacentersupport.lenovo.com/us/en/products/networking"
SEARCH_URL_TEMPLATE = "https://datacentersupport.lenovo.com/us/en/search?query={query}"

_PRODUCT_URL_RE = re.compile(r"/products/[a-z0-9/-]+/\d+$")
_VERSION_RE = re.compile(r"\d+\.\d+\.\d+\.\d+")

_FIREFOX_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:126.0) "
    "Gecko/20100101 Firefox/126.0"
)


def _find_product_url(page) -> Optional[str]:
    links = page.eval_on_selector_all(
        "a", "els => els.map(e => ({text: e.textContent.trim(), href: e.href}))",
    )
    for item in links:
        if _PRODUCT_URL_RE.search(item.get("href", "")):
            return item["href"]
    return None


def _extract_version_from_table(body_text: str) -> Optional[str]:
    """Scans the rendered downloads-tab text for the first (= newest,
    confirmed live to be date-descending) real firmware-update entry,
    excluding ONIE boot-loader images (see module docstring)."""
    lines = body_text.splitlines()
    for i, line in enumerate(lines):
        low = line.lower()
        if "firmware update" in low and "onie" not in low:
            for nxt in lines[i + 1 : i + 6]:
                m = _VERSION_RE.search(nxt)
                if m:
                    return m.group(0)
    return None


class LenovoProvider(FirmwareProvider):
    """Fully public-source provider -- no login flow exists or is
    fabricated here; support.lenovo.com is confirmed genuinely
    unreachable (see module docstring), but this is a different,
    working domain entirely."""

    def __init__(self):
        self.vendor_key = "Lenovo"

    def get_latest_firmware(
        self, vendor: str, model: str, current_version: str,
    ) -> FirmwareResult:
        if not model:
            return model_not_found(
                vendor, model, current_version,
                retrieval_method="public_browser_firefox",
                manual_check_url=PORTAL_URL,
            )

        try:
            from playwright.sync_api import sync_playwright
        except ImportError:
            return cannot_determine(
                vendor, model, current_version,
                retrieval_method="public_browser_firefox",
                reason="Playwright is not installed in this environment.",
                manual_check_url=PORTAL_URL,
            )

        try:
            with sync_playwright() as playwright:
                # Firefox, deliberately, not Chromium -- see module
                # docstring for the real, confirmed HTTP/2 error this
                # avoids on this specific domain.
                browser = playwright.firefox.launch(headless=True)
                try:
                    return self._resolve(browser, vendor, model, current_version)
                finally:
                    browser.close()
        except Exception as e:
            return cannot_determine(
                vendor, model, current_version,
                retrieval_method="public_browser_firefox",
                reason=f"Lenovo lookup failed: {e}.",
                manual_check_url=PORTAL_URL,
            )

    def _resolve(self, browser, vendor, model, current_version) -> FirmwareResult:
        context = browser.new_context(user_agent=_FIREFOX_UA)
        try:
            page = context.new_page()
            page.goto(
                SEARCH_URL_TEMPLATE.format(query=model),
                wait_until="domcontentloaded", timeout=20000,
            )
            page.wait_for_timeout(3000)
            product_url = _find_product_url(page)
        finally:
            context.close()

        if not product_url:
            return model_not_found(
                vendor, model, current_version,
                retrieval_method="public_browser_firefox",
                manual_check_url=PORTAL_URL,
            )

        context = browser.new_context(user_agent=_FIREFOX_UA)
        try:
            page = context.new_page()
            downloads_url = f"{product_url}/downloads/driver-list/component?name=Switch"
            page.goto(downloads_url, wait_until="domcontentloaded", timeout=20000)
            page.wait_for_timeout(4000)
            body_text = page.inner_text("body")
        except Exception as e:
            return cannot_determine(
                vendor, model, current_version,
                retrieval_method="public_browser_firefox",
                reason=f"Failed to load the downloads tab: {e}.",
                manual_check_url=PORTAL_URL,
            )
        finally:
            context.close()

        latest_version = _extract_version_from_table(body_text)
        if not latest_version or not parse_version(latest_version):
            return cannot_determine(
                vendor, model, current_version,
                retrieval_method="public_browser_firefox",
                reason=(
                    f"Found a real Lenovo product page for {model!r}, but "
                    "no firmware-versioned entry was found on its "
                    "downloads tab."
                ),
                manual_check_url=PORTAL_URL,
            )

        return ok_result(
            vendor=vendor,
            model=model,
            current_version=current_version,
            latest_version=latest_version,
            source_url=downloads_url,
            confidence=Confidence.MEDIUM,
            retrieval_method="public_browser_firefox",
            update_available=is_update_available(current_version, latest_version),
            message=(
                "Retrieved from Lenovo's public Data Center Support site "
                "(no login required), discovered dynamically via its own "
                "search -- not a hardcoded product-ID mapping. Excludes "
                "ONIE boot-loader images; picks the newest dated "
                "'Firmware Update' entry."
            ),
        )
