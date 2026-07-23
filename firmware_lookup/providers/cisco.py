"""
Cisco -- Tier 2, login-gated, with a real, verified public shortcut that
DERIVES the right page from whatever model the user types, rather than a
fixed table of pre-verified URLs.

The login flow (software.cisco.com/download/home) was the first vendor
with a real (browser-assisted) login flow, and the one used to build and
debug the generic BrowserLoginSessionManager / BrowserAuthenticatedProvider
base classes (see session.py and providers/base.py) through several
rounds of real, live-found bugs:
  - input() hanging forever with no interactive terminal attached
    (getpass() fails fast in that case; plain input() doesn't).
  - Buffered stdout hiding all diagnostic output when the server wasn't
    run with -u / PYTHONUNBUFFERED.
  - A false-positive "looks authenticated" check that closed the
    browser 5 seconds into an account-creation flow the user hadn't
    finished -- fixed by requiring several consecutive confirmations
    (see CONSECUTIVE_CONFIRMATIONS_REQUIRED in browser_login.py) and
    widening the "definitely not done yet" URL markers.
  - Akamai's edge blocking a HEADLESS browser context even with valid
    session cookies loaded -- fixed by using headless=False for the
    authenticated lookup too, not just login.
  - A password field directly preceded (no space) by content Okta's
    OAuth URL never named -- URL-only detection false-positived while
    the user was still typing their password -- fixed with a DOM veto
    for a visible password field (see browser_login.py).
  - The same false-positive happening a second way: Cisco's own
    "Software Download" home page serves the SAME URL whether or not
    you're logged in, just swapping in a "LOG IN NOW" button for the
    logged-out case -- fixed with a second DOM veto for a visible
    login-prompt button/link.
software.cisco.com/download/home itself VERIFIED LIVE this session
(real page, real browser, no bypass): every listed product explicitly
says "Login Required" or "Login and Valid Contract Required" in its own
visible text -- this is a genuine login wall, not a bot-detection false
alarm like several other vendors turned out to be.

VERIFIED LIVE this session, in order of discovery:
  1. Cisco's public search (search.cisco.com) surfaces real, no-login
     release-notes documents. BUT confirmed live this is UNRELIABLE for
     "what's the latest" specifically: searching "Catalyst 9300 release
     notes" returned 10 real results spanning SIX different historical
     named IOS XE trains (Everest/Fuji/Gibraltar/Amsterdam/Bengaluru/
     Cupertino/Dublin) plus unrelated products (Catalyst 3850, ASA,
     Firepower) matched on fuzzy keyword relevance -- the true newest
     release never appeared in the first 10 hits at all. Search
     relevance ranking does not correlate with recency here; sorting
     search results by parsed version therefore returned a real but
     WRONG "latest" (17.12 instead of the true 17.18/26.1). Search
     alone was abandoned as the primary mechanism for exactly this
     reason -- kept only as a documented dead end, not reused below.
  2. The real, reliable mechanism: Cisco's own support site publishes a
     "Release Notes" LIST page per product family, at a predictable,
     reusable URL convention --
       https://www.cisco.com/c/en/us/support/switches/
         <family-slug>-series-switches/products-release-notes-list.html
     confirmed live for BOTH "catalyst-9300" and "nexus-9000" (and, by
     the same convention, presumably every other Cisco switch family
     with a support page, though only these two are individually
     verified) -- real dated entries, newest-first, e.g.:
       Release Notes for Cisco Catalyst 9300 Series Switches,
         Cisco IOS XE 26.1.x            <- topmost, newest
       Release Notes for Cisco Catalyst 9300 Series Switches,
         Cisco IOS XE 17.18.x
       ...
     real markup: <a data-id="link3" class="" href="...">TITLE</a> (an
     essentially identical pattern to Nexus's own list, just a
     different data-id number -- matched generically below).
  3. Nexus 9000 specifically ships TWO parallel release trains on this
     same list page -- "ACI Mode" and standard "NX-OS Mode" -- real
     dated entries in both sections, different numbering AND different
     dates entirely. Nothing in a bare model name says which mode a
     given switch actually runs; ACI mode requires additional APIC
     controller infrastructure and is the less common deployment, so
     this defaults to NX-OS Mode when that section-heading split
     exists, and says so explicitly in the result message.
  4. A second, opportunistic refinement: some of these per-family pages
     link to individual release documents that themselves expose a real
     "Document Change History" table (a genuine dated <table>, verified
     live for Catalyst) whose newest row is a more precise answer than
     the list-page title alone (which is sometimes only a major.minor
     "train" reference, e.g. "17.18.x", not the exact patch). Tried
     against whatever page the family-slug lookup returns, not gated to
     one specific product.

Building the family-slug from the model name (see _derive_family_slug):
  - Catalyst: any model naming "catalyst" or a bare/prefixed Catalyst
    SKU shape (e.g. "C9300-24T") yields "catalyst-<family-number>" for
    WHATEVER 4-digit family number is present -- not limited to a fixed
    9200-9600 list, so a model like "Catalyst 3850" or "Catalyst 2960"
    (never individually verified) is still given a real, structurally-
    grounded attempt rather than skipped outright.
  - Nexus: any model naming "nexus" or an "N<n>K" prefix yields
    "nexus-<thousands>" from whichever leading-9/7/5/3/2 digit is
    present (9300 -> nexus-9000, 7018 -> nexus-7000, etc.) -- covers
    every real Nexus switch family by construction, not a hardcoded
    per-family list.
  - Anything else (routers, ASA, wireless controllers, other switch
    vendors' lines Cisco doesn't badge this way, etc.): no confident
    slug can be derived without real evidence of that product line's
    own naming convention, so this returns None and falls through to
    login rather than guessing a URL that might silently resolve to the
    wrong product.
Every candidate URL is verified LIVE (a real page, a real title, real
list entries) before ever being trusted -- a 404 or unexpected page
shape just falls through to login, exactly like a guess that didn't
pan out for any other vendor in this project.
"""
from __future__ import annotations

