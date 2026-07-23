"""
NoviFlow -- Tier 2, login-gated. Real public source investigated and
confirmed NOT to exist this session (not just an old/unverified guess).

VERIFIED LIVE this session: noviflow.com/support/ only has a "REQUEST A
CALL" button -- no self-service download or firmware-version page of
any kind on the public site.

Real, confirmed login URL: https://support.noviflow.com/ -- a genuine
email/password login form; new accounts are provisioned by emailing
support@noviflow.com (no public self-registration).

Real, confirmed switch models (from real product pages, running
NoviFlow's own "NoviWare" NOS): NoviSwitch 2122, 2128/2128M, 2150,
21100.

Login flow: generic browser-assisted login via BrowserAuthenticatedProvider
(see providers/base.py) -- same pattern proven for Cisco/ORing/Adtran.

***HONESTY FLAG***: the LOGIN flow itself is UNVERIFIED end-to-end (no
test account available) -- flagged here rather than assumed away.
"""
from __future__ import annotations

from typing import Optional

from firmware_lookup.providers.base import BrowserAuthenticatedProvider
from firmware_lookup.result import FirmwareResult

PORTAL_URL = "https://support.noviflow.com/"
HOME_URL = "https://support.noviflow.com/"


class NoviFlowProvider(BrowserAuthenticatedProvider):
    HOME_URL = HOME_URL

    def __init__(self):
        super().__init__("NoviFlow", PORTAL_URL)

    def check_public_source(
        self, vendor: str, model: str, current_version: str,
    ) -> Optional[FirmwareResult]:
        # Confirmed live this session (see module docstring): the
        # public support page has no self-service download of any
        # kind -- always falls through to login.
        return None
