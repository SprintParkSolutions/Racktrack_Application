"""
TOTOLINK -- Tier 2, login-gated. Real public source investigated and
confirmed NOT to exist this session (not just an old/unverified guess).

VERIFIED LIVE this session: totolink.net's main corporate site has a
broken support IA -- /support, /service, /documentation, and a
category listing path all 404 (confirmed live). The site's own footer
links to a real, separate current portal: support.totolink.net --
confirmed live this resolves and returns a real, genuine login page
("Login to TOTOLINK", Email + Password fields, "Forgot Password?",
"Login with Email Link", "Sign up").

A DIFFERENT legacy subdomain, m.totolink.net/portal/..., is indexed by
Google with real-looking download-center page titles, but confirmed
live this subdomain does NOT resolve at all (DNS NXDOMAIN,
net::ERR_NAME_NOT_RESOLVED) -- a dead, decommissioned portal, not a
usable source even though it's still indexed.

Real, confirmed switch models (from real PDF datasheets hosted on
totolink.net, for reference/testing): SG16D, SG24.

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

PORTAL_URL = "https://support.totolink.net/"
HOME_URL = "https://support.totolink.net/"


class TotolinkProvider(BrowserAuthenticatedProvider):
    HOME_URL = HOME_URL

    def __init__(self):
        super().__init__("TOTOLINK", PORTAL_URL)

    def check_public_source(
        self, vendor: str, model: str, current_version: str,
    ) -> Optional[FirmwareResult]:
        # Confirmed live this session (see module docstring): the only
        # reachable current support portal is genuinely login-gated;
        # the one legacy public portal that might have worked is dead
        # (DNS doesn't resolve). Always falls through to login.
        return None
