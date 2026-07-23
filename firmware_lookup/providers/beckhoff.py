"""
Beckhoff Automation -- Tier 2, login-gated. Real public source
investigated and confirmed NOT to exist this session (not just an old/
unverified guess).

VERIFIED LIVE this session: beckhoff.com's Download Finder
(beckhoff.com/en-en/support/download-finder/) has a real myBeckhoff
login widget embedded directly in it ("myBeckhoff Login," email/
password fields, "Create new account to access Beckhoff software
downloads"). A real product page (CU2508, an Ethernet port
multiplier) was checked directly via a real browser and has no
firmware version text anywhere on it, only a generic "Download finder"
nav link -- confirming no public per-model firmware page exists
outside the login-gated finder.

Real, confirmed login URL: beckhoff.com/en-en/mybeckhoff-login/index.aspx
-- fetched live, page titled "Login | Beckhoff Worldwide," with
myBeckhoff Login email/password fields, "Stay logged in," "Create new
account."

Real, confirmed model names (from beckhoff.com product pages and
third-party plugin listings, for reference/testing): CU2508 (Ethernet
port multiplier), CU2208, CU2005.

Login flow: generic browser-assisted login via BrowserAuthenticatedProvider
(see providers/base.py) -- the same pattern proven, and debugged through
several rounds of real live bugs, for Cisco (see cisco.py's module
docstring).

***HONESTY FLAG***: the LOGIN flow itself is UNVERIFIED end-to-end (no
test account available).
"""
from __future__ import annotations

from typing import Optional

from firmware_lookup.providers.base import BrowserAuthenticatedProvider
from firmware_lookup.result import FirmwareResult

PORTAL_URL = "https://www.beckhoff.com/en-en/support/download-finder/"
HOME_URL = "https://www.beckhoff.com/en-en/mybeckhoff-login/index.aspx"


class BeckhoffProvider(BrowserAuthenticatedProvider):
    HOME_URL = HOME_URL

    def __init__(self):
        super().__init__("Beckhoff", PORTAL_URL)

    def check_public_source(
        self, vendor: str, model: str, current_version: str,
    ) -> Optional[FirmwareResult]:
        # Confirmed live this session (see module docstring): the real
        # download finder has a login widget embedded in it, and no
        # real product page shows a firmware version publicly. Always
        # falls through to login.
        return None
