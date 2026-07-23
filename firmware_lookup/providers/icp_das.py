"""
ICP DAS -- Tier 1, public, no login.

VERIFIED LIVE this session: icpdas.com/en/download/index.php?kind1=7&model={model}
is a real, public, no-login, per-model Firmware-category filter (a
"login" nav link exists but doesn't gate this page). Confirmed live
for 3 real managed switch models (iNS-306, iNS-308, iNS-316 -- all in
the "Industrial IoT Switch iNS-300 Series" family): each returns a
real results table
    FILE NAME | DESCRIPTION | MODEL | LAST UPDATE
    Industrial IoT Switch iNS-300 Series | Vol. iNS_F.2.25.01_EN | iNS-306 | 2025-01-21
-- the whole iNS-300 family shares one firmware release (a real,
family-wide publishing pattern, not a per-model difference). Cross-
checked NS-208 (a genuinely UNMANAGED switch in the same product line)
through this same URL pattern: no table/no firmware entry at all --
confirms unmanaged models genuinely have no firmware to publish here,
not a bug in this filter.
"""
from __future__ import annotations

import re
from typing import Optional

from firmware_lookup.providers.base import FirmwareProvider
from firmware_lookup.result import (
    Confidence, FirmwareResult, cannot_determine, model_not_found, ok_result,
)
from firmware_lookup.versioning import is_update_available, parse_version

PAGE_URL_TEMPLATE = "https://www.icpdas.com/en/download/index.php?kind1=7&model={model}"
PORTAL_URL = "https://www.icpdas.com/en/download/index.php"

_VERSION_TOKEN_RE = re.compile(r"([A-Za-z0-9]+_[A-Za-z]\.\d+(?:\.\d+)*(?:_[A-Za-z]+)?)")


def _parse_result_table(table_text: str, model: str) -> Optional[tuple[str, str]]:
    """Real markup, verified live: header row 'FILE NAME DESCRIPTION
    MODEL LAST UPDATE', then one data row with a genuine leading empty
    cell -- '\\tFILE_NAME\\tDESCRIPTION\\tMODEL\\tLAST_UPDATE'. Returns
    (version, last_update) or None if no matching data row exists."""
    rows = [r for r in table_text.splitlines() if r.strip()]
    for row in rows:
        cells = row.split("\t")
        if cells and cells[0] == "":
            cells = cells[1:]
        if len(cells) >= 3 and cells[2].strip().lower() == model.strip().lower():
            description = cells[1].strip()
            last_update = cells[3].strip() if len(cells) > 3 else ""
            version_match = _VERSION_TOKEN_RE.search(description)
            version = version_match.group(1) if version_match else description
            return version, last_update
    return None


class IcpDasProvider(FirmwareProvider):
    def __init__(self):
        self.vendor_key = "ICP DAS"

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
                reason="Playwright not available to load ICP DAS's download center.",
                manual_check_url=PORTAL_URL,
            )

        url = PAGE_URL_TEMPLATE.format(model=model.strip())
        try:
            with sync_playwright() as playwright:
                browser = playwright.chromium.launch(headless=True)
                try:
                    page = browser.new_page()
                    page.goto(url, wait_until="networkidle", timeout=25000)
                    page.wait_for_timeout(1500)
                    text = page.inner_text("body")
                finally:
                    browser.close()
        except Exception as e:
            return cannot_determine(
                vendor, model, current_version,
                retrieval_method="public_browser",
                reason=f"ICP DAS's download center failed to load: {e}.",
                manual_check_url=PORTAL_URL,
            )

        idx = text.find("FILE NAME")
        if idx < 0:
            return model_not_found(
                vendor, model, current_version,
                retrieval_method="public_browser",
                manual_check_url=PORTAL_URL,
            )

        parsed = _parse_result_table(text[idx:], model)
        if not parsed or not parse_version(parsed[0]):
            return model_not_found(
                vendor, model, current_version,
                retrieval_method="public_browser",
                manual_check_url=PORTAL_URL,
            )

        latest_version, last_update = parsed

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
                "Retrieved from ICP DAS's public Download Center (no "
                f"login required) -- last updated {last_update}."
            ),
        )
