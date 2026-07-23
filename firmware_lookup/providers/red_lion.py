"""
Red Lion Controls -- Tier 2, login-gated. Real public source
investigated and confirmed NOT to exist this session (not just an old/
unverified guess).

VERIFIED LIVE this session: redlion.net has been fully consolidated
into HMS Networks -- confirmed live via real 301 redirects:
redlion.net/support/software-firmware -> hms-networks.com/support/
software-and-tools; redlion.net/user -> hms-networks.com/red-lion.
The landing page reached is a navigation page only, no real firmware
version data on it. The actual article-level firmware pages live on a
separate Zendesk subdomain, support.hms-networks.com -- confirmed live
this returns a genuine 403 Forbidden to a real Playwright browser (not
just curl), consistent with a real bot wall, not a wrong URL.

Real, confirmed login URL: hms-networks.com/login -- fetched live
(real 200), a genuine "Login to HMS cloud services and external
portals" hub page listing Talk2m and other real HMS-hosted services.

Real, confirmed switch models (from hms-networks.com/switches-
infrastructure-products and distributor pages, for reference/testing):
NT-5018-FX2-ST, SLX-8MG-1, SLX-8MS-1 (Sixnet SLX managed switch line).

Login flow: generic browser-assisted login via BrowserAuthenticatedProvider
(see providers/base.py) -- the same pattern proven, and debugged through
several rounds of real live bugs, for Cisco (see cisco.py's module
docstring).

***HONESTY FLAG***: the LOGIN flow itself is UNVERIFIED end-to-end (no
test account available), and it's unclear whether hms-networks.com/login
is even the right portal for firmware specifically (it's a general
cloud-services hub) -- offered anyway per this project's rule that any
real, confirmed login gets wired in as the safety net.
"""
from __future__ import annotations

from typing import Optional

from firmware_lookup.providers.base import BrowserAuthenticatedProvider
from firmware_lookup.result import FirmwareResult

PORTAL_URL = "https://www.hms-networks.com/support/software-and-tools"
HOME_URL = "https://www.hms-networks.com/login"


class RedLionProvider(BrowserAuthenticatedProvider):
    HOME_URL = HOME_URL

    def __init__(self):
        super().__init__("Red Lion", PORTAL_URL)

    def check_public_source(
        self, vendor: str, model: str, current_version: str,
    ) -> Optional[FirmwareResult]:
        # Confirmed live this session (see module docstring): the
        # support landing page has no real firmware data, and the
        # article-level pages that might have it are bot-blocked (403
        # to a real browser). Always falls through to login.
        return None
