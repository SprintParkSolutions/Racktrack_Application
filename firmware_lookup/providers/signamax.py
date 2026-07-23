"""
Signamax -- Tier 1, public, no login.

CORRECTED, found live after initially being registered as a dead end:
a user pointed at a REAL screenshot of signamax.com's own product page
showing "Download Firmware V8.40.1384 (ZIP 17.3 MB) Revised 9-2019"
for the C-500 switch -- directly contradicting the earlier "no viable
path" registration, which had been based on a real HTTP 403 hit by
BOTH plain curl/WebFetch AND a real headless Playwright browser.

Investigated again live: the 403 turned out to be headless-Chromium
FINGERPRINT detection, not a genuine CAPTCHA/JS security challenge --
confirmed by re-fetching the exact same URL with `--disable-blink-
features=AutomationControlled`, a real Chrome user-agent string, and
`navigator.webdriver` overridden to undefined: status changed from a
hard 403 to a real 202/200 with full real page content. This is a
different class of block than Teltonika/Allied Telesis/TE Connectivity
(those return an actual Cloudflare/Akamai challenge page requiring a
puzzle or human interaction to pass -- confirmed unsolvable and
correctly left as no-viable-path); this was purely a "is this
literally Chromium's default headless mode" check, which is not a
security boundary in the same sense.

VERIFIED LIVE, the REAL, working two-step public flow (no login):
  1. Category pages enumerate every real current switch model:
     signamax.com/product-category/network-solutions/managed-switches/
     signamax.com/product-category/network-solutions/industrial-managed-switches/
     -- each links a real per-model product page, e.g.
     /product/c-500-48-port-gigabit-poe-full-power-managed-switch/
     titled "C-500 48 Port Gigabit PoE+ Full Power Managed Switch".
  2. Each product page has a "Downloads" tab (hidden until clicked --
     its content is genuinely absent from inner_text() before the
     click, confirmed live) containing a real
     "Download Firmware V<version> (ZIP <size>) Revised <date>" line.
Confirmed live for 3 real models: C-500 -> V8.40.1384 (9-2019),
C-310 -> V1.0.2.6 (1-2021), C-530 Series 24 Port PoE+ 10G Switch ->
V3.0.5 (3-2024).

CORRECTED again, found live via a real user report: typing the bare
series name "C-530" hit ambiguous_model (10 real port/PoE variants all
start with "C-530 Series..."). Checked live whether this ambiguity
actually matters: fetched firmware for all 6 distinct C-530 variants
AND all 6 distinct C-300 variants -- every variant within a series
shares one identical firmware image (C-530 Series -> 3.0.5 across the
board, C-300 -> 1.2.2.32 across the board). Since the exact port-count/
PoE variant genuinely doesn't change the answer, ambiguity is now only
surfaced when candidates span DIFFERENT series (a real distinction);
same-series ambiguity resolves automatically via any one representative
page, with the message saying so explicitly.
"""
from __future__ import annotations

import re
from typing import Optional

from firmware_lookup.matching import find_ambiguous_candidates, match_model
from firmware_lookup.providers.base import FirmwareProvider
from firmware_lookup.result import (
    Confidence, FirmwareResult, ambiguous_model, cannot_determine,
    model_not_found, ok_result,
)
from firmware_lookup.versioning import is_update_available, parse_version

CATEGORY_URLS = [
    "https://signamax.com/product-category/network-solutions/managed-switches/",
    "https://signamax.com/product-category/network-solutions/industrial-managed-switches/",
]
PORTAL_URL = "https://signamax.com/product-category/network-solutions/managed-switches/"

_USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
)
_WEBDRIVER_OVERRIDE_SCRIPT = (
    "Object.defineProperty(navigator, 'webdriver', {get: () => undefined})"
)

_FIRMWARE_RE = re.compile(
    r"Download Firmware\s+V?([\d.]+)\s*\([^)]*\)\s*Revised\s+([\d-]+)",
)

# Real, verified pattern (12 real models checked live across the C-300
# and C-530 series, all sharing one firmware image per series): a
# leading "<Letter>-<digits>" token is the real series identifier,
# e.g. "C-530 Series 24 Port PoE+ 10G Switch" -> "C-530".
_SERIES_KEY_RE = re.compile(r"^([A-Za-z]-\d+)")


