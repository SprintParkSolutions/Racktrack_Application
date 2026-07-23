"""
FirmwareProvider contract + two reusable base classes:
  - UnimplementedProvider: shared by dead-end Tier-1 vendors (no real
    source found). Avoids one boilerplate file per vendor.
  - LoginGatedProvider: Tier-2 base. Checks for a public source first;
    falls back to the login-session framework; if that can't establish a
    real session (it never can this pass -- see session.py), returns the
    honest auth_required() result.

Contract every provider must honor:
  - get_latest_firmware() must NEVER raise. Catch everything internally
    and return cannot_determine() instead.
  - Must never fabricate a version number.
  - Must never perform a generic web search or scrape a non-official
    domain.
"""
from __future__ import annotations

import logging
import re
from abc import ABC, abstractmethod
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from firmware_lookup.result import (
    Confidence, FirmwareResult, auth_required, cannot_determine,
    model_not_found, not_implemented, ok_result,
)
from firmware_lookup.session import BrowserLoginSessionManager, LoginSessionManager
from firmware_lookup.versioning import is_update_available

logger = logging.getLogger("firmware_lookup.providers")

# Screenshot + HTML dump on any authenticated_lookup failure. Proven
# valuable for Cisco (turned a guessed selector into a real, fixable
# finding instead of a dead-end error string) -- generic here so every
# vendor gets the same diagnosability.
DEBUG_DIR = Path(__file__).parent.parent / "debug_output"


class FirmwareProvider(ABC):
    vendor_key: str = ""

    @abstractmethod
    def get_latest_firmware(
        self, vendor: str, model: str, current_version: str,
    ) -> FirmwareResult:
        ...


class UnimplementedProvider(FirmwareProvider):
    """Registered for vendors where live research this session found no
    viable public source (JS-only SPA, bot-walled, or no stable page).

    `manual_check_url`, when given, is a real vendor page verified to be
    reachable by a real human browser (even though our automated access
    is blocked) -- passed through so the user gets a real link to check
    themselves instead of a dead end. Never a guess: only set for
    vendors where the URL was actually verified live.

    CONFIRMED GAP, flagged live 2026-07-16: this used to hand back
    manual_check_url immediately, based purely on PAST research (a
    reason string dated 2026-07-13 etc.) -- it never actually tried
    anything on the current call. That's backwards from every other
    provider's "try automatically first, link is the last resort"
    pattern. Fixed: now makes one real, live GET against
    manual_check_url on every call before falling back -- if the block
    has genuinely lifted since it was last checked, this says so
    honestly (still not_implemented, since there's no extraction logic
    built for these vendors even if the page loads, but the message
    reflects what was ACTUALLY observed just now, not a stale claim)."""

    def __init__(
        self, vendor_key: str, reason: str, manual_check_url: str = "",
        user_reason: str = "",
    ):
        self.vendor_key = vendor_key
        self.reason = reason
        self.manual_check_url = manual_check_url
        self.user_reason = user_reason

    def get_latest_firmware(
        self, vendor: str, model: str, current_version: str,
    ) -> FirmwareResult:
        logger.info("[%s] not implemented (history): %s", vendor, self.reason)

        still_blocked = True
        if self.manual_check_url:
            try:
                from firmware_lookup.http_client import FirmwareHttpClient
                probe = FirmwareHttpClient(vendor.lower().replace(" ", "_"))
                html = probe.get_text(self.manual_check_url)
                still_blocked = html is None
                logger.info(
                    "[%s] live re-check of %s: %s", vendor, self.manual_check_url,
                    "still blocked" if still_blocked else "reachable now",
                )
            except Exception:
                logger.exception("[%s] live re-check raised", vendor)
                still_blocked = True  # can't confirm it's open -- stay honest

        result = not_implemented(
            vendor, model, current_version, self.manual_check_url or None,
            user_reason=self.user_reason or None,
        )
        # The "reachable now" rewording below is specifically for the
        # bot-wall-lifted scenario -- a confirmed structural gap (e.g.
        # UfiSpace's hardware genuinely not publishing a version at
        # all) stays true regardless of whether the page loads, so it
        # must not be overwritten by that generic wording.
        if self.user_reason:
            return result
        if self.manual_check_url and not still_blocked:
            # Genuinely new information -- the page loads now. Worded
            # reason-agnostically: some vendors here (D-Link, Teltonika,
            # Allied Telesis) were originally BOT-BLOCKED, but others
            # (ORing, Antaira, Linksys) were never blocked at all -- the
            # real gap for those is a missing version field on an
            # otherwise-reachable page. Claiming "it was blocked" for
            # the latter group would itself be an inaccurate statement,
            # so this only asserts what's actually true either way: the
            # page is reachable right now, and the ORIGINAL reason
            # logged above is what still applies (see self.reason).
            result.message = (
                "Provider not implemented -- no extraction logic has "
                "been built for this vendor yet, but its site is "
                "reachable right now. You can check the current "
                "version yourself using the link below."
            )
        return result


