"""
ZTE -- Tier 2, login-gated. Real public source investigated and
confirmed NOT to exist this session (not just an old/unverified guess).

VERIFIED LIVE this session: enterprise.zte.com.cn's support and
switches pages are Vue.js SPA shells that only return unrendered
template placeholders ({{$t(...)}}) to a server-side fetch -- no real
public firmware content was ever reachable.

Real, confirmed login URL: support.zte.com.cn/support/login/ ->
client-side redirects to h5index.aspx (confirmed live, HTTP 200), whose
real HTML contains genuine login form elements: a "登录" (Login) link
to /support/login/login.aspx, a UserName field, and a Register2.aspx
registration link. This is ZTE's Technical Support portal.

Real, confirmed switch model names (from a real ZTE-hosted PDF at
sdnfv.zte.com.cn, for reference/testing): ZXR10 5960-H (data center
TOR switch), ZXR10 5900E, ZXR10 5250-H.

Login flow: generic browser-assisted login via BrowserAuthenticatedProvider
(see providers/base.py) -- the same pattern proven, and debugged through
several rounds of real live bugs, for Cisco (see cisco.py's module
docstring).

***HONESTY FLAG***: the LOGIN flow itself is UNVERIFIED end-to-end (no
test account available), and the login page/flow is primarily in
Chinese -- the generic search-box extraction this base class uses is
even less likely to match real selectors here than for other vendors.
"""
from __future__ import annotations

from typing import Optional

from firmware_lookup.providers.base import BrowserAuthenticatedProvider
from firmware_lookup.result import FirmwareResult

PORTAL_URL = "https://support.zte.com.cn/support/login/"
HOME_URL = "http://support.zte.com.cn/support/login/login.aspx"


class ZTEProvider(BrowserAuthenticatedProvider):
    HOME_URL = HOME_URL

    def __init__(self):
        super().__init__("ZTE", PORTAL_URL)

    def check_public_source(
        self, vendor: str, model: str, current_version: str,
    ) -> Optional[FirmwareResult]:
        # Confirmed live this session (see module docstring): the
        # enterprise site is a JS SPA with no server-rendered public
        # content at all. Always falls through to login.
        return None
