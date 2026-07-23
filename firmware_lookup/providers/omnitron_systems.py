"""
Omnitron Systems -- Tier 2, login-gated. Real public source
investigated and confirmed NOT to exist this session (not just an
old/unverified guess).

VERIFIED LIVE this session: omnitron-systems.com product pages have
no public firmware download; the vendor's own site copy states "users
can login to access Omnitron documentation and firmware."

Real, confirmed login URL: https://www.omnitron-systems.com/login --
fetched live, a genuine login form (Username, Password, "Remember
Me", "Sign in with a passkey" option, "Forgot Login?", "Register"
links), explicitly labeled for "Omnitron documentation and firmware."

Real, confirmed switch models: RuggedNet GHPoE/Mi, OmniConverter
GHPoE/M, RuggedNet GHPoEBT/Si.

Login flow: generic browser-assisted login via BrowserAuthenticatedProvider
(see providers/base.py) -- same pattern proven for Cisco/ORing/Adtran.

***HONESTY FLAG***: the LOGIN flow itself is UNVERIFIED end-to-end (no
test account available) -- flagged here rather than assumed away.
"""
from __future__ import annotations

from typing import Optional

from firmware_lookup.providers.base import BrowserAuthenticatedProvider
from firmware_lookup.result import FirmwareResult

PORTAL_URL = "https://www.omnitron-systems.com/login"
HOME_URL = "https://www.omnitron-systems.com/login"


class OmnitronSystemsProvider(BrowserAuthenticatedProvider):
    HOME_URL = HOME_URL

    def __init__(self):
        super().__init__("Omnitron Systems", PORTAL_URL)

    def check_public_source(
        self, vendor: str, model: str, current_version: str,
    ) -> Optional[FirmwareResult]:
        # Confirmed live this session (see module docstring): the
        # vendor's own site copy confirms firmware is login-gated --
        # always falls through to login.
        return None
