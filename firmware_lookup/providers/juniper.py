"""
Juniper Networks -- Tier 1 public source, WITH a login fallback for
resilience.

HISTORY: originally login-gated (BrowserAuthenticatedProvider), then
fully reclassified to public-only after live evidence showed login was
never actually required (see git history / earlier docstring for the
full story: a completely anonymous browser reached a genuine
"Install Package" release table with zero authentication).

CONFIRMED BUG, found live 2026-07-16: the public-only version used
`wait_until="networkidle"` for the initial page load, which hit a real
30-second timeout in practice (Juniper's page apparently never goes
fully network-idle, likely due to persistent background requests --
chat widgets, analytics polling -- the same class of issue already
fixed for Dell/H3C/RUCKUS by switching to `domcontentloaded` + an
explicit wait instead of trusting networkidle to ever fire). Fixed here
the same way.

Also restored as a LOGIN FALLBACK: even though login was proven
unnecessary for the common case, a transient failure (a timeout, a
changed page, Juniper rate-limiting anonymous traffic, etc.) previously
had nowhere to go -- the public-only version just failed outright. Now
structured as BrowserAuthenticatedProvider: check_public_source() tries
the real, proven anonymous path FIRST (fast, no prompt); if that
doesn't resolve, it honestly falls through to the existing login flow
(UNVERIFIED against a real account past the search box -- see the
account-registration dead end noted in project history) rather than
dead-ending immediately.

Real, verified selectors from actual saved HTML (not guessed):
  - Search box: <input class="form-control search"
      placeholder="Type a product name">
  - Autocomplete suggestion (NOT an <li> or .dropdown-item as
      originally guessed): <div id="prodList" class="search-list">
      <h4 class="list active" selectedproduct="srx300">SRX300</h4>
      </div> -- selector: "#prodList h4, h4[selectedproduct]"
  - CONFIRMED BUG, found live: .fill() on the search box never
      triggered the autocomplete at all -- this is an Angular typeahead
      that debounces off real per-keystroke events, fixed by using
      .type(model, delay=150) instead of .fill().
  - Release table: Angular Material (<mat-table>, <mat-row>,
      <mat-cell>). The release value's cell:
      "mat-cell.cdk-column-release" -- real inner text is the
      concatenation of a hidden mobile label + the value, e.g.
      "Release26.2R1", so JUNOS_VERSION_PATTERN strips out just the
      version-shaped substring rather than trusting the whole cell text.

UNVERIFIED: only tested against one real product (SRX300) via the
public path. Whether every Juniper product family uses this exact same
page structure, and whether the FIRST "Install Package" row is always
the most current release, are both assumptions carried forward from a
single real observation.
"""
from __future__ import annotations

import re
from typing import Optional

from firmware_lookup.providers.base import (
    BrowserAuthenticatedProvider, dump_debug_artifacts,
)
from firmware_lookup.result import (
    Confidence, FirmwareResult, cannot_determine, model_not_found, ok_result,
)
from firmware_lookup.versioning import is_update_available

PORTAL_URL = "https://support.juniper.net/support/downloads/"
HOME_URL = PORTAL_URL

# Real Junos version formats (e.g. "20.1R1", "18.4R1-S2", "15.1X49-D170",
# "26.2R1") -- deliberately specific so it can never match a date like
# "2026.07.12" the way a generic \d+\.\d+ pattern would.
JUNOS_VERSION_PATTERN = re.compile(r"\b\d{1,2}\.\d[RXF]\d{1,3}(?:-[SD]\d{1,3})?\b")


