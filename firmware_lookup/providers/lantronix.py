"""
Lantronix -- Tier 2, login-gated. Real public source investigated and
confirmed NOT to exist for switches this session (not just an old/
unverified guess).

VERIFIED LIVE this session: Lantronix genuinely sells managed switches
(confirmed via lantronix.com/product-finder/managed-switches/ -- real
models include SM24TBT4XPA, SM8TBT2SA, SISPM1242-582-LRT). Each
product's own "Firmware Downloads" tab states, verbatim: "You must log
in or create a MyLantronix account to download firmware." No version
number is shown without login.

A separate general public archive (lantronix.com/resource-category/
firmware/) IS browsable with no login, but was confirmed live to
contain NO switch-family entries -- only other Lantronix product lines
(NTC-220, xPico 600, NTC-500, FOX4, EDS5000). So it doesn't cover this
vendor's switches specifically, despite being genuinely public.

Also checked a notable exception: lantronix.com/sespm-series-firmware-
download-request/ -- a public (no-login) page for the SESPM Series
specifically, but it's a serial-number-gated REQUEST FORM ("Firmware
for the SESPM Series is dependent on the serial number of your
switch"), not a browsable version list -- can't extract a version
number from it without submitting a real unit's serial number, so it
isn't usable as an automated source either.

Real, confirmed login URL: lantronix.com/mylantronix/?view=login --
fetched live, a real MyLantronix login form (Email Address, Password,
"Remember Me", "Forgot Password", "Sign up").

REAL MARKUP FOUND, worth recording precisely: the "Firmware Downloads"
block on a product page (e.g. lantronix.com/products/sm24tbt4xpa/) is
NOT a separate portal -- it's a locked section right there on the same
per-model product page, confirmed live:
    <div class="downloads-group">
      <div class="group-title">Firmware Downloads</div>
      <div class="group-items" style="display: none;">
        <div class="download">
          <div class="file-type locked"></div>
          <div class="title">...must log in or create a MyLantronix
          account to download firmware...</div>
        </div>
      </div>
    </div>
This means the generic base-class login flow (which searches via a
search box on HOME_URL after logging in) would NOT work here -- this
product page has no search box at all, so the base class's default
_extract_from_page() would just fail at "no search box matched" every
time even with a perfectly valid session. Overridden below instead:
reload the SAME per-model product page (URL is a plain mechanical
transform, confirmed live for 2 different real models --
"SM24TBT4XPA" -> .../products/sm24tbt4xpa/, "SM8TBT2SA" ->
.../products/sm8tbt2sa/, both real 200s) with the authenticated
session, and scan specifically inside this same "Firmware Downloads"
block for a version number.

***HONESTY FLAG***: UNVERIFIED end-to-end -- no test account available,
so the actual UNLOCKED markup (once really logged in) has never been
observed; the extraction regex below is a best-effort generic version
pattern applied to this specific section's text, not something
confirmed against real unlocked content. Still checks for the same
"must log in" text as a stale-session signal, which IS confirmed real.
"""
from __future__ import annotations

import re
from typing import Optional

from firmware_lookup.providers.base import BrowserAuthenticatedProvider, dump_debug_artifacts
from firmware_lookup.result import (
    Confidence, FirmwareResult, auth_required, cannot_determine,
    model_not_found, ok_result,
)
from firmware_lookup.versioning import is_update_available

PORTAL_URL = "https://www.lantronix.com/product-finder/managed-switches/"
HOME_URL = "https://www.lantronix.com/mylantronix/?view=login"

# Real markup, verified live: bounded to the "Firmware Downloads"
# group specifically, stopping before the next downloads-group section
# (e.g. "Webinars") so an unrelated section's text is never scanned.
_FIRMWARE_SECTION_RE = re.compile(
    r'<div class="group-title">Firmware Downloads</div>\s*'
    r'<div class="group-items"[^>]*>(.*?)(?=<div class="downloads-group">|\Z)',
    re.DOTALL,
)
# Note: leading \b is deliberately NOT used before the digits -- \b
# doesn't exist between two \w characters (e.g. "v" immediately
# followed by a digit, both \w), a real regex boundary bug found and
# fixed repeatedly elsewhere in this codebase (Dell, Cisco Catalyst/
# Nexus). The optional "v"/"V" prefix is consumed via a lookahead so it
# doesn't end up inside the captured version group.
_VERSION_TOKEN_RE = re.compile(
    r"(?:[vV](?=\d))?(\d+\.\d+(?:\.\d+)*[A-Za-z0-9\-]{0,10})"
)