class LoginGatedProvider(FirmwareProvider):
    """Base for Tier-2 (enterprise/login-gated) vendors."""

    vendor_key: str = ""
    PORTAL_URL: str = ""

    def __init__(self, vendor_key: str, portal_url: str):
        self.vendor_key = vendor_key
        self.PORTAL_URL = portal_url
        self.session_manager = LoginSessionManager(vendor_key)

    def check_public_source(
        self, vendor: str, model: str, current_version: str,
    ) -> Optional[FirmwareResult]:
        """Override when a vendor publishes latest-version info without
        login (e.g. Fortinet's public docs site). Default: no public
        source known."""
        return None

    def authenticated_lookup(
        self, vendor: str, model: str, current_version: str, session: dict,
    ) -> FirmwareResult:
        """Override when a real login() exists for this vendor (currently
        just Cisco) to actually use the authenticated session. Default:
        unchanged historical behavior -- honest auth_required(), so every
        vendor without a real login() is provably unaffected by this
        hook's existence."""
        return auth_required(vendor, model, current_version)

    def get_latest_firmware(
        self, vendor: str, model: str, current_version: str,
    ) -> FirmwareResult:
        try:
            result = self.check_public_source(vendor, model, current_version)
        except Exception:
            logger.exception("[%s] check_public_source raised", vendor)
            result = None
        if result is not None:
            return result

        # ensure_session() only loads+validates an existing session (see
        # session.py) -- it never triggers an interactive browser login,
        # so this never blocks a normal lookup call waiting on a human.
        # It CAN still raise, though: a session file can exist on disk
        # while this particular process/instance has no passphrase
        # cached in memory yet (e.g. a fresh process, or a web-UI login
        # that used a different instance -- see server.py's fix for
        # that specific case). Decrypting then fails, and that failure
        # must degrade to auth_required(), not crash the whole lookup --
        # this normal API-key/vendor lookup call has no way to supply a
        # passphrase, so "can't decrypt" and "no session" are the same
        # outcome from the caller's point of view.
        try:
            session = self.session_manager.ensure_session()
        except Exception:
            logger.exception("[%s] ensure_session raised", vendor)
            session = None
        if session is None:
            # Public source didn't resolve and there's no session yet --
            # the UI offers a login prompt at this status, but also hand
            # over the vendor's real portal directly as a same-step
            # alternative, in case the user would rather just check it
            # themselves than go through login.
            return auth_required(vendor, model, current_version, self.PORTAL_URL or None)

        try:
            return self.authenticated_lookup(vendor, model, current_version, session)
        except Exception as e:
            logger.exception("[%s] authenticated_lookup raised", vendor)
            # Final fallback: public failed, login was actually attempted
            # (a session existed), and the authenticated lookup itself
            # still blew up -- both automatic steps are now exhausted,
            # so hand over the real portal link as promised.
            return cannot_determine(
                vendor, model, current_version,
                retrieval_method="authenticated",
                reason=f"Internal error during authenticated lookup: {e}",
                manual_check_url=self.PORTAL_URL or None,
            )


def dump_debug_artifacts(page, vendor_key: str, label: str) -> Optional[str]:
    """Save page HTML + a screenshot so a failed selector is diagnosable
    without a live account. Never raises -- a failure to dump debug
    artifacts must not mask the original error. Returns the dump path
    (without extension) as a string, or None if the dump itself failed."""
    try:
        DEBUG_DIR.mkdir(parents=True, exist_ok=True)
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        base = DEBUG_DIR / f"{vendor_key.lower().replace(' ', '_')}_{label}_{stamp}"
        base.with_suffix(".html").write_text(page.content())
        page.screenshot(path=str(base.with_suffix(".png")), full_page=True)
        return str(base)
    except Exception as e:
        logger.warning("[%s] failed to dump debug artifacts: %s", vendor_key, e)
        return None


