"""
Datto -- Tier 2, login-gated. Real public source investigated and
confirmed NOT to exist this session (not just an old/unverified
guess).

VERIFIED LIVE this session: Datto Networking (now a Kaseya brand)
does genuinely sell managed switches -- KB/version data is partially
public, but bulk firmware downloads are gated behind a real account.

Real, confirmed login URL: https://auth.datto.com/login -- fetched
live, a genuine login gateway ("Email", "Continue", "Or Login With
KaseyaOne", a Kaseya-unified SSO flow).

Real, confirmed switch models: OMS24/E24, S24-L/L24, S8-L/L8.

Login flow: generic browser-assisted login via BrowserAuthenticatedProvider
(see providers/base.py) -- same pattern proven for Cisco/ORing/Adtran.

***HONESTY FLAG***: the LOGIN flow itself is UNVERIFIED end-to-end (no
test account available), and this is a multi-step SSO flow (Kaseya
One) rather than a plain username/password form -- flagged here
rather than assumed away.
"""
from __future__ import annotations

from typing import Optional

from firmware_lookup.providers.base import BrowserAuthenticatedProvider
from firmware_lookup.result import FirmwareResult

PORTAL_URL = "https://auth.datto.com/login"
HOME_URL = "https://auth.datto.com/login"


class DattoProvider(BrowserAuthenticatedProvider):
    HOME_URL = HOME_URL

    def __init__(self):
        super().__init__("Datto", PORTAL_URL)

    def check_public_source(
        self, vendor: str, model: str, current_version: str,
    ) -> Optional[FirmwareResult]:
        # Confirmed live this session (see module docstring): bulk
        # firmware downloads require a real Kaseya/Datto account --
        # always falls through to login.
        return None
