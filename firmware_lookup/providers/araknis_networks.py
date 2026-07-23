"""
Araknis Networks (Snap One) -- Tier 2, login-gated. Real public
source investigated and confirmed NOT to exist this session (not just
an old/unverified guess).

VERIFIED LIVE this session: snapav.com/shop/en/snapav/firmware is a
public marketing page about firmware *features* for access points,
not switches, with no version numbers or per-model downloads. Araknis
switch product pages explicitly instruct firmware is delivered via
OvrC: "update when you claim the switch in your OvrC account, or
download the firmware from the support tab."

Real, confirmed login URL: https://app.ovrc.com/#/login -- fetched
live with a real headless browser (an earlier non-browser fetch got
only a status widget; a real render shows the actual form): genuine
Email + Password fields, "Create an Account", "Forgot Password?",
"Log In" button.

Real, confirmed switch models: AN-310-SW-R-24-POE, AN-310-SW-R-16-POE,
AN-310-SW-R-8-POE (with a real quoted firmware version v1.3.10,
released 06/22/2021, found directly on the product page -- not used
here since it's a point-in-time citation, not a live lookup source).

Login flow: generic browser-assisted login via BrowserAuthenticatedProvider
(see providers/base.py) -- same pattern proven for Cisco/ORing/Adtran.

***HONESTY FLAG***: the LOGIN flow itself is UNVERIFIED end-to-end (no
test account available), and OvrC is a dealer/installer account
system (not necessarily a direct end-user account) -- flagged here
rather than assumed away.
"""
from __future__ import annotations

from typing import Optional

from firmware_lookup.providers.base import BrowserAuthenticatedProvider
from firmware_lookup.result import FirmwareResult

PORTAL_URL = "https://app.ovrc.com/#/login"
HOME_URL = "https://app.ovrc.com/#/login"


class AraknisNetworksProvider(BrowserAuthenticatedProvider):
    HOME_URL = HOME_URL

    def __init__(self):
        super().__init__("Araknis Networks", PORTAL_URL)

    def check_public_source(
        self, vendor: str, model: str, current_version: str,
    ) -> Optional[FirmwareResult]:
        # Confirmed live this session (see module docstring): the
        # public firmware-features page has no per-model version data
        # -- always falls through to the OvrC login.
        return None
