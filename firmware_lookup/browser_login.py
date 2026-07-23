"""
Reusable browser-assisted login helper for Tier-2 (login-gated) vendors.

Pattern adapted from Agent_scrap/nvidia_poc/nvidia.py (that file itself
is NOT modified/imported here -- this is a fresh, generic version of the
same idea): modern vendor portals run JS-driven SSO/MFA login flows that
a scripted HTTP POST cannot drive, so we open a REAL, visible browser and
let a human complete the login (including any MFA/CAPTCHA/SSO redirects).
We detect success by polling a throwaway tab against an
authentication-only URL until it stops looking like a login page, then
capture Playwright's `storage_state()` (cookies + localStorage) so future
runs can reuse the session headlessly without a browser window at all.
"""
from __future__ import annotations

import logging
import re
import time
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Iterator, Optional

logger = logging.getLogger("firmware_lookup.browser_login")

NAV_TIMEOUT_MS = 30_000
MANUAL_LOGIN_TIMEOUT_MS = 10 * 60 * 1000
MANUAL_LOGIN_POLL_MS = 5_000

# Same directory providers/base.py's dump_debug_artifacts() uses (that
# function lives in providers/base.py and isn't imported here to avoid
# a circular import -- this is a small, deliberately separate helper).
_DEBUG_DIR = Path(__file__).parent / "debug_output"
# CONFIRMED BUG, found live against Dell: a login attempt sat with a
# persistent HTTP 403 on every confirmation check for 3+ minutes, and
# there was no way to see what the page actually looked like during
# that stretch -- dump_debug_artifacts() only ever fires AFTER login is
# detected, so a login that never gets detected leaves zero visual
# evidence behind. Take a periodic screenshot during the wait itself so
# a stuck/blocked attempt is diagnosable without needing the user to
# manually screenshot their own screen.
_PERIODIC_SCREENSHOT_EVERY_N_POLLS = 6  # ~30s at the default 5s poll


def _dump_periodic_screenshot(page, vendor_key: str, elapsed_ms: int) -> None:
    try:
        _DEBUG_DIR.mkdir(parents=True, exist_ok=True)
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        slug = vendor_key.lower().replace(" ", "_")
        page.screenshot(
            path=str(_DEBUG_DIR / f"{slug}_login_wait_t{elapsed_ms}ms_{stamp}.png"),
            full_page=True,
        )
    except Exception:
        pass  # never let a diagnostic screenshot break the actual login wait
# CONFIRMED BUG, found live against Cisco: a single positive "looks
# authenticated" check closed the browser 5 seconds into an
# account-creation flow the user hadn't finished yet -- the check itself
# was too easily fooled (see cisco.py's module docstring). Requiring
# several CONSECUTIVE positive checks was a partial fix.
CONSECUTIVE_CONFIRMATIONS_REQUIRED = 3

# CONFIRMED BUG #2, found live against Juniper (a DIFFERENT vendor, a
# DIFFERENT failure mode): support.juniper.net's page apparently returns
# a normal 200 whether or not you're actually logged in -- only specific
# things WITHIN the page are gated, not the page itself. That means even
# 3 consecutive "not blocked" checks can pass within 15 seconds despite
# nobody having logged in at all. This is not a one-off: across the only
# two vendors tested live so far, the detection heuristic has failed in
# two DIFFERENT ways (Cisco: "not blocked" != "logged in"; Juniper: the
# page never gates at the HTTP level at all). There is no reliable way
# to detect "you are actually logged in" for a vendor without a real
# account to observe one against -- so instead of trying a third
# heuristic, this puts a hard floor under how fast auto-detection can
# EVER close the browser: no matter what the checks think they see,
# nothing can trigger success before this many milliseconds have
# elapsed, giving a human a fair, honest chance to actually finish
# logging in (including MFA) before any detection logic can act at all.
MINIMUM_ELAPSED_BEFORE_SUCCESS_MS = 90_000

