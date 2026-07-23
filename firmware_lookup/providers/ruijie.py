"""
Ruijie Networks -- Tier 2 base (for the login safety net), with a real,
verified public source for enterprise switch (RG-S/RG-NBS series)
firmware version info that needs no login.

VERIFIED LIVE this session: ruijienetworks.com 301-redirects to
ruijie.com (the vendor consolidated onto this domain). Its resource
center at ruijie.com/en-global/resources/products is a JS-rendered SPA
(confirmed live: a plain curl/WebFetch of it returns only the page
shell) that calls a real, plain-HTTP JSON search API underneath --
captured live via Playwright's response interception, not guessed:
    POST https://www.ruijie.com/api/search/allContentSearchData
    {"contentTypes":[],"currentPage":1,"keyword":"<model>",
     "languageNameLocals":[],"pageSize":30,"products":[],"productIds":[],
     "sortBy":"updateTime","formats":[],"subContentTypes":[],
     "reyeeFlag":false,"languageId":1}
This is plain HTTP/JSON, no browser needed at all once known.

CONFIRMED SCOPE, found live: this endpoint's per-model results are
dominated by documentation (datasheets, config/command-reference
guides), NOT a direct "current firmware version" field or a firmware
binary listing -- repeated real queries for "RG-S5000-E" and variants
never surfaced a record whose urlAddress pointed at a
/resources/software/ firmware page, despite one such page (e.g.
.../resources/software/rg-s5000-e-firmware/11-4-1-b88/) being
confirmed live to exist and be genuinely public. Rather than guess a
brittle way to reach that page directly, this uses the SAME real
signal already proven for Cisco/Extreme/Nokia elsewhere in this
codebase: Ruijie's own "Release Note" documents are indexed by this
same search API and their titles embed the real RGOS version they
document, e.g. confirmed live:
    "Ruijie RG-S5000-E Series Switches Release Notes, RGOS 11.4(1)B88P2 (V1.0)"
    "Ruijie RG-S5000-E Series Switches Release Notes, RGOS 11.4(1)B88P1 (V1.0)"
    "Ruijie RG-S5000-E Series Switches Release Notes, RGOS 11.4(1)B88 (V1.0)"
-- the highest RGOS version among matching Release Note titles is taken
as latest, same "parse version out of a release-notes title" principle
already established, not a new/riskier technique.

HONESTY FLAG: this only covers Ruijie's main enterprise line
(ruijie.com search results) -- the "Reyee" SMB sub-brand
(reyee.ruijie.com, reyeeFlag=true) was confirmed live to have its OWN
separate per-model firmware pages (e.g. reyee.ruijie.com/.../
rg-es-es205gc-es208gc-firmware/...) but wasn't verified against this
same search API this session, so Reyee-branded models are NOT covered
here and correctly fall through to login instead.

LOGIN SAFETY NET: real login URL confirmed live --
ruijienetworks.com/login/ 301-redirects to https://account.ruijie.com/
("Ruijie Login" page). UNVERIFIED end-to-end (no test account
available), same honesty flag as every other vendor using the generic
authenticated path in providers/base.py.
"""
from __future__ import annotations

import json
import re
from typing import Optional

from firmware_lookup.http_client import FirmwareHttpClient
from firmware_lookup.providers.base import BrowserAuthenticatedProvider
from firmware_lookup.result import Confidence, FirmwareResult, ok_result
from firmware_lookup.versioning import is_update_available, parse_version

PORTAL_URL = "https://www.ruijie.com/en-global/resources/products"
HOME_URL = "https://account.ruijie.com/"

SEARCH_API_URL = "https://www.ruijie.com/api/search/allContentSearchData"

# Real markup, verified live: a Release Note title embeds the RGOS
# version it documents, e.g. "...Release Notes, RGOS 11.4(1)B88P2 (V1.0)".
_RGOS_VERSION_RE = re.compile(r"RGOS\s+([\d]+\.[\d]+(?:\([\d]+\))?[A-Za-z0-9]*)")


class RuijieProvider(BrowserAuthenticatedProvider):
    HOME_URL = HOME_URL

    def __init__(self):
        super().__init__("Ruijie", PORTAL_URL)
        self.http = FirmwareHttpClient("ruijie")

    def check_public_source(
        self, vendor: str, model: str, current_version: str,
    ) -> Optional[FirmwareResult]:
        if not model:
            return None

        body = json.dumps({
            "contentTypes": [], "currentPage": 1, "keyword": model.strip(),
            "languageNameLocals": [], "pageSize": 30, "products": [],
            "productIds": [], "sortBy": "updateTime", "formats": [],
            "subContentTypes": [], "reyeeFlag": False, "languageId": 1,
        })
        response_text = self.http.post_text(
            SEARCH_API_URL, data=body,
            headers={"Content-Type": "application/json"},
        )
        if not response_text:
            return None

        try:
            payload = json.loads(response_text)
        except (ValueError, TypeError):
            return None

        records = payload.get("data", {}).get("records") or []
        candidates: list[tuple[str, str]] = []
        for record in records:
            title = record.get("title") or ""
            subtype = (record.get("subContentTypeName") or "").lower()
            if "release note" not in subtype:
                continue
            version_match = _RGOS_VERSION_RE.search(title)
            if not version_match:
                continue
            version_str = version_match.group(1)
            if not parse_version(version_str):
                continue
            url = record.get("urlAddress") or PORTAL_URL
            candidates.append((version_str, url))

        if not candidates:
            return None

        candidates.sort(key=lambda vc: parse_version(vc[0]), reverse=True)
        latest_version, source_url = candidates[0]

        return ok_result(
            vendor=vendor,
            model=model,
            current_version=current_version,
            latest_version=latest_version,
            source_url=source_url,
            confidence=Confidence.MEDIUM,
            retrieval_method="public_html",
            update_available=is_update_available(current_version, latest_version),
            message=(
                "Retrieved from Ruijie's public resource search (no "
                "login required) -- the highest RGOS version named in "
                "a matching Release Notes document title. Only covers "
                "Ruijie's main enterprise line, not the Reyee SMB "
                "sub-brand."
            ),
        )
