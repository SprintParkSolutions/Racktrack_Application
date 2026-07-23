"""
Beijer Electronics -- Tier 2, login-gated. Real public source
investigated and confirmed NOT to exist this session (not just an
old/unverified guess).

VERIFIED LIVE this session: smartstore.beijerelectronics.com/en/Firmware
301-redirects to my.beijerelectronics.com/en/portal-login -- a real,
genuine account portal ("WELCOME TO MYBEIJERELECTRONICS... eBusiness
and Smartstore are replaced by MyBeijerElectronics. You need to
register a new account..."), confirming firmware is now exclusively
behind this portal, not publicly served.

Real, confirmed login URL: https://my.beijerelectronics.com/en/portal-login

Real, confirmed switch models (JetNet industrial Ethernet switch
line, secondary-source-confirmed via a third-party trade article, not
yet independently re-confirmed first-party): JetNet 2208-T8,
JetNet 3008G, JetNet 5010G.

Login flow: generic browser-assisted login via BrowserAuthenticatedProvider
(see providers/base.py) -- same pattern proven for Cisco/ORing/Adtran.

***HONESTY FLAG***: the LOGIN flow itself is UNVERIFIED end-to-end (no
test account available) -- flagged here rather than assumed away.
"""
from __future__ import annotations

from typing import Optional

from firmware_lookup.providers.base import BrowserAuthenticatedProvider
from firmware_lookup.result import FirmwareResult

PORTAL_URL = "https://my.beijerelectronics.com/en/portal-login"
HOME_URL = "https://my.beijerelectronics.com/en/portal-login"


class BeijerElectronicsProvider(BrowserAuthenticatedProvider):
    HOME_URL = HOME_URL

    def __init__(self):
        super().__init__("Beijer Electronics", PORTAL_URL)

    def check_public_source(
        self, vendor: str, model: str, current_version: str,
    ) -> Optional[FirmwareResult]:
        # Confirmed live this session (see module docstring): the old
        # public firmware path now 301-redirects straight into the
        # login-gated portal -- always falls through to login.
        return None
