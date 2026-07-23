"""
ORing Industrial Networking -- Tier 2 base (for the login safety net).
Public firmware listing exists but has no extractable version field;
a real login system was found on re-investigation and is now wired in
as the safety net, per the same public -> login -> link rule applied
to every other vendor here.

VERIFIED LIVE this session: oringnet.com/en/support/download/150-firmware
is a real, fully public firmware listing (no login needed to VIEW or
download files) -- but confirmed live it has NO version-number field
anywhere: each real entry is just "<MODEL> Firmware" with a generic
filename (e.g. "fw_igs-3032.bin") and a "Details" tooltip showing only
File Size and Date, never a version string. A structural dead end for
extraction, not an access problem.

CORRECTED, found live after initially being registered as a dead end
with no login: oringnet.com DOES have a real account system --
confirmed live via a "Sign In" link in the site's own nav, resolving to
https://oringnet.com/en/user-login, a real username/password login
form (1 real password field, "Log in", "Forgot your password?",
"Don't have an account?"). UNVERIFIED whether logging in actually adds
a version field to the firmware listing (no test account available to
confirm), but the same honest principle as every other Tier-2 vendor
here applies: a real, confirmed login exists, so it's offered as the
next real step rather than jumping straight to a manual link.

CONFIRMED BUG #1, found live via a REAL login (real screenshot
evidence): after successfully logging in -- a genuine Profile page
appeared showing the actual account holder's name, username, and
registration date -- the login-detection loop kept reporting
LOGIN_PROMPT_STILL_VISIBLE and never finished, running out the full
timeout even though login had genuinely succeeded. Root cause:
oringnet.com's own nav bar keeps a static "Sign In" link in the header
REGARDLESS of real auth state (confirmed in the same screenshot: "Sign
In" visible top-right of an authenticated Profile page). This is the
exact same class of bug already found for Cisco/Dell, but in the
opposite direction -- there, "Sign In" text was the CORRECT signal that
login hadn't happened; here, it's a permanent false positive that
persists even after a real, verified login. Fixed by disabling the
login-prompt-text veto specifically for ORing (CHECK_LOGIN_PROMPT_TEXT
= False) -- the password-field veto alone is still active, so a
genuinely-not-logged-in state is still caught correctly.

CONFIRMED BUG #2, found live immediately after fixing #1 (real login,
real server logs): with the nav-text false positive gone, the
generic URL-based confirmation check (session.py's
DEFAULT_NOT_AUTHENTICATED_MARKERS, which includes the literal string
"login") started false-negativing instead -- oringnet.com's real,
genuinely-authenticated Profile page URL is
https://oringnet.com/en/user-login?view=profile, which still contains
"login" as part of its permanent path (it doesn't move to a separate
domain/path post-login the way most vendors do). Every poll logged
URL_CHECK_MISS / CONFIRM_STATUS_MISS (status=200, i.e. the page loads
fine, is_authenticated() just rejects it) indefinitely. Fixed with a
custom OringSessionManager._is_authenticated() override: a
"view=profile" query param is a positive, ORing-specific signal of a
genuinely authenticated page, checked BEFORE the generic marker list
so it isn't shadowed by the literal "login" substring.

CONFIRMED BUG #3, found live immediately after fixing #2 (real login,
real server logs): the LOCAL check (using the browser tab's actual
current URL, which DOES include "?view=profile" after a real login)
started passing correctly -- but the SEPARATE background confirmation
request (browser_login.py's REQUIRE_LOGIN_CONFIRM_REQUEST step) kept
failing anyway, logging CONFIRM_STATUS_MISS (status=200) on every
poll. Root cause: that confirmation request always re-checks the
SAME FIXED auth_check_url string (HOME_URL, i.e. the bare
".../user-login" with no query string) -- it is structurally
incapable of ever containing "view=profile", regardless of how well
logged in the session actually is, since it never follows the real
page's live navigation. This is the exact same class of problem
already solved for Dell (session.py's REQUIRE_LOGIN_CONFIRM_REQUEST
docstring: "a confirmation step that can never pass for a given vendor
is worse than no confirmation at all") -- just a different underlying
cause (URL shape here, an Akamai 403 for Dell). Fixed the same way:
REQUIRE_LOGIN_CONFIRM_REQUEST = False, trusting the local
(already-fixed) URL check alone.
"""
from __future__ import annotations

from typing import Optional

from firmware_lookup.providers.base import BrowserAuthenticatedProvider
from firmware_lookup.result import FirmwareResult
from firmware_lookup.session import BrowserLoginSessionManager

PORTAL_URL = "https://oringnet.com/en/support/download/150-firmware"
HOME_URL = "https://oringnet.com/en/user-login"


class OringSessionManager(BrowserLoginSessionManager):
    HOME_URL = HOME_URL
    ACCOUNT_CHECK_URL = HOME_URL
    # See module docstring CONFIRMED BUG #1: oringnet.com's nav always
    # shows "Sign In" even when genuinely authenticated.
    CHECK_LOGIN_PROMPT_TEXT = False
    # See module docstring CONFIRMED BUG #3: the background confirmation
    # request always re-checks the bare HOME_URL (no "?view=profile"),
    # so it can never demonstrate the one positive signal that actually
    # proves authentication here -- trust the local URL check alone.
    REQUIRE_LOGIN_CONFIRM_REQUEST = False

    def _is_authenticated(self, url: str, status_code) -> bool:
        # See module docstring CONFIRMED BUG #2: the real authenticated
        # Profile page's URL still contains the literal substring
        # "login" (oringnet.com/en/user-login?view=profile), which the
        # generic marker-based check would otherwise treat as a
        # not-authenticated signal. A positive "view=profile" marker is
        # checked first so it can't be shadowed by that false marker.
        if status_code in (401, 403):
            return False
        if "view=profile" in url.lower():
            return True
        return super()._is_authenticated(url, status_code)


class OringProvider(BrowserAuthenticatedProvider):
    HOME_URL = HOME_URL

    def __init__(self):
        super().__init__("ORing", PORTAL_URL)
        self.session_manager = OringSessionManager("ORing")

    def check_public_source(
        self, vendor: str, model: str, current_version: str,
    ) -> Optional[FirmwareResult]:
        # Confirmed live this session (see module docstring): the
        # public listing has no version-number field at all for any
        # model -- always falls through to login rather than
        # fabricating a version from a filename or date.
        return None
