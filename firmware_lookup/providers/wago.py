"""
WAGO -- Tier 1, public, no login (Industrial Managed Switch line).

VERIFIED LIVE this session: downloadcenter.wago.com/latest/firmware-<model>
is a real, fully public per-model firmware page (no login -- a "Login"
nav link exists but doesn't gate this content). The page is a JS
Angular SPA (confirmed live: plain curl/WebFetch only returns the app
shell; a real Playwright render is needed), with real markup:
    Version 1.2.8 (S1)
    Release Date 2026-03-23
Confirmed live for 3 different real models (852-303, 852-1813,
852-1305), each with its own real, current version and date -- the
model/article number is the URL slug directly, a plain mechanical
transform, not a maintained table.

CROSS-CHECKED, worth recording: a separate, static, no-login release-
notes PDF for 852-303 (downloadcenter.wago.com/api/uploads/..._852_303
_....pdf) shows an OLDER version (V01.02.08.S0, dated 2024-03-07) than
this live page (1.2.8 (S1), dated 2026-03-23) -- confirms the live SPA
page is the current, authoritative source and the PDF is a point-in-
time release note, not used here.
"""
from __future__ import annotations

import re
from typing import Optional

from firmware_lookup.providers.base import FirmwareProvider
from firmware_lookup.result import (
    Confidence, FirmwareResult, cannot_determine, model_not_found, ok_result,
)
from firmware_lookup.versioning import is_update_available, parse_version

PAGE_URL_TEMPLATE = "https://downloadcenter.wago.com/latest/firmware-{model}"
PORTAL_URL = "https://downloadcenter.wago.com/"

# Real markup, verified live: the version text is immediately followed
# (across some intervening icon/SVG markup) by the release-date div's
# own automationid attribute.
_FIRMWARE_RE = re.compile(
    r"Version\s+(\d+(?:\.\d+)+)\s*(?:\([^)]*\))?\s*</div>.*?"
    r'automationid="artifactReleaseDate"[^>]*>\s*<span[^>]*>Release Date\s*([\d-]+)',
    re.DOTALL,
)


class WagoProvider(FirmwareProvider):
    def __init__(self):
        self.vendor_key = "WAGO"

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
                reason="Playwright not available to load WAGO's download center.",
                manual_check_url=PORTAL_URL,
            )

        url = PAGE_URL_TEMPLATE.format(model=model.strip())
        try:
            with sync_playwright() as playwright:
                browser = playwright.chromium.launch(headless=True)
                try:
                    page = browser.new_page()
                    resp = page.goto(url, wait_until="networkidle", timeout=20000)
                    status = resp.status if resp else None
                    page.wait_for_timeout(1500)
                    html = page.content()
                finally:
                    browser.close()
        except Exception as e:
            return cannot_determine(
                vendor, model, current_version,
                retrieval_method="public_browser",
                reason=f"WAGO's download center failed to load: {e}.",
                manual_check_url=PORTAL_URL,
            )

        if status == 404:
            return model_not_found(
                vendor, model, current_version,
                retrieval_method="public_browser",
                manual_check_url=PORTAL_URL,
            )

        match = _FIRMWARE_RE.search(html)
        if not match or not parse_version(match.group(1)):
            return model_not_found(
                vendor, model, current_version,
                retrieval_method="public_browser",
                manual_check_url=PORTAL_URL,
            )
        latest_version = match.group(1)
        release_date = match.group(2)

        return ok_result(
            vendor=vendor,
            model=model,
            current_version=current_version,
            latest_version=latest_version,
            source_url=url,
            confidence=Confidence.HIGH,
            retrieval_method="public_browser",
            update_available=is_update_available(current_version, latest_version),
            message=(
                "Retrieved from WAGO's public Download Center (no "
                f"login required) -- released {release_date}."
            ),
        )
