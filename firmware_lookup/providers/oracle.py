"""
Oracle -- Tier 2, login-gated. Real public source investigated and
confirmed NOT to exist this session (not just an old/unverified
guess).

VERIFIED LIVE this session: Oracle's own documentation lists exact
firmware .pkg file names publicly, but the actual files/download
mechanism are gated behind My Oracle Support. Oracle's own-branded
network switches (Oracle Switch ES2-64, ES2-72) are current; the
older Fabric Interconnect line (F1-4/F1-15) is confirmed EOL 2022.

Real, confirmed login URL: https://support.oracle.com/ -- fetched
live, redirects to support.oracle.com/signin, a genuine "Welcome to
My Oracle Support... Sign in or Create your Oracle account" gateway.

Real, confirmed switch models: Oracle Switch ES2-64, Oracle Switch
ES2-72.

Login flow: generic browser-assisted login via BrowserAuthenticatedProvider
(see providers/base.py) -- same pattern proven for Cisco/ORing/Adtran.

***HONESTY FLAG***: the LOGIN flow itself is UNVERIFIED end-to-end (no
test account available) -- flagged here rather than assumed away.
"""
from __future__ import annotations

from typing import Optional

from firmware_lookup.providers.base import BrowserAuthenticatedProvider
from firmware_lookup.result import FirmwareResult

PORTAL_URL = "https://support.oracle.com/"
HOME_URL = "https://support.oracle.com/"


class OracleProvider(BrowserAuthenticatedProvider):
    HOME_URL = HOME_URL

    def __init__(self):
        super().__init__("Oracle", PORTAL_URL)

    def check_public_source(
        self, vendor: str, model: str, current_version: str,
    ) -> Optional[FirmwareResult]:
        # Confirmed live this session (see module docstring): exact
        # firmware file names are documented publicly, but the actual
        # download requires My Oracle Support -- always falls through
        # to login.
        return None
