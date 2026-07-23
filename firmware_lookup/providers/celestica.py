"""
Celestica -- Tier 2, login-gated. Real public source investigated and
confirmed NOT to exist this session (not just an old/unverified guess).

VERIFIED LIVE this session: documentationportal.celestica.com is a
real, public, no-login documentation portal (a genuine Heretto-based
site, reachable fine with a real headless browser -- an earlier
WebFetch-based attempt to reach it hit a browser-compatibility gate
that turned out to be a false block, not a real one). It has real
per-model pages for the actual switch hardware (DS1000, DS5000,
ES1000, etc.) -- but every "Revision History" table on those pages is
DOCUMENT revision history (dated entries like "Added Ground Lug
Assembly installation instructions"), not firmware/software version
history. The portal's own "Software" section only links a SONiC User
Manual, a Supported-Systems list, and an EULA -- no version-specific
firmware download of any kind. Celestica's switches run Community
SONiC (open-source NOS), not a Celestica-tracked per-model firmware
version.

Real, confirmed login: servicenow.celestica.com redirects to a genuine
ADFS SSO login (adfs.celestica.com, real SAML request observed) for
its ServiceNow support portal -- a real, current customer support
gateway.

Real, confirmed switch models (from the real documentation portal
nav): DS1000, DS2000, DS3000, DS3001, DS4000/DS4001, DS4100, DS4101,
DS5000, ES1000, ES1010/ES1050/EG1050, ES1500.

Login flow: generic browser-assisted login via BrowserAuthenticatedProvider
(see providers/base.py) -- same pattern proven for Cisco/ORing/Adtran.

***HONESTY FLAG***: the LOGIN flow itself is UNVERIFIED end-to-end (no
test account available), and the ADFS SSO redirect chain is a more
complex login surface than a plain username/password form -- flagged
here rather than assumed away.
"""
from __future__ import annotations

from typing import Optional

from firmware_lookup.providers.base import BrowserAuthenticatedProvider
from firmware_lookup.result import FirmwareResult

PORTAL_URL = "https://servicenow.celestica.com/"
HOME_URL = "https://servicenow.celestica.com/"


class CelesticaProvider(BrowserAuthenticatedProvider):
    HOME_URL = HOME_URL

    def __init__(self):
        super().__init__("Celestica", PORTAL_URL)

    def check_public_source(
        self, vendor: str, model: str, current_version: str,
    ) -> Optional[FirmwareResult]:
        # Confirmed live this session (see module docstring): the real
        # public documentation portal tracks document revisions, not
        # firmware/software versions -- always falls through to login.
        return None
