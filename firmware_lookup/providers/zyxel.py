"""
Zyxel Networks -- Tier 2, real public source tried first, real
browser-assisted login as the safety net.

VERIFIED LIVE this session: zyxel.com's own Download Library is a real,
fully public page (no login) with a real per-model filter that turns
out to be a simple, direct URL query parameter -- confirmed live that
typing a model into the real UI's autocomplete (id="edit-model") and
selecting a suggestion navigates to
    https://www.zyxel.com/global/en/support/download?model=<slug>
where <slug> is just the model name lowercased (e.g. "GS1900-24" ->
"gs1900-24") -- confirmed this is a genuine, reliable, MECHANICAL
transform (not something requiring the autocomplete's own internal ID)
by fetching a SECOND, different model's URL built the exact same way
without ever touching the UI, and getting correct, real results either
way. No browser needed for this path at all -- the whole public lookup
is plain HTTP.

Real markup, a standard Drupal Views table:
    <td class="views-field views-field-model-name">GS1900-24</td>
    <td class="views-field views-field-nothing-2">Firmware</td>
    <td class="views-field views-field-field-version">2.90(AAHL.2)C0</td>
    <td class="views-field views-field-field-release-date">June 12, 2026</td>
Confirmed live the table lists EVERY document type for a model
(Firmware, MIB File, Declaration, User's Guide, Datasheet, etc.) mixed
together, newest-first within each type -- scoped here to rows whose
own "Material" column literally says "Firmware", and takes the first
(newest) one.

LOGIN SAFETY NET: if a model isn't in the public Download Library (a
new/unlisted model, or Zyxel adds account-gating to some future page),
this falls through to a real browser-assisted login rather than
stopping at model_not_found -- same pattern as every other Tier-2
vendor here. VERIFIED LIVE this session: clicking "Sign in" on Zyxel's
own site navigates to a real login portal at
https://account.zyxel.com/users/sign_in (a separate Zyxel-run account
domain, not zyxel.com itself). Login flow itself uses the generic
browser-assisted search-and-extract in BrowserAuthenticatedProvider
(providers/base.py) -- UNVERIFIED end-to-end against a real Zyxel
account (no test credentials available), same honesty flag as every
other vendor using this generic authenticated path.
"""
from __future__ import annotations

import re
from typing import Optional

from firmware_lookup.http_client import FirmwareHttpClient
from firmware_lookup.providers.base import BrowserAuthenticatedProvider
from firmware_lookup.result import Confidence, FirmwareResult, ok_result
from firmware_lookup.versioning import is_update_available

PORTAL_URL = "https://www.zyxel.com/global/en/support/download"
HOME_URL = "https://account.zyxel.com/users/sign_in"

_ROW_RE = re.compile(
    r'class="views-field views-field-model-name">([^<]+?)\s*</td>.*?'
    r'class="views-field views-field-nothing-2">([^<]+?)\s*</td>.*?'
    r'class="views-field views-field-field-version">([^<]*?)\s*</td>.*?'
    r'class="views-field views-field-field-release-date">([^<]*?)\s*</td>',
    re.DOTALL,
)


class ZyxelProvider(BrowserAuthenticatedProvider):
    HOME_URL = HOME_URL

    def __init__(self):
        super().__init__("Zyxel", PORTAL_URL)
        self.http = FirmwareHttpClient("zyxel")

    def check_public_source(
        self, vendor: str, model: str, current_version: str,
    ) -> Optional[FirmwareResult]:
        if not model:
            return None

        url = f"{PORTAL_URL}?model={model.strip().lower()}"
        html = self.http.get_text(url)
        if not html:
            return None

        rows = _ROW_RE.findall(html)
        firmware_rows = [
            (version, date) for _model, material, version, date in rows
            if material.strip().lower() == "firmware" and version.strip()
        ]
        if not firmware_rows:
            # Genuinely no Firmware entry for this model on the public
            # page -- falls through to login rather than assuming this
            # model doesn't exist at all (it may just not be listed
            # here, or Zyxel may show more once authenticated).
            return None

        # First "Firmware"-typed row is the newest -- confirmed live the
        # table lists each document type newest-first.
        latest_version, latest_date = firmware_rows[0]

        return ok_result(
            vendor=vendor,
            model=model,
            current_version=current_version,
            latest_version=latest_version,
            source_url=url,
            confidence=Confidence.HIGH,
            retrieval_method="public_html",
            update_available=is_update_available(current_version, latest_version),
            message=(
                "Retrieved from Zyxel's public Download Library (no "
                f"login required) -- the newest Firmware entry, released "
                f"{latest_date}."
            ),
        )
