"""
Tejas Networks -- Tier 2, login-gated. Real public source investigated
and confirmed NOT to exist this session (not just an old/unverified
guess).

VERIFIED LIVE this session: tejasnetworks.com/service/ is a real,
public page (no login) but only lists 24/7 support contact info
(phone, email) and a services brochure -- no download/version-lookup
content, no per-model firmware page or directory anywhere on the
marketing site.

Real, confirmed login URL: tejdocs.india.tejasnetworks.com/login.php
-- fetched live, a genuine login form ("Learning Center of Excellence"
documentation library, Username/Password, "Forgot Username/Password?",
signup-request link). Zero content is visible pre-auth -- this is the
real, confirmed gate for firmware/software docs.

Real, confirmed switch model names (from tejasnetworks.com product
pages, for reference/testing): TJ1400P-M1/M2/M3/M4 (L2/L3 access/
distribution switches), TJ1600 Core Switch (TJ1600I, TJ1600S).

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

PORTAL_URL = "https://tejdocs.india.tejasnetworks.com/login.php"
HOME_URL = "https://tejdocs.india.tejasnetworks.com/login.php"


class TejasNetworksProvider(BrowserAuthenticatedProvider):
    HOME_URL = HOME_URL

    def __init__(self):
        super().__init__("Tejas Networks", PORTAL_URL)

    def check_public_source(
        self, vendor: str, model: str, current_version: str,
    ) -> Optional[FirmwareResult]:
        # Confirmed live this session (see module docstring): the
        # marketing site has no download/version content at all; the
        # real documentation library is genuinely login-gated. Always
        # falls through to login.
        return None
