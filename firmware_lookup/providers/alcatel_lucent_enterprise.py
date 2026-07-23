"""
Alcatel-Lucent Enterprise (ALE) -- Tier 2, login-gated. Real public
source investigated and confirmed NOT to exist this session (not just
an old/unverified guess).

VERIFIED LIVE this session: al-enterprise.com/en/support lists only
PSIRT advisories, a help center, training, and user manuals -- no
firmware/download section. OmniSwitch product pages (e.g.
al-enterprise.com/en/products/switches/omniswitch-6360,
.../omniswitch-6900) link only to datasheets/hardware guides, never
firmware binaries. A partner community thread corroborates this
directly: "There is no public download for the AOS code. You need to
have access to the BPWS or ask your Business Partner to provide you
with the AOS code."

Real, confirmed login portal: the support page's "MyPortal" link
resolves to https://myportal.al-enterprise.com/s/ -- fetched live and
confirmed to be a Salesforce Experience Cloud site: the raw HTML
contains a JS redirect to a real SAML auth request
(saml_acs=https://myportal.al-enterprise.com/login?so=..., Issuer=
https://al-enterprise.my.salesforce.com), i.e. a genuine SSO/SAML-
gated partner portal, not publicly browsable. An older domain,
support.esd.alcatel-lucent.com, was checked and confirmed DEAD
(NXDOMAIN) -- ALE has fully migrated to MyPortal.

Real, confirmed current OmniSwitch models (fetched directly from
product pages, for reference/testing): OmniSwitch 6360 (OS6360-10/24/48,
OS6360-P24, ...), OmniSwitch 6900 (OS6900-X24, OS6900-X48, OS6900-T24,
OS6900-C32E), OmniSwitch 6465.

Login flow: generic browser-assisted login via BrowserAuthenticatedProvider
(see providers/base.py) -- the same pattern proven, and debugged through
several rounds of real live bugs, for Cisco (see cisco.py's module
docstring).

***HONESTY FLAG***: the LOGIN flow itself is UNVERIFIED end-to-end (no
test account available), and MyPortal's real SAML flow may behave
differently from the generic search-box extraction this base class
assumes -- expect the same categories of live bugs Cisco had until this
is actually tested against a real account.
"""
from __future__ import annotations

from typing import Optional

from firmware_lookup.providers.base import BrowserAuthenticatedProvider
from firmware_lookup.result import FirmwareResult

PORTAL_URL = "https://myportal.al-enterprise.com/s/"
HOME_URL = PORTAL_URL


class AlcatelLucentEnterpriseProvider(BrowserAuthenticatedProvider):
    HOME_URL = HOME_URL

    def __init__(self):
        super().__init__("Alcatel-Lucent Enterprise", PORTAL_URL)

    def check_public_source(
        self, vendor: str, model: str, current_version: str,
    ) -> Optional[FirmwareResult]:
        # Confirmed live this session (see module docstring): AOS
        # firmware is genuinely only available through the SAML-gated
        # MyPortal, confirmed by real partner-community testimony and a
        # real SAML redirect -- not just unverified. Always falls
        # through to login.
        return None
