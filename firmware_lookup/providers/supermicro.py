"""
Supermicro -- Tier 2, login-gated. Real public source investigated and
confirmed NOT to exist for switches this session (not just an old/
unverified guess).

VERIFIED LIVE this session: Supermicro's per-model firmware page,
    https://www.supermicro.com/en/support/resources/downloadcenter/firmware/<MODEL>
(e.g. .../firmware/SSE-X3648S) 200s for a real browser (this domain
blocks plain curl/WebFetch with a bot-detection 403 -- confirmed live
that a real Playwright browser gets a genuine 200 through the same
block), but the real rendered page body says, verbatim: "WE ARE SORRY.
The Firmware file is unavailable due to either of the following
reasons: You haven't logged into the website. OR You are not
authorized to access the download page." -- a real, confirmed login
wall, not a bot block.

Real, confirmed login URL: the page's own "MySupermicro" nav link
resolves to https://www.supermicro.com/en/mysupermicro -- fetched
live, a real "MySupermicro Partner Portal" page with "Sign in" / "Create
An Account".

Login flow: generic browser-assisted login via BrowserAuthenticatedProvider
(see providers/base.py) -- the same pattern proven, and debugged through
several rounds of real live bugs, for Cisco (see cisco.py's module
docstring).

LOGIN VERIFIED LIVE this session with a real account: a real login
completed successfully (CONFIRMATION_HIT 3/3, "Login detected. Session
captured.", confirmed written to disk after fixing a separate silent-
logging gap in session.py). Initially suspected the same headless-
reuse bug already proven for Cisco/Dell, and set
REUSE_SESSION_HEADLESS = False to match -- but a real second attempt,
reusing the saved session in a VISIBLE (non-headless) browser, still
came back auth_required.

***CONFIRMED, from the user directly***: Supermicro's real login flow
requires CAPTCHA/image verification on every single login, not just
the first one -- this is a fundamentally different problem than
headless fingerprinting (which REUSE_SESSION_HEADLESS=False correctly
solves for Cisco/Dell), and explains why a saved session doesn't
reliably carry over: the site's own re-verification step is designed
to require a human every time. Per this project's rules, CAPTCHA/
image-verification challenges must NEVER be bypassed or automated --
that would be evasion, not scraping. REUSE_SESSION_HEADLESS is kept at
False (still the technically correct setting given the earlier Cisco/
Dell-style evidence, and harmless either way), but the practical
reality for this vendor is: expect to complete a real, manual,
CAPTCHA-gated login close to every time, not just once. Not something
this project can or should engineer around.
"""
from __future__ import annotations

from typing import Optional

from firmware_lookup.providers.base import BrowserAuthenticatedProvider
from firmware_lookup.result import FirmwareResult

PORTAL_URL = "https://www.supermicro.com/en/support/resources/downloadcenter/swdownload"
HOME_URL = "https://www.supermicro.com/en/mysupermicro"


class SupermicroProvider(BrowserAuthenticatedProvider):
    HOME_URL = HOME_URL
    # Set to match the Cisco/Dell headless-reuse fix (see module
    # docstring) -- confirmed NOT sufficient on its own for Supermicro:
    # a real second login attempt, reusing the session visibly, still
    # failed, because Supermicro requires CAPTCHA/image verification on
    # every real login (confirmed by the user directly). Kept here
    # since it's still the technically correct setting, but the real
    # fix for this vendor is "expect to log in manually almost every
    # time" -- not something automatable without violating the
    # never-bypass-CAPTCHA rule.
    REUSE_SESSION_HEADLESS = False

    def __init__(self):
        super().__init__("Supermicro", PORTAL_URL)

    def check_public_source(
        self, vendor: str, model: str, current_version: str,
    ) -> Optional[FirmwareResult]:
        # Confirmed live this session (see module docstring): the real
        # rendered page (not just a bot-blocked fetch) says outright
        # "You haven't logged into the website." Always falls through
        # to login.
        return None
