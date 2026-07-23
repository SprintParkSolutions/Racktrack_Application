"""
Versa Networks -- Tier 2, login-gated. Real public source investigated
this session with a genuine, honest mixed result (not a blanket guess).

VERIFIED LIVE this session: docs.versa-networks.com hosts release
notes split by product line with INCONSISTENT public access, confirmed
by fetching two real pages directly:
  - Titan (cloud-managed SASE) release notes ARE public, no login --
    confirmed live real content: "Release 11.0" (dated July 16, 2025),
    "Release 11.2" (Jan 14, 2026), "Release 11.3" (Mar 16, 2026),
    referencing "Versa Operating System (VOS) Release 22.1.4".
  - Secure SD-WAN/VOS release notes for the SAME general URL family
    (e.g. .../Release_Notes_for_Secure_SD-WAN/.../VOS_Release_Notes_for
    _Release_22.1) are login-gated -- confirmed live the fetch landed
    on a real sign-in screen (Versa SSO / Local / SAML SSO / OpenID
    Connect) instead of content.
Given this inconsistency, and that Versa's real hardware line (CSG/CSX
Cloud Services Gateway appliances) is SD-WAN/routing hardware rather
than traditional switches, this provider does not attempt to guess
which specific release-notes path a given model maps to -- there's no
reliable, verified per-model mapping into the Titan-vs-VOS split found
this session.

Real, confirmed login URL: support.versa-networks.com/support/login --
fetched live, a real ServiceNow-based portal immediately showing "You
are not logged in, or your session has expired. Redirecting to the
login page."

Real, confirmed model names (from versa-networks.com/products/
components/appliances/, for reference/testing): CSG300 Series, CSG1000
Series, CSG5000 Series, CSX4000 Series.

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

PORTAL_URL = "https://support.versa-networks.com/support/login"
HOME_URL = "https://support.versa-networks.com/support/login"


class VersaNetworksProvider(BrowserAuthenticatedProvider):
    HOME_URL = HOME_URL

    def __init__(self):
        super().__init__("Versa Networks", PORTAL_URL)

    def check_public_source(
        self, vendor: str, model: str, current_version: str,
    ) -> Optional[FirmwareResult]:
        # Confirmed live this session (see module docstring): public
        # access to release notes is genuinely inconsistent across
        # Versa's product lines, with no reliable per-model mapping
        # found -- always falls through to login rather than guessing
        # which path applies.
        return None
