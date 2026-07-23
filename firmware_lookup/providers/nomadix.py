"""
Nomadix -- Tier 2, login-gated. Real public source investigated and
confirmed NOT to exist this session (not just an old/unverified
guess).

VERIFIED LIVE this session: nomadix.com/support/ is public but states
"Technical training and documentation are available on our Partner
Portal (requires an account)."

Real, confirmed login URL: https://portal.nomadix.com/user/login --
fetched live, a genuine login form (Username, Password, "Remember Me"
checkbox, "Forgot your password?" link, "Sign Up" registration link).

Real, confirmed switch models: AS 8T2XHA (8-port managed access
switch), AS 24T4XHA (24-port managed access switch), AS 48T2XHEA
(48-port managed access switch).

Login flow: generic browser-assisted login via BrowserAuthenticatedProvider
(see providers/base.py) -- same pattern proven for Cisco/ORing/Adtran.

***HONESTY FLAG***: the LOGIN flow itself is UNVERIFIED end-to-end (no
test account available) -- flagged here rather than assumed away.
"""
from __future__ import annotations

from typing import Optional

from firmware_lookup.providers.base import BrowserAuthenticatedProvider
from firmware_lookup.result import FirmwareResult

PORTAL_URL = "https://portal.nomadix.com/user/login"
HOME_URL = "https://portal.nomadix.com/user/login"


class NomadixProvider(BrowserAuthenticatedProvider):
    HOME_URL = HOME_URL

    def __init__(self):
        super().__init__("Nomadix", PORTAL_URL)

    def check_public_source(
        self, vendor: str, model: str, current_version: str,
    ) -> Optional[FirmwareResult]:
        # Confirmed live this session (see module docstring): the
        # public support page has no self-service download of any
        # kind -- always falls through to login.
        return None
