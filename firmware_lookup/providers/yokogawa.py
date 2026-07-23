"""
Yokogawa -- Tier 2, login-gated. Real public source investigated and
confirmed NOT to exist this session (not just an old/unverified
guess).

VERIFIED LIVE this session: Yokogawa's "network switches" (GRVSW
series) are rebadged Belden/Hirschmann MACH104 switches -- confirmed
via official Yokogawa spec doc web-material3.yokogawa.com/GS30A10B10-01EN.pdf:
GRVSW-664FA = vendor model MACH104-20TX-FR. General Yokogawa software/
firmware download pages (yokogawa.com/us/library/documents-downloads/software/)
don't carry switch-specific firmware.

Real, confirmed login URL: https://yokogawa-support.belden.com/en/kb/support-portal-8
-- fetched live with a real headless browser, redirects to
my.belden.com/s/?language=en_US, a genuine Belden Partner Community
Portal ("Login" nav link, Knowledgebase/News/Submit a Case sections)
-- the same OEM support infrastructure confirmed this session for
GarrettCom (also a Belden/Hirschmann-manufactured line).

Real, confirmed switch models: GRVSW-664FA, GRVSW-660FA, GRVSW-673FA.

Login flow: generic browser-assisted login via BrowserAuthenticatedProvider
(see providers/base.py) -- same pattern proven for Cisco/ORing/Adtran.

***HONESTY FLAG***: the LOGIN flow itself is UNVERIFIED end-to-end (no
test account available). Also worth noting: a customer typing the
Yokogawa model number (e.g. "GRVSW-664FA") won't match Belden's own
MACH104 catalog naming even after login -- this OEM relationship is
documented for context, not because the login flow is known to
resolve the model-name mismatch.
"""
from __future__ import annotations

from typing import Optional

from firmware_lookup.providers.base import BrowserAuthenticatedProvider
from firmware_lookup.result import FirmwareResult

PORTAL_URL = "https://yokogawa-support.belden.com/en/kb/support-portal-8"
HOME_URL = "https://yokogawa-support.belden.com/en/kb/support-portal-8"


class YokogawaProvider(BrowserAuthenticatedProvider):
    HOME_URL = HOME_URL

    def __init__(self):
        super().__init__("Yokogawa", PORTAL_URL)

    def check_public_source(
        self, vendor: str, model: str, current_version: str,
    ) -> Optional[FirmwareResult]:
        # Confirmed live this session (see module docstring): general
        # Yokogawa software pages don't carry switch-specific firmware
        # -- always falls through to the Belden-hosted login.
        return None
