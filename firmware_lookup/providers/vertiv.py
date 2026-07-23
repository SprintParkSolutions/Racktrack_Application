"""
Vertiv -- Tier 2, login-gated. Real public source investigated and
confirmed NOT to exist this session (not just an old/unverified guess).

SCOPE HONESTY FLAG, real and important: confirmed live this session
that Vertiv does NOT appear to sell traditional managed Ethernet
network switches. What real product pages under "switch" naming
actually are: Avocent MergePoint Unity 2 (a KVM-over-IP switch line,
confirmed real model MPU2-108DAC-400, no firmware version shown on its
own page) and "Network Power Switch" NPS-I/NPS-II (confirmed live via
direct fetch these are POWER TRANSFER switches -- "allows instantaneous
transfer of load between two power sources" -- not networking at all).
A Liebert vNSA Network Switch (8-port, for Liebert iCOM cooling
controllers) also surfaced but wasn't independently verified. This
provider is registered anyway since Vertiv appears on the source
vendor list, but real lookups against it should expect
model_not_found/auth_required rather than genuine switch firmware in
most cases, honestly, given this scope gap.

Real, confirmed login-gated download portal: vertiv.com/en-us/support/
software-downloads/ -- fetched live, literally states "Your account is
restricted to access this link. Please contact Vertiv Partner
Support." None of its 6 listed product categories (IT Management,
Power Distribution, Monitoring, UPS, DC Power, Software) is networking.

Real, confirmed login URL: softwaredownloads.vertiv.com/Account/
Login.aspx -- fetched live, real page text "Please login to verify
your access to Software files," with Register/Forgot Username-Password
options.

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

PORTAL_URL = "https://www.vertiv.com/en-us/support/software-downloads/"
HOME_URL = "https://softwaredownloads.vertiv.com/Account/Login.aspx"


class VertivProvider(BrowserAuthenticatedProvider):
    HOME_URL = HOME_URL

    def __init__(self):
        super().__init__("Vertiv", PORTAL_URL)

    def check_public_source(
        self, vendor: str, model: str, current_version: str,
    ) -> Optional[FirmwareResult]:
        # Confirmed live this session (see module docstring): the
        # download portal is explicitly account-restricted, and Vertiv
        # doesn't appear to sell traditional network switches at all.
        # Always falls through to login.
        return None
