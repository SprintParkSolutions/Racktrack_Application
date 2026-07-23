"""
PLANET Technology -- Tier 1, public, no login.

CONFIRMED REVERSAL, found live 2026-07-16 (previously marked
not_implemented -- see unimplemented.py's prior NOT_IMPLEMENTED_REASONS
entry, dated 2026-07-13, which claimed "results are loaded via AJAX
regardless of query parameters tried; no backing API endpoint was
discoverable"): that was wrong, or the right query parameters simply
weren't found yet. Real, live-verified source this session:
  https://www.planet.com.tw/en/support/downloads
        ?method=category&c1=lan-switches&p=<model-slug>&type=5
is a REAL GET endpoint (confirmed via a plain HTTP client, no browser
needed at all) that returns a real, dated firmware version table for
whatever model slug is given, e.g. confirmed live for AVS-4210-24HP4X:
    Date        Model              Version         Description
    2026-01-30  AVS-4210-24HP4X    1.403b260107    ...
    2025-10-13  AVS-4210-24HP4X    1.403b250922    ...
sorted newest-first by date.

The model SLUG itself isn't guessable from the model name directly
(e.g. "AVS-4210-24HP4X" -> "avs-4210-24hp4x" happens to be a simple
lowercase, but real entries like "CB-DAQSFP-0.5 / CB-DAQSFP-2M" ->
"cb-daqsfp-0.5-cb-daqsfp-2m" are not a mechanical transform) -- the
real, live-fetched <select name="p"> dropdown (322 real entries,
confirmed live) is fetched fresh each call and fuzzy-matched via the
existing matching.match_model(), same principle as MOXA/NETGEAR's
live-fetched catalogs, rather than a maintained slug table.

The category dropdown's OWN options are static HTML (see
_CATEGORY_OPTION_RE), but the per-category MODEL list is populated via
client-side JS after selecting a category -- confirmed live this needs
one real Playwright interaction (select the category, wait, read the
resulting <option> list) to discover; the actual RESULTS fetch, once a
real model slug is known, is plain HTTP (fast, no browser needed).

Scope: LAN Switches category only (c1=lan-switches) -- PLANET's site
groups other product lines (PoE, Industrial Ethernet, etc.) under
separate category slugs not verified this session.

HONESTY NOTE on model_not_found, confirmed live: not every real, listed
model has firmware published -- e.g. GS-2210-24T2S resolves correctly in
the model catalog (a genuine, unambiguous match) but its own results
page says, verbatim, "Sorry, no results were found." (confirmed with a
real visible browser). model_not_found in that case is the honest,
correct answer, not a bug -- verified by checking a real browser's
rendering of the exact same query before assuming otherwise.
"""
from __future__ import annotations

import re
from typing import Optional
from urllib.parse import quote

from firmware_lookup.http_client import FirmwareHttpClient
from firmware_lookup.matching import match_model
from firmware_lookup.providers.base import FirmwareProvider
from firmware_lookup.result import (
    Confidence, FirmwareResult, cannot_determine, model_not_found, ok_result,
)
from firmware_lookup.versioning import is_update_available

PORTAL_URL = "https://www.planet.com.tw/en/support/downloads"
CATEGORY_SLUG = "lan-switches"
FIRMWARE_TYPE = "5"

# Real markup, verified live: the category-scoped page's model <select>
# lists every real switch model as a plain <option>.
_MODEL_OPTION_RE = re.compile(r'<option value="([^"]+)">([^<]+)</option>')
# Real markup, verified live: each firmware result is a real table row --
# Date, Model, Version columns in that order.
_RESULT_ROW_RE = re.compile(
    r'<tr>\s*<td class="text-center align-middle">([^<]+)</td>\s*'
    r'<td class="text-center align-middle">([^<]+)</td>\s*'
    r'<td class="text-center align-middle">([^<]+)</td>',
)


