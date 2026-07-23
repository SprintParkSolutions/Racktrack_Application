"""
Aerohive -- Tier 2, login-gated. Real public source investigated and
confirmed NOT to exist this session (not just an old/unverified guess).

Aerohive was acquired by Extreme Networks in 2019; aerohive.com itself
is now unreachable (confirmed live: ECONNREFUSED on every path tried),
consistent with a full domain shutdown/migration.

VERIFIED LIVE this session: the real successor public documentation
site, supportdocs.extremenetworks.com/support/documentation/, has a
real "Routing & Switching" section listing genuine per-model pages
(e.g. .../sr2208p/, .../sr2224p/, .../sr2348p/) -- but each page only
hosts a Hardware User Guide and a datasheet PDF, no firmware/software
version number anywhere.

Two login URLs found; only one is usable:
  - Legacy Aerohive "MyHive" (myhive-auth.aerohive.com/cas/login):
    confirmed real but its TLS certificate has EXPIRED -- unusable.
  - Current Extreme customer/partner support portal
    (extreme-networks.my.site.com/ExtrLogin): confirmed live, a real
    Salesforce-community login page ("Login to Portal", "Create a new
    Extreme Customer Portal Account"). This is the one wired in below.

Real, confirmed switch models (from the official supportdocs listing):
SR2024, SR2024P, SR2124P, SR2148P, SR2208P, SR2224P, SR2324P, SR2348P.

Login flow: generic browser-assisted login via BrowserAuthenticatedProvider
(see providers/base.py) -- same pattern proven for Cisco/ORing/Adtran.

***HONESTY FLAG***: the LOGIN flow itself is UNVERIFIED end-to-end (no
test account available) -- flagged here rather than assumed away.
"""
from __future__ import annotations

from typing import Optional

from firmware_lookup.providers.base import BrowserAuthenticatedProvider
from firmware_lookup.result import FirmwareResult

PORTAL_URL = "https://extreme-networks.my.site.com/ExtrLogin"
HOME_URL = "https://extreme-networks.my.site.com/ExtrLogin"


class AerohiveProvider(BrowserAuthenticatedProvider):
    HOME_URL = HOME_URL

    def __init__(self):
        super().__init__("Aerohive", PORTAL_URL)

    def check_public_source(
        self, vendor: str, model: str, current_version: str,
    ) -> Optional[FirmwareResult]:
        # Confirmed live this session (see module docstring): the real
        # successor public docs site has no firmware/version data on
        # any per-model page -- always falls through to login.
        return None