import re
from typing import Optional

from firmware_lookup.http_client import FirmwareHttpClient
from firmware_lookup.providers.base import BrowserAuthenticatedProvider
from firmware_lookup.result import Confidence, FirmwareResult, ok_result
from firmware_lookup.session import BrowserLoginSessionManager
from firmware_lookup.versioning import is_update_available, parse_version

PORTAL_URL = "https://software.cisco.com"
HOME_URL = "https://software.cisco.com/download/home"

RELEASE_NOTES_LIST_TEMPLATE = (
    "https://www.cisco.com/c/en/us/support/switches/{slug}-series-switches/"
    "products-release-notes-list.html"
)

# Real markup, verified live for both Catalyst ('data-id="link3"') and
# Nexus ('data-id="link4"') release-notes list pages -- the exact
# link-number suffix varies by page, matched generically here rather
# than hardcoded to one value.
_LIST_LINK_RE = re.compile(
    r'<a data-id="link\d+" class="" href="([^"]+)">([^<]+)</a>',
)
# Real markup, verified live for Nexus 9000 specifically: two parallel
# sections on the same page, "... in ACI Mode" and "... in NX-OS Mode".
# When present, scope to the standard NX-OS Mode section (see module
# docstring's HONESTY FLAG on this real, unresolved ambiguity).
_NXOS_MODE_HEADING_RE = re.compile(
    r'<div class="heading">[^<]*in NX-OS Mode</div>',
)

# Real title shapes found live: "... Release 8.3", "... Release
# 10.6(3)F", "... Cisco IOS XE 17.18.x" -- the version is always the
# LAST version-shaped token in the title, not anchored to one specific
# preceding keyword (which would only cover phrasings already observed).
_VERSION_TOKEN_RE = re.compile(r"\d+(?:\.\d+){1,3}(?:\([\dA-Za-z]+\))?[A-Za-z]?")

