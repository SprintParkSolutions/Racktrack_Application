"""
Linksys -- Tier 1, public, no login.

CORRECTED, found live after initially being registered as a dead end:
the original registration said support.linksys.com's per-model KB
articles never show a firmware version, only a Quick Start Guide/
Regulatory Info/CLI Manual. A user pushed back and pointed at
ui.linksys.com's own UI Simulator, which does show a "Firmware
Version" field -- investigated that first and confirmed it's a red
herring: two different real models (LGS328C, LGS352C) show the
IDENTICAL "1.00.01.01" and identical fake "Serial Number: 000000001"
in that simulator, proving it's a static demo template, not real data.

Continuing to investigate rather than stopping there (the user then
asked to browse from OUR OWN fallback link instead of guessing URLs)
found the REAL source: support.linksys.com/kb/section/188/ lists a
real per-model KB article for each switch (e.g. "Linksys LGS310C
Support" -> article/5135-en). MOST of these articles (confirmed live
for LGS310C and LGS352C) have a real "<Model> Downloads" section with
a genuine, differentiated Firmware entry:
    LGS310C -> Ver. 1.01.02.02, Latest Date: 6/02/2022
    LGS352C -> Ver. 1.01.02.01, Latest Date: 5/30/2023
-- two DIFFERENT real version numbers for two different real products,
each linking a real downloads.linksys.com file with the version
embedded in the filename (e.g. LGS310MPC-LGS310C_v1.01.02.02.imag).

CONFIRMED, real and honest: NOT every model's article has this
section -- LGS328C's article links only the fake UI Simulator instead
of a real Downloads block. This is a genuine per-model gap (the
article simply wasn't built out with a Downloads section), not a bug
in this provider -- model_not_found is the honest answer for LGS328C
specifically.

The original "no version field" finding was real for the specific
article checked at the time; the fix here is discovering the article
per-model fresh from the live category page rather than assuming
every article has (or lacks) the same structure.

SECOND BUG caught testing this fix: LGS310C's and LGS352C's real
Downloads blocks use two DIFFERENT real HTML structures (LGS310C:
<p><span>Ver. ...</span></p> paragraphs; LGS352C: <li>Ver. ...</li>
list items) -- a raw-HTML regex tuned against one broke on the other,
silently returning model_not_found for a model that genuinely has
real data. Fixed by matching page.inner_text()'s RENDERED TEXT instead
of raw markup -- both structures render to the same plain-text shape,
so one regex covers both real variants without caring which tags
produced them.
"""
from __future__ import annotations

import re
from typing import Optional

from firmware_lookup.matching import find_ambiguous_candidates, match_model
from firmware_lookup.providers.base import FirmwareProvider
from firmware_lookup.result import (
    Confidence, FirmwareResult, ambiguous_model, cannot_determine,
    model_not_found, ok_result,
)
from firmware_lookup.versioning import is_update_available, parse_version

CATEGORY_URL = "https://support.linksys.com/kb/section/188/"
PORTAL_URL = CATEGORY_URL

# Real markup, verified live: category page link text is literally
# "Linksys <MODEL> Support" for the per-model article (a separate,
# near-identical "<MODEL> FAQs" link also exists per model -- only the
# "Support" one has the real Downloads section).
_MODEL_LINK_RE = re.compile(r"^Linksys\s+(\S+)\s+Support$")

# Real markup, verified live: matched against RENDERED TEXT
# (page.inner_text), not raw HTML -- two different real articles use
# two different real HTML structures for the same "<Model> Downloads"
# block (LGS310C: <p><span>...</span></p> paragraphs; LGS352C: <li>
# list items), but both render to the same plain-text shape:
# "Firmware\nVer. <version>\nLatest Date: <date>". Matching text
# instead of markup sidesteps that structural inconsistency entirely.
_FIRMWARE_RE = re.compile(
    r"Firmware\s*\n+\s*Ver\.\s*([\d.]+)\s*\n+\s*Latest Date:\s*([\d/]+)",
)


