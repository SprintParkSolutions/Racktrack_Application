"""
Fortinet -- promoted out of the login-gated tier.

Verified live this session: docs.fortinet.com is Fortinet's own public
documentation site (no login) and lists every released FortiSwitch
major.minor version via a version-selector list of
`href="/product/fortiswitch/X.Y"` links.

VERIFIED LIVE (exact patch version, no extra request): the SAME html
already fetched from docs.fortinet.com/product/fortiswitch/ also contains
document links like `href="/document/fortiswitch/8.0.0/..."` -- the exact
patch-level version is already present in this one response, it just
wasn't being parsed out before. Confirmed this pattern holds across
major.minor pages (e.g. the 7.6 page links to 7.6.7, the current latest
patch under 7.6).

IMPORTANT (verified live, do not regress): directly probing a guessed
`/document/fortiswitch/X.Y.Z/...` URL is UNSAFE as an existence check --
a deliberately-fake patch "7.4.99" 302-redirected to "7.4.9" instead of
404ing, i.e. the site fuzzy-redirects invalid patch numbers rather than
rejecting them. Patch existence must ONLY ever be inferred from links
actually present in a fetched page's HTML, never from probing a
constructed URL.
"""
from __future__ import annotations

import logging
import re

from firmware_lookup.http_client import FirmwareHttpClient
from firmware_lookup.providers.base import BrowserAuthenticatedProvider
from firmware_lookup.result import Confidence, FirmwareResult, ok_result
from firmware_lookup.versioning import is_update_available

logger = logging.getLogger("firmware_lookup.providers.fortinet")

DOCS_URL = "https://docs.fortinet.com/product/fortiswitch/"
_VERSION_LINK_RE = re.compile(r'href="/product/fortiswitch/(\d+)\.(\d+)"')
_PATCH_LINK_RE = re.compile(r'href="/document/fortiswitch/(\d+)\.(\d+)\.(\d+)/')
PORTAL_URL = "https://support.fortinet.com"

MAJOR_MINOR_ONLY_MESSAGE = (
    "Only major.minor granularity is publicly listed for this release -- "
    "this IS the latest publicly verifiable version at that granularity, "
    "not an invented patch number."
)
EXACT_PATCH_MESSAGE = (
    "Exact patch-level release verified via docs.fortinet.com's own "
    "release-notes link for this version."
)


class FortinetProvider(BrowserAuthenticatedProvider):
    # Login is a SAFETY NET only: docs.fortinet.com below is Fortinet's
    # own official public documentation, tried first and used whenever
    # it succeeds (which is expected to be nearly always). This login
    # path is UNVERIFIED and best-effort, added per explicit user
    # request so there's a real fallback instead of a dead end if the
    # public docs site is ever unreachable.
    HOME_URL = PORTAL_URL

    def __init__(self):
        super().__init__("Fortinet", PORTAL_URL)
        self.http = FirmwareHttpClient("fortinet")

    def check_public_source(
        self, vendor: str, model: str, current_version: str,
    ) -> FirmwareResult | None:
        html = self.http.get_text(DOCS_URL)
        if not html:
            return None

        versions = [(int(maj), int(min_)) for maj, min_ in _VERSION_LINK_RE.findall(html)]
        if not versions:
            return None

        latest_major, latest_minor = max(versions)

        # Same fetched page also carries patch-level document links --
        # filter to the ones matching the latest major.minor and take the
        # highest patch. No second HTTP request.
        patches = [
            int(patch) for maj, min_, patch in _PATCH_LINK_RE.findall(html)
            if int(maj) == latest_major and int(min_) == latest_minor
        ]

        if patches:
            latest_patch = max(patches)
            latest_version = f"{latest_major}.{latest_minor}.{latest_patch}"
            confidence = Confidence.HIGH
            message = EXACT_PATCH_MESSAGE
        else:
            latest_version = f"{latest_major}.{latest_minor}"
            confidence = Confidence.MEDIUM
            message = MAJOR_MINOR_ONLY_MESSAGE

        return ok_result(
            vendor=vendor,
            model=model,
            current_version=current_version,
            latest_version=latest_version,
            source_url=DOCS_URL,
            confidence=confidence,
            retrieval_method="docs_site",
            update_available=is_update_available(current_version, latest_version),
            message=message,
        )