# Real markup, verified live for Catalyst's individual release-notes
# documents: a <table> with a "Document Change History" caption; each
# data row's first <td><p class="p">DATE</p></td>, second
# <td><p class="p">RELEASE</p></td>.
_CHANGE_HISTORY_ROW_RE = re.compile(
    r'<tbody class="tbody">\s*<tr>\s*<td[^>]*>\s*<p class="p">([^<]+)</p>'
    r'\s*</td>\s*<td[^>]*>\s*<p class="p">([\d.]+)</p>',
)

# CONFIRMED BUG, found live: the release-notes LIST page's first entry
# isn't reliably the base OS release notes at all -- Nexus 7000's own
# list starts with "Cisco Programmable Fabric with VXLAN BGP EVPN
# Release Notes" (an unrelated topic), followed by "Recommended Cisco
# NX-OS Releases..." (no version number in its own title), THEN several
# non-OS sub-documents ("FPGA/EPLD Upgrade Release Notes", "NX-OS/IOS
# Comparison Tech Notes", "IPv6 Feature Mapping") before the real base
# "Cisco Nexus 7000 Series NX-OS Release Notes, Release 8.4" entry.
# Titles containing any of these are real search hits but are NOT the
# switch's own OS/firmware version -- same category of false positive
# already found and fixed for Dell (diagnostics tools / component
# firmware mistaken for the real OS version).
_EXCLUDED_TITLE_WORDS = (
    "fpga", "epld", "comparison", "feature mapping",
    "configuration differences", "programmable fabric",
)

# CONFIRMED BUG, found live: real Catalyst/Nexus SKUs commonly glue a
# multi-digit model number directly onto trailing letters with no
# separator ("C9300-24T", "93180YC-EX") -- both digits and letters are
# \w, so there's no \b boundary at that junction (same class of bug
# found and fixed for Dell's version regex). Matched without a trailing
# boundary requirement; the "catalyst"/"nexus"/"n<n>k" prefix checks in
# _derive_family_slug already keep this safely scoped.
_FOUR_DIGIT_RE = re.compile(r"\d{4}")


def _derive_family_slug(model: str) -> Optional[str]:
    lower = model.lower()
    if "catalyst" in lower or re.search(r"\bc9\d{3}\b", lower):
        match = _FOUR_DIGIT_RE.search(model)
        if match:
            return f"catalyst-{match.group(0)}"
        return None
    if "nexus" in lower or re.search(r"\bn[2379]k\b", lower):
        match = _FOUR_DIGIT_RE.search(model)
        if match:
            thousands = f"{match.group(0)[0]}000"
            return f"nexus-{thousands}"
        return None
    return None


def _extract_title_version(title: str) -> Optional[str]:
    matches = _VERSION_TOKEN_RE.findall(title)
    return matches[-1] if matches else None


class CiscoSessionManager(BrowserLoginSessionManager):
    HOME_URL = HOME_URL
    ACCOUNT_CHECK_URL = HOME_URL