# Best-effort selectors for common login-form shapes (plain HTML forms,
# Okta/Auth0-style SSO widgets). Tried in order; first match wins. This
# is deliberately generic/best-effort -- if none match, prefill is
# silently skipped and the human just types their credentials manually,
# same as before this feature existed. Never blocks or raises.
_USERNAME_SELECTORS = [
    "input[name='username']", "input[id='username']",
    "input[type='email']", "input[name='email']",
    "input[autocomplete='username']",
]
_PASSWORD_SELECTORS = [
    "input[name='password']", "input[id='password']",
    "input[type='password']", "input[autocomplete='current-password']",
]

# CONFIRMED BUG, found live against Cisco (real screenshot evidence): the
# password-field veto below only catches the login FORM itself. Cisco's
# "Software Download" home page is served at the exact same URL whether
# or not you're logged in -- when logged out it just shows a "Login to
# view your download history" / "LOG IN NOW" button in place of real
# content, no password field anywhere on it, no URL change either. A
# visible login-prompt button/link is just as strong a "definitely NOT
# authenticated yet" signal as a password field -- same veto pattern,
# different real-world shape.
_LOGIN_PROMPT_TEXT_RE = re.compile(r"log\s*in|sign\s*in", re.IGNORECASE)


def _login_prompt_visible(page) -> bool:
    try:
        for role in ("button", "link"):
            locator = page.get_by_role(role, name=_LOGIN_PROMPT_TEXT_RE).first
            if locator.is_visible(timeout=500):
                return True
    except Exception:
        pass
    return False


def _password_field_visible(page) -> bool:
    try:
        return any(
            page.locator(sel).first.is_visible(timeout=500)
            for sel in _PASSWORD_SELECTORS
        )
    except Exception:
        return False


def _require_playwright():
    try:
        import playwright.sync_api  # noqa: F401
    except ImportError as e:
        raise RuntimeError(
            "Browser-assisted login requires Playwright. Install it with:\n"
            "  pip install playwright && playwright install chromium"
        ) from e


def _try_prefill(page, username: str, password: str) -> bool:
    """Best-effort: fill username/password into whatever login form is
    on the page right now, using the first matching selector for each.
    Returns True if both fields were found and filled, False otherwise
    (never raises -- a miss just means the human fills it in manually,
    exactly as if this feature didn't exist)."""
    filled_user = filled_pass = False
    for sel in _USERNAME_SELECTORS:
        try:
            locator = page.locator(sel).first
            if locator.is_visible(timeout=1000):
                locator.fill(username)
                filled_user = True
                break
        except Exception:
            continue
    for sel in _PASSWORD_SELECTORS:
        try:
            locator = page.locator(sel).first
            if locator.is_visible(timeout=1000):
                locator.fill(password)
                filled_pass = True
                break
        except Exception:
            continue
    return filled_user and filled_pass


