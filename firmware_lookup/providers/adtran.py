"""
Adtran -- Tier 2, login-gated. Real public source investigated and
confirmed NOT to exist this session (not just an old/unverified guess).

VERIFIED LIVE this session: adtran.com's own support page links
"Software releases" to https://my.adtran.com/ -- a real login portal
("My Adtran Log In", Email + Password fields). Separately, the
public-looking search shell at
https://portal.adtran.com/web/url/software_mm ("Find Software for
Product", tabs: Product Line / Category / Part-CLEI number) does NOT
itself wall off search -- but following a real resolved product-family
URL from it (softwareFamilyId-based) returned, verbatim: "You must be
logged in to view this software." So the search UI is public, the
actual version/download data behind it is genuinely login-gated -- a
real, confirmed distinction, not an assumption.

Also checked supportcommunity.adtran.com (a Lithium/Khoros forum
Google indexes with real release-notes thread titles/URLs, e.g.
"ASE-4-4-45-Release-Notes") as a possible alternate public source --
confirmed live it returns a real 403 Forbidden (nginx) to both a
plain curl and a browser-UA curl, consistent with a genuine bot wall
rather than a false negative. Even if reachable, a community forum
thread isn't an authoritative "latest version" source anyway, so this
wasn't pursued further.

Real, confirmed current switch models (fetched directly from
adtran.com product pages, for reference/testing): NetVanta 1560
Series (1560-08/24/48), NetVanta 1570 Series, NetVanta 1760 Series.

Login flow: generic browser-assisted login via BrowserAuthenticatedProvider
(see providers/base.py) -- the same pattern proven, and debugged through
several rounds of real live bugs, for Cisco (see cisco.py's module
docstring).

VERIFIED LIVE END-TO-END this session, against a REAL Adtran account
(the user logged in with real credentials): the generic base-class
login flow (search box at HOME_URL) does NOT work for Adtran -- the
my.adtran.com dashboard has no search box at all, so it always failed
with "no search box matched." Traced the REAL path a human follows
instead:
  1. my.adtran.com's "Software Downloads" tile links to
     community.adtran.com (a separate Salesforce Community domain) --
     confirmed live this is genuine SSO (no second login prompt, the
     same account name appears immediately).
  2. community.adtran.com requires accepting a Terms of Use click-
     through -- confirmed live this can fire TWICE: once for the
     community login itself, and a SEPARATE one specifically for
     /s/software-downloads (likely an export-control agreement for
     firmware specifically).
  3. The real Software Downloads page is a Salesforce Lightning tree
     (NOT a flat list, NOT full-text searchable via the page's own
     global search -- confirmed live the global search explicitly says
     "For Software Downloads, see the Software Downloads page above").
     Its own local "Search Menu..." filter DOES work, confirmed live:
     typing "1560" correctly surfaced "NetVanta Software > NetVanta
     1500 > NetVanta 1560 > NetVanta 1560-08/24/48" -- note the real,
     non-obvious nesting (1560 files under the 1500 category, not its
     own top-level entry), which is exactly why a live tree search is
     used here instead of guessing a URL/category pattern.
  4. Clicking the exact leaf node (e.g. "NetVanta 1560-24") loads a
     real "Current Release" table, confirmed live with real markup:
       <table><tr><th>Version</th><th>Release Date</th>...</tr>
       <tr><td>4.4-50</td><td>12/17/25</td>...</tr></table>
     followed by a separate "Archived Releases" table with the same
     shape -- the FIRST real data row (skipping the <th> header row)
     under "Current Release" specifically is the current version.

***HONESTY FLAG***: the login mechanism, terms-acceptance handling,
and tree-search extraction are now REAL and tested against a live
account for one model. Model-to-tree-item matching is a live text
search + containment match (not a hardcoded URL), so it should
generalize to other NetVanta models, but has only been proven for the
NetVanta 1560 family so far.
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

PORTAL_URL = "https://portal.adtran.com/web/url/software_mm"
HOME_URL = "https://my.adtran.com/"

SOFTWARE_DOWNLOADS_URL = "https://community.adtran.com/s/software-downloads"

# Real markup, verified live: the "Current Release" table's first real
# data row (the header row uses <th>, never matched by this <td>-only
# pattern, so it's naturally skipped).
_CURRENT_RELEASE_ROW_RE = re.compile(
    r"Current Release.*?<tbody[^>]*>.*?<tr[^>]*>\s*"
    r"<td[^>]*>([^<]+)</td>\s*<td[^>]*>([^<]+)</td>",
    re.DOTALL,
)


class AdtranProvider(BrowserAuthenticatedProvider):
    HOME_URL = HOME_URL

    def __init__(self):
        super().__init__("Adtran", PORTAL_URL)

    def check_public_source(
        self, vendor: str, model: str, current_version: str,
    ) -> Optional[FirmwareResult]:
        # Confirmed live this session (see module docstring): the real
        # software-download content is genuinely login-gated, not just
        # unverified. Always falls through to login.
        return None

    def _accept_terms_if_present(self, page) -> None:
        """Confirmed live this can appear twice (community login, then
        again specifically for software-downloads) -- best-effort,
        never raises if it's not there."""
        try:
            btn = page.locator("button", has_text="Accept").first
            if btn.is_visible(timeout=3000):
                btn.click()
                page.wait_for_timeout(2000)
        except Exception:
            pass

    def _extract_from_page(
        self, page, vendor: str, model: str, current_version: str,
    ) -> FirmwareResult:
        if not model:
            return cannot_determine(
                vendor, model, current_version,
                retrieval_method="authenticated_browser",
                reason="No model given.",
                manual_check_url=PORTAL_URL,
            )

        dump_path = None
        try:
            page.goto(SOFTWARE_DOWNLOADS_URL, wait_until="domcontentloaded", timeout=20000)
            page.wait_for_timeout(2000)
            self._accept_terms_if_present(page)
            self._accept_terms_if_present(page)  # confirmed live: can fire a 2nd time

            search_box = page.locator("input[placeholder='Search Menu...']").first
            search_box.wait_for(state="visible", timeout=8000)
        except Exception as e:
            dump_path = dump_debug_artifacts(page, vendor, "load_failed")
            return cannot_determine(
                vendor, model, current_version,
                retrieval_method="authenticated_browser",
                reason=(
                    f"Adtran's Software Downloads page (or its login "
                    f"terms step) did not behave as expected: {e}. "
                    f"Debug artifacts: {dump_path or 'none'}."
                ),
                manual_check_url=PORTAL_URL,
            )

        # A password field here means the community SSO itself failed
        # (stale/invalid my.adtran.com session).
        try:
            from firmware_lookup.browser_login import _password_field_visible
            if _password_field_visible(page):
                dump_path = dump_debug_artifacts(page, vendor, "stale_session")
                self.session_manager.invalidate_session()
                return auth_required(
                    vendor, model, current_version,
                    manual_check_url=PORTAL_URL,
                )
        except Exception:
            pass

        search_box.fill(model)
        page.wait_for_timeout(1500)

        # Confirmed live: the filtered tree can list multiple related
        # leaves (e.g. searching "1560" surfaces 1560-08/24/48 plus
        # their parent category nodes) -- click the leaf whose own text
        # is the closest real match to what was typed, never the first
        # node found.
        norm_model = model.strip().lower()
        leaf_locator = page.locator("a, span").filter(has_text=re.compile(re.escape(model.strip()), re.IGNORECASE))
        matched = None
        for i in range(leaf_locator.count()):
            el = leaf_locator.nth(i)
            try:
                if not el.is_visible():
                    continue
                text = el.inner_text().strip()
            except Exception:
                continue
            if text.lower() == norm_model or norm_model in text.lower():
                matched = el
                if text.lower() == norm_model:
                    break  # exact match wins outright

        if matched is None:
            dump_path = dump_debug_artifacts(page, vendor, "no_tree_match")
            return model_not_found(
                vendor, model, current_version,
                retrieval_method="authenticated_browser",
                manual_check_url=PORTAL_URL,
            )

        try:
            matched.click(timeout=5000)
            page.wait_for_timeout(2500)
        except Exception as e:
            dump_path = dump_debug_artifacts(page, vendor, "tree_click_failed")
            return cannot_determine(
                vendor, model, current_version,
                retrieval_method="authenticated_browser",
                reason=f"Found a matching tree item but couldn't click it: {e}.",
                manual_check_url=PORTAL_URL,
            )

        dump_path = dump_debug_artifacts(page, vendor, "release_table") or dump_path
        html = page.content()
        row_match = _CURRENT_RELEASE_ROW_RE.search(html)
        if not row_match:
            return model_not_found(
                vendor, model, current_version,
                retrieval_method="authenticated_browser",
                manual_check_url=PORTAL_URL,
            )
        latest_version = row_match.group(1).strip()
        release_date = row_match.group(2).strip()

        return ok_result(
            vendor=vendor,
            model=model,
            current_version=current_version,
            latest_version=latest_version,
            source_url=page.url,
            confidence=Confidence.HIGH,
            retrieval_method="authenticated_browser",
            update_available=is_update_available(current_version, latest_version),
            message=(
                "Retrieved via an authenticated Adtran Community "
                f"session -- Current Release table, released "
                f"{release_date}."
            ),
        )
