"""
Belden (Hirschmann industrial switches) -- Tier 2, login-gated. Real
public source investigated and confirmed NOT to exist this session
(not just an old/unverified guess).

VERIFIED LIVE this session: catalog.belden.com product pages (e.g.
MACH104-20TX-F-L3P) reference real firmware filenames in their
description text (e.g. "Web_MACH100GE_09115.zip"), but the actual
download link on that page routes to my.belden.com/s/downloads --
confirmed live via a real redirect chain: hirschmann-support.belden.com
-> (302) -> my.belden.com -> (301) -> my.belden.com/s/, a real
Salesforce Experience Cloud "Partner Community Portal" (confirmed by
the page's own title and sfdcedge server header). No public per-model
firmware version page or directory was found anywhere outside this
gated portal.

Real, confirmed login URL: my.belden.com/s/ (the real redirect target
confirmed above).

Real, confirmed switch model names (from catalog.belden.com and
belden.com search results, for reference/testing): MACH104-20TX-F-L3P,
RSP/RSPS/RSPE series DIN-rail switches, BOBCAT managed switch series.

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

PORTAL_URL = "https://my.belden.com/s/"
HOME_URL = "https://my.belden.com/s/"


class BeldenProvider(BrowserAuthenticatedProvider):
    HOME_URL = HOME_URL

    def __init__(self):
        super().__init__("Belden", PORTAL_URL)

    def check_public_source(
        self, vendor: str, model: str, current_version: str,
    ) -> Optional[FirmwareResult]:
        # Confirmed live this session (see module docstring): the real
        # firmware download route redirects to a login-gated partner
        # portal; no public per-model version page exists. Always
        # falls through to login.
        return None
