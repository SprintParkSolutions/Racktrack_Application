"""
Ciena -- Tier 2, login-gated. Real public source investigated and
confirmed NOT to exist this session (not just an old/unverified guess).

VERIFIED LIVE this session: ciena.com returns a real 403 Forbidden to
both plain curl/WebFetch AND a real headless Playwright browser on
every URL tried (support pages, product pages like /products/5160,
datasheet pages) -- a genuine bot wall, not a login redirect. A real
community Q&A thread on my.ciena.com, titled verbatim "Latest firmware
for 3960 switches," returned a login/access wall when fetched,
consistent with firmware discussion/downloads living behind the
support extranet rather than being publicly indexed content.

Real, confirmed login URL: my.ciena.com/CienaPortal/s/login/ -- this
is the myCiena support extranet's current real login page (re-verified
2026-07-20 after the old /CienaPortal/login?locale=us path redirects
here anyway): a genuine login form (Username, Password, "Forgot your
password?", "Remember me") plus a real "Don't have an account yet?
Register for a myCiena account today." option for new users.

Real, confirmed switch/product model names (from search-indexed real
Ciena product-page titles, for reference/testing): 5160 (Service
Aggregation Switch), 5170 (Routing and Switching), 3960 (Service
Delivery Switch).

Login flow: generic browser-assisted login via BrowserAuthenticatedProvider
(see providers/base.py) -- the same pattern proven, and debugged through
several rounds of real live bugs, for Cisco (see cisco.py's module
docstring).

***HONESTY FLAG***: the LOGIN flow itself is UNVERIFIED end-to-end (no
test account available). ciena.com's own bot wall (blocking even a
real headless browser) is a genuine, confirmed risk to the login flow
itself succeeding -- flagged here rather than assumed away.
"""
from __future__ import annotations

from typing import Optional

from firmware_lookup.providers.base import BrowserAuthenticatedProvider
from firmware_lookup.result import FirmwareResult

PORTAL_URL = "https://my.ciena.com/CienaPortal/s/login/"
HOME_URL = "https://my.ciena.com/CienaPortal/s/login/"


class CienaProvider(BrowserAuthenticatedProvider):
    HOME_URL = HOME_URL

    def __init__(self):
        super().__init__("Ciena", PORTAL_URL)

    def check_public_source(
        self, vendor: str, model: str, current_version: str,
    ) -> Optional[FirmwareResult]:
        # Confirmed live this session (see module docstring): the
        # entire ciena.com domain blocks automated access, including a
        # real headless browser, and the one community thread found
        # about firmware requires login too. Always falls through to
        # login.
        return None
