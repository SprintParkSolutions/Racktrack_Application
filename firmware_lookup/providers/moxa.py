"""
MOXA -- public support page, no login.

Source: https://www.moxa.com/en/support/product-support/software-and-documentation
This page server-renders a large table of products, each row linking to
an Azure CDN firmware file whose name embeds a version, e.g.:
    .../moxa-iologik-2500-series-ethernet-firmware-v4.3.hfm

IMPORTANT (verified live): this page returns different/blocked content to
a generic bot User-Agent -- a realistic desktop browser UA is required.

KNOWN LIMITATION (verified live): this landing page is an ASP.NET
WebForms page whose product search is a POST postback
(`WebForm_OnSubmit`/`__doPostBack`), not a plain GET/query-param search.
Without emulating that postback (fragile, out of scope -- reverse
engineering a WebForms postback is exactly the kind of brittle scraping
the spec says to avoid), only the small set of products currently
featured directly on the landing page (as of this writing: 2 of its 22
rows have a direct Firmware link) can be resolved here. Every other MOXA
model will honestly return cannot_determine/model_not_found rather than
a wrong or fabricated version -- this is a real coverage gap, not a
correctness one.

Confidence is Medium: one official page, but rows are matched by
substring/fuzzy product-name matching against a small product table
rather than a per-model API, so there's real risk of picking an
adjacent row on an ambiguous partial name.
"""
from __future__ import annotations

import logging
import re
from typing import Optional

from firmware_lookup.http_client import FirmwareHttpClient
from firmware_lookup.matching import match_model
from firmware_lookup.providers.base import BrowserAuthenticatedProvider
from firmware_lookup.result import Confidence, FirmwareResult, ok_result
from firmware_lookup.versioning import is_update_available

logger = logging.getLogger("firmware_lookup.providers.moxa")

URL = "https://www.moxa.com/en/support/product-support/software-and-documentation"
BROWSER_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
)

# Each product row looks like:
#   <tr class="border-table__tr">
#     <td ...><a class="border-table__link" href="?psid=NNNN">PRODUCT NAME</a></td>
#     <td ...>...<a ... data-type="Firmware" ... href=".../name-v4.3.hfm">...
#   </tr>
_ROW_RE = re.compile(r'<tr class="border-table__tr">(.*?)</tr>', re.DOTALL)
_PRODUCT_NAME_RE = re.compile(r'href="\?psid=\d+"[^>]*>([^<]{2,80})</a>')
_FIRMWARE_LINK_RE = re.compile(
    r'data-type="Firmware"[^>]*href="([^"]+-v([\d.]+)\.\w+)"',
    re.IGNORECASE,
)


class MoxaProvider(BrowserAuthenticatedProvider):
    # Real support homepage -- verified live via an actual browser
    # (200; raw curl gets a 403 from bot detection on this domain, same
    # reason BROWSER_UA exists below, but a real Playwright browser
    # isn't affected). Login is a SAFETY NET only: MOXA's public support
    # page below is the vendor's own official data, tried first. This
    # login path is UNVERIFIED and best-effort, added per explicit user
    # request so there's a real fallback instead of a dead end.
    HOME_URL = "https://www.moxa.com/en/support"

    def __init__(self):
        super().__init__("MOXA", self.HOME_URL)
        self.http = FirmwareHttpClient("moxa", user_agent=BROWSER_UA)

    def check_public_source(
        self, vendor: str, model: str, current_version: str,
    ) -> Optional[FirmwareResult]:
        html = self.http.get_text(URL)
        if not html:
            return None

        entries = self._parse_entries(html)
        if not entries:
            return None

        if not model:
            return None

        names = [name for name, _url, _ver in entries]
        matched_name, score, method = match_model(model, names)
        if not matched_name:
            return None

        matched_entries = [e for e in entries if e[0] == matched_name]
        firmware_url, latest_version = matched_entries[0][1], matched_entries[0][2]

        return ok_result(
            vendor=vendor,
            model=model,
            current_version=current_version,
            latest_version=latest_version,
            source_url=firmware_url,
            confidence=Confidence.MEDIUM,
            retrieval_method="public_html",
            update_available=is_update_available(current_version, latest_version),
        )

    @staticmethod
    def _parse_entries(html: str) -> list[tuple[str, str, str]]:
        """Returns (product_name, firmware_url, version) tuples, one per
        table row that has both a product name and a Firmware link."""
        entries = []
        for row in _ROW_RE.findall(html):
            name_m = _PRODUCT_NAME_RE.search(row)
            fw_m = _FIRMWARE_LINK_RE.search(row)
            if name_m and fw_m:
                entries.append((name_m.group(1).strip(), fw_m.group(1), fw_m.group(2)))
        return entries
