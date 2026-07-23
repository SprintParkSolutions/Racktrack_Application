"""
TP-Link -- public per-model download page, no login.

Source: https://www.tp-link.com/us/support/download/<model-slug>/
The page statically renders firmware rows keyed by
`id="Firmware_<MODEL>"`, each linking to a CDN file whose name embeds the
hardware revision, firmware version, and build date, e.g.:
    SG1016DE(UN) 7.0_1.0.1 Build 20240628 Rel.34903_up.bin.zip
                 ^hw rev  ^fw version   ^build date
"""
from __future__ import annotations

import logging
import re
from datetime import datetime
from typing import Optional

from firmware_lookup.http_client import FirmwareHttpClient
from firmware_lookup.providers.base import BrowserAuthenticatedProvider
from firmware_lookup.result import Confidence, FirmwareResult, ok_result
from firmware_lookup.versioning import is_update_available

logger = logging.getLogger("firmware_lookup.providers.tplink")

BASE = "https://www.tp-link.com/us/support/download"

# e.g. "SG1016DE(UN) 7.0_1.0.1 Build 20240628 Rel.34903_up.bin.zip"
#        model      hw-rev  fw-version   build-date
_FILENAME_RE = re.compile(
    r"([A-Z0-9\-]+)\([A-Z0-9]+\)\s+([\d.]+)_([\d.]+)\s+Build\s+(\d{8})",
    re.IGNORECASE,
)


def _model_to_slug(model: str) -> str:
    return re.sub(r"\s+", "-", model.strip().lower())


class TPLinkProvider(BrowserAuthenticatedProvider):
    # Real support homepage -- verified live. Login is a SAFETY NET
    # only: TP-Link's public per-model download page below is the
    # vendor's own official data, tried first. This login path is
    # UNVERIFIED and best-effort, added per explicit user request so
    # there's a real fallback instead of a dead end.
    HOME_URL = "https://www.tp-link.com/us/support"

    def __init__(self):
        super().__init__("TP-Link", self.HOME_URL)
        self.http = FirmwareHttpClient("tplink")

    def check_public_source(
        self, vendor: str, model: str, current_version: str,
    ) -> Optional[FirmwareResult]:
        if not model:
            return None
        slug = _model_to_slug(model)
        url = f"{BASE}/{slug}/"
        html = self.http.get_text(url)
        if not html:
            return None

        rows = []  # (hw_rev, fw_version, build_date, raw_ver_string)
        for m in _FILENAME_RE.finditer(html):
            _, hw_rev, fw_version, build_date = m.groups()
            try:
                parsed_date = datetime.strptime(build_date, "%Y%m%d")
            except ValueError:
                continue
            rows.append((hw_rev, fw_version, parsed_date))

        if not rows:
            return None

        hw_hint = _extract_hw_major(model)
        candidate_rows = rows
        confidence = Confidence.MEDIUM
        if hw_hint is not None:
            matching = [r for r in rows if _hw_major(r[0]) == hw_hint]
            if matching:
                candidate_rows = matching
                confidence = Confidence.HIGH
        elif len({r[0] for r in rows}) == 1:
            confidence = Confidence.HIGH

        newest = max(candidate_rows, key=lambda r: r[2])
        latest_version = newest[1]

        return ok_result(
            vendor=vendor,
            model=model,
            current_version=current_version,
            latest_version=latest_version,
            source_url=url,
            confidence=confidence,
            retrieval_method="public_html",
            update_available=is_update_available(current_version, latest_version),
        )


def _extract_hw_major(model: str) -> Optional[int]:
    """Pull a hardware-revision major number out of a model string like
    'TL-SG1016DE v2' or 'TL-SG1016DE V2.0', if present."""
    m = re.search(r"\bv(\d+)(?:\.\d+)?\b", model, re.IGNORECASE)
    return int(m.group(1)) if m else None


def _hw_major(hw_rev: str) -> Optional[int]:
    """Extract the leading integer from a filename-embedded hardware
    revision like '7.0' -> 7, so it can be compared against a user-typed
    hint like 'v7' regardless of formatting differences."""
    m = re.match(r"(\d+)", hw_rev.strip())
    return int(m.group(1)) if m else None
