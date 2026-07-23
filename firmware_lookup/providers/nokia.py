"""
Nokia -- Tier 2, login-gated, with a real, verified public shortcut
that dynamically matches whatever model the user types against Nokia's
own live product catalog, not a hardcoded product list.

Login flow: generic browser-assisted login via BrowserAuthenticatedProvider
(see providers/base.py) -- the same pattern proven, and debugged through
several rounds of real live bugs, for Cisco (see cisco.py's module
docstring: input() hangs, buffered-stdout blind spots, false-positive
auth detection, headless bot-blocking).

***HONESTY FLAG***: the LOGIN flow itself is UNVERIFIED. No test account
available for Nokia -- expect the same categories of live bugs Cisco had
(wrong selectors, false-positive login detection, vendor-specific bot
protection) until this is actually tested against a real account.

VERIFIED LIVE this session (real breakthrough, found by following a real
link from customer.nokia.com's public product catalog rather than the
login-gated support portal itself): documentation.nokia.com is a
completely separate, publicly-browsable documentation search system.
Real findings:
  - documentation.nokia.com/pybin/doc_ctr.py (no product_id) lists EVERY
    Nokia product Nokia documents -- confirmed live, ~80 real entries
    including real switch/router families like "7210 SAS (Service
    Access System)", "7750 SR (Service Router)", "7250 IXR (Interconnect
    Router)". Real markup: <a class="sub-header-link-list-item"
    href="/pybin/doc_ctr.py?product_id=833-006357">7210 SAS (Service
    Access System)</a> -- fetched fresh each call and fuzzy-matched
    against whatever model the user types (via the existing
    matching.match_model(), same utility MOXA/NETGEAR use against their
    own live-fetched catalogs), NOT a hardcoded product-id table.
  - Following a specific product's link (?product_id=...) lists real,
    dated release-notes documents, sorted newest-first by Issue Date --
    confirmed live: "7210 SAS Software Release Notes 26.3.R2" dated
    2026/06/26 was the top result, with 26.3.R2 -> 24.9.R5 -> 25.9.R4
    in descending date order (note: NOT descending version-number
    order -- 24.9.R5 appears between two newer-dated entries, meaning
    Nokia maintains multiple parallel release trains simultaneously;
    "most recently issued" is the only reliable ordering signal here,
    not "highest version number").
  - The actual PDF documents are lock-icon-marked and presumably
    require login to open -- but the VERSION NUMBER ITSELF is real,
    dated, visible text in the results list, before ever touching a
    locked document. This mirrors the same "the citable fact is public
    even though the underlying file is not" pattern already relied on
    for several other vendors' safety-net-style sources this session.
  - This portal is real but genuinely SLOW to render (client-heavy JS;
    confirmed live it needs ~12+ seconds after domcontentloaded before
    the product list or results actually populate -- a shorter wait
    silently returns near-empty content, not an error).
"""
from __future__ import annotations

import re
from typing import Optional

from firmware_lookup.matching import match_model
from firmware_lookup.providers.base import BrowserAuthenticatedProvider
from firmware_lookup.result import Confidence, FirmwareResult, ok_result
from firmware_lookup.versioning import is_update_available, parse_version

PORTAL_URL = "https://customer.nokia.com"
HOME_URL = PORTAL_URL

DOC_CENTER_URL = "https://documentation.nokia.com/pybin/doc_ctr.py"
# Confirmed live: this page needs real time to client-render its content
# -- a shorter wait returns a near-empty page, not an error.
RENDER_WAIT_MS = 13000

# Real markup, verified live: every product in Nokia's documentation
# catalog is one of these list items.
_PRODUCT_LINK_RE = re.compile(
    r'<a class="sub-header-link-list-item" href="(/pybin/doc_ctr\.py\?product_id=[^"]+)">([^<]+)</a>',
)
# Real markup, verified live on a specific product's results page: each
# dated result is a real <a> immediately followed by its Issue Date.
_RESULT_ROW_RE = re.compile(
    r'<a href="([^"]+)" target="_self">([^<]+?)\s*</a></span><br>'
    r'<span class="result-p-meta">Issue Date: <span class="result-filt-data">([^<]+)</span>',
)
# Nokia's own release-numbering style, confirmed live in TWO real
# shapes: "26.3.R2" / "24.9.R5" (dot before R, seen in Release Notes
# titles) and "4.0R8" / "3.0r12" (no dot before R, seen in the version
# filter dropdown) -- the dot is optional, mixed-case R either way.
_VERSION_TOKEN_RE = re.compile(r"\d+\.\d+\.?[Rr]\d+")


def _extract_title_version(title: str) -> Optional[str]:
    matches = _VERSION_TOKEN_RE.findall(title)
    return matches[-1] if matches else None


class NokiaProvider(BrowserAuthenticatedProvider):
    HOME_URL = HOME_URL

    def __init__(self):
        super().__init__("Nokia", PORTAL_URL)

    def check_public_source(
        self, vendor: str, model: str, current_version: str,
    ) -> Optional[FirmwareResult]:
        if not model:
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
                    result = self._search_and_extract(
                        page, vendor, model, current_version,
                    )
                finally:
                    browser.close()
        except Exception:
            return None

        return result

    def _search_and_extract(
        self, page, vendor: str, model: str, current_version: str,
    ) -> Optional[FirmwareResult]:
        page.goto(DOC_CENTER_URL, wait_until="domcontentloaded", timeout=25000)
        page.wait_for_timeout(RENDER_WAIT_MS)
        catalog_html = page.content()

        products = _PRODUCT_LINK_RE.findall(catalog_html)
        if not products:
            return None
        catalog_names = [name for _url, name in products]

        matched_name, _score, method = match_model(model, catalog_names)
        if method == "ambiguous":
            # Login can't resolve which candidate is right either --
            # not a case a fresh public-source attempt would help with,
            # so this correctly falls through like every other unmatched
            # case (the orchestrator's own ambiguous-model handling
            # happens at a different layer for vendors with a public-
            # only catalog; here it's simplest and safest to just decline).
            return None
        if not matched_name:
            return None

        product_path = next(url for url, name in products if name == matched_name)
        product_url = f"https://documentation.nokia.com{product_path}"

        page.goto(product_url, wait_until="domcontentloaded", timeout=25000)
        page.wait_for_timeout(RENDER_WAIT_MS)
        results_html = page.content()

        latest_version = None
        source_url = None
        result_date = None
        for href, title, date_str in _RESULT_ROW_RE.findall(results_html):
            if "release notes" not in title.lower():
                continue
            version_str = _extract_title_version(title)
            if not version_str or not parse_version(version_str):
                continue
            # First qualifying entry is the most recently issued --
            # confirmed live the results list is sorted by Issue Date,
            # NOT by version number (Nokia maintains multiple parallel
            # release trains at once).
            latest_version, source_url, result_date = version_str, href, date_str
            break
        if not latest_version:
            return None

        return ok_result(
            vendor=vendor,
            model=model,
            current_version=current_version,
            latest_version=latest_version,
            source_url=source_url,
            confidence=Confidence.MEDIUM,
            retrieval_method="public_browser",
            update_available=is_update_available(current_version, latest_version),
            message=(
                f"Retrieved from Nokia's public documentation search (no "
                f"login required for the listing itself) -- the most "
                f"recently issued release notes entry (issued {result_date}) "
                f"for {matched_name!r}. The underlying document is "
                "login-locked, but its title and issue date are public; "
                "Nokia maintains multiple parallel release trains at "
                "once, so this is the newest BY DATE, not necessarily "
                "the highest version number overall."
            ),
        )