class PlanetProvider(FirmwareProvider):
    def __init__(self):
        self.vendor_key = "PLANET"
        self.http = FirmwareHttpClient("planet")

    def get_latest_firmware(
        self, vendor: str, model: str, current_version: str,
    ) -> FirmwareResult:
        if not model:
            return cannot_determine(
                vendor, model, current_version,
                retrieval_method="public_html",
                reason="No model given.",
                manual_check_url=PORTAL_URL,
            )

        try:
            from playwright.sync_api import sync_playwright
        except ImportError:
            return cannot_determine(
                vendor, model, current_version,
                retrieval_method="public_html",
                reason="Playwright not available to discover the model catalog.",
                manual_check_url=PORTAL_URL,
            )

        try:
            catalog_html = self._fetch_model_catalog()
        except Exception as e:
            return cannot_determine(
                vendor, model, current_version,
                retrieval_method="public_html",
                reason=f"Could not fetch PLANET's model catalog: {e}.",
                manual_check_url=PORTAL_URL,
            )
        if not catalog_html:
            return cannot_determine(
                vendor, model, current_version,
                retrieval_method="public_html",
                reason="PLANET's model catalog page did not load.",
                manual_check_url=PORTAL_URL,
            )

        options = _MODEL_OPTION_RE.findall(catalog_html)
        catalog = {name: slug for slug, name in options if slug}
        if not catalog:
            return cannot_determine(
                vendor, model, current_version,
                retrieval_method="public_html",
                reason="PLANET's model catalog was empty.",
                manual_check_url=PORTAL_URL,
            )

        matched_name, _score, method = match_model(model, list(catalog.keys()))
        if method == "ambiguous":
            from firmware_lookup.result import ambiguous_model
            from firmware_lookup.matching import find_ambiguous_candidates
            return ambiguous_model(
                vendor, model, current_version,
                find_ambiguous_candidates(model, list(catalog.keys())),
                retrieval_method="public_html",
            )
        if not matched_name:
            return model_not_found(
                vendor, model, current_version,
                retrieval_method="public_html",
                manual_check_url=PORTAL_URL,
            )

        slug = catalog[matched_name]
        results_url = (
            f"{PORTAL_URL}?method=category&c1={CATEGORY_SLUG}"
            f"&p={quote(slug)}&type={FIRMWARE_TYPE}"
        )
        results_html = self.http.get_text(results_url)
        if not results_html:
            return cannot_determine(
                vendor, model, current_version,
                retrieval_method="public_html",
                reason="PLANET's firmware results page did not load.",
                manual_check_url=PORTAL_URL,
            )

        rows = _RESULT_ROW_RE.findall(results_html)
        if not rows:
            return model_not_found(
                vendor, model, current_version,
                retrieval_method="public_html",
                manual_check_url=PORTAL_URL,
            )

        # First row is the newest -- confirmed live the results table is
        # sorted newest-first by date.
        _date, _model_col, latest_version = rows[0]

        return ok_result(
            vendor=vendor,
            model=model,
            current_version=current_version,
            latest_version=latest_version.strip(),
            source_url=results_url,
            confidence=Confidence.HIGH,
            retrieval_method="public_html",
            update_available=is_update_available(current_version, latest_version.strip()),
            message=(
                "Retrieved from PLANET's public downloads search "
                "(no login required) -- the most recent dated firmware "
                "entry for this model."
            ),
        )

    def _fetch_model_catalog(self) -> Optional[str]:
        """The model <select>'s options are populated client-side after
        selecting the category -- one real Playwright interaction,
        cached implicitly per call (each lookup re-fetches fresh, same
        as MOXA/NETGEAR's live-fetched catalogs).

        CONFIRMED BUG, found live TWICE: (1) a fixed 1.5s wait after
        selecting the category intermittently returned an incomplete
        option list (a real, reproducible case: "GS-2210-24T2S" --
        confirmed present in the full 322-entry catalog on one fetch,
        silently missing from another moments later with no error).
        (2) The first fix attempt -- wait_for_function on ">100
        options" -- was ALSO wrong: options populate incrementally, so
        crossing 100 doesn't mean the list is done (322 real entries
        exist; "GS-2210-24T2S" loads later in that sequence) -- this
        just returned a differently-sized PARTIAL list, still missing
        the model, with no error either. Fixed properly this time: poll
        the option count until it's stable (unchanged) across two
        consecutive checks, not just past an arbitrary threshold --
        this is the only way to know the async population has actually
        finished, not just crossed some point in it."""
        from playwright.sync_api import sync_playwright

        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True)
            try:
                page = browser.new_page()
                page.goto(PORTAL_URL, wait_until="domcontentloaded", timeout=20000)
                page.wait_for_timeout(1500)
                page.locator('select[name="c1"]').select_option(CATEGORY_SLUG)
                self._wait_for_stable_option_count(page)
                return page.content()
            finally:
                browser.close()

    @staticmethod
    def _wait_for_stable_option_count(page, max_checks: int = 20, poll_ms: int = 500) -> None:
        """Polls the model <select>'s option count until it stops
        growing between two consecutive checks -- the only reliable
        signal that PLANET's async population has actually finished,
        since any fixed delay or arbitrary minimum-count threshold was
        proven live to fire too early and silently truncate the real
        322-entry catalog."""
        previous_count = -1
        for _ in range(max_checks):
            page.wait_for_timeout(poll_ms)
            try:
                current_count = page.locator('select[name="p"] option').count()
            except Exception:
                continue
            if current_count > 1 and current_count == previous_count:
                return
            previous_count = current_count
