"""
Aruba (HPE Aruba Networking) -- Tier 2, login-gated.

Verified live this session: arubanetworks.com/techdocs/AOS-CX/ returns
HTTP 403 -- no public "latest version" page found.

CONFIRMED BUG, found live: the old PORTAL_URL (asp.arubanetworks.com)
now returns a real 503 -- "Site is no longer available. Starting Feb
23, 2026, the redirection has been discontinued from the old ASP URL.
Please update your bookmark to continue accessing the HPE Networking
Support Portal at https://networkingsupport.hpe.com." (HPE finished
consolidating Aruba's support portal under its own domain.) Verified
live that networkingsupport.hpe.com itself returns a real 200. Updated
PORTAL_URL/HOME_URL to that -- same class of fix as Extreme's dead
portal URL earlier this session.

Login flow: generic browser-assisted login via BrowserAuthenticatedProvider
(see providers/base.py) -- the same pattern proven, and debugged through
several rounds of real live bugs, for Cisco (see cisco.py's module
docstring: input() hangs, buffered-stdout blind spots, false-positive
auth detection, headless bot-blocking).

CONFIRMED BUG, found live against a real (newly-registered) HPE
account: "Login detected" fired within 5 SECONDS of opening the
browser, both before and after the user actually signed in -- a false
positive, the same class of bug Cisco/Juniper had, but a new root
cause. HOME_URL (networkingsupport.hpe.com) is a fully public marketing
page: it returns 200 and contains none of the DEFAULT_NOT_AUTHENTICATED
_MARKERS whether or not you're logged in, so both the local URL check
and the background confirmation request against it always look
"authenticated" instantly. Real evidence of the actual gate: manually
reloading the saved session and navigating to HOME_URL again landed
directly on a genuine "HPE Sign In" form, whose page title revealed the
real login domain: auth.hpe.com (a standard OAuth2/OIDC redirect,
`https://auth.hpe.com/hpe/cf/?fromURI=...oauth2...authorize...`). Added
"auth.hpe.com" to EXTRA_NOT_AUTHENTICATED_MARKERS so a mid-login
redirect through that domain is correctly recognized as NOT yet
authenticated. This is a partial fix, honestly: HOME_URL itself still
can't distinguish real auth state (it never redirects either way), so
this only catches the case where a check happens to land on the actual
auth.hpe.com redirect -- it does not turn HOME_URL into a reliable gate.

VERIFIED LIVE (decisive finding, same pattern as Juniper's
reclassification): while investigating why the "Software and
Documents" download page requires an email-verification flow (see
above), a COMPLETELY SEPARATE, genuinely public HPE support search was
found: support.hpe.com/connect/s/search. Tested anonymously (no
storage_state, no cookies at all): searching "Aruba 6300M" with the
"Networking" product-type filter applied returned a real result --
"AOS-CX 6300/6300L/6400 Release Notes" listing "R8S89A HPE Aruba
Networking CX 6300M ... Switch 10.10.0002" -- a genuine part number +
product name + version, publicly, with zero authentication. This is
used here as a `check_public_source()` best-effort attempt BEFORE
falling through to login -- not a full reclassification like Juniper,
because only ONE model has been observed this way so far and the
extraction is a regex scan of loosely-structured search-result text,
not a clean structured table like Juniper's <mat-table>. If this
public path doesn't find a confident match, it returns None and the
existing (buggy, still largely unverified) login flow above remains
the fallback.

Real, verified mechanics:
  - Search URL: https://support.hpe.com/connect/s/search?language=en_US
    #q=<model>&t=All&sort=relevancy&numberOfResults=25
  - The "Networking" product-type filter checkbox: CONFIRMED BUG found
    live -- a plain `text=Networking` locator matches THREE elements on
    the page, two of them off-screen/hidden ("HPE Networking Support
    Portal" branding text, etc.); only `get_by_text('Networking',
    exact=True).locator('visible=true').first` reliably hits the real,
    visible filter checkbox. The same trap already happened once for
    "Drivers and Software" (matched a hidden "Find Drivers and
    Software" element first) -- exact + visible-only matching is now
    used everywhere on this page for that reason.
  - Version format observed: "10.10.0002" (2-2-4 digit groups) --
    matches the AOS-CX / ArubaOS format documented earlier in this
    project's plan ("Aruba (`10.13.1000`)"), so the same shape.

***HONESTY FLAG***: single-model live verification (6300M only).
Extraction is a regex scan filtered to result blocks that also contain
the searched model string -- best-effort, not a guaranteed-correct
structured field like Juniper's. The login flow below is UNCHANGED and
still carries all its prior honesty flags for whenever this public path
doesn't resolve.

VERIFIED LIVE, decisively, against a real corporate-email HPE account
(the earlier generic-email account was blocked at a "Start Onboarding"
wall requiring a corporate domain -- see history above; a real
corporate account gets past that entirely, straight to a real
personalized dashboard: "HPE Networking Support Portal", real name
shown in nav, "93 Software Releases" indexed). From there, a REAL
authenticated search was found and used successfully:
  - Real search input: NOT the one found first via a generic
    `atomic-search-box input` selector (that matched one of TWENTY
    duplicate instances in the DOM, almost all hidden -- a Coveo Atomic
    web-component quirk). The actual visible one, confirmed by
    enumerating every real `<input>` element and checking `.is_visible()`
    directly rather than guessing another text-based selector: plain
    `input[placeholder='Search']`.
  - Real results URL after searching: networkingsupport.hpe.com/
    globalsearch#q=<model>&tab=Software -- lands directly on the
    Software tab already filtered, no extra click needed.
  - Real, clean, structured result format (verified for model=6300M):
    multiple entries like "AOS-CX_6400-6300_10.18.0001 | May 22 2026 |
    File Name: AOS-CX_6400-6300_10_18_0001.swi | Release Info: AOS-CX
    10.18.0001 | GA | ... | Major Version: 10.18 Minor Version: 0001".
    Extraction reads the version straight out of the "Release Info:
    AOS-CX X.Y.Z" field specifically (not a loose whole-page regex scan)
    -- the FIRST such match, in whatever order HPE's own search already
    returned results in (their default relevance sort), same honest
    "trust the vendor's own ordering" convention used for Juniper/Dell
    rather than inventing a cross-branch "true latest" ranking of our
    own (real evidence showed multiple concurrent AOS-CX release
    branches -- e.g. 10.13.x, 10.16.x, 10.18.x -- with dates that don't
    increase monotonically with version number, so guessing which
    branch is "the" latest would itself be a fabrication).

***HONESTY FLAG***: only verified against 6300M with a real corporate
account. Whether every model searches this cleanly, and whether a
non-corporate/unverified account can reach this same search at all
(the account used still showed an "Account Verification Required"
banner even after reaching the real dashboard), are both unconfirmed.
"""
from __future__ import annotations

