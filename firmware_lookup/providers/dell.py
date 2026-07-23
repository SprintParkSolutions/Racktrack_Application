"""
Dell Technologies -- Tier 2, login-gated with a real, verified public
shortcut (promoted from "always defers to login" after live testing).

VERIFIED LIVE this session (real, anonymous, no-login browser session):
dell.com/support's search-and-filter flow works WITHOUT any login at
all -- a real visible-browser search for "S4148F-ON", filtered to the
"Downloads & Drivers" panel, returned real, unauthenticated driver
listings including "Dell Networking Firmware Updater V3.33.5.1-28 for
S4100 Open Networking Switch" (dated 18 Jun 2026). Confirmed via a plain
headless HTTP/browser probe first hitting Akamai's "Access Denied" (same
block already known for the authenticated path -- see
REUSE_SESSION_HEADLESS below), then a visible (non-headless) browser
reaching the real page fine -- same bot-detection pattern, not a login
wall. check_public_source() therefore tries this first, same as
Juniper/Aruba/H3C/RUCKUS; login remains a safety net for whatever this
doesn't resolve.

CONFIRMED BUG, found live earlier this session (real login completed by
the user, real "results" debug screenshot + HTML inspected,
model=S4148F-ON): the search-results page mixes 639 results across
forums, knowledgebase, manuals, AND drivers together -- an unscoped scan
grabbed "10.5.2.0" from a FORUM POST'S BODY TEXT ("Version 10.5.2.0
Booted up a S4148F-on for the first time and noticed...") -- i.e. one
random poster's own installed version, not Dell's actual latest release.
Same class of bug as the Juniper community-post false positive,
different vendor.

Real fix, grounded in the actual saved HTML: the results page has a
left-sidebar filter, "Downloads & Drivers (30)", real markup:
    <div class="dds__checkbox"><label id="lblProductCategory"
      class="dds__checkbox__label"><input type="checkbox" .../>
      <span>...Downloads &amp; Drivers</span><span>(30)</span>
    </label></div>
(id is duplicated across every filter checkbox on the page -- a markup
quirk on Dell's side -- so selecting by visible text is the only stable
option, not id). Clicking that label scopes results down to just the
actual driver/firmware listings.

CONFIRMED BUG #2, found live this session (re-checked via the new public
path): the filtered results page ALSO renders a "Dell AI Overview" panel
ABOVE the real driver listings, explicitly self-labelled "Generated
content may contain errors" -- it appears first in document order, so an
unscoped scan can grab its own (possibly wrong/unrelated) version number
instead of a genuine driver entry's. Real markup: the whole panel is
wrapped in class="search-genai-answer". Excluded before scanning, same
pattern as the generic <footer> exclusion.
"""
from __future__ import annotations

import re
from typing import Optional

from firmware_lookup.providers.base import (
    BrowserAuthenticatedProvider, dump_debug_artifacts,
)
from firmware_lookup.result import (
    Confidence, FirmwareResult, cannot_determine, model_not_found, ok_result,
)
from firmware_lookup.session import BrowserLoginSessionManager
from firmware_lookup.versioning import is_update_available

PORTAL_URL = "https://www.dell.com/support"
HOME_URL = PORTAL_URL

# Dell OS10 / switch firmware versions look like "10.5.4.0", "10.5.2.0".
# CONFIRMED BUG, found live TWICE (titles "...V3.33.4.1-1..." and
# "...v3.40.5.1-26..."): a plain \b\d... pattern can't match starting
# right at the leading digit when it's directly preceded by "v"/"V" with
# no separator -- \b requires a transition between a word char and a
# non-word char, and "v" and a digit are BOTH word characters, so there
# is no boundary there at all. The regex engine then finds the next
# available boundary (after the first ".", one digit group in), silently
# truncating "3.40.5.1" down to "40.5.1". Fixed by matching an optional
# leading v/V explicitly instead of relying on \b to skip it.
DELL_VERSION_PATTERN = re.compile(r"(?:[vV](?=\d))?(\d{1,2}\.\d{1,2}\.\d{1,2}(?:\.\d{1,2})?)\b")