class CiscoProvider(BrowserAuthenticatedProvider):
    HOME_URL = HOME_URL
    # VERIFIED LIVE this session: Cisco's Akamai edge blocks headless
    # contexts with a real "Access Denied" even with valid session
    # cookies loaded. Every other vendor defaults to headless for
    # reused-session lookups (see base.py) -- Cisco is the one
    # confirmed exception, not the default. (The public docs path below
    # is unaffected -- headless works fine there, verified separately.)
    REUSE_SESSION_HEADLESS = False

    def __init__(self):
        super().__init__("Cisco", PORTAL_URL)
        self.session_manager = CiscoSessionManager("Cisco")
        self.http = FirmwareHttpClient("cisco")

    def check_public_source(
        self, vendor: str, model: str, current_version: str,
    ) -> Optional[FirmwareResult]:
        slug = _derive_family_slug(model or "")
        if not slug:
            # No confidently-derivable family slug for this model (see
            # module docstring) -- falls through to login rather than
            # guessing a URL for a product line never verified.
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
                    result = self._extract_from_list_page(
                        page, vendor, model, current_version, slug,
                    )
                finally:
                    browser.close()
        except Exception:
            return None

        return result

    def _extract_from_list_page(
        self, page, vendor: str, model: str, current_version: str, slug: str,
    ) -> Optional[FirmwareResult]:
        list_url = RELEASE_NOTES_LIST_TEMPLATE.format(slug=slug)
        page.goto(list_url, wait_until="domcontentloaded", timeout=20000)
        page.wait_for_timeout(1500)
        html = page.content()

        mode_heading = _NXOS_MODE_HEADING_RE.search(html)
        search_scope = html[mode_heading.start():] if mode_heading else html

        href = title = version_str = None
        parsed = None
        for candidate_href, candidate_title in _LIST_LINK_RE.findall(search_scope):
            lower = candidate_title.lower()
            if "release notes" not in lower:
                continue
            if any(word in lower for word in _EXCLUDED_TITLE_WORDS):
                continue
            candidate_version = _extract_title_version(candidate_title)
            if not candidate_version:
                continue
            candidate_parsed = parse_version(candidate_version)
            if not candidate_parsed:
                continue
            # First qualifying entry is the newest -- verified live that
            # both Catalyst's and Nexus's list pages order entries
            # newest-first once non-OS sub-documents are excluded.
            href, title, version_str, parsed = (
                candidate_href, candidate_title, candidate_version, candidate_parsed,
            )
            break
        if not href:
            return None
        if not parsed:
            return None

        source_url = href if href.startswith("http") else f"https://www.cisco.com{href}"
        latest_version = version_str
        confidence = Confidence.MEDIUM
        message = (
            "Retrieved from Cisco's public release-notes list for this "
            f"product family (no login required) -- top entry: {title!r}."
        )
        if mode_heading:
            message += (
                " UNRESOLVED: this product ships two parallel release "
                "trains, standard 'NX-OS Mode' (used here) and 'ACI "
                "Mode' (a separate, differently-numbered train requiring "
                "APIC controller infrastructure) -- nothing in the model "
                "name says which one this switch actually runs. This "
                "assumes standard NX-OS Mode, the more common default; "
                "please confirm which mode applies before trusting this."
            )

        # Opportunistic refinement: if the linked document itself
        # exposes a real "Document Change History" table (verified live
        # for Catalyst), its newest row is a more precise, more
        # confidently-dated answer than the list-page title alone
        # (which can be a generic major.minor "train" reference, not an
        # exact patch) -- tried regardless of which product this is.
        try:
            page.goto(source_url, wait_until="domcontentloaded", timeout=20000)
            page.wait_for_timeout(1500)
            notes_html = page.content()
            row_match = _CHANGE_HISTORY_ROW_RE.search(notes_html)
            if row_match:
                _date, exact_version = row_match.groups()
                exact_parsed = parse_version(exact_version)
                if exact_parsed and exact_parsed >= parsed:
                    latest_version = exact_version
                    if not mode_heading:
                        confidence = Confidence.HIGH
                        message = (
                            "Retrieved from Cisco's public documentation "
                            "(no login required) -- the top row of the "
                            "page's own 'Document Change History' table, "
                            "a dated, maintained patch record, not "
                            "narrative or AI-generated text."
                        )
        except Exception:
            pass  # the list-page-derived version above is still valid

        return ok_result(
            vendor=vendor,
            model=model,
            current_version=current_version,
            latest_version=latest_version,
            source_url=source_url,
            confidence=confidence,
            retrieval_method="public_browser",
            update_available=is_update_available(current_version, latest_version),
            message=message,
        )
