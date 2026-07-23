"""
Extreme Networks -- Tier 2, login-gated, with a real, verified public
shortcut for ExtremeXOS (a.k.a. "Switch Engine").

CONFIRMED BUG, found live: the original PORTAL_URL
(extremeportal.force.com) is DEAD -- a real login attempt reached it and
got Salesforce's "URL No Longer Exists" error page (their old Community
Cloud portal was migrated off that domain). Verified live this session
that curl against extremeportal.force.com, /ExtrLoginPage, and /ExtrHome
all 404, while extremenetworks.com/support/ links to the REAL current
portal at extreme-networks.my.site.com (confirmed live: /ExtrSupportHome
returns a real 200). Updated PORTAL_URL/HOME_URL to that.

VERIFIED LIVE this session: supportdocs.extremenetworks.com is a
completely public documentation portal (no login), reached from Extreme's
own site navigation, distinct from the login-gated support/download
portal above. Its main index page (support/documentation/) is a real,
dynamically-generated <select> of every product line Extreme documents,
each option pointing at that line's CURRENT version -- e.g. the
"ExtremeXOS" option pointed at .../extremexos-33-7-1/ live, and that
page's own document list included a real, dated "ExtremeXOS v33.7.1
Release Notes" entry (dated Jul 2026). Fetching the option's URL
dynamically (rather than hardcoding "33-7-1", which would go stale the
moment a new version ships) is the same principle already used for
Cisco's release-notes collection pages.

HONESTY FLAG, real and unresolved: Extreme's switch catalog spans
several DIFFERENT operating systems (ExtremeXOS/Switch Engine, VOSS,
Fabric Engine, ExtremeWireless WiNG, and older EOS/ERS-family software)
-- confirmed live via the same documentation index, which lists all of
these as separate, differently-versioned product lines. Multiple real
attempts this session (checking the release notes' own "Hardware/
Software Compatibility" section, image-file-naming conventions, and a
"Release Recommendations" cross-reference) did NOT turn up a live,
citable mapping from bare switch model numbers to which of these OSes a
given switch actually runs. Rather than guess a model-number pattern
with no real evidence behind it (a genuine wrong-OS risk, not just a
coverage gap), this is scoped narrowly and safely: it only matches when
the model string explicitly names "ExtremeXOS" or "Switch Engine" (the
two real, confirmed-live synonymous names for this one OS) -- e.g. "X670
ExtremeXOS" or "Switch Engine 5420". A bare model number alone (e.g.
just "5420" or "X670") is NOT matched, since there's no verified
evidence it runs this specific OS rather than VOSS/Fabric Engine/other.
This is a real, narrower scope than Cisco's Catalyst/Nexus coverage, not
a hardcoded allowlist of specific models -- any model naming ExtremeXOS/
Switch Engine explicitly gets a real, live-verified attempt.
"""
from __future__ import annotations

import re
from typing import Optional

from firmware_lookup.http_client import FirmwareHttpClient
from firmware_lookup.providers.base import BrowserAuthenticatedProvider
from firmware_lookup.result import Confidence, FirmwareResult, ok_result
from firmware_lookup.versioning import is_update_available, parse_version

PORTAL_URL = "https://extreme-networks.my.site.com/ExtrSupportHome"
HOME_URL = PORTAL_URL

DOCS_INDEX_URL = "https://supportdocs.extremenetworks.com/support/documentation/"

# Real markup, verified live: a <select> option whose visible text is
# exactly "ExtremeXOS", value is that product line's CURRENT version
# page URL (fetched dynamically here so a future version bump doesn't
# require a code change, same principle as Cisco's collection pages).
_EXTREMEXOS_OPTION_RE = re.compile(
    r'<option value="([^"]+)">\s*ExtremeXOS\s*</option>',
)
# Real markup, verified live on the per-version documentation page: each
# document is a real <a> with a title <h4> -- matched generically so any
# document title on the page can be checked, not just a hardcoded one.
_DOC_LINK_RE = re.compile(
    r'<a target="_blank" href="([^"]+)"[^>]*>\s*<div class="c-doc-list__content[^"]*">\s*'
    r'<h4 class="c-doc-list__title">\s*([^<]+?)\s*</h4>',
)
_VERSION_TOKEN_RE = re.compile(r"\d+(?:\.\d+){1,3}")


def _extract_title_version(title: str) -> Optional[str]:
    matches = _VERSION_TOKEN_RE.findall(title)
    return matches[-1] if matches else None


def _matches_extremexos(model: str) -> bool:
    lower = model.lower()
    return "extremexos" in lower or "switch engine" in lower


class ExtremeProvider(BrowserAuthenticatedProvider):
    HOME_URL = HOME_URL

    def __init__(self):
        super().__init__("Extreme", PORTAL_URL)
        self.http = FirmwareHttpClient("extreme")

    def check_public_source(
        self, vendor: str, model: str, current_version: str,
    ) -> Optional[FirmwareResult]:
        if not _matches_extremexos(model or ""):
            # No confident OS match for this model (see module
            # docstring's HONESTY FLAG) -- falls through to login rather
            # than guessing which of Extreme's several OS families a
            # bare model number runs.
            return None

        try:
            from playwright.sync_api import sync_playwright
        except ImportError:
            return None

        try:
            with sync_playwright() as playwright:
                browser = playwright.chromium.launch(headless=True)
                try:
                    page = browser.new_page()
                    result = self._extract_extremexos_version(
                        page, vendor, model, current_version,
                    )
                finally:
                    browser.close()
        except Exception:
            return None

        return result

    def _extract_extremexos_version(
        self, page, vendor: str, model: str, current_version: str,
    ) -> Optional[FirmwareResult]:
        page.goto(DOCS_INDEX_URL, wait_until="domcontentloaded", timeout=20000)
        page.wait_for_timeout(1500)
        index_html = page.content()

        option_match = _EXTREMEXOS_OPTION_RE.search(index_html)
        if not option_match:
            return None
        version_page_url = option_match.group(1)

        page.goto(version_page_url, wait_until="domcontentloaded", timeout=20000)
        page.wait_for_timeout(1500)
        version_html = page.content()

        latest_version = None
        source_url = None
        for href, title in _DOC_LINK_RE.findall(version_html):
            lower = title.lower()
            if "release notes" not in lower or "extremexos" not in lower:
                continue
            version_str = _extract_title_version(title)
            if not version_str or not parse_version(version_str):
                continue
            latest_version = version_str
            source_url = href
            break
        if not latest_version:
            return None

        return ok_result(
            vendor=vendor,
            model=model,
            current_version=current_version,
            latest_version=latest_version,
            source_url=source_url,
            confidence=Confidence.MEDIUM,
            retrieval_method="public_browser",
            update_available=is_update_available(current_version, latest_version),
            message=(
                "Retrieved from Extreme's public documentation portal "
                "(no login required) -- the current ExtremeXOS/Switch "
                "Engine release notes document. This only covers "
                "ExtremeXOS/Switch Engine specifically; Extreme's other "
                "switch operating systems (VOSS, Fabric Engine) are not "
                "covered by this check."
            ),
        )