class BrowserAuthenticatedProvider(LoginGatedProvider):
    """Generic Tier-2 provider: browser-assisted login (via
    BrowserLoginSessionManager) + a generic search-box-then-regex-
    extract authenticated lookup. Built by generalizing what was proven,
    with real bugs found and fixed via live testing, for Cisco (see
    providers/cisco.py's module docstring).

    ***HONESTY FLAG***: the search selectors and extraction regex here
    are the SAME best-effort guesses used for Cisco, applied generically
    -- UNVERIFIED for any vendor besides Cisco itself, since there is no
    test account for the others. A vendor subclass should override
    authenticated_lookup() entirely once it's been tested live and the
    real page structure is known, rather than trusting this generic
    version to be correct.

    CONFIRMED BUG, found live against a real Juniper account: pressing
    Enter/clicking a search button on free-typed text doesn't always
    trigger real navigation -- Juniper's page silently stayed on the
    same Downloads landing page, and the old `text=/regex/` locator then
    grabbed the FULL TEXT of an unrelated static sidebar element ("RE:
    vSRX evaluation + Openshift | 2026.07.12", a community-forum post
    title+date) as if it were the answer, because Playwright's `text=`
    selector matches an element containing the pattern anywhere and then
    returns that whole element's text, not just the matched substring.
    Fixed two ways, generically (not just for Juniper): (1) if the URL
    hasn't changed after the search action, that's proof nothing
    happened -- return cannot_determine() instead of scanning the still-
    generic page; (2) extraction now runs a Python regex over
    page.inner_text("body") so only the matched substring itself is
    returned as a candidate, never the surrounding sentence.
    """

    HOME_URL: str = ""

    # CONFIRMED BUG, reported live: reusing an already-saved session (no
    # fresh login needed) still opened a VISIBLE browser window just to
    # run the search -- nothing for a human to do there, so nothing
    # should be shown. Default to headless for this reused-session path.
    # Cisco AND Dell are confirmed exceptions (not the default): both
    # were VERIFIED LIVE to block headless contexts with a real Akamai
    # "Access Denied" page even with valid session cookies loaded --
    # CiscoProvider and DellProvider explicitly override this back to
    # False. Every other vendor here is UNVERIFIED for headless reuse --
    # given two-for-two real vendors hitting this exact same Akamai
    # block, treat headless reuse as optimistic rather than assumed-safe
    # for any new vendor until it's actually been observed live.
    REUSE_SESSION_HEADLESS: bool = True

    def __init__(self, vendor_key: str, portal_url: str):
        self.vendor_key = vendor_key
        self.PORTAL_URL = portal_url
        self.session_manager = BrowserLoginSessionManager(vendor_key)
        self.session_manager.HOME_URL = self.HOME_URL
        self.session_manager.ACCOUNT_CHECK_URL = self.HOME_URL

    def _extract_from_page(
        self, page, vendor: str, model: str, current_version: str,
    ) -> FirmwareResult:
        """Given an ALREADY-AUTHENTICATED page (doesn't matter whether it
        just finished a fresh login or was reloaded from a saved
        session), navigate to HOME_URL, search for `model`, and extract a
        version. Split out from authenticated_lookup() so the exact same
        logic can run either (a) against a reloaded saved session, or
        (b) directly inside the still-open browser right after a fresh
        login -- see login_and_fetch() below, built because the old
        design required TWO separate browser windows (one to log in,
        a SEPARATE one afterward just to search) which was slow and
        looked broken from the outside."""
        dump_path = None
        try:
            page.goto(self.HOME_URL, wait_until="domcontentloaded")

            # CONFIRMED BUG, found live against Supermicro (real HTML dump
            # evidence): checking the login-prompt veto immediately after
            # "domcontentloaded" caught the page before its own JS had
            # finished -- Supermicro's account-state UI (the
            # js-login/js-sign-in/js-sign-out menu block, plus a "Sign in"
            # CTA in the page's marketing banner) is populated/toggled by
            # client-side JS AFTER the initial DOM load, so a genuinely
            # fresh, real, human-completed login (captcha and all) still
            # showed the default logged-out markup a few seconds later and
            # got wrongly invalidated -- a timing race, not a real
            # logged-out state. Same fix already used before the search-
            # results scan below (networkidle wait, capped, with a short
            # fixed buffer since some sites never go fully idle): give any
            # async auth-state JS a chance to settle before the veto reads
            # the DOM, instead of reading it the instant the DOM exists.
            try:
                page.wait_for_load_state("networkidle", timeout=8000)
            except Exception:
                pass
            page.wait_for_timeout(1500)

            dump_path = dump_debug_artifacts(page, vendor, "home")

            # CONFIRMED BUG, found live against Cisco: is_session_valid()
            # only checks the saved expires_at timestamp, not whether the
            # session was ever genuinely authenticated -- a session saved
            # from a false-positive login detection gets silently reused
            # for its whole lifetime, landing back on a real login page
            # here every time, while this method still went on to claim
            # "Logged in successfully" in its error message (see below).
            # A password field OR a visible "Log In" prompt right after
            # navigating to HOME_URL is a direct, reliable "we are NOT
            # logged in" signal regardless of what the stored session
            # claimed -- same two DOM vetoes used in browser_login.py's
            # fresh-login detection (the second one added after real
            # evidence showed Cisco's home page serves the SAME URL
            # whether logged in or not, just swapping in a "LOG IN NOW"
            # button instead of a password field for the logged-out
            # case -- a URL check alone can never catch that).
            try:
                from firmware_lookup.browser_login import (
                    _login_prompt_visible, _password_field_visible,
                )
                # CONFIRMED BUG, found live against ORing: its nav bar
                # keeps a static "Sign In" link regardless of real auth
                # state (see session.py's CHECK_LOGIN_PROMPT_TEXT for
                # the full evidence) -- reuses that same per-vendor flag
                # here so a reused, genuinely valid ORing session isn't
                # wrongly invalidated by the identical false positive.
                check_login_prompt = getattr(
                    self.session_manager, "CHECK_LOGIN_PROMPT_TEXT", True,
                )
                stale_session = _password_field_visible(page) or (
                    check_login_prompt and _login_prompt_visible(page)
                )
            except Exception:
                stale_session = False
            if stale_session:
                dump_path = dump_debug_artifacts(page, vendor, "stale_session_login_page") or dump_path
                self.session_manager.invalidate_session()
                return auth_required(
                    vendor, model, current_version,
                    manual_check_url=self.PORTAL_URL or None,
                )

            try:
                search_box = page.locator(
                    "input[type='search'], input[placeholder*='Search' i]"
                ).first
                search_box.wait_for(state="visible", timeout=8000)
            except Exception:
                dump_path = dump_debug_artifacts(page, vendor, "no_search_box") or dump_path
                return cannot_determine(
                    vendor, model, current_version,
                    retrieval_method="authenticated_browser",
                    reason=(
                        f"Logged in successfully, but no search box "
                        f"matched the guessed selector on the real "
                        f"{vendor} page. Debug artifacts saved to "
                        f"{dump_path or DEBUG_DIR} -- share the .png "
                        "so the selector can be fixed against the "
                        "real page instead of guessed again."
                    ),
                    manual_check_url=self.PORTAL_URL or None,
                )

            pre_search_url = page.url
            search_box.fill(model)
            search_box.press("Enter")
            # CONFIRMED BUG, found live against a real Dell account:
            # a fixed 3s wait raced Dell's SPA -- the debug
            # screenshot captured at exactly that mark still showed
            # a "Loading results" spinner with an empty results
            # area, so the regex scanned a page with no content yet
            # and wrongly concluded model_not_found. networkidle
            # waits for the actual async fetch to finish instead of
            # guessing a fixed delay; best-effort since some sites
            # never go fully idle (e.g. polling/analytics), so a
            # short fallback wait still runs either way.
            try:
                page.wait_for_load_state("networkidle", timeout=8000)
            except Exception:
                pass
            page.wait_for_timeout(1500)
            dump_path = dump_debug_artifacts(page, vendor, "results") or dump_path

            if page.url == pre_search_url:
                return cannot_determine(
                    vendor, model, current_version,
                    retrieval_method="authenticated_browser",
                    reason=(
                        f"Logged in and filled the search box, but the "
                        f"page never navigated anywhere after pressing "
                        f"Enter -- {vendor}'s search may require "
                        "picking a real autocomplete suggestion rather "
                        "than accepting free-typed text, or may load "
                        "results via JS without a URL change (this "
                        "exact failure mode was confirmed live for "
                        "Juniper, where it produced a false-positive "
                        "match against unrelated sidebar text). Debug "
                        f"artifacts: {dump_path or DEBUG_DIR}."
                    ),
                    manual_check_url=self.PORTAL_URL or None,
                )

            # CONFIRMED BUG, found live against a real RUCKUS account:
            # the whole-page scan grabbed "12.2.0" from the SITE'S OWN
            # footer build-version stamp ("12.2.0 | 20260626.1_6249"),
            # not any switch firmware -- confirmed via a real debug
            # screenshot. This is a generic risk (many corporate sites
            # stamp a build/CMS version in the footer), so excluding
            # <footer> from the scan is a base-class fix, not a
            # RUCKUS-specific patch.
            try:
                page.evaluate(
                    "document.querySelectorAll('footer').forEach(el => el.remove())"
                )
            except Exception:
                pass
            body_text = page.inner_text("body")
            candidates = re.findall(
                r"\b\d+\.\d+(?:\.\d+)?[A-Za-z0-9()]{0,8}\b", body_text
            )
        except Exception as e:
            return cannot_determine(
                vendor, model, current_version,
                retrieval_method="authenticated_browser",
                reason=(
                    f"{vendor} authenticated lookup failed: {e}. Debug "
                    f"artifacts: {dump_path or DEBUG_DIR}."
                ),
                manual_check_url=self.PORTAL_URL or None,
            )

        if not candidates:
            return model_not_found(
                vendor, model, current_version,
                retrieval_method="authenticated_browser",
                manual_check_url=self.PORTAL_URL or None,
            )

        latest_version = candidates[0].strip()
        return ok_result(
            vendor=vendor,
            model=model,
            current_version=current_version,
            latest_version=latest_version,
            source_url=self.HOME_URL,
            confidence=Confidence.MEDIUM,
            retrieval_method="authenticated_browser",
            update_available=is_update_available(current_version, latest_version),
            message=(
                f"Retrieved via an authenticated {vendor} session. "
                "Extraction selectors are best-effort and unverified "
                "against a real account -- please confirm this looks "
                "like a genuine version string, not stray page text."
            ),
        )

    def authenticated_lookup(
        self, vendor: str, model: str, current_version: str, session: dict,
    ) -> FirmwareResult:
        from firmware_lookup.browser_login import open_authenticated_page

        storage_state = session.get("storage_state")
        if not storage_state:
            return cannot_determine(
                vendor, model, current_version,
                retrieval_method="authenticated_browser",
                reason=f"Saved {vendor} session was missing browser state data.",
                manual_check_url=self.PORTAL_URL or None,
            )

        try:
            with open_authenticated_page(storage_state, headless=self.REUSE_SESSION_HEADLESS) as page:
                return self._extract_from_page(page, vendor, model, current_version)
        except Exception as e:
            return cannot_determine(
                vendor, model, current_version,
                retrieval_method="authenticated_browser",
                reason=f"{vendor} authenticated lookup failed: {e}.",
                manual_check_url=self.PORTAL_URL or None,
            )

    def login_and_fetch(
        self, vendor: str, model: str, current_version: str,
    ) -> FirmwareResult:
        """Entry point for the web UI's login button when a model/version
        is already known: chains login straight into extraction in ONE
        browser session instead of the old two-step flow (log in, close
        that window, then separately click "Look up" which opened a
        SECOND window to search) -- the direct fix for the reported
        problem that fetching didn't seem to happen automatically once
        login succeeded.

        If a valid session already exists, no fresh browser opens here at
        all (see ensure_session_interactive()), so there's nothing for an
        extractor to run inside -- falls back to the normal
        authenticated_lookup() path in that case, which is still just
        one browser window."""
        result_holder: dict = {}

        def extractor(page):
            result_holder["result"] = self._extract_from_page(
                page, vendor, model, current_version,
            )

        try:
            session = self.session_manager.ensure_session_interactive(extractor=extractor)
        except Exception as e:
            logger.exception("[%s] login_and_fetch raised", vendor)
            return cannot_determine(
                vendor, model, current_version,
                retrieval_method="authenticated_browser",
                reason=f"Login failed: {e}",
                manual_check_url=self.PORTAL_URL or None,
            )

        if session is None:
            return cannot_determine(
                vendor, model, current_version,
                retrieval_method="authenticated_browser",
                reason="Login was not completed (timed out or window closed).",
                manual_check_url=self.PORTAL_URL or None,
            )

        if "result" in result_holder:
            return result_holder["result"]

        # A valid session already existed -- login() (and the extractor
        # inside it) never ran. Same session, same guarantees, just via
        # the existing one-window reload path instead.
        return self.authenticated_lookup(vendor, model, current_version, session)