def run_browser_login(
    home_url: str,
    auth_check_url: str,
    is_authenticated: Callable[[str, Optional[int]], bool],
    *,
    timeout_ms: int = MANUAL_LOGIN_TIMEOUT_MS,
    poll_ms: int = MANUAL_LOGIN_POLL_MS,
    prefill: Optional[tuple[str, str]] = None,
    extractor: Optional[Callable[["playwright.sync_api.Page"], None]] = None,
    vendor_key: str = "vendor",
    require_confirm_request: bool = True,
    check_login_prompt_text: bool = True,
) -> Optional[dict]:
    """
    Opens a visible browser at `home_url`, waits for a human to complete
    login. Every `poll_ms` up to `timeout_ms`: first a free, local check
    of the main tab's own URL (no network activity at all); only once
    that looks promising does it make ONE lightweight background HTTP
    request (via the browser context's shared cookies, no new tab, no
    page render) to `auth_check_url` to confirm via status code.
    `is_authenticated(current_url, status_code)` decides both checks
    (status_code is None for the free local check). IMPORTANT: relying on
    URL alone is NOT sufficient for portals that serve a 403/401 at the
    SAME url instead of redirecting to a separate login domain (verified
    true for software.cisco.com -- it returns 403 in place, no redirect)
    -- callers should check status_code, not just url shape, for the real
    confirmation pass.

    Does NOT open a background tab and repeatedly navigate it to the
    protected URL -- verified live this session that doing so (the
    original design) got the user's real login session disrupted
    mid-login, almost certainly Akamai bot-management flagging the
    repeated background-tab activity happening in parallel with an
    active login as automated.

    `prefill`, if given, is a (username, password) pair that gets
    best-effort auto-filled into the login form -- saves retyping, does
    NOT skip MFA/2FA if the portal prompts for it; a human still
    completes that step in the opened window.

    `extractor`, if given, is called with the still-open, now-
    authenticated `page` right after login is detected and BEFORE the
    browser closes -- this is what lets a fresh login chain straight
    into a real lookup in the SAME browser session instead of closing
    this window and having to open a completely separate one afterward
    just to run the search (that two-window round trip was the user-
    reported symptom: "once user logs in it should automatically start
    fetching from that point," not require a second manual step). Any
    exception the extractor raises is caught and logged here -- a
    failed extraction must never prevent the now-valid session from
    still being captured and saved for next time.

    `check_login_prompt_text`, default True: whether a visible "Log In"/
    "Sign In" button/link counts as a hard "still NOT authenticated"
    veto (see _login_prompt_visible). CONFIRMED BUG, found live against
    ORing with a real screenshot: after a genuine, successful login (a
    real Profile page showing the actual account's name, username, and
    registration date), the site's own nav bar still displayed a static
    "Sign In" link regardless of auth state -- this ran the full
    timeout on a guaranteed-false negative even though login had
    already succeeded, the exact same class of bug already found for
    Cisco/Dell but in the opposite direction (there, "Sign In" text was
    the correct veto; here it's a permanent false positive). Set False
    on a vendor's session manager once live evidence shows its nav
    keeps this text regardless of real auth state.

    Returns Playwright's storage_state() dict on success, or None if the
    login wasn't completed within the timeout.
    """
    _require_playwright()
    from playwright.sync_api import TimeoutError as PlaywrightTimeoutError
    from playwright.sync_api import sync_playwright

    # Diagnostic state -- we don't yet know why the window is closing
    # mid-login, so instrument everything instead of guessing again.
    # Mutable dict so the event-listener closures below can read/write
    # it without needing `nonlocal`.
    diag = {"elapsed_ms": 0, "events": []}

    def _log_event(name: str, detail: str = "") -> None:
        entry = f"t+{diag['elapsed_ms']}ms {name} {detail}".strip()
        diag["events"].append(entry)
        print(f"[browser_login] {entry}")

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=False)
        browser.on("disconnected", lambda: _log_event("BROWSER_DISCONNECTED"))
        context = browser.new_context()
        page = context.new_page()
        page.on("close", lambda: _log_event("PAGE_CLOSE"))
        page.on("crash", lambda: _log_event("PAGE_CRASH"))
        page.on("console", lambda msg: (
            _log_event("CONSOLE_" + msg.type.upper(), msg.text[:200])
            if msg.type in ("error", "warning") else None
        ))
        page.on("dialog", lambda d: (
            _log_event("DIALOG", f"{d.type}: {d.message[:200]}"), d.dismiss(),
        ))

        try:
            page.goto(home_url, timeout=NAV_TIMEOUT_MS, wait_until="domcontentloaded")
        except PlaywrightTimeoutError:
            logger.warning("browser_login: could not load %s", home_url)
            browser.close()
            return None

        prefilled = False
        if prefill:
            username, password = prefill
            prefilled = _try_prefill(page, username, password)

        print("\n" + "=" * 70)
        print("MANUAL LOGIN REQUIRED")
        print(f"A browser window has opened at {home_url}.")
        if prefilled:
            print("Username/password were auto-filled from your saved credentials.")
            print("Just complete MFA/SSO if prompted, and submit.")
        else:
            print("Log in (or register) there, including any MFA/SSO steps.")
        print(f"Waiting up to {timeout_ms // 60_000} minute(s)... the window "
              f"will not close before at least "
              f"{MINIMUM_ELAPSED_BEFORE_SUCCESS_MS // 1000}s have passed, "
              f"no matter what, so take your time.")
        print("=" * 70)

        authenticated = False
        died = False
        consecutive_hits = 0
        poll_count = 0
        while diag["elapsed_ms"] < timeout_ms:
            try:
                page.wait_for_timeout(poll_ms)
            except Exception as e:
                # The page/context/browser is gone -- this IS the "window
                # closed" symptom. Stop immediately instead of continuing
                # to hammer a dead page, and record exactly when/how.
                _log_event("WAIT_FAILED", f"{type(e).__name__}: {e}")
                died = True
                break
            diag["elapsed_ms"] += poll_ms
            poll_count += 1

            if page.is_closed():
                _log_event("PAGE_IS_CLOSED_DETECTED")
                died = True
                break

            if poll_count % _PERIODIC_SCREENSHOT_EVERY_N_POLLS == 0:
                _dump_periodic_screenshot(page, vendor_key, diag["elapsed_ms"])

            # CONFIRMED BUG, found live against Cisco (real user report:
            # "the page getting closed when i am entering password"):
            # Cisco's real Okta login URL is an OAuth-style
            # id.cisco.com/oauth2/.../authorize?... URL that doesn't
            # happen to contain "login"/"signin"/"password"/etc, so the
            # URL-substring heuristic below false-positived as
            # "authenticated" from the very first poll (5s in) while the
            # user was still looking at the password field -- log proof:
            # CONFIRMATION_HIT appeared at t+5000ms and URL_CHECK_MISS
            # never appeared once in the whole run. A password input
            # actually visible on the page is a far more direct signal
            # than guessing at URL shapes -- check the DOM itself first,
            # as a hard veto that no URL/status heuristic can override.
            if _password_field_visible(page):
                _log_event("PASSWORD_FIELD_STILL_VISIBLE")
                consecutive_hits = 0
                continue

            # CONFIRMED BUG #2, found live against Cisco (real screenshot
            # evidence): even after the password veto above, a full run
            # confirmed "authenticated" at t+120000ms and closed the
            # window -- but the captured post-login screenshot showed the
            # Software Download home page still displaying "Login to view
            # your download history" / a "LOG IN NOW" button. Cisco's
            # home URL doesn't change based on auth state at all, so no
            # URL heuristic can ever catch this: a visible login-prompt
            # button/link is just as direct a "still NOT authenticated"
            # signal as a password field.
            if check_login_prompt_text and _login_prompt_visible(page):
                _log_event("LOGIN_PROMPT_STILL_VISIBLE")
                consecutive_hits = 0
                continue

            # Cheap, local, ZERO-network check first: has the main tab's
            # own URL moved away from something login/SSO/signup-shaped?
            # Reading page.url costs nothing and touches Cisco's server
            # not at all -- skip the real check entirely, and reset the
            # consecutive-hit counter, while it still looks like the
            # user is mid-flow.
            try:
                current_url = page.url
            except Exception as e:
                _log_event("URL_READ_FAILED", f"{type(e).__name__}: {e}")
                died = True
                break
            if not is_authenticated(current_url, None):
                # CONFIRMED BUG, found live against Dell: two full login
                # attempts (one ran the entire 10-minute timeout) never
                # logged a single CONFIRMATION_HIT or
                # CONFIRM_REQUEST_FAILED -- meaning this local URL check
                # was silently failing every single poll, the whole
                # time, for a reason that wasn't previously visible
                # anywhere. Log the actual URL on every miss (not just
                # silence) so the next attempt shows exactly what it's
                # comparing against instead of us guessing again.
                _log_event("URL_CHECK_MISS", current_url[:150])
                consecutive_hits = 0
                continue

            # CONFIRMED BUG, found live against Dell (real user login,
            # real evidence): the local URL check above passed on EVERY
            # single poll for 5+ minutes straight (zero URL_CHECK_MISS),
            # consistent with a genuine completed login -- but this
            # lightweight background confirmation request got a 403 from
            # Akamai on every single attempt too, with no exceptions,
            # the entire time. Contrast with Cisco, where this same
            # mechanism DID eventually return a real CONFIRMATION_HIT --
            # so this isn't a universal flaw in the design, it's Akamai
            # unconditionally blocking this specific request pattern for
            # Dell specifically, regardless of real auth state. A
            # confirmation step that can NEVER pass for a given vendor is
            # worse than no confirmation at all -- require_confirm_request
            # lets a vendor skip straight to trusting the local URL check
            # once it's been consistently positive, instead of running
            # out the full timeout on a guaranteed-false negative.
            if not require_confirm_request:
                hit_this_round = True
            else:
                # One lightweight confirmation request, sharing the SAME
                # context's cookies, via Playwright's request API -- a
                # single plain HTTP GET, no new tab, no page render, no
                # JS execution (replaced an earlier design that opened a
                # background tab and navigated it to the same protected
                # URL every 5s -- kept here only if this ALSO turns out
                # to disrupt the session, in which case the diagnostic
                # events below will show it).
                hit_this_round = False
                confirm_status = None
                try:
                    response = context.request.get(auth_check_url, timeout=10_000)
                    confirm_status = response.status
                    hit_this_round = is_authenticated(auth_check_url, confirm_status)
                except Exception as e:
                    _log_event("CONFIRM_REQUEST_FAILED", f"{type(e).__name__}: {e}")

            if hit_this_round:
                consecutive_hits += 1
                _log_event(
                    "CONFIRMATION_HIT",
                    f"{consecutive_hits}/{CONSECUTIVE_CONFIRMATIONS_REQUIRED}",
                )
            else:
                # CONFIRMED BUG, found live against Dell: the local URL
                # check passed (page.url looked authenticated) for 45+
                # seconds straight with zero CONFIRMATION_HIT and zero
                # CONFIRM_REQUEST_FAILED -- meaning this background
                # confirmation request WAS getting a response, just one
                # that silently failed is_authenticated() every time,
                # with no visibility into why. Log the actual status
                # code so a repeated non-2xx (bot-detection blocking
                # this specific "invisible" request pattern, distinct
                # from the real page navigation that just succeeded) is
                # provable instead of invisible.
                if confirm_status is not None:
                    _log_event("CONFIRM_STATUS_MISS", f"status={confirm_status}")
                consecutive_hits = 0

            if consecutive_hits >= CONSECUTIVE_CONFIRMATIONS_REQUIRED:
                if diag["elapsed_ms"] < MINIMUM_ELAPSED_BEFORE_SUCCESS_MS:
                    # Hard floor: detection thinks it's done, but not
                    # enough real time has passed for that to be
                    # trustworthy for a vendor we've never verified.
                    # Keep polling instead of closing early.
                    _log_event(
                        "CONFIRMED_BUT_TOO_EARLY",
                        f"{diag['elapsed_ms']}ms < {MINIMUM_ELAPSED_BEFORE_SUCCESS_MS}ms floor",
                    )
                    continue
                authenticated = True
                break

        if died:
            print("\n" + "=" * 70)
            print("The login window closed or stopped responding before login")
            print("was detected. Diagnostic timeline:")
            for entry in diag["events"]:
                print(f"  {entry}")
            print("=" * 70)
            try:
                browser.close()
            except Exception:
                pass
            return None

        if not authenticated:
            browser.close()
            logger.info("browser_login: timed out waiting for manual login")
            return None

        if extractor is not None:
            print("Login detected. Extracting firmware data in this same "
                  "session before closing the window...")
            try:
                extractor(page)
            except Exception as e:
                logger.exception("browser_login: extractor callback raised")
                _log_event("EXTRACTOR_FAILED", f"{type(e).__name__}: {e}")

        state = context.storage_state()
        browser.close()
        print("Login detected. Session captured.")
        return state


@contextmanager
def open_authenticated_page(
    storage_state: dict, *, headless: bool = True,
) -> Iterator["playwright.sync_api.Page"]:
    """Context reloaded from a saved storage_state -- yields a Page ready
    for authenticated navigation. Defaults to headless (no window shown),
    but VERIFIED LIVE this session that headless mode gets blocked by
    Cisco's Akamai edge with a same-page "Access Denied" even with valid
    session cookies loaded -- likely bot-fingerprinting headless Chrome
    specifically, independent of authentication. Pass headless=False for
    vendors where this happens (confirmed necessary for Cisco); this is
    just using a real, visible, non-hidden browser -- not any kind of
    fingerprint spoofing to defeat the bot check, which would cross the
    same line already held for Teltonika/Allied Telesis elsewhere in
    this project."""
    _require_playwright()
    from playwright.sync_api import sync_playwright

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=headless)
        context = browser.new_context(storage_state=storage_state)
        page = context.new_page()
        try:
            yield page
        finally:
            page.close()
            context.close()
            browser.close()