# CONFIRMED BUG, found live: a whole-body-text scan of the filtered
# "Downloads & Drivers" results grabbed a version number from "Dell
# Networking Diagnostics Tools 3.33.4.1-X for S4148 Open Networking
# Switch" -- a real, verified driver entry, but a DIAGNOSTIC UTILITY,
# not the switch's actual OS/firmware image. Real page structure
# inspected live: each result's title is cleanly exposed as
# title="..." on its <a class="citation-link">, e.g. exactly the string
# above -- far more reliable to match against than free body text.
# Extraction is now scoped to these real per-entry titles, and only
# accepts a candidate whose title contains "Firmware" while explicitly
# excluding "Diagnostics" and "OpenManage" (a management plugin, also
# confirmed real but also not switch firmware) -- if nothing on the page
# genuinely qualifies, this correctly returns no candidates rather than
# reporting a diagnostics-tool version as if it were the switch's OS.
_CITATION_TITLE_RE = re.compile(r'class="citation-link"[^>]*title="([^"]+)"')
# CONFIRMED BUG #3, found live: even after requiring "Firmware" in the
# title and excluding Diagnostics/OpenManage, the next real entry that
# slipped through was "Innodisk Solid-State Drive Firmware Update for
# 3IE3, v3.00.7.0-3" -- firmware for an internal storage COMPONENT, not
# the switch's own network OS. Excluding it too. This is the third
# distinct false-positive category found live in a row (forum post -> AI
# narrative -> diagnostics tool -> component firmware) for the exact
# same model search -- a real signal that Dell's public driver catalog
# may not surface a distinct switch-OS download for every model at all,
# not just a regex problem to keep patching indefinitely.
_DISQUALIFYING_WORDS = (
    "diagnostics", "openmanage", "solid-state", "solid state", "ssd",
)
# A genuine switch OS/firmware entry for PowerSwitch models is expected
# to name the model family itself (not just a generic "Firmware" word
# that any component update could also carry) -- require the model
# string to also appear in the title as an extra real-world anchor.
#
# HONESTY FLAG, unresolved: the best real, model-anchored, non-excluded
# candidate found live so far is titled "Dell Networking Firmware
# Updater vX.Y.Z-N for <model>" -- this is very likely the actual OS10
# firmware package for the switch, but it could also just be an
# installer/updater UTILITY that reports its own tool version, distinct
# from the OS10 image version it installs (same ambiguity class as the
# already-excluded Diagnostics Tools, just less clear-cut). No test
# account or definitive real evidence available yet to settle this
# either way -- flagged in the result message (see below) rather than
# asserted as fact.
def _real_firmware_candidates(html: str, model: str) -> list[tuple[str, str]]:
    """Returns [(version, title), ...] so callers can inspect which real
    entry a version came from, not just the bare number."""
    candidates = []
    model_key = re.sub(r"[\s\-]+", "", model).lower()
    for title in _CITATION_TITLE_RE.findall(html):
        lower = title.lower()
        if any(word in lower for word in _DISQUALIFYING_WORDS):
            continue
        if "firmware" not in lower:
            continue
        title_key = re.sub(r"[\s\-]+", "", lower)
        if model_key and model_key not in title_key:
            continue
        for version in DELL_VERSION_PATTERN.findall(title):
            candidates.append((version, title))
    return candidates


class DellSessionManager(BrowserLoginSessionManager):
    HOME_URL = HOME_URL
    ACCOUNT_CHECK_URL = HOME_URL
    # CONFIRMED BUG, found live against a real Dell login: the background
    # confirmation ping (see session.py's REQUIRE_LOGIN_CONFIRM_REQUEST
    # docstring) got a 403 from Akamai on every single poll for 5+
    # minutes straight, with zero exceptions, while the free local URL
    # check passed the entire time -- unlike Cisco, where this same ping
    # DID eventually succeed for real. Trust the local check alone for
    # Dell instead of running out the full timeout on a guaranteed-false
    # negative after a genuine login.
    REQUIRE_LOGIN_CONFIRM_REQUEST = False