class JuniperProvider(BrowserAuthenticatedProvider):
    HOME_URL = HOME_URL

    def __init__(self):
        super().__init__("Juniper", PORTAL_URL)

    def check_public_source(
        self, vendor: str, model: str, current_version: str,
    ) -> Optional[FirmwareResult]:
        # VERIFIED LIVE (see module docstring): this works with zero
        # login for the common case. Runs its own throwaway headless
        # browser (no session needed) -- login only kicks in if this
        # returns None.
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

        # Only a real match is worth short-circuiting login for --
        # anything else (cannot_determine/model_not_found) should fall
        # through to the login path instead, in case it does better.
        if result is not None and result.status.value == "ok":
            return result
        return None

    def _search_and_extract(
        self, page, vendor: str, model: str, current_version: str,
    ) -> Optional[FirmwareResult]:
        """Shared real logic for both the anonymous (check_public_source)
        and authenticated (_extract_from_page) paths."""
        dump_path = None
        try:
            # CONFIRMED BUG (see module docstring): networkidle hit a
            # real 30s timeout in practice. domcontentloaded + an
            # explicit settle wait is the same fix already applied for
            # Dell/H3C/RUCKUS.
            page.goto(self.HOME_URL, wait_until="domcontentloaded", timeout=30000)
            page.wait_for_timeout(3000)
            dump_path = dump_debug_artifacts(page, vendor, "home")

            try:
                search_box = page.locator(
                    "input.form-control.search, input[placeholder='Type a product name']"
                ).first
                search_box.wait_for(state="visible", timeout=8000)
            except Exception:
                dump_path = dump_debug_artifacts(page, vendor, "no_search_box") or dump_path
                return cannot_determine(
                    vendor, model, current_version,
                    retrieval_method="public_browser",
                    reason=(
                        "No search box matched the verified selector on "
                        f"the real Juniper page. Debug artifacts: {dump_path or 'none'}."
                    ),
                    manual_check_url=self.PORTAL_URL,
                )

            # CONFIRMED BUG (see module docstring): .fill() never
            # triggered the autocomplete. Real per-keystroke typing does.
            search_box.click()
            search_box.type(model, delay=150)
            page.wait_for_timeout(1500)

            suggestion = page.locator("#prodList h4, h4[selectedproduct]").first
            try:
                suggestion.wait_for(state="visible", timeout=5000)
            except Exception:
                # CONFIRMED BUG, found live: the autocomplete is
                # genuinely intermittent -- the exact same model
                # succeeded on one run and produced no suggestion at
                # all on another, with no code change in between. One
                # retry (clear + re-type) before giving up honestly,
                # rather than a single unlucky timing window deciding
                # the whole result.
                try:
                    search_box.click()
                    search_box.fill("")
                    page.wait_for_timeout(300)
                    search_box.type(model, delay=150)
                    suggestion.wait_for(state="visible", timeout=6000)
                except Exception:
                    dump_path = dump_debug_artifacts(page, vendor, "no_suggestion") or dump_path
                    return model_not_found(
                        vendor, model, current_version, retrieval_method="public_browser",
                        manual_check_url=self.PORTAL_URL,
                    )

            try:
                suggestion.click(timeout=4000)
            except Exception:
                dump_path = dump_debug_artifacts(page, vendor, "no_suggestion") or dump_path
                return model_not_found(
                    vendor, model, current_version, retrieval_method="public_browser",
                    manual_check_url=self.PORTAL_URL,
                )

            try:
                page.wait_for_load_state("networkidle", timeout=8000)
            except Exception:
                pass
            page.wait_for_timeout(1000)

            # CONFIRMED BUG, found live (model=EX2300): the results page
            # can default to a non-Junos "OS" selection -- for EX2300 it
            # defaulted to "J-Web" (a management app, own version format
            # "25.2A1.1" that doesn't match real Junos versions at all)
            # instead of the actual device OS. Real markup: a custom
            # combobox (role="combobox") opens a listbox
            # (role="option") with real entries "J-Web", "Junos", "Junos
            # SR" etc. Best-effort: if a "Junos" option exists and isn't
            # already selected, switch to it before reading the release
            # table -- if it's not present, proceed with whatever OS is
            # already showing.
            try:
                # The listbox's options are only interactable once the
                # combobox is actually opened (verified live: the items
                # exist in the DOM but aren't clickable/visible before
                # this click) -- open it first, THEN look for "Junos".
                page.locator("[role='combobox']").first.click(timeout=3000)
                page.wait_for_timeout(500)
                junos_option = page.locator("[role='option'][title='Junos']").first
                if junos_option.is_visible(timeout=1500):
                    junos_option.click(timeout=3000)
                    page.wait_for_timeout(2000)
                else:
                    # No Junos option for this product -- close the
                    # dropdown without changing anything.
                    page.keyboard.press("Escape")
            except Exception:
                pass

            dump_path = dump_debug_artifacts(page, vendor, "results") or dump_path

            try:
                release_cell_text = page.locator(
                    "mat-cell.cdk-column-release"
                ).first.inner_text(timeout=4000)
            except Exception:
                release_cell_text = ""

            candidates = JUNOS_VERSION_PATTERN.findall(release_cell_text)
            if not candidates:
                # Fall back to scanning the whole results panel in case
                # the table structure differs for this product -- still
                # scoped to a Junos-shaped pattern, so this can't match
                # unrelated text.
                body_text = page.inner_text("body")
                candidates = JUNOS_VERSION_PATTERN.findall(body_text)
        except Exception as e:
            return cannot_determine(
                vendor, model, current_version,
                retrieval_method="public_browser",
                reason=f"Juniper lookup failed: {e}. Debug artifacts: {dump_path or 'none'}.",
                manual_check_url=self.PORTAL_URL,
            )

        if not candidates:
            return model_not_found(
                vendor, model, current_version, retrieval_method="public_browser",
                manual_check_url=self.PORTAL_URL,
            )

        latest_version = candidates[0].strip()
        return ok_result(
            vendor=vendor,
            model=model,
            current_version=current_version,
            latest_version=latest_version,
            source_url=self.HOME_URL,
            confidence=Confidence.HIGH,
            retrieval_method="public_browser",
            update_available=is_update_available(current_version, latest_version),
            message=(
                "Retrieved from Juniper's public downloads catalog -- no "
                "login required (verified live; login was previously "
                "assumed necessary but was never actually gating this "
                "page). Read from the real 'Install Package' release "
                "table for the matched product."
            ),
        )

    def _extract_from_page(
        self, page, vendor: str, model: str, current_version: str,
    ) -> FirmwareResult:
        # Login fallback path -- UNVERIFIED past the search box against
        # a real account (see module docstring: an earlier attempt hit
        # an account-registration dead end). Reuses the exact same
        # proven search logic as the public path, just running inside
        # an already-authenticated page instead of a throwaway one.
        result = self._search_and_extract(page, vendor, model, current_version)
        if result is not None:
            return result
        return cannot_determine(
            vendor, model, current_version,
            retrieval_method="authenticated_browser",
            reason="Juniper authenticated search found no result.",
            manual_check_url=self.PORTAL_URL,
        )
