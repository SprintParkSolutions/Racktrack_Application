"""
Arista Networks -- Tier 2, login-gated.

NOT individually re-verified for a public source this session (only
Cisco and Aruba were live-checked) -- check_public_source() still just
defers to login.

LOGIN VERIFIED LIVE this session with a real account: a real login
completed successfully (nav bar showed "Welcome! Ashok", a genuine
per-account greeting -- confirmed via real screenshot, not a guess).
The generic base-class flow then failed, honestly, with "no search box
matched the guessed selector" -- confirmed why via the same screenshot:

CONFIRMED LIVE, from a real authenticated screenshot of
arista.com/en/support/software-download: this page is NOT a search-box
UI like Cisco's -- it's a folder/category browser (bulleted links:
"Active Releases", "Support Only Releases", "Aboot", "Extensions",
"Product Stencils", "vEOS", each with its own one-line description;
below that, expandable "cEOS Lab" / "vEOS Lab" tree folders). The
generic BrowserAuthenticatedProvider search-box logic was structurally
never going to match here, independent of any selector-naming issue --
overridden below with real navigation (click "Active Releases") instead.

CONFIRMED LIVE, same screenshot, a SEPARATE and more fundamental
finding: this real, logged-in account is entitlement-restricted. A red
notice box on the page states, verbatim: "Please note that software
downloads and technical documentation are restricted at this time.
This may be due to an error with your Arista customer registration, a
lack of support coverage for your install base products, or improper
account settings. Guest users can still access vEOS, cEOS downloads,
and Arista Labs." -- i.e. this account cannot see real switch-platform
(non-vEOS/cEOS) firmware listings at all right now, regardless of
selector correctness. Detected explicitly below and surfaced honestly
(quoting the real notice + the page's own listed contact addresses)
rather than reported as a generic selector/navigation failure.

***HONESTY FLAG***: the "Active Releases" click-through and the EOS
version-token regex below are a best-effort structure inferred from
ONE real screenshot (the actual folder-tree markup wasn't captured in
the debug HTML dump -- likely rendered via a JS widget that page.content()
doesn't serialize) -- UNVERIFIED end-to-end, since the only real test
account available is itself entitlement-restricted and can't reach the
real release list to confirm. Expect to iterate against
arista_*_stale_session_login_page_*.png / arista_no_releases_found_*.png
debug artifacts once an entitled account is available, same as every
other vendor's selector-refinement history in this project.
"""
from __future__ import annotations

import re
from typing import Optional

from firmware_lookup.providers.base import (
    BrowserAuthenticatedProvider, dump_debug_artifacts,
)
from firmware_lookup.result import (
    Confidence, FirmwareResult, auth_required, cannot_determine, ok_result,
)
from firmware_lookup.versioning import is_update_available

PORTAL_URL = "https://www.arista.com/en/support/software-download"
HOME_URL = PORTAL_URL

# Real, verbatim text from the account-restriction notice, confirmed
# live -- matched case-insensitively since only the substring itself is
# load-bearing, not exact capitalization.
_RESTRICTED_NOTICE_RE = re.compile(r"restricted at this time", re.IGNORECASE)

# Real EOS version shape, confirmed live via the page's own Field Notice
# text ("EOS-4.21.3F") -- major.minor.patch plus a trailing maintenance
# letter, optionally a dashed suffix (e.g. "-SSU" variants seen in other
# Arista release naming). Not anchored to a specific major version
# number, so this doesn't silently break if/when the major version
# advances past whatever was true this session.
_EOS_VERSION_RE = re.compile(r"\b\d{1,2}\.\d{1,2}\.\d{1,2}[A-Z](?:-[A-Z]+)?\b")


