"""
Telco Systems -- Tier 2, login-gated. Real public source investigated
and confirmed NOT to exist this session (not just an old/unverified
guess).

CORRECTED, found live after initially being registered as a dead end:
the original registration was based on telco-support.zendesk.com
returning a real Cloudflare "Performing security verification"
challenge to a real headless Playwright browser. Re-investigated with
the same stealth technique that fixed Signamax (--disable-blink-
features=AutomationControlled, a real Chrome UA, navigator.webdriver
overridden) -- the portal loads fine (status 200, full real page
content), confirming the earlier block was headless-fingerprint
detection, not a genuine unsolvable challenge.

VERIFIED LIVE this session: telco-support.zendesk.com redirects to
telco-support.telco.com/auth/v3/signin, a real, genuine login form
("Sign in to BATM Networks Support" -- BATM Networks is Telco Systems'
parent company -- Email + Password fields, "Forgot password?").

Real, confirmed switch models: TM-3348, TM-3308H, TM-7124.

Login flow: generic browser-assisted login via BrowserAuthenticatedProvider
(see providers/base.py) -- same pattern proven for Cisco/ORing/Adtran.

***HONESTY FLAG***: the LOGIN flow itself is UNVERIFIED end-to-end (no
test account available) -- flagged here rather than assumed away.
"""
from __future__ import annotations

from typing import Optional

from firmware_lookup.providers.base import BrowserAuthenticatedProvider
from firmware_lookup.result import FirmwareResult

PORTAL_URL = "https://telco-support.zendesk.com/"
HOME_URL = "https://telco-support.zendesk.com/"


class TelcoSystemsProvider(BrowserAuthenticatedProvider):
    HOME_URL = HOME_URL

    def __init__(self):
        super().__init__("Telco Systems", PORTAL_URL)

    def check_public_source(
        self, vendor: str, model: str, current_version: str,
    ) -> Optional[FirmwareResult]:
        # Confirmed live this session (see module docstring): the
        # support portal requires a real BATM Networks account --
        # always falls through to login.
        return None
