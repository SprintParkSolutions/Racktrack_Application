"""
Huawei -- Tier 2, login-gated, with a real, verified public shortcut for
the S-series campus switch families (S1700 through S16700).

Login flow: generic browser-assisted login via BrowserAuthenticatedProvider
(see providers/base.py) -- the same pattern proven, and debugged through
several rounds of real live bugs, for Cisco (see cisco.py's module
docstring: input() hangs, buffered-stdout blind spots, false-positive
auth detection, headless bot-blocking).

***HONESTY FLAG***: the LOGIN flow itself is UNVERIFIED. No test account
available for Huawei -- expect the same categories of live bugs Cisco had
(wrong selectors, false-positive login detection, vendor-specific bot
protection) until this is actually tested against a real account.

VERIFIED LIVE this session, in two contradictory stages worth recording
honestly:
  1. Huawei's own global SEARCH box explicitly said (translated from
     Chinese) "To search for more content, please log in first", and a
     directly-guessed documentation URL redirected straight to
     uniportal.huawei.com's login page -- real, direct evidence that
     LOOKED like a genuine login wall.
  2. That conclusion turned out to be about the search box specifically,
     NOT Huawei's real category-based NAVIGATION, which is fully public:
     support.huawei.com/enterprise/en/category/switches-pid-1482605678974
     lists every real switch series (confirmed live: S100 through
     S16700, CloudEngine CE/XH families) with NO login required.
     Following a series link to its real per-model "Software Download"
     tab (a genuine in-page tab, not the global nav item of the same
     name -- found live by enumerating DOM matches, since the visible
     one is a <span class="tab-label">, not the hidden <a class="entry">
     from the page header) shows a real, dated Version/Patch table, no
     login needed, e.g. confirmed live for the S3700&S5700&S6700 series:
       S3700&S5700&S6700 V600R025C00SPC500  | Valid | 2025-10-09
       S3700&S5700&S6700 V600R025SPH120     | Valid | 2026-02-28  (patch)
     Real markup: an Element-UI <table> whose rows are
       <a href="..." target="_blank">TITLE</a> ... 3x <div class="cell">
       (an empty spacer cell, then Status, then Publication Date).
     Older/EOL models (e.g. S2700-18TP-SI-AC) honestly show "Sorry, no
     software is released for this product" on this same real page --
     a genuine "nothing here" result, not a login wall either.

Building the family match (see _derive_series_url): Huawei's switch
catalog groups multiple related model numbers into one combined series
page, e.g. "S3700&S5700&S6700 Series" -- the category page is fetched
fresh each call (not hardcoded) and every series name's own embedded
4-digit model numbers are parsed to find which series covers whichever
4-digit number is in the model the user typed (e.g. "S5731-H" -> "5731"
-> matches the "5700" token inside "S3700&S5700&S6700 Series" by
leading-2-digit family, "57"). This covers the S1700-S16700 lineup
generically, the same "derive from whatever's typed" principle as
Cisco's Catalyst/Nexus family-slug derivation.

Scope, real and honest: this does NOT cover Huawei's CloudEngine
data-center switches (CE5800/CE6800/etc, and the XH-prefixed models) --
their series names use a different 2-digit shorthand ("CloudEngine
58&68&78&88&98 Series") that a bare 4-digit family match can't reliably
resolve without more live verification than was done this session, so a
CloudEngine model correctly falls through to login rather than guessing.
"""
from __future__ import annotations

import html
import re
from typing import Optional

from firmware_lookup.providers.base import BrowserAuthenticatedProvider
from firmware_lookup.result import Confidence, FirmwareResult, ok_result
from firmware_lookup.versioning import is_update_available

PORTAL_URL = "https://support.huawei.com"
HOME_URL = PORTAL_URL

SWITCHES_CATEGORY_URL = (
    "https://support.huawei.com/enterprise/en/category/"
    "switches-pid-1482605678974?submodel=doc"
)

# Real markup, verified live: each switch series on the category page is
# one of these real links.
_SERIES_LINK_RE = re.compile(
    r'<a[^>]*class="offering-node ellipsis" href="([^"]+)">([^<]+)</a>',
)
# Real markup, verified live on a series' own /software page: a real
# Element-UI table row -- link, one empty spacer cell, Status, Date.
_VERSION_ROW_RE = re.compile(
    r'href="([^"]+)"[^>]*target="_blank"[^>]*>([^<]+)</a>.*?'
    r'<div class="cell"><!----></div></td><td[^>]*><div class="cell"><!---->([^<]*)</div></td>'
    r'<td[^>]*><div class="cell"><!---->([^<]+)</div>',
)
# Huawei's own real versioning convention, confirmed live in titles like
# "S3700&S5700&S6700 V600R025C00SPC500" and "...V600R025SPH120".
_VERSION_TOKEN_RE = re.compile(r"V\d+R\d+\S*")
_FOUR_DIGIT_RE = re.compile(r"\d{4}")


def _model_family(model: str) -> Optional[str]:
    match = _FOUR_DIGIT_RE.search(model)
    return match.group(0)[:2] if match else None


def _series_families(series_name: str) -> set[str]:
    return {n[:2] for n in _FOUR_DIGIT_RE.findall(series_name)}


def _extract_version(title: str) -> Optional[str]:
    match = _VERSION_TOKEN_RE.search(title)
    return match.group(0) if match else None


class HuaweiProvider(BrowserAuthenticatedProvider):
    HOME_URL = HOME_URL

    def __init__(self):
        super().__init__("Huawei", PORTAL_URL)

    def check_public_source(
        self, vendor: str, model: str, current_version: str,
    ) -> Optional[FirmwareResult]:
        family = _model_family(model or "")
        if not family:
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
                        page, vendor, model, current_version, family,
                    )
                finally:
                    browser.close()
        except Exception:
            return None

        return result

    def _search_and_extract(
        self, page, vendor: str, model: str, current_version: str, family: str,
    ) -> Optional[FirmwareResult]:
        page.goto(SWITCHES_CATEGORY_URL, wait_until="domcontentloaded", timeout=20000)
        page.wait_for_timeout(2000)
        category_html = page.content()

        series_path = None
        for href, name in _SERIES_LINK_RE.findall(category_html):
            if family in _series_families(html.unescape(name)):
                series_path = href
                break
        if not series_path:
            return None

        software_url = f"https://support.huawei.com{series_path}/software"
        page.goto(software_url, wait_until="domcontentloaded", timeout=20000)
        page.wait_for_timeout(2500)
        software_html = page.content()

        candidates = []  # (date, href, title)
        for href, title, status, date in _VERSION_ROW_RE.findall(software_html):
            if status.strip().lower() != "valid":
                continue
            candidates.append((date, href, html.unescape(title)))
        if not candidates:
            return None

        candidates.sort(key=lambda c: c[0], reverse=True)
        latest_date, href, title = candidates[0]
        latest_version = _extract_version(title)
        if not latest_version:
            return None
        source_url = href if href.startswith("http") else f"https://support.huawei.com{href}"

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
                f"Retrieved from Huawei's public switch documentation "
                f"(no login required) -- the most recently published "
                f"'Valid' status version/patch entry (published "
                f"{latest_date}): {title!r}. This covers Huawei's "
                "S-series campus switches (S1700-S16700); CloudEngine "
                "data-center switches are not covered by this check."
            ),
        )
