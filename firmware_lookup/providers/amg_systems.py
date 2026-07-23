"""
AMG Systems -- Tier 2, login-gated. Real public source investigated
and confirmed NOT to exist this session (not just an old/unverified
guess).

VERIFIED LIVE this session: product pages (e.g.
amgsystems.com/english/products/ethernet/managed-switch/amg560-series-non-poe/amg560-8g-12s)
only have a Datasheet PDF and Manual PDF in a "Downloads" tab -- no
firmware file, no version number.

Real, confirmed login URL: https://www.amgsystems.com/english/sign-in
-- fetched live, a genuine login form (Email + Password fields, both
required, "Forgot password?", "Remember me", "Sign in" button,
"Create account" link).

Real, confirmed switch models: AMG560-8G-12S, AMG560 series (PoE),
AMG510-8G Series.

Login flow: generic browser-assisted login via BrowserAuthenticatedProvider
(see providers/base.py) -- same pattern proven for Cisco/ORing/Adtran.

***HONESTY FLAG***: the LOGIN flow itself is UNVERIFIED end-to-end (no
test account available) -- flagged here rather than assumed away.
"""
from __future__ import annotations

from typing import Optional

from firmware_lookup.providers.base import BrowserAuthenticatedProvider
from firmware_lookup.result import FirmwareResult

PORTAL_URL = "https://www.amgsystems.com/english/sign-in"
HOME_URL = "https://www.amgsystems.com/english/sign-in"


class AmgSystemsProvider(BrowserAuthenticatedProvider):
    HOME_URL = HOME_URL

    def __init__(self):
        super().__init__("AMG Systems", PORTAL_URL)

    def check_public_source(
        self, vendor: str, model: str, current_version: str,
    ) -> Optional[FirmwareResult]:
        # Confirmed live this session (see module docstring): product
        # pages only have datasheet/manual PDFs, no firmware -- always
        # falls through to login.
        return None
