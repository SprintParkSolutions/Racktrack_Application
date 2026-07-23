"""
C-Data Technology -- Tier 2, login-gated. Real public source investigated
and confirmed NOT to exist this session (not just an old/unverified guess).

VERIFIED LIVE this session: cdatatec.com/software-download/ is a real,
fully public page (no login) but states, verbatim: "Contact
support@cdatatec.com to obtain the CMS and the latest firmware for
your hardware." Only a CMS mobile app download is offered publicly --
no per-model firmware files or version numbers anywhere on the site.
cdatatec.com/support (also public) confirms "Software Upgrade Service"
is listed as a support CATEGORY, not a self-service download.

Real, confirmed login URL: cdatatec.com/sign-in.html -- fetched live
(HTTP 200), a genuine "LOG IN" form with a "Sign up now" link.
UNCERTAIN whether logging in actually changes anything: the support
page's own wording ("Contact support@... to obtain...") suggests
firmware is handled via a human email/ticket process regardless of
account status, not unlocked by login -- offered anyway per this
project's rule that any real, confirmed login gets wired in as the
safety net, but this one may lead nowhere even with valid credentials.

Real, confirmed current switch models (from cdatatec.com/switch/, for
reference/testing): C-Data CS2080G, CS2080GP, CS2080GPA.

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

PORTAL_URL = "https://www.cdatatec.com/software-download/"
HOME_URL = "https://www.cdatatec.com/sign-in.html"


class CDataProvider(BrowserAuthenticatedProvider):
    HOME_URL = HOME_URL

    def __init__(self):
        super().__init__("C-Data", PORTAL_URL)

    def check_public_source(
        self, vendor: str, model: str, current_version: str,
    ) -> Optional[FirmwareResult]:
        # Confirmed live this session (see module docstring): the
        # public page explicitly says to email support for firmware --
        # no self-service version data at all. Always falls through to
        # login.
        return None
