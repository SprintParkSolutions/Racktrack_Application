"""
RUCKUS Networks -- Tier 2, login-gated (with a real public shortcut for
ICX switches -- see below).

VERIFIED LIVE this session, extensively: real login DOES work (a real
account was created and authenticated -- confirmed via a real debug
screenshot showing an actual name/email in the top nav). But real
firmware DOWNLOAD content was never reachable through the generic
search box no matter what model string was tried (ICX7150, ICX7150-48P,
ICX7250, ICX8200, ICX7650, ICX7550, "ICX 8100" -- all model_not_found,
confirmed live). The "Software Downloads" content-source facet in
search results appeared inconsistently and was never present for any
of these queries -- strong evidence that real firmware files need an
entitlement (a registered product) beyond just being logged in, which a
freshly-created generic account doesn't have. The login path above is
kept as an honest fallback but is NOT expected to resolve real data for
most accounts.

VERIFIED LIVE (decisive, user-found): a completely different, FULLY
PUBLIC page structure exists and was found by the user directly
browsing the site (not via search) --
support.ruckuswireless.com/product_families/21-ruckus-icx-switches --
a single static page listing EVERY RUCKUS ICX switch family (8100,
7150, 8200, 7550, 7650, 7750, 7850) together, each with a real
"Stability Release" / "Base release" / "Patches" line naming an exact
FastIron version, e.g. "RUCKUS ICX FastIron 10.0.10g_cd6 (GA)" for most
of them, but genuinely DIFFERENT for 7750 specifically ("RUCKUS ICX
FastIron 08.0.95s (GA)") -- confirming this is real per-model data, not
one blanket number copy-pasted everywhere. Confirmed live via a
completely anonymous Playwright session (no storage_state, no cookies
at all) that this exact page and exact content loads with ZERO
authentication -- "LOGIN" still shows in the top nav the whole time.

This is used as check_public_source(): the page is fetched once,
split into per-model sections by heading, and the requested model is
matched against those headings before extracting a version from ONLY
that model's own section -- never a different model's number, even
though they're all on one page.

***HONESTY FLAG***: only covers RUCKUS ICX switches (one product
family page, one verified URL). Other RUCKUS product lines (SmartZone,
Unleashed, access points) are NOT covered by this and will fall through
to the still-mostly-unverified login path.
"""
from __future__ import annotations

import re
from typing import Optional

from firmware_lookup.providers.base import BrowserAuthenticatedProvider
from firmware_lookup.result import Confidence, FirmwareResult, ok_result
from firmware_lookup.versioning import is_update_available

PORTAL_URL = "https://support.ruckuswireless.com"
HOME_URL = PORTAL_URL

# Verified live: one static page lists every RUCKUS ICX switch family
# together, fully publicly, no login.
ICX_FAMILY_URL = "https://support.ruckuswireless.com/product_families/21-ruckus-icx-switches"

# Real heading format: "RUCKUS ICX 8100 Campus Switches" (verified live
# across all 7 current ICX families).
MODEL_HEADING_PATTERN = re.compile(r"RUCKUS ICX (\w+) Campus Switches")

# Real FastIron version format, e.g. "10.0.10g_cd6", "08.0.95s" --
# verified live, two genuinely different real examples on the same page.
FASTIRON_VERSION_PATTERN = re.compile(r"\b\d{2}\.\d\.\d{1,3}[a-z]?(?:_[a-z0-9]+)?\b")


class RuckusProvider(BrowserAuthenticatedProvider):
    HOME_URL = HOME_URL

    def __init__(self):
        super().__init__("RUCKUS", PORTAL_URL)

    def check_public_source(
        self, vendor: str, model: str, current_version: str,
    ) -> Optional[FirmwareResult]:
        if not model:
            return None

        # Only handles ICX switches -- if the typed model doesn't look
        # like an ICX model number at all, don't even try (avoids a
        # pointless fetch for e.g. an AP or SmartZone model).
        model_digits = re.search(r"\d{3,4}", model)
        if not model_digits:
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
                    page.goto(ICX_FAMILY_URL, wait_until="domcontentloaded", timeout=30000)
                    page.wait_for_timeout(4000)
                    body_text = page.inner_text("body")
                finally:
                    browser.close()
        except Exception:
            return None

        # Split into per-model sections by heading so extraction can
        # never grab a DIFFERENT model's version (verified live that
        # ICX 7750 genuinely differs from the rest on this exact page).
        headings = list(MODEL_HEADING_PATTERN.finditer(body_text))
        target_digits = model_digits.group(0)
        matched_section = None
        for i, h in enumerate(headings):
            if h.group(1) == target_digits:
                start = h.end()
                end = headings[i + 1].start() if i + 1 < len(headings) else len(body_text)
                matched_section = body_text[start:end]
                break

        if matched_section is None:
            return None

        candidates = FASTIRON_VERSION_PATTERN.findall(matched_section)
        if not candidates:
            return None

        latest_version = candidates[0].strip()
        return ok_result(
            vendor=vendor,
            model=model,
            current_version=current_version,
            latest_version=latest_version,
            source_url=ICX_FAMILY_URL,
            confidence=Confidence.MEDIUM,
            retrieval_method="public_browser",
            update_available=is_update_available(current_version, latest_version),
            message=(
                "Retrieved from RUCKUS's public ICX product family page "
                "(verified live to work with no login at all) -- "
                "extracted from the section specifically matching this "
                "model, not a different one on the same page. Only "
                "covers ICX switches; other RUCKUS product lines still "
                "need login."
            ),
        )
