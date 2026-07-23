"""
Avaya -- Tier 2, login-gated. Switch/networking line fully absorbed
into Extreme Networks; real public source investigated and confirmed
NOT to give a reliable "latest version" answer this session.

VERIFIED LIVE this session: Extreme Networks acquired Avaya's
fabric-based secure networking business (campus core/edge switches),
deal closed 2017-07-14 for $100M -- confirmed via Extreme's own SEC
filings (8-K/10-K) and independent reporting. Confirmed live:
- support.avaya.com STILL EXISTS and serves real, public (no-login)
  documentation for legacy Avaya-branded switches -- e.g. fetched
  directly: support.avaya.com/css/public/documents/101016714 (ERS 4000
  Series Release 5.7.3 release notes) and .../100161570 (ERS 3500
  config guide). But these are static per-release documents, not a
  live "current version" index -- there's no confirmed way to tell
  which of possibly many such documents is the CURRENT latest release
  without risking a stale/wrong answer.
- The actual firmware DOWNLOAD area, support.avaya.com/support/en/downloads,
  is a JS SPA whose raw HTML contains literal "Sign In"/"Register" UI
  strings -- confirmed login-gated, though the exact SSO redirect
  domain wasn't resolvable via static fetch.
- Newer documentation for the same legacy switch families has also
  moved to Extreme's own domain (confirmed live, a real public PDF:
  documentation.extremenetworks.com/ERS_Series/ERS49005900/SW/76x/
  9035399_ConfigSysERS49005900_7.6_CG.pdf), while the actual firmware
  downloads there route through the SAME Extreme login portal already
  used by providers/extreme.py (support.extremenetworks.com
  302-redirects to extreme-networks.my.site.com, confirmed live to
  return 403 for unauthenticated access) -- reused here as HOME_URL
  rather than inventing a separate one, since it's the real, already-
  verified portal for this exact switch lineup post-acquisition.

Real, confirmed switch model names (fetched directly): Ethernet
Routing Switch (ERS) 3500 Series, ERS 4000 Series, ERS 4900/5900
Series.

Login flow: generic browser-assisted login via BrowserAuthenticatedProvider
(see providers/base.py) -- the same pattern proven, and debugged through
several rounds of real live bugs, for Cisco (see cisco.py's module
docstring).

***HONESTY FLAG***: the LOGIN flow itself is UNVERIFIED end-to-end (no
test account available for either avaya.com or Extreme's portal).
"""
from __future__ import annotations

from typing import Optional

from firmware_lookup.providers.base import BrowserAuthenticatedProvider
from firmware_lookup.result import FirmwareResult

PORTAL_URL = "https://support.avaya.com/support/en/downloads"
HOME_URL = "https://extreme-networks.my.site.com/ExtrSupportHome"


class AvayaProvider(BrowserAuthenticatedProvider):
    HOME_URL = HOME_URL

    def __init__(self):
        super().__init__("Avaya", PORTAL_URL)

    def check_public_source(
        self, vendor: str, model: str, current_version: str,
    ) -> Optional[FirmwareResult]:
        # Confirmed live this session (see module docstring): only
        # static per-release documentation is public, with no reliable
        # "current version" index found -- returning a version from a
        # single static document risks being stale, so this honestly
        # falls through to login rather than guessing.
        return None