def _product_page_url(model: str) -> str:
    slug = model.strip().lower().replace(" ", "-")
    return f"https://www.lantronix.com/products/{slug}/"


class LantronixProvider(BrowserAuthenticatedProvider):
    HOME_URL = HOME_URL

    def __init__(self):
        super().__init__("Lantronix", PORTAL_URL)

    def check_public_source(
        self, vendor: str, model: str, current_version: str,
    ) -> Optional[FirmwareResult]:
        # Confirmed live this session (see module docstring): switch
        # firmware is genuinely login-gated ("You must log in or create
        # a MyLantronix account to download firmware"), and the one
        # public archive that exists doesn't cover switches. Always
        # falls through to login.
        return None

    def _extract_from_page(
        self, page, vendor: str, model: str, current_version: str,
    ) -> FirmwareResult:
        """Overridden (see module docstring): the generic base-class
        flow assumes a search box exists at HOME_URL, which this
        product page doesn't have -- reloads the SAME per-model product
        page instead and scans specifically inside its "Firmware
        Downloads" section."""
        if not model:
            return cannot_determine(
                vendor, model, current_version,
                retrieval_method="authenticated_browser",
                reason="No model given.",
                manual_check_url=PORTAL_URL,
            )

        product_url = _product_page_url(model)
        dump_path = None
        try:
            page.goto(product_url, wait_until="domcontentloaded", timeout=20000)
            page.wait_for_timeout(1000)
            html = page.content()
        except Exception as e:
            return cannot_determine(
                vendor, model, current_version,
                retrieval_method="authenticated_browser",
                reason=f"Lantronix product page failed to load: {e}.",
                manual_check_url=PORTAL_URL,
            )

        section_match = _FIRMWARE_SECTION_RE.search(html)
        if not section_match:
            dump_path = dump_debug_artifacts(page, vendor, "no_firmware_section")
            return model_not_found(
                vendor, model, current_version,
                retrieval_method="authenticated_browser",
                manual_check_url=PORTAL_URL,
            )

        section_html = section_match.group(1)
        if "must" in section_html.lower() and "log in" in section_html.lower():
            # Same real "must log in" text confirmed live even inside
            # what should be an authenticated session -- the session is
            # stale/invalid, not that firmware genuinely doesn't exist.
            dump_path = dump_debug_artifacts(page, vendor, "still_locked") or dump_path
            self.session_manager.invalidate_session()
            return auth_required(
                vendor, model, current_version,
                manual_check_url=PORTAL_URL,
            )

        section_text = re.sub(r"<[^>]+>", " ", section_html)
        version_match = _VERSION_TOKEN_RE.search(section_text)
        if not version_match:
            dump_path = dump_debug_artifacts(page, vendor, "no_version_found") or dump_path
            return cannot_determine(
                vendor, model, current_version,
                retrieval_method="authenticated_browser",
                reason=(
                    "Logged in, and the Firmware Downloads section no "
                    "longer shows the login prompt, but no version-"
                    f"looking text was found in it. Debug artifacts: "
                    f"{dump_path or 'none'}."
                ),
                manual_check_url=PORTAL_URL,
            )
        latest_version = version_match.group(1)

        return ok_result(
            vendor=vendor,
            model=model,
            current_version=current_version,
            latest_version=latest_version,
            source_url=product_url,
            confidence=Confidence.MEDIUM,
            retrieval_method="authenticated_browser",
            update_available=is_update_available(current_version, latest_version),
            message=(
                "Retrieved via an authenticated Lantronix session, from "
                "this model's own Firmware Downloads section. "
                "Extraction is best-effort and unverified against a "
                "real account -- please confirm this looks like a "
                "genuine version string."
            ),
        )