import re
from typing import Optional

from firmware_lookup.providers.base import (
    BrowserAuthenticatedProvider, dump_debug_artifacts,
)
from firmware_lookup.result import Confidence, FirmwareResult, ok_result
from firmware_lookup.versioning import is_update_available

PORTAL_URL = "https://networkingsupport.hpe.com"
HOME_URL = PORTAL_URL

SUPPORT_SEARCH_URL = "https://support.hpe.com/connect/s/search?language=en_US"

# AOS-CX / ArubaOS version format, e.g. "10.10.0002", "10.13.1000" --
# 2-2-(3 or 4) digit groups, verified live against a real result.
ARUBA_VERSION_PATTERN = re.compile(r"\b\d{1,2}\.\d{1,2}\.\d{3,4}\b")

# Real authenticated-search result field, verified live: "Release Info:
# AOS-CX 10.18.0001" -- reading the version straight out of this named
# field is far more precise than a loose whole-page scan.
ARUBA_RELEASE_INFO_PATTERN = re.compile(r"Release Info:\s*AOS-CX\s+(\d{1,2}\.\d{1,2}\.\d{3,4})")


class ArubaProvider(BrowserAuthenticatedProvider):
    HOME_URL = HOME_URL

    def __init__(self):
        super().__init__("Aruba", PORTAL_URL)
        # CONFIRMED BUG (see module docstring): HOME_URL never gates,
        # so detection false-positived within 5s regardless of real
        # auth state. The real login domain is auth.hpe.com.
        self.session_manager.EXTRA_NOT_AUTHENTICATED_MARKERS = ("auth.hpe.com",)

    def check_public_source(
        self, vendor: str, model: str, current_version: str,
    ) -> Optional[FirmwareResult]:
        # Verified live this session: arubanetworks.com/techdocs/AOS-CX/
        # -> HTTP 403 (kept for the record -- that specific URL is dead
        # to anonymous access). The REAL public path found this session
        # is support.hpe.com's general search, tried below instead.
        if not model:
            return None

        try:
            from playwright.sync_api import sync_playwright
        except ImportError:
            return None

        dump_path = None
        try:
            with sync_playwright() as playwright:
                browser = playwright.chromium.launch(headless=True)
                try:
                    page = browser.new_page()
                    search_url = f"{SUPPORT_SEARCH_URL}#q={model.replace(' ', '%20')}&t=All&sort=relevancy&numberOfResults=25"
                    page.goto(search_url, wait_until="domcontentloaded", timeout=30000)
                    page.wait_for_timeout(6000)

                    try:
                        page.get_by_text("Networking", exact=True).locator(
                            "visible=true"
                        ).first.click(timeout=5000)
                        page.wait_for_timeout(6000)
                    except Exception:
                        # Filter not found/clickable -- fall through to
                        # login rather than trust unfiltered, likely
                        # cross-product-line results.
                        return None

                    dump_path = dump_debug_artifacts(page, vendor, "public_search")

                    # Scope extraction to result blocks that actually
                    # mention the model -- best-effort guard against
                    # matching an unrelated product's version number.
                    body_text = page.inner_text("body")
                except Exception:
                    return None
                finally:
                    browser.close()
        except Exception:
            return None

        model_idx = body_text.lower().find(model.lower())
        if model_idx == -1:
            return None
        window = body_text[max(0, model_idx - 200): model_idx + 400]
        candidates = ARUBA_VERSION_PATTERN.findall(window)
        if not candidates:
            return None

        latest_version = candidates[0].strip()
        return ok_result(
            vendor=vendor,
            model=model,
            current_version=current_version,
            latest_version=latest_version,
            source_url=SUPPORT_SEARCH_URL,
            confidence=Confidence.MEDIUM,
            retrieval_method="public_browser",
            update_available=is_update_available(current_version, latest_version),
            message=(
                "Retrieved from HPE's general public support search "
                "(no login) -- verified live for one model (6300M) this "
                "session; the exact search-result structure for other "
                "models is unconfirmed. Please double check this looks "
                "like a genuine version tied to the right product, not "
                f"an unrelated result. Debug artifacts: {dump_path or 'none'}."
            ),
        )

    def _extract_from_page(
        self, page, vendor: str, model: str, current_version: str,
    ) -> FirmwareResult:
        from firmware_lookup.result import cannot_determine, model_not_found

        dump_path = None
        try:
            page.goto(self.HOME_URL, wait_until="domcontentloaded", timeout=30000)
            page.wait_for_timeout(4000)
            dump_path = dump_debug_artifacts(page, vendor, "home")

            try:
                # VERIFIED LIVE selector (see module docstring) -- NOT
                # the generic guess, and not the first of 20 duplicate
                # Coveo Atomic instances either.
                search_box = page.locator("input[placeholder='Search']").first
                search_box.wait_for(state="visible", timeout=8000)
            except Exception:
                dump_path = dump_debug_artifacts(page, vendor, "no_search_box") or dump_path
                return cannot_determine(
                    vendor, model, current_version,
                    retrieval_method="authenticated_browser",
                    reason=(
                        "Logged in successfully, but the verified real "
                        "search box was not present this time -- HPE may "
                        "have changed the dashboard. Debug artifacts: "
                        f"{dump_path or 'none'}."
                    ),
                    manual_check_url=self.PORTAL_URL,
                )

            pre_search_url = page.url
            search_box.click()
            search_box.type(model, delay=100)
            page.wait_for_timeout(500)
            page.keyboard.press("Enter")
            try:
                page.wait_for_load_state("networkidle", timeout=8000)
            except Exception:
                pass
            page.wait_for_timeout(2000)
            dump_path = dump_debug_artifacts(page, vendor, "results") or dump_path

            if page.url == pre_search_url:
                return cannot_determine(
                    vendor, model, current_version,
                    retrieval_method="authenticated_browser",
                    reason=(
                        "Logged in and searched, but the page never "
                        f"navigated anywhere for {model!r}. Debug "
                        f"artifacts: {dump_path or 'none'}."
                    ),
                    manual_check_url=self.PORTAL_URL,
                )

            body_text = page.inner_text("body")
        except Exception as e:
            return cannot_determine(
                vendor, model, current_version,
                retrieval_method="authenticated_browser",
                reason=f"Aruba authenticated lookup failed: {e}. Debug artifacts: {dump_path or 'none'}.",
                manual_check_url=self.PORTAL_URL,
            )

        # VERIFIED LIVE (see module docstring): read the version out of
        # the named "Release Info: AOS-CX X.Y.Z" field specifically,
        # not a loose whole-page number scan.
        candidates = ARUBA_RELEASE_INFO_PATTERN.findall(body_text)
        if not candidates:
            return model_not_found(
                vendor, model, current_version, retrieval_method="authenticated_browser",
                manual_check_url=self.PORTAL_URL,
            )

        latest_version = candidates[0].strip()
        return ok_result(
            vendor=vendor,
            model=model,
            current_version=current_version,
            latest_version=latest_version,
            source_url=page.url,
            confidence=Confidence.MEDIUM,
            retrieval_method="authenticated_browser",
            update_available=is_update_available(current_version, latest_version),
            message=(
                "Retrieved via an authenticated HPE Networking Support "
                "session, real 'Release Info: AOS-CX' field, first "
                "result in HPE's own default sort order. HPE tracks "
                "multiple concurrent AOS-CX release branches "
                "simultaneously -- this is the top-ranked result for "
                "this exact model, not necessarily the single newest "
                "release across every branch. Please confirm this looks "
                "like the right release for your deployment."
            ),
        )
