"""
Antaira -- public, no login required, no bot-wall at all.

CORRECTED, found live after initially being registered as a no-viable-
path vendor: the earlier finding (2026-07-16) said no public firmware/
download repository could be found anywhere on antaira.com. RE-VERIFIED
LIVE 2026-07-22 (prompted by a real user screenshot of a live, reachable
Antaira product page showing a real "Firmware 6.2 Upgrade Bundle"
download link): antaira.com is NOT bot-walled at all -- plain
FirmwareHttpClient gets a clean 200 on every URL tried here, no
Cloudflare/Akamai/WAF page anywhere. The real gap in the earlier finding
was that individual PRODUCT pages (e.g. .../products/managed-10-100Mbps-
PoE/LMP-1202M-SFP-T) render their "DOWNLOAD" section (Firmware /
Software Manual / Product Datasheet / Hardware Manual links) via
client-side JS -- invisible to a plain HTTP fetch, hence the original
"nothing found" -- but rendered fine by a normal (no stealth flags even
needed) headless Chromium.

VERIFIED LIVE this session, the real, fully dynamic resolution chain
(no hardcoded model-to-category mapping anywhere):
  1. antaira.com runs on NetSuite SuiteCommerce (confirmed live: the
     real homepage search form's action is s.nl?ext=F, and firmware
     files are served from .../core/media/media.nl?..., both real
     NetSuite URL conventions). Its real site search is a plain GET:
     https://www.antaira.com/s.nl?ext=F&sc=46&category=&search=<model>
     -- confirmed live, no form submission needed, a direct URL works.
  2. The real product link in the results is identified by matching
     the search results page's own real product-shaped link (/products/
     <category-slug>/<model>) whose VISIBLE TEXT contains the searched
     model string -- not just any /products/ URL shape, since related/
     nav links elsewhere on the same results page share that same URL
     shape (confirmed live: a real search for "LMP-1202M-SFP-T" also
     returned unrelated /products/sena/accessories and /products/sena/
     Bluetooth links on the same page).
  3. On the real product page, the firmware VERSION is embedded
     directly in the download link's own visible text -- e.g.
     "Firmware 6.2 Upgrade Bundle" -- so the version can be read
     WITHOUT ever downloading the actual firmware file (confirmed live:
     the real href behind that text is a NetSuite media.nl binary
     download URL, never fetched here).

***HONESTY FLAG***: verified end-to-end for exactly ONE real product
(LMP-1202M-SFP-T). The "Firmware X.Y[.Z] ..." link-text shape and the
NetSuite search URL parameters (sc=46 in particular, a NetSuite
"search scope" ID) are treated as generic here but only actually
observed once -- other Antaira product categories/pages may format
their download section differently.
"""
from __future__ import annotations

import re
from typing import Optional

from firmware_lookup.providers.base import FirmwareProvider
from firmware_lookup.result import (
    Confidence, FirmwareResult, cannot_determine, model_not_found, ok_result,
)
from firmware_lookup.versioning import is_update_available, parse_version

PORTAL_URL = "https://www.antaira.com/Home/support"
SEARCH_URL_TEMPLATE = "https://www.antaira.com/s.nl?ext=F&sc=46&category=&search={query}"

_FIRMWARE_TEXT_RE = re.compile(r"firmware\s+(\d+(?:\.\d+)+)", re.IGNORECASE)

_STEALTH_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
)


def _find_product_url(page, model: str) -> Optional[str]:
    links = page.eval_on_selector_all(
        "a", "els => els.map(e => ({text: e.textContent.trim(), href: e.href}))",
    )
    model_lower = model.lower()
    for item in links:
        if model_lower in item.get("text", "").lower() and "/products/" in item.get("href", ""):
            return item["href"]
    return None


def _find_firmware_version(page) -> Optional[str]:
    texts = page.eval_on_selector_all("a", "els => els.map(e => e.textContent.trim())")
    for text in texts:
        m = _FIRMWARE_TEXT_RE.search(text)
        if m:
            return m.group(1)
    return None


class AntairaProvider(FirmwareProvider):
    """Fully public-source provider -- no login flow exists or is
    fabricated here; antaira.com has no bot-wall at all (see module
    docstring), just client-side-JS-rendered download sections."""

    def __init__(self):
        self.vendor_key = "Antaira"

    def get_latest_firmware(
        self, vendor: str, model: str, current_version: str,
    ) -> FirmwareResult:
        if not model:
            return model_not_found(
                vendor, model, current_version,
                retrieval_method="public_browser",
                manual_check_url=PORTAL_URL,
            )

        try:
            from playwright.sync_api import sync_playwright
        except ImportError:
            return cannot_determine(
                vendor, model, current_version,
                retrieval_method="public_browser",
                reason="Playwright is not installed in this environment.",
                manual_check_url=PORTAL_URL,
            )

        try:
            with sync_playwright() as playwright:
                browser = playwright.chromium.launch(
                    headless=True,
                    args=["--disable-blink-features=AutomationControlled"],
                )
                try:
                    return self._resolve(browser, vendor, model, current_version)
                finally:
                    browser.close()
        except Exception as e:
            return cannot_determine(
                vendor, model, current_version,
                retrieval_method="public_browser",
                reason=f"Antaira lookup failed: {e}.",
                manual_check_url=PORTAL_URL,
            )

    def _resolve(self, browser, vendor, model, current_version) -> FirmwareResult:
        context = browser.new_context(user_agent=_STEALTH_UA)
        try:
            context.add_init_script(
                "Object.defineProperty(navigator, 'webdriver', {get: () => undefined})"
            )
            page = context.new_page()
            page.goto(
                SEARCH_URL_TEMPLATE.format(query=model),
                wait_until="domcontentloaded", timeout=20000,
            )
            page.wait_for_timeout(2000)
            product_url = _find_product_url(page, model)
        finally:
            context.close()

        if not product_url:
            return model_not_found(
                vendor, model, current_version,
                retrieval_method="public_browser",
                manual_check_url=PORTAL_URL,
            )

        context = browser.new_context(user_agent=_STEALTH_UA)
        try:
            context.add_init_script(
                "Object.defineProperty(navigator, 'webdriver', {get: () => undefined})"
            )
            page = context.new_page()
            page.goto(product_url, wait_until="domcontentloaded", timeout=20000)
            page.wait_for_timeout(2000)
            latest_version = _find_firmware_version(page)
        except Exception as e:
            return cannot_determine(
                vendor, model, current_version,
                retrieval_method="public_browser",
                reason=f"Failed to load the product page: {e}.",
                manual_check_url=PORTAL_URL,
            )
        finally:
            context.close()

        if not latest_version or not parse_version(latest_version):
            return cannot_determine(
                vendor, model, current_version,
                retrieval_method="public_browser",
                reason=(
                    f"Found a real Antaira product page for {model!r}, but "
                    "no 'Firmware X.Y' download link was found on it."
                ),
                manual_check_url=PORTAL_URL,
            )

        return ok_result(
            vendor=vendor,
            model=model,
            current_version=current_version,
            latest_version=latest_version,
            source_url=product_url,
            confidence=Confidence.MEDIUM,
            retrieval_method="public_browser",
            update_available=is_update_available(current_version, latest_version),
            message=(
                "Retrieved from Antaira's public product page (no login "
                "required), discovered dynamically via its own site "
                "search -- not a hardcoded product mapping. The version "
                "is read from the download link's own visible text "
                "(e.g. 'Firmware 6.2 Upgrade Bundle'), not the firmware "
                "file itself, which is never downloaded."
            ),
        )