class AristaProvider(BrowserAuthenticatedProvider):
    HOME_URL = HOME_URL

    def __init__(self):
        super().__init__("Arista", PORTAL_URL)

    def check_public_source(
        self, vendor: str, model: str, current_version: str,
    ) -> Optional[FirmwareResult]:
        # Not individually re-verified this session -- always falls
        # through to the login flow for now.
        return None

    def _extract_from_page(
        self, page, vendor: str, model: str, current_version: str,
    ) -> FirmwareResult:
        # Arista overrides _extract_from_page entirely (folder-tree
        # navigation instead of a search box -- see module docstring),
        # so it doesn't inherit the base class's stale-session DOM veto;
        # reapplying the same two-veto check here (password field OR a
        # visible sign-in prompt) since the real screenshot confirmed
        # Arista's nav DOES change to a per-account "Welcome! <name>"
        # greeting once logged in -- unlike ORing/Dell's static nav
        # text, so both vetoes are safe to use here, not just one.
        dump_path = None
        try:
            page.goto(self.HOME_URL, wait_until="domcontentloaded")
            try:
                page.wait_for_load_state("networkidle", timeout=8000)
            except Exception:
                pass
            page.wait_for_timeout(1500)

            from firmware_lookup.browser_login import (
                _login_prompt_visible, _password_field_visible,
            )
            stale_session = _password_field_visible(page) or _login_prompt_visible(page)
        except Exception:
            stale_session = False
        if stale_session:
            dump_debug_artifacts(page, vendor, "stale_session_login_page")
            self.session_manager.invalidate_session()
            return auth_required(
                vendor, model, current_version,
                manual_check_url=self.PORTAL_URL,
            )

        try:
            # Real cookie-consent banner, confirmed live, covers the
            # bottom of the page and can intercept clicks below it.
            try:
                page.locator("button:has-text('Accept All Cookies')").first.click(timeout=4000)
                page.wait_for_timeout(500)
            except Exception:
                pass

            dump_path = dump_debug_artifacts(page, vendor, "home")

            body_text = page.inner_text("body")
            if _RESTRICTED_NOTICE_RE.search(body_text):
                return cannot_determine(
                    vendor, model, current_version,
                    retrieval_method="authenticated_browser",
                    reason=(
                        "Logged in successfully, but this Arista account "
                        "is entitlement-restricted: the real page shows "
                        '"Please note that software downloads and '
                        "technical documentation are restricted at this "
                        "time. This may be due to an error with your "
                        "Arista customer registration, a lack of support "
                        "coverage for your install base products, or "
                        'improper account settings." Only guest-tier '
                        "vEOS/cEOS downloads are open, not real switch "
                        "firmware. This is an account-side entitlement "
                        "gate on Arista's own site, not something this "
                        "tool can bypass -- contact "
                        "service-contracts@arista.com (registration "
                        "issues) or registration@arista.com (support "
                        "portal issues), per the page's own instructions."
                    ),
                    manual_check_url=self.PORTAL_URL,
                )

            try:
                page.get_by_text("Active Releases", exact=False).first.click(timeout=8000)
            except Exception:
                dump_path = dump_debug_artifacts(page, vendor, "no_active_releases_link") or dump_path
                return cannot_determine(
                    vendor, model, current_version,
                    retrieval_method="authenticated_browser",
                    reason=(
                        'Logged in successfully, but no "Active Releases" '
                        f"link matched the guessed locator on the real "
                        f"Arista page. Debug artifacts saved to "
                        f"{dump_path or 'none'} -- share the .png so the "
                        "real navigation can be fixed against the actual "
                        "page instead of guessed again."
                    ),
                    manual_check_url=self.PORTAL_URL,
                )

            try:
                page.wait_for_load_state("networkidle", timeout=8000)
            except Exception:
                pass
            page.wait_for_timeout(1500)
            dump_path = dump_debug_artifacts(page, vendor, "active_releases") or dump_path

            try:
                page.evaluate(
                    "document.querySelectorAll('footer').forEach(el => el.remove())"
                )
            except Exception:
                pass
            releases_text = page.inner_text("body")
            candidates = _EOS_VERSION_RE.findall(releases_text)
        except Exception as e:
            return cannot_determine(
                vendor, model, current_version,
                retrieval_method="authenticated_browser",
                reason=(
                    f"{vendor} authenticated lookup failed: {e}. Debug "
                    f"artifacts: {dump_path or 'none'}."
                ),
                manual_check_url=self.PORTAL_URL,
            )

        if not candidates:
            dump_path = dump_debug_artifacts(page, vendor, "no_releases_found") or dump_path
            return cannot_determine(
                vendor, model, current_version,
                retrieval_method="authenticated_browser",
                reason=(
                    'Opened "Active Releases", but no EOS version-shaped '
                    f"text (e.g. \"4.31.2F\") was found on the resulting "
                    f"page. Debug artifacts: {dump_path or 'none'}."
                ),
                manual_check_url=self.PORTAL_URL,
            )

        latest_version = candidates[0].strip()
        return ok_result(
            vendor=vendor,
            model=model,
            current_version=current_version,
            latest_version=latest_version,
            source_url=self.HOME_URL,
            confidence=Confidence.MEDIUM,
            retrieval_method="authenticated_browser",
            update_available=is_update_available(current_version, latest_version),
            message=(
                f"Retrieved via an authenticated {vendor} session, from "
                'the "Active Releases" folder listing. UNVERIFIED: the '
                "assumption that the first EOS version-shaped token on "
                "this page is the newest release has not been confirmed "
                "against a real, non-restricted account -- please "
                "confirm this looks like a genuine current release, not "
                "an older entry or unrelated version-shaped text."
            ),
        )
