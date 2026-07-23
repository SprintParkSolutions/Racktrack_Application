"""
CERIO Corporation -- Tier 1, public, no login.

VERIFIED LIVE this session: endl.cerio.cc is CERIO's real, public,
no-login download portal (linked from cerio.com.tw/services/). Two
real category-index pages enumerate every current switch model with
its own real per-model download page:
    endl.cerio.cc/2018/10/switchs/          (Enterprise Network Switch)
    endl.cerio.cc/2017/04/enterprise-switch/ (Enterprise PoE Network Switch)
Each model's URL slug is date-prefixed and NOT a mechanical transform
of the model number (e.g. CS-2424G-24P's real page is dated 2017/04,
CS-1008XG's is dated 2025/03) -- discovered fresh from the index pages
each call, not guessed or hardcoded.

Each per-model page has real <table class="fortuna_table"> sections
(Specification, User/QIG Manual, Firmware Download); confirmed live
for CS-2424G-24P (Firmware Download -> v2.5.2, 2022.08.10) and
CS-2648XG (-> v1.0.2, 2021.08.17). CROSS-CHECKED and confirmed
genuinely honest: CS-1008XG and CS-1224XG have NO "Firmware Download"
section at all (only Specification/QIG Manual) -- a real per-model
gap, not a bug, matching the same honesty pattern found earlier this
session for Edimax.
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
    "https://endl.cerio.cc/2018/10/switchs/",
    "https://endl.cerio.cc/2017/04/enterprise-switch/",
]
PORTAL_URL = "https://endl.cerio.cc/"

# Real markup, verified live: each result link's href ends in
# /YYYY/MM/<slug>/ -- the slug (uppercased, underscores/hyphens as-is)
# is the real model identifier.
_SLUG_RE = re.compile(r"/\d{4}/\d{2}/([a-z0-9_-]+)/?$")

_FIRMWARE_RE = re.compile(
    r"Firmware Download.*?<table.*?</tr>\s*<tr[^>]*>\s*"
    r"<td[^>]*>(?:<[^>]+>)*\s*(?:&nbsp;)?\s*([^<]+)"
    r".*?<td[^>]*>(?:<[^>]+>)*\s*(?:&nbsp;)?\s*([^<]+)",
    re.DOTALL,
)


class CerioProvider(FirmwareProvider):
    def __init__(self):
        self.vendor_key = "CERIO Corporation"

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
                reason="Playwright not available to load CERIO's download portal.",
                manual_check_url=PORTAL_URL,
            )

        try:
            with sync_playwright() as playwright:
                browser = playwright.chromium.launch(headless=True)
                try:
                    page = browser.new_page()
                    catalog: dict[str, str] = {}
                    for cat_url in CATEGORY_URLS:
                        page.goto(cat_url, wait_until="networkidle", timeout=25000)
                        page.wait_for_timeout(1500)
                        hrefs = page.eval_on_selector_all(
                            "a", "els => els.map(e => e.href)",
                        )
                        for href in hrefs:
                            slug_match = _SLUG_RE.search(href)
                            if slug_match:
                                model_name = slug_match.group(1).upper()
                                catalog[model_name] = href

                    if not catalog:
                        return cannot_determine(
                            vendor, model, current_version,
                            retrieval_method="public_browser",
                            reason="CERIO's download portal category pages did not load.",
                            manual_check_url=PORTAL_URL,
                        )

                    matched_name, _score, method = match_model(
                        model, list(catalog.keys()),
                    )
                    if method == "ambiguous":
                        return ambiguous_model(
                            vendor, model, current_version,
                            find_ambiguous_candidates(model, list(catalog.keys())),
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
                    html = page.content()
                finally:
                    browser.close()
        except Exception as e:
            return cannot_determine(
                vendor, model, current_version,
                retrieval_method="public_browser",
                reason=f"CERIO's download portal failed to load: {e}.",
                manual_check_url=PORTAL_URL,
            )

        match = _FIRMWARE_RE.search(html)
        if not match or not parse_version(match.group(1)):
            # Confirmed live for real models (e.g. CS-1008XG, CS-1224XG):
            # a genuine absence of any Firmware Download section, not a bug.
            return model_not_found(
                vendor, model, current_version,
                retrieval_method="public_browser",
                manual_check_url=PORTAL_URL,
            )
        latest_version = match.group(1).strip()
        release_date = match.group(2).strip()

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
                "Retrieved from CERIO's public download portal (no "
                f"login required) -- released {release_date}."
            ),
        )