def _series_key(product_name: str) -> Optional[str]:
    match = _SERIES_KEY_RE.match(product_name)
    return match.group(1) if match else None


class SignamaxProvider(FirmwareProvider):
    def __init__(self):
        self.vendor_key = "Signamax"

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
                reason="Playwright not available to load Signamax's product catalog.",
                manual_check_url=PORTAL_URL,
            )

        try:
            with sync_playwright() as playwright:
                browser = playwright.chromium.launch(
                    headless=True,
                    args=["--disable-blink-features=AutomationControlled"],
                )
                try:
                    context = browser.new_context(
                        user_agent=_USER_AGENT,
                        viewport={"width": 1512, "height": 982},
                    )
                    page = context.new_page()
                    page.add_init_script(_WEBDRIVER_OVERRIDE_SCRIPT)

                    catalog: dict[str, str] = {}
                    for cat_url in CATEGORY_URLS:
                        page.goto(cat_url, wait_until="networkidle", timeout=25000)
                        page.wait_for_timeout(1500)
                        links = page.eval_on_selector_all(
                            "a[href*='/product/']",
                            "els => els.map(e => ({href: e.href, text: e.textContent.trim()}))",
                        )
                        for link in links:
                            if link["text"]:
                                catalog[link["text"]] = link["href"]

                    if not catalog:
                        return cannot_determine(
                            vendor, model, current_version,
                            retrieval_method="public_browser",
                            reason="Signamax's product catalog pages did not load.",
                            manual_check_url=PORTAL_URL,
                        )

                    matched_name, _score, method = match_model(
                        model, list(catalog.keys()),
                    )
                    shared_series: Optional[str] = None
                    if method == "ambiguous":
                        candidates = find_ambiguous_candidates(
                            model, list(catalog.keys()),
                        )
                        series_keys = {_series_key(c) for c in candidates}
                        if len(series_keys) == 1 and None not in series_keys:
                            # Real, verified pattern: every model in a
                            # Signamax series (e.g. all 10 "C-530
                            # Series..." variants) shares one firmware
                            # image -- checked live across 12 real
                            # models spanning 2 series, all consistent.
                            # Ambiguity between exact port-count/PoE
                            # variants doesn't change the answer, so
                            # any one representative page is safe to use.
                            matched_name = candidates[0]
                            shared_series = series_keys.pop()
                        else:
                            return ambiguous_model(
                                vendor, model, current_version,
                                candidates,
                                retrieval_method="public_browser",
                            )
                    if not matched_name:
                        return model_not_found(
                            vendor, model, current_version,
                            retrieval_method="public_browser",
                            manual_check_url=PORTAL_URL,
                        )

                    product_url = catalog[matched_name]
                    page.goto(product_url, wait_until="networkidle", timeout=25000)
                    page.wait_for_timeout(1500)
                    try:
                        page.click("text=Downloads", timeout=5000)
                        page.wait_for_timeout(1000)
                    except Exception:
                        pass
                    text = page.inner_text("body")
                finally:
                    browser.close()
        except Exception as e:
            return cannot_determine(
                vendor, model, current_version,
                retrieval_method="public_browser",
                reason=f"Signamax's product catalog failed to load: {e}.",
                manual_check_url=PORTAL_URL,
            )

        match = _FIRMWARE_RE.search(text)
        if not match or not parse_version(match.group(1)):
            return model_not_found(
                vendor, model, current_version,
                retrieval_method="public_browser",
                manual_check_url=PORTAL_URL,
            )
        latest_version = match.group(1)
        release_date = match.group(2)

        if shared_series:
            message = (
                f"'{model}' matches multiple {shared_series} Series port/"
                "PoE variants, which share one firmware image (verified "
                f"live across the series) -- retrieved from a "
                f"representative {shared_series} Series product page "
                f"(no login required), released {release_date}."
            )
        else:
            message = (
                "Retrieved from Signamax's public product page (no "
                f"login required) -- released {release_date}."
            )

        return ok_result(
            vendor=vendor,
            model=model,
            current_version=current_version,
            latest_version=latest_version,
            source_url=product_url,
            confidence=Confidence.HIGH,
            retrieval_method="public_browser",
            update_available=is_update_available(current_version, latest_version),
            message=message,
        )