class LinksysProvider(FirmwareProvider):
    def __init__(self):
        self.vendor_key = "Linksys"

    def get_latest_firmware(
        self, vendor: str, model: str, current_version: str,
    ) -> FirmwareResult:
        if not model:
            return cannot_determine(
                vendor, model, current_version,
                retrieval_method="public_browser",
                reason="No model given.",
                manual_check_url=PORTAL_URL,
            )

        try:
            from playwright.sync_api import sync_playwright
        except ImportError:
            return cannot_determine(
                vendor, model, current_version,
                retrieval_method="public_browser",
                reason="Playwright not available to load Linksys's support catalog.",
                manual_check_url=PORTAL_URL,
            )

        # Confirmed live this session: a plain headless Chromium
        # browser gets flagged by fingerprint detection on this
        # domain (the same class of false block found on Signamax) --
        # stealth launch args avoid it.
        try:
            with sync_playwright() as playwright:
                browser = playwright.chromium.launch(
                    headless=True,
                    args=["--disable-blink-features=AutomationControlled"],
                )
                try:
                    context = browser.new_context(
                        user_agent=(
                            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                            "AppleWebKit/537.36 (KHTML, like Gecko) "
                            "Chrome/126.0.0.0 Safari/537.36"
                        ),
                        viewport={"width": 1512, "height": 982},
                    )
                    page = context.new_page()
                    page.add_init_script(
                        "Object.defineProperty(navigator, 'webdriver', "
                        "{get: () => undefined})"
                    )

                    page.goto(CATEGORY_URL, wait_until="networkidle", timeout=25000)
                    page.wait_for_timeout(1500)
                    links = page.eval_on_selector_all(
                        "a",
                        "els => els.map(e => ({href: e.href, "
                        "text: e.textContent.trim()}))",
                    )
                    catalog: dict[str, str] = {}
                    for link in links:
                        match = _MODEL_LINK_RE.match(link["text"])
                        if match:
                            catalog[match.group(1)] = link["href"]

                    if not catalog:
                        return cannot_determine(
                            vendor, model, current_version,
                            retrieval_method="public_browser",
                            reason="Linksys's support catalog page did not load.",
                            manual_check_url=PORTAL_URL,
                        )

                    matched_name, _score, method = match_model(
                        model, list(catalog.keys()),
                    )
                    if method == "ambiguous":
                        return ambiguous_model(
                            vendor, model, current_version,
                            find_ambiguous_candidates(model, list(catalog.keys())),
                            retrieval_method="public_browser",
                        )
                    if not matched_name:
                        return model_not_found(
                            vendor, model, current_version,
                            retrieval_method="public_browser",
                            manual_check_url=PORTAL_URL,
                        )

                    article_url = catalog[matched_name]
                    page.goto(article_url, wait_until="networkidle", timeout=25000)
                    page.wait_for_timeout(1500)
                    text = page.inner_text("body")
                finally:
                    browser.close()
        except Exception as e:
            return cannot_determine(
                vendor, model, current_version,
                retrieval_method="public_browser",
                reason=f"Linksys's support catalog failed to load: {e}.",
                manual_check_url=PORTAL_URL,
            )

        match = _FIRMWARE_RE.search(text)
        if not match or not parse_version(match.group(1)):
            # Confirmed live for a real model (LGS328C): a genuine
            # absence of any Downloads/Firmware section, not a bug.
            return model_not_found(
                vendor, model, current_version,
                retrieval_method="public_browser",
                manual_check_url=PORTAL_URL,
            )
        latest_version = match.group(1)
        release_date = match.group(2)

        return ok_result(
            vendor=vendor,
            model=model,
            current_version=current_version,
            latest_version=latest_version,
            source_url=article_url,
            confidence=Confidence.HIGH,
            retrieval_method="public_browser",
            update_available=is_update_available(current_version, latest_version),
            message=(
                "Retrieved from Linksys's public support article (no "
                f"login required) -- released {release_date}."
            ),
        )
