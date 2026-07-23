"""
EnGenius -- Tier 1, public, no login.

VERIFIED LIVE this session: engeniustech.com/engenius-firmware-updates.html
is a real, public, no-login firmware finder with a real
<input id="search-input"> ("Search by product model name/number").
Submitting it navigates to engeniustech.com/eu/downloads and lists
real per-product result links (confirmed live: searching "ECS" returns
23 real results, searching a fake model returns "0 results"). Each
result link's text is "<Series Name> - <MODEL CODE> <Description>",
e.g. "CloudSwitch L2Plus 24 - ECS1528T Cloud Managed 24-Port Gigabit
Switch with 4 SFP+ Ports".

Clicking a result opens /eu/download-result?post_id=<id>, a real
per-product downloads table with columns Type | Name | Version |
Release Date | Download | Checksum. Confirmed live for ECS1528T: 8
real "Firmware" rows spanning v1.2.90 (2024-10-01) through
v1.2.130-193 (2026-05-27) -- the newest by RELEASE DATE, not row
order, since a non-firmware "MIB" row is interleaved after the second-
newest firmware row. Version is always parsed by comparing real
Release Date values, not assumed sorted.
"""
from __future__ import annotations

import re
from datetime import datetime
from typing import Optional

from firmware_lookup.matching import find_ambiguous_candidates, match_model
from firmware_lookup.providers.base import FirmwareProvider
from firmware_lookup.result import (
    Confidence, FirmwareResult, ambiguous_model, cannot_determine,
    model_not_found, ok_result,
)
from firmware_lookup.versioning import is_update_available, parse_version

FIRMWARE_FINDER_URL = "https://www.engeniustech.com/engenius-firmware-updates.html"
SEARCH_INPUT_SELECTOR = "#search-input"

# Real markup, verified live: "<Series Name>\n\t\t\t\t - <MODEL>\n..."
_MODEL_CODE_RE = re.compile(r"-\s*([A-Za-z0-9]+)\s")


def _extract_model_code(link_text: str) -> Optional[str]:
    match = _MODEL_CODE_RE.search(link_text)
    return match.group(1) if match else None


def _pick_latest_firmware_row(table_text: str) -> Optional[tuple[str, str]]:
    """Real markup: header 'Type Name Version Release Date Download
    Checksum', then one tab-separated data row per file. Returns
    (version, release_date_str) for the Firmware-type row with the
    latest real Release Date, or None if no Firmware row exists."""
    best: Optional[tuple[datetime, str, str]] = None
    for row in table_text.splitlines():
        cells = row.split("\t")
        if not cells or cells[0].strip() != "Firmware":
            continue
        if len(cells) < 4:
            continue
        version = cells[2].strip()
        date_str = cells[3].strip()
        try:
            parsed_date = datetime.strptime(date_str, "%B %d, %Y")
        except ValueError:
            continue
        if best is None or parsed_date > best[0]:
            best = (parsed_date, version, date_str)
    if best is None:
        return None
    return best[1], best[2]


class EnGeniusProvider(FirmwareProvider):
    def __init__(self):
        self.vendor_key = "EnGenius"

    def get_latest_firmware(
        self, vendor: str, model: str, current_version: str,
    ) -> FirmwareResult:
        if not model:
            return cannot_determine(
                vendor, model, current_version,
                retrieval_method="public_browser",
                reason="No model given.",
                manual_check_url=FIRMWARE_FINDER_URL,
            )

        try:
            from playwright.sync_api import sync_playwright
        except ImportError:
            return cannot_determine(
                vendor, model, current_version,
                retrieval_method="public_browser",
                reason="Playwright not available to load EnGenius's firmware finder.",
                manual_check_url=FIRMWARE_FINDER_URL,
            )

        try:
            with sync_playwright() as playwright:
                browser = playwright.chromium.launch(headless=True)
                try:
                    page = browser.new_page()
                    page.goto(
                        FIRMWARE_FINDER_URL, wait_until="networkidle", timeout=25000,
                    )
                    page.wait_for_timeout(1500)
                    page.fill(SEARCH_INPUT_SELECTOR, model.strip())
                    page.keyboard.press("Enter")
                    page.wait_for_timeout(2500)

                    links = page.eval_on_selector_all(
                        "a[href*='download-result']",
                        "els => els.map(e => ({href: e.href, text: e.textContent}))",
                    )
                    catalog: dict[str, str] = {}
                    for link in links:
                        code = _extract_model_code(link["text"])
                        if code:
                            catalog[code] = link["href"]

                    if not catalog:
                        return model_not_found(
                            vendor, model, current_version,
                            retrieval_method="public_browser",
                            manual_check_url=FIRMWARE_FINDER_URL,
                        )

                    matched_code, _score, method = match_model(
                        model, list(catalog.keys()),
                    )
                    if method == "ambiguous":
                        return ambiguous_model(
                            vendor, model, current_version,
                            find_ambiguous_candidates(model, list(catalog.keys())),
                            retrieval_method="public_browser",
                        )
                    if not matched_code:
                        return model_not_found(
                            vendor, model, current_version,
                            retrieval_method="public_browser",
                            manual_check_url=FIRMWARE_FINDER_URL,
                        )

                    product_url = catalog[matched_code]
                    page.goto(
                        product_url, wait_until="networkidle", timeout=25000,
                    )
                    page.wait_for_timeout(1500)
                    tables = page.query_selector_all("table")
                    table_text = tables[0].inner_text() if tables else ""
                finally:
                    browser.close()
        except Exception as e:
            return cannot_determine(
                vendor, model, current_version,
                retrieval_method="public_browser",
                reason=f"EnGenius's firmware finder failed to load: {e}.",
                manual_check_url=FIRMWARE_FINDER_URL,
            )

        picked = _pick_latest_firmware_row(table_text)
        if not picked or not parse_version(picked[0]):
            return model_not_found(
                vendor, model, current_version,
                retrieval_method="public_browser",
                manual_check_url=FIRMWARE_FINDER_URL,
            )
        latest_version, release_date = picked

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
                "Retrieved from EnGenius's public firmware finder (no "
                f"login required) -- released {release_date}."
            ),
        )
