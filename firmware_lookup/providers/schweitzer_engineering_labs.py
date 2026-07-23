"""
Schweitzer Engineering Laboratories (SEL) -- Tier 1, public, no login.

VERIFIED LIVE this session: selinc.com/products/firmware/ is a real,
fully public, no-login firmware finder (a "Login" nav link exists but
doesn't gate this page or its data) -- an earlier research pass using
a non-browser fetch tool got an empty/bot-walled-looking shell and
wrongly flagged this as blocked; a real headless Playwright render
loads it fine (HTTP 200), proving that was a false negative, not a
real block.

The page is an AngularJS SPA with a real <select id="filter_versionProduct">
dropdown listing every real current product (134 options confirmed
live, including real switch models e.g. SEL-2740S, SEL-2730M, SEL-2742S).
Selecting one populates a real results <table> with columns:
    Product | Revision | Firmware ID | Date Available | Serial Number
Confirmed live for 3 different real switch models:
    SEL-2740S -> Revision R113-V2, Firmware ID
                 SEL-2740S-R113-V2-Z001001-D20260601, dated 6/8/26
    SEL-2742S -> Revision R112-V6, dated 6/8/26
    SEL-3620  -> Revision R215-V0, dated 10/3/24

Confirmed real switch models (per-product pages, not guessed):
SEL-2740S = "Software-Defined Network Switch" (flagged Last-Time-Buy
on its own product page, still a current real product with firmware
published); SEL-2730M = "Managed 24-Port Ethernet Switch".
"""
from __future__ import annotations

from typing import Optional

from firmware_lookup.matching import find_ambiguous_candidates, match_model
from firmware_lookup.providers.base import FirmwareProvider
from firmware_lookup.result import (
    Confidence, FirmwareResult, ambiguous_model, cannot_determine,
    model_not_found, ok_result,
)
from firmware_lookup.versioning import is_update_available, parse_version

FIRMWARE_PAGE_URL = "https://selinc.com/products/firmware/"
SELECT_ID = "#filter_versionProduct"


def _parse_result_table(table_text: str, matched_name: str) -> Optional[tuple[str, str]]:
    """Real markup, verified live: Playwright's inner_text() on the
    results <table> renders as one tab-separated header row ("Product
    Revision Firmware ID Date Available Serial Number") followed by one
    tab-separated data row per matched product. Returns
    (revision, release_date) or None if no matching data row exists."""
    rows = [r for r in table_text.splitlines() if r.strip()]
    for row in rows[1:]:
        cells = row.split("\t")
        if len(cells) >= 3 and cells[0].strip() == matched_name:
            release_date = cells[3].strip() if len(cells) > 3 else ""
            return cells[1].strip(), release_date
    return None


class SchweitzerEngineeringLabsProvider(FirmwareProvider):
    def __init__(self):
        self.vendor_key = "Schweitzer Engineering Laboratories"

    def get_latest_firmware(
        self, vendor: str, model: str, current_version: str,
    ) -> FirmwareResult:
        if not model:
            return cannot_determine(
                vendor, model, current_version,
                retrieval_method="public_browser",
                reason="No model given.",
                manual_check_url=FIRMWARE_PAGE_URL,
            )

        try:
            from playwright.sync_api import sync_playwright
        except ImportError:
            return cannot_determine(
                vendor, model, current_version,
                retrieval_method="public_browser",
                reason="Playwright not available to load SEL's firmware finder.",
                manual_check_url=FIRMWARE_PAGE_URL,
            )

        try:
            with sync_playwright() as playwright:
                browser = playwright.chromium.launch(headless=True)
                try:
                    page = browser.new_page()
                    page.goto(
                        FIRMWARE_PAGE_URL, wait_until="networkidle", timeout=25000,
                    )
                    page.wait_for_timeout(1500)
                    options = page.eval_on_selector_all(
                        f"{SELECT_ID} option",
                        "els => els.map(e => e.textContent.trim())"
                        ".filter(t => t && t !== 'Choose an Option' && t !== 'View All')",
                    )
                    matched_name, _score, method = match_model(model, options)
                    if method == "ambiguous":
                        return ambiguous_model(
                            vendor, model, current_version,
                            find_ambiguous_candidates(model, options),
                            retrieval_method="public_browser",
                        )
                    if not matched_name:
                        return model_not_found(
                            vendor, model, current_version,
                            retrieval_method="public_browser",
                            manual_check_url=FIRMWARE_PAGE_URL,
                        )

                    page.select_option(SELECT_ID, label=matched_name)
                    page.wait_for_timeout(2000)
                    tables = page.query_selector_all("table")
                    table_text = tables[0].inner_text() if tables else ""
                finally:
                    browser.close()
        except Exception as e:
            return cannot_determine(
                vendor, model, current_version,
                retrieval_method="public_browser",
                reason=f"SEL's firmware finder failed to load: {e}.",
                manual_check_url=FIRMWARE_PAGE_URL,
            )

        parsed = _parse_result_table(table_text, matched_name)
        if not parsed or not parse_version(parsed[0]):
            return model_not_found(
                vendor, model, current_version,
                retrieval_method="public_browser",
                manual_check_url=FIRMWARE_PAGE_URL,
            )

        latest_version, release_date = parsed

        return ok_result(
            vendor=vendor,
            model=model,
            current_version=current_version,
            latest_version=latest_version,
            source_url=FIRMWARE_PAGE_URL,
            confidence=Confidence.HIGH,
            retrieval_method="public_browser",
            update_available=is_update_available(current_version, latest_version),
            message=(
                "Retrieved from SEL's public firmware finder (no login "
                f"required) -- released {release_date}."
            ),
        )
