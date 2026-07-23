"""
Micas Networks -- Tier 2, login-gated. Real public source
investigated and confirmed NOT to exist this session (not just an
old/unverified guess).

VERIFIED LIVE this session: doc titles/version numbers are partially
public, but actual bulk downloads are gated behind a real account.

Real, confirmed login URL: https://www.micasnetworks.com/user-login --
fetched live with a real headless browser, a genuine login form
("Sign in to Micas Networks", "Forgot password?", "Sign in with
Microsoft", "Sign in with Google", "Sign up" for new accounts).

Real, confirmed switch models (data-center white-box, SONiC-based):
M2-W6940-128QC, M2-W6510-48GT4V, M2-W6510-48V8C.

Login flow: generic browser-assisted login via BrowserAuthenticatedProvider
(see providers/base.py) -- same pattern proven for Cisco/ORing/Adtran.

***HONESTY FLAG***: the LOGIN flow itself is UNVERIFIED end-to-end (no
test account available) -- flagged here rather than assumed away.
"""
from __future__ import annotations

from typing import Optional

from firmware_lookup.providers.base import BrowserAuthenticatedProvider
from firmware_lookup.result import FirmwareResult

PORTAL_URL = "https://www.micasnetworks.com/user-login"
HOME_URL = "https://www.micasnetworks.com/user-login"


class MicasNetworksProvider(BrowserAuthenticatedProvider):
    HOME_URL = HOME_URL

    def __init__(self):
        super().__init__("Micas Networks", PORTAL_URL)

    def check_public_source(
        self, vendor: str, model: str, current_version: str,
    ) -> Optional[FirmwareResult]:
        # Confirmed live this session (see module docstring): actual
        # firmware downloads require a real account -- always falls
        # through to login.
        return None
