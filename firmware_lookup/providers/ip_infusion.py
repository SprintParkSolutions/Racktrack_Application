"""
IP Infusion -- Tier 2 base (for the login safety net), with a real,
verified public source for the current OcNOS release.

VERIFIED LIVE this session: ipinfusion.com/ocnos-releases/ is a real,
public release-history page (no login) that lists real GA version
history -- confirmed live: "OcNOS 7.0" (GA, March 2026), "OcNOS 6.6.1"
(designated Long-Term Support release), "OcNOS 6.6" (retired
maintenance release). This domain returns a real Cloudflare-style 403
to plain curl/WebFetch -- confirmed live a real Playwright browser
gets through fine (200), same pattern as several other vendors this
session.

SCOPE NOTE, important and different from every other vendor here: IP
Infusion sells a network OPERATING SYSTEM (OcNOS), not switch
hardware -- it runs on third-party "white box" hardware (Edgecore,
UfiSpace, Celestica, etc.) rather than IP Infusion's own branded
models. There is no per-hardware-model firmware to look up here, only
one current OcNOS release across the whole product line -- so this
provider intentionally ignores the `model` field entirely and always
reports the current GA release, the same way MikroTik/NVIDIA report a
channel-wide version rather than a per-model one.

LOGIN SAFETY NET: real, confirmed login exists for actual license/
release-file downloads at ipinfusion.atlassian.net, which redirects
live to id.atlassian.com/login (Atlassian-hosted SSO) -- wired in as
the fallback per this project's rule, though the version NUMBER itself
is already public above, so this should rarely be needed.
"""
from __future__ import annotations

import re
from typing import Optional

from firmware_lookup.providers.base import BrowserAuthenticatedProvider
from firmware_lookup.result import Confidence, FirmwareResult, ok_result
from firmware_lookup.versioning import is_update_available, parse_version

RELEASES_URL = "https://www.ipinfusion.com/ocnos-releases/"
HOME_URL = "https://ipinfusion.atlassian.net/"

_GA_VERSION_RE = re.compile(r"OcNOS\s+(\d+(?:\.\d+)+)")


class IPInfusionProvider(BrowserAuthenticatedProvider):
    HOME_URL = HOME_URL

    def __init__(self):
        super().__init__("IP Infusion", RELEASES_URL)

    def check_public_source(
        self, vendor: str, model: str, current_version: str,
    ) -> Optional[FirmwareResult]:
        try:
            from playwright.sync_api import sync_playwright
        except ImportError:
            return None

        try:
            with sync_playwright() as playwright:
                browser = playwright.chromium.launch(headless=True)
                try:
                    page = browser.new_page()
                    page.goto(RELEASES_URL, wait_until="networkidle", timeout=20000)
                    page.wait_for_timeout(1500)
                    text = page.inner_text("body")
                finally:
                    browser.close()
        except Exception:
            return None

        matches = _GA_VERSION_RE.findall(text)
        versions = [v for v in matches if parse_version(v)]
        if not versions:
            return None
        # Real page lists newest-first (confirmed live: 7.0, then
        # 6.6.1, then 6.6) -- but sort by parsed version defensively
        # rather than trusting page order alone.
        versions.sort(key=lambda v: parse_version(v), reverse=True)
        latest_version = versions[0]

        return ok_result(
            vendor=vendor,
            model=model,
            current_version=current_version,
            latest_version=latest_version,
            source_url=RELEASES_URL,
            confidence=Confidence.MEDIUM,
            retrieval_method="public_browser",
            update_available=is_update_available(current_version, latest_version),
            message=(
                "Retrieved from IP Infusion's public OcNOS release "
                "history (no login required). IP Infusion sells the "
                "OcNOS network OS, not branded switch hardware, so "
                "this reports the current GA release across the whole "
                "product line rather than a per-model version."
            ),
        )