class DellProvider(BrowserAuthenticatedProvider):
    HOME_URL = HOME_URL
    # CONFIRMED BUG, found live: reusing a saved session headlessly hit
    # the exact same Akamai "Access Denied" block already proven for
    # Cisco -- real screenshot showed "You don't have permission to
    # access 'http://www.dell.com/support' on this server", served from
    # errors.edgesuite.net (Akamai's own error domain), even with a
    # freshly-confirmed valid session. Dell needs a visible window for
    # reused-session lookups too, same as Cisco -- this was a real,
    # tested exception to the headless default, not a guess.
    REUSE_SESSION_HEADLESS = False

    def __init__(self):
        super().__init__("Dell", PORTAL_URL)
        self.session_manager = DellSessionManager("Dell")

    def check_public_source(
        self, vendor: str, model: str, current_version: str,
    ) -> Optional[FirmwareResult]:
        # VERIFIED LIVE (see module docstring): this works with zero
        # login for the common case. Runs its own throwaway browser (no
        # saved session needed) -- login only kicks in if this returns
        # None. headless=False: confirmed live that Dell's Akamai edge
        # blocks headless contexts with "Access Denied" regardless of
        # login state, same block already known for the authenticated
        # path (REUSE_SESSION_HEADLESS below).
        if not model:
            return None

        try:
            from playwright.sync_api import sync_playwright
        except ImportError:
            return None

        try:
            with sync_playwright() as playwright:
                browser = playwright.chromium.launch(headless=False)
                try:
                    page = browser.new_page()
                    result = self._search_and_extract(page, vendor, model, current_version)
                finally:
                    browser.close()
        except Exception:
            return None

        # Only a real match is worth short-circuiting login for --
        # anything else should fall through to the login path instead,
        # in case an authenticated session does better.
        if result is not None and result.status.value == "ok":
            return result
        return None

    def _extract_from_page(
        self, page, vendor: str, model: str, current_version: str,
    ) -> FirmwareResult:
        # Dell overrides _extract_from_page entirely (its own filter +
        # AI-overview-exclusion logic), so it doesn't inherit the base
        # class's stale-session DOM veto (see providers/base.py) --
        # applying a check here directly so a session that's
        # expired-but-not-yet-timestamp-expired self-heals. Deliberately
        # password-field ONLY, not the login-prompt-button veto used
        # elsewhere: verified live that Dell's page shows a "Sign In"
        # button/link as persistent header chrome even on the fully
        # anonymous page (1 button + 3 links, all reading "Sign In") --
        # no evidence it disappears once actually authenticated, so
        # using it here risks flagging a genuinely valid Dell session as
        # stale. A password field is a much safer signal: it's
        # login-form-specific, not standing nav chrome.
        try:
            page.goto(self.HOME_URL, wait_until="domcontentloaded")
            from firmware_lookup.browser_login import _password_field_visible
            stale_session = _password_field_visible(page)
        except Exception:
            stale_session = False
        if stale_session:
            dump_debug_artifacts(page, vendor, "stale_session_login_page")
            self.session_manager.invalidate_session()
            from firmware_lookup.result import auth_required
            return auth_required(
                vendor, model, current_version,
                manual_check_url=self.PORTAL_URL,
            )
        return self._search_and_extract(page, vendor, model, current_version)

    def _search_and_extract(
        self, page, vendor: str, model: str, current_version: str,
    ) -> FirmwareResult:
        """Shared real logic for both the anonymous (check_public_source)
        and authenticated (_extract_from_page) paths."""
        dump_path = None
        try:
            page.goto(self.HOME_URL, wait_until="domcontentloaded")

            # CONFIRMED BUG, found live: a cookie-consent modal ("This
            # website uses cookies...", Decline All / Accept All) covers
            # the page on first load and blocks interaction with the
            # real search box and results below it -- a debug screenshot
            # showed the search term typed but the page still rendering
            # the generic "Welcome to Dell Support" hero, not real
            # results, because the click-throughs behind the modal never
            # actually registered. Dismiss it up front, best-effort (a
            # miss here just means the page behaves as it did before
            # this fix -- never blocks the rest of the flow).
            try:
                page.locator("button:has-text('Accept All')").first.click(timeout=4000)
                page.wait_for_timeout(500)
            except Exception:
                pass

            dump_path = dump_debug_artifacts(page, vendor, "home")

            try:
                search_box = page.locator(
                    "input[type='search'], input[placeholder*='Search' i]"
                ).first
                search_box.wait_for(state="visible", timeout=8000)
            except Exception:
                dump_path = dump_debug_artifacts(page, vendor, "no_search_box") or dump_path
                return cannot_determine(
                    vendor, model, current_version,
                    retrieval_method="public_browser",
                    reason=(
                        "No search box matched the guessed selector on "
                        f"the real Dell page. Debug artifacts: {dump_path or 'none'}."
                    ),
                    manual_check_url=self.PORTAL_URL,
                )

            pre_search_url = page.url
            search_box.fill(model)
            search_box.press("Enter")
            try:
                page.wait_for_load_state("networkidle", timeout=8000)
            except Exception:
                pass
            page.wait_for_timeout(1500)
            dump_path = dump_debug_artifacts(page, vendor, "results") or dump_path

            if page.url == pre_search_url:
                return cannot_determine(
                    vendor, model, current_version,
                    retrieval_method="public_browser",
                    reason=(
                        "Filled the search box, but the page never "
                        f"navigated anywhere after pressing Enter for "
                        f"{model!r}. Debug artifacts: {dump_path or 'none'}."
                    ),
                    manual_check_url=self.PORTAL_URL,
                )

            # CONFIRMED BUG, found live (see module docstring): the
            # unfiltered results page mixes forums/KB/manuals/drivers
            # together, and a forum poster's own installed version got
            # grabbed as if it were Dell's answer. Filter down to the
            # real "Downloads & Drivers" panel first -- best-effort,
            # since the post-filter page structure itself is still
            # unverified live.
            filtered = False
            try:
                filter_checkbox = page.locator(
                    "label:has-text('Downloads & Drivers'):visible"
                ).first
                filter_checkbox.click(timeout=5000)
                try:
                    page.wait_for_load_state("networkidle", timeout=8000)
                except Exception:
                    pass
                page.wait_for_timeout(1500)
                filtered = True
            except Exception:
                pass
            dump_path = dump_debug_artifacts(
                page, vendor, "filtered_results" if filtered else "unfiltered_results",
            ) or dump_path

            # CONFIRMED BUG #2, found live: even scoped to the filtered
            # Downloads & Drivers panel, a whole-body-text scan grabbed a
            # version from "Dell Networking Diagnostics Tools 3.33.4.1-X
            # for S4148 Open Networking Switch" -- a real, verified
            # driver entry, but a diagnostic UTILITY, not the switch's
            # actual OS/firmware image. Also confirmed live: the "Dell AI
            # Overview" panel's own narrative prose ("...equipped with
            # SmartFabric OS10, release 10.5.3.2...") is self-labelled
            # "Generated content may contain errors" and must never be
            # trusted as a citable source either. Extraction now reads
            # ONLY the real title="..." attributes Dell puts on each
            # verified citation link (see _real_firmware_candidates
            # above) -- this structurally avoids both the AI narrative
            # prose (never touches inner_text) and diagnostic/management
            # entries (explicit word filter), rather than trying to
            # patch the whole-body regex further.
            html = page.content()
            candidates = _real_firmware_candidates(html, model)
        except Exception as e:
            return cannot_determine(
                vendor, model, current_version,
                retrieval_method="public_browser",
                reason=(
                    f"Dell lookup failed: {e}. Debug "
                    f"artifacts: {dump_path or 'none'}."
                ),
                manual_check_url=self.PORTAL_URL,
            )

        if not candidates:
            # Honest "not found" -- confirmed live that Dell's driver
            # catalog for a switch model can genuinely contain ONLY
            # diagnostic/management-tool entries with no distinct
            # "firmware"-titled listing at all. Reporting a tool's
            # version as if it were the switch's OS would be a fabricated
            # answer; falling through (via None from check_public_source,
            # or model_not_found from the authenticated path) to the
            # login safety net is the honest move instead.
            return model_not_found(
                vendor, model, current_version, retrieval_method="public_browser",
                manual_check_url=self.PORTAL_URL,
            )

        latest_version, matched_title = candidates[0]
        latest_version = latest_version.strip()
        # HONESTY FLAG (see _real_firmware_candidates docstring): a match
        # from an "...Updater..."-titled entry is likely the real OS10
        # firmware package, but could instead be an installer tool's own
        # version -- unresolved without a real account to check against.
        # Downgrade confidence and say so explicitly rather than assert
        # certainty either way.
        is_updater = "updater" in matched_title.lower()
        confidence = Confidence.LOW if (is_updater or not filtered) else Confidence.MEDIUM
        return ok_result(
            vendor=vendor,
            model=model,
            current_version=current_version,
            latest_version=latest_version,
            source_url=self.HOME_URL,
            confidence=confidence,
            retrieval_method="public_browser",
            update_available=is_update_available(current_version, latest_version),
            message=(
                (
                    "Retrieved via Dell's public support search, filtered "
                    "to the real 'Downloads & Drivers' results panel, "
                    "scoped to entries whose own title contains "
                    "'Firmware', and excluding Diagnostics/OpenManage "
                    "tool listings and Dell's AI-generated summary (fixes "
                    "three confirmed false-positive bugs found live: a "
                    "forum post's own installed-version mention, an "
                    "AI-generated summary Dell itself labels as possibly "
                    "inaccurate, and a diagnostics utility's version "
                    "being mistaken for the switch's own firmware)."
                    if filtered else
                    "Retrieved via Dell's public support search, but the "
                    "'Downloads & Drivers' filter could not be applied "
                    "(page may have changed) -- this scanned the full "
                    "mixed results page instead, so it may be forum/KB "
                    "text rather than a real driver listing. Confidence "
                    "lowered accordingly."
                ) + (
                    " UNRESOLVED: this came from an entry titled "
                    f"{matched_title!r} -- likely the real firmware "
                    "package, but possibly an installer/updater tool's "
                    "own version number instead of the switch OS version "
                    "it installs. Please verify against the source link "
                    "before trusting this number."
                    if is_updater else
                    " Please confirm this looks like a genuine version "
                    "string from an actual driver entry, not stray page text."
                )
            ),
        )
