"""
Kyland Technology -- Tier 2, login-gated. Real public source investigated
and confirmed NOT to exist this session (not just an old/unverified guess).

VERIFIED LIVE this session: kyland.com's own Documentation and Materials
pages (kyland.com/documentation, kyland.com/materials) are fully public,
but only list catalogs/brochures/whitepapers/MIB files -- no firmware
binaries, no version numbers, no per-model firmware listing anywhere.
kyland.com/support/RequestSupport explicitly describes "Free upgrades
of software to users" as a support-ticket service (hotline + email),
implying firmware is obtained by contacting support directly, not a
self-service download page -- a genuine, different distribution model
from most vendors here, not a coverage gap.

Real, confirmed login URL: kyland.com/index.php?acl=member&method=login
-- fetched live (HTTP 200), a genuine login form (username/password,
"Remember Me", "Forget password?", third-party Sina/QQ login).

Real, confirmed current switch models (fetched directly from
kyland.com/Products, for reference/testing): SICOM6432G, SICOM3028GPT,
SICOM3432G.

Login flow: generic browser-assisted login via BrowserAuthenticatedProvider
(see providers/base.py) -- the same pattern proven, and debugged through
several rounds of real live bugs, for Cisco (see cisco.py's module
docstring).

***HONESTY FLAG***: the LOGIN flow itself is UNVERIFIED end-to-end (no
test account available), and it's genuinely unclear whether logging in
even changes anything here (the support page describes a HUMAN ticket
process, not a self-service portal) -- offered anyway per this
project's rule that any real, confirmed login gets wired in as the
safety net, but this one may just as likely lead nowhere even with
valid credentials.
"""
from __future__ import annotations

from typing import Optional

from firmware_lookup.providers.base import BrowserAuthenticatedProvider
from firmware_lookup.result import FirmwareResult

PORTAL_URL = "https://www.kyland.com/support/RequestSupport"
HOME_URL = "https://www.kyland.com/index.php?acl=member&method=login"


class KylandProvider(BrowserAuthenticatedProvider):
    HOME_URL = HOME_URL

    def __init__(self):
        super().__init__("Kyland", PORTAL_URL)

    def check_public_source(
        self, vendor: str, model: str, current_version: str,
    ) -> Optional[FirmwareResult]:
        # Confirmed live this session (see module docstring): the
        # public Documentation/Materials pages have no firmware
        # binaries or version numbers at all -- firmware is obtained
        # via a support ticket, not self-service. Always falls through
        # to login.
        return None
