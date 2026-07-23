"""
H3C -- Tier 2, login-gated.

VERIFIED LIVE this session: real login completed against a real H3C
account (wsso.h3c.com/NewH3CLoginPage.aspx -- a genuine SSO domain,
correctly withheld as "not authenticated" while on it; confirmed
success afterward via a real debug screenshot showing "Welcome
ind_88cuj7o7g96f Logout" in the top nav, not just a URL heuristic).

CONFIRMED BUG, found live TWICE before that real login: H3C's
Support homepage (www.h3c.com/en/Support) never gates at all --
it shows "Login" in the top nav regardless of real auth state (same
class of false-positive already found for Cisco/Juniper/Aruba), and a
"prm-portal.h3c.com/register" account-registration dead end was hit on
an earlier attempt with no existing account. "register" is already in
the default not-authenticated markers, so that specific redirect is
handled; the homepage-never-gates problem is not vendor-specifically
patched here (same known limitation as elsewhere).

VERIFIED LIVE, separately, via a fully anonymous browser (no
storage_state at all): the ENTIRE search + extraction flow below also
works with ZERO login. Real evidence: searching "S5130" and filtering
to "SOFTWARE DOWNLOAD" returned genuine H3C Comware version strings
(e.g. "S5130S_EI-CMW710-R6380") straight from h3c.com's own public
search, no account needed. This override is used for both the
authenticated-session path AND is also wired into check_public_source()
below -- if a confident match is found anonymously, login is skipped
entirely; login remains as an honest fallback only.

Real, verified mechanics (from actual saved HTML/screenshots, not
guessed):
  - The visible "Resource Center" search box on the homepage
    (placeholder="Please enter a keyword") is NOT the one used --
    there's a SEPARATE, initially-hidden search input behind the
    magnifying-glass icon in the top nav; CONFIRMED BUG: the visible
    homepage box exists in the DOM but Playwright reports it as "not
    visible" until the icon toggle is clicked first.
  - Search results land on h3c.com/en/search/?q0=<query>, with a real
    "SOFTWARE DOWNLOAD" filter tab (exact text match required -- same
    "matches a hidden element first" trap already hit for Aruba's
    "Drivers and Software" tab, so `exact=True` + `visible=true` is
    used here too).
  - Version format: `<Model>-CMW<major>-R<build>`, e.g.
    "S5130S_EI-CMW710-R6380", "S5130S_EI-CMW710-R6126P37" (P-suffix =
    patch number).

***HONESTY FLAG***: H3C splits into sub-variant editions (EI/LI/HI)
sharing a base model number -- extraction here is scoped to result
blocks that literally contain the searched model string, but doesn't
guarantee the CORRECT sub-variant if multiple editions share a
substring match. Single product family (S5130) verified live.
"""
from __future__ import annotations

import re
from typing import Optional

from firmware_lookup.providers.base import (
    BrowserAuthenticatedProvider, dump_debug_artifacts,
)
from firmware_lookup.result import Confidence, FirmwareResult, ok_result
from firmware_lookup.versioning import is_update_available

PORTAL_URL = "https://www.h3c.com/en/Support"
HOME_URL = PORTAL_URL

# H3C Comware version format, e.g. "CMW710-R6380", "CMW710-R6126P37"
# (P-suffix = patch number) -- verified live against real search results.
H3C_VERSION_PATTERN = re.compile(r"\bCMW\d{2,4}-R\d{3,6}(?:P\d+)?\b")


class H3CProvider(BrowserAuthenticatedProvider):
    HOME_URL = HOME_URL

    def __init__(self):
        super().__init__("H3C", PORTAL_URL)

    def check_public_source(
        self, vendor: str, model: str, current_version: str,
    ) -> Optional[FirmwareResult]:
        # VERIFIED LIVE this session (see module docstring): the real
        # search + "SOFTWARE DOWNLOAD" filter mechanism works fully
        # anonymously. Reuses the exact same logic as the authenticated
        # path via _search_and_extract() below -- login was never
        # actually required for this data.
        if not model:
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
                    result = self._search_and_extract(page, vendor, model, current_version)
                finally:
                    browser.close()
        except Exception:
            return None

        return result

    def _search_and_extract(
        self, page, vendor: str, model: str, current_version: str,
    ) -> Optional[FirmwareResult]:
        """Shared real logic for both the anonymous (check_public_source)
        and authenticated (_extract_from_page) paths -- verified live to
        behave identically either way, since login never actually gated
        this search (see module docstring)."""
        try:
            page.goto(self.HOME_URL, wait_until="domcontentloaded", timeout=30000)
            page.wait_for_timeout(3000)

            # CONFIRMED BUG (see module docstring): the visible keyword
            # box is hidden until the search-icon toggle is clicked.
            try:
                page.locator("i.icon-search, .search-icon, [class*='search']").first.click(timeout=5000)
                page.wait_for_timeout(1000)
            except Exception:
                pass

            search_box = page.locator("input[placeholder*='keyword' i]").first
            search_box.click(timeout=5000)
            search_box.type(model, delay=100)
            page.wait_for_timeout(500)
            page.keyboard.press("Enter")
            page.wait_for_timeout(4000)

            try:
                page.get_by_text("SOFTWARE DOWNLOAD", exact=True).locator(
                    "visible=true"
                ).first.click(timeout=5000)
                page.wait_for_timeout(4000)
            except Exception:
                # Filter not found/clickable -- unfiltered results mix
                # in docs/PDFs, too unreliable to trust.
                return None

            body_text = page.inner_text("body")
        except Exception:
            return None

        model_idx = body_text.lower().find(model.lower())
        if model_idx == -1:
            return None
        window = body_text[max(0, model_idx - 200): model_idx + 400]
        candidates = H3C_VERSION_PATTERN.findall(window)
        if not candidates:
            return None

        latest_version = candidates[0].strip()
        # CONFIRMED BUG, found live: the old construction
        # (`HOME_URL.rsplit('/Support', 1)[0] + "/en/search/"`) produced
        # a broken double-"/en/en/search/" URL, since HOME_URL already
        # ends in ".../en/Support". Point directly at the real search
        # results page instead (with the actual query included, so the
        # proof link goes to what was really scanned, not just the
        # search homepage).
        from urllib.parse import quote
        source_url = f"https://www.h3c.com/en/search/?q0={quote(model)}"
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
                "Retrieved from H3C's public support search (verified "
                "live to work with no login at all). H3C splits into "
                "sub-variant editions (EI/LI/HI) sharing a base model "
                "number -- please confirm this is the correct edition, "
                "not just a substring match on the model number."
            ),
        )

    def _extract_from_page(
        self, page, vendor: str, model: str, current_version: str,
    ) -> FirmwareResult:
        from firmware_lookup.result import cannot_determine

        result = self._search_and_extract(page, vendor, model, current_version)
        dump_path = dump_debug_artifacts(page, vendor, "results")
        if result is not None:
            return result
        return cannot_determine(
            vendor, model, current_version,
            retrieval_method="authenticated_browser",
            reason=(
                f"Logged in successfully, but the search + 'Software "
                f"Download' filter found no confident match for {model!r}. "
                f"Debug artifacts: {dump_path or 'none'}."
            ),
            manual_check_url=self.PORTAL_URL,
        )
