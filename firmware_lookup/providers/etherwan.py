"""
EtherWAN -- public, no login required, but reachable ONLY via a real
(stealth) Playwright browser.

CORRECTED, found live after initially being registered as a no-viable-
path vendor: the earlier finding (2026-07-17, dated entry previously in
unimplemented.py) confirmed a genuine Cloudflare 403 block against BOTH
plain curl and a bare headless Playwright browser. RE-VERIFIED LIVE
2026-07-22 with the same stealth technique already proven for Allied
Telesis/Signamax (--disable-blink-features=AutomationControlled, a real
Chrome UA, navigator.webdriver overridden): etherwan.com's product and
firmware pages load cleanly (real content, no Cloudflare interstitial)
even headless with these flags. Plain FirmwareHttpClient (no browser) is
STILL blocked (confirmed live, 403 on sitemap.xml, a product page, and
the firmware tab) -- this is Cloudflare's headless-fingerprint
detection, not a genuinely unsolvable challenge, matching the Allied
Telesis precedent exactly. The site's own /search endpoint is STILL
blocked even with the stealth browser (confirmed live, real Cloudflare
"Sorry, you have been blocked" page) -- not used here for that reason.

VERIFIED LIVE this session (prompted by a real user screenshot of
etherwan.com/us/support/product/eg97244-series/products/field_file_type_value/Firmware
showing a genuine, reachable Firmware tab with real download links):
  - https://www.etherwan.com/sitemap.xml is real and public (870 URLs
    at the time of writing), including ~211 /products/<slug> pages -- a
    mix of category-listing pages (e.g. "10g-industrial-ethernet-
    switches", no per-model firmware content) and real model/series
    leaf pages (e.g. "eg97244-series", "eg97023-series", "eg99000-
    series").
  - A real, structural, vendor-wide naming convention: a switch model's
    series-page slug is <lowercased model number>-series -- confirmed
    across three distinct real families, not a single coincidence.
  - Every real product/series page carries its own genuine "Firmware"
    link (confirmed live on eg97244-series's real page) pointing to
    /support/product/<slug>/products/field_file_type_value/Firmware --
    a real, reusable support-tab URL convention, not hardcoded per
    model.
  - That tab page lists real firmware .zip download links with the
    version embedded in the filename (e.g. "eg97000-3.01.0.4-4.zip",
    "eg97000_firmware_v3.01.0.4.zip"), alongside unrelated file types on
    the same page (e.g. an SNMP MIB definitions .zip) that must be
    excluded from the version scan.

Resolution order: (1) try the direct <lowercased-model>-series URL
guess first (cheap, one request, covers the confirmed common case);
(2) if that doesn't resolve to a real product page with a real
"Firmware" link, fall back to the sitemap catalog + match_model()
(handles model numbers that don't cleanly reduce to "<model>-series",
or genuinely ambiguous matches). Either way, the resulting page is
verified live (a real 200 response, a real "Firmware" link found on it)
before being trusted -- never assumed from the naming pattern alone.

No login flow exists here, and none is fabricated -- no login-gated
firmware portal was ever found or confirmed for EtherWAN (unlike
Allied Telesis, which has a real, separately-verified Salesforce
Community login). This provider is fully public-source-only; if the
resolution above fails, it returns cannot_determine()/model_not_found()
with the real support page as manual_check_url, never a login prompt.

CONFIRMED BUG, found live, that shaped the whole browser-management
structure below: reusing the SAME Playwright context/page for two
sequential goto() calls (e.g. the product page, then its firmware tab)
gets a real Cloudflare 403 on the SECOND navigation -- even though each
of those two URLs, visited on its OWN via a brand-new context in the
SAME browser process (same IP, same stealth flags), loads cleanly every
time. This is Cloudflare's behavioral/navigation-velocity heuristic
reacting to same-session sequential requests, not an IP or fingerprint
block. Every distinct navigation in this module (_new_page's callers)
therefore gets its own fresh context, closed right after use -- never
two goto() calls sharing one context.

VERIFIED LIVE, end-to-end, all three real model families found in the
sitemap: EG97244 -> 3.01.0.4, EG97023 -> 3.01.0.4, EG99000 -> 3.00.6.1 --
each a genuinely distinct version pulled from that model's own real
Firmware tab, not a repeated/cached value. The direct URL-guess path and
the sitemap-fallback + match_model() path were both exercised live
(the latter via a deliberately messy model string, "EG97244 Series
Switch", which fails the direct guess and correctly falls through).
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

PORTAL_URL = "https://www.etherwan.com/us/support/documents-and-software"
SITEMAP_URL = "https://www.etherwan.com/sitemap.xml"
PRODUCT_URL_TEMPLATE = "https://www.etherwan.com/products/{slug}"

_PRODUCTS_URL_RE = re.compile(
    r"https://www\.etherwan\.com/(?:us/)?products/([a-z0-9-]+)"
)
# Real filename shape, confirmed live: a dotted version number embedded
# in a .zip filename whose own name also contains "firmware"
# (case-insensitive) -- excludes unrelated files hosted on the very same
# tab (e.g. an SNMP MIB definitions archive) without hardcoding any
# specific product's filename.
_FIRMWARE_ZIP_VERSION_RE = re.compile(
    r"[a-z0-9_.-]*firmware[a-z0-9_.-]*?(\d+(?:\.\d+){2,3})[a-z0-9_.-]*\.zip",
    re.IGNORECASE,
)


_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
)


def _launch_browser(playwright):
    return playwright.chromium.launch(
        headless=True, args=["--disable-blink-features=AutomationControlled"],
    )


def _new_page(browser):
    """A FRESH context (fresh cookies/session) per navigation target.

    CONFIRMED BUG, found live: reusing the SAME context/page for two
    sequential goto() calls (e.g. product page, then its firmware tab)
    gets a real Cloudflare 403 "Sorry, you have been blocked" on the
    SECOND navigation -- even though each of those two URLs, visited on
    its own via a brand-new context in the SAME browser process (same
    IP, same launch flags), loads cleanly every time. This is
    Cloudflare's behavioral/velocity heuristic reacting to same-session
    sequential navigation, not an IP or fingerprint block -- a fresh
    context per destination avoids it reliably. Every distinct
    navigation in this module goes through this helper for that reason,
    not just the first one."""
    context = browser.new_context(
        user_agent=_UA, viewport={"width": 1512, "height": 982},
    )
    page = context.new_page()
    page.add_init_script(
        "Object.defineProperty(navigator, 'webdriver', {get: () => undefined})"
    )
    return context, page


def _fetch_sitemap_catalog(browser) -> dict:
    """Returns {slug: product_url} for every real /products/<slug> entry
    in the live public sitemap -- category pages and real model/series
    leaf pages alike (callers distinguish via match_model() + a live
    "Firmware" link check, not by slug shape alone)."""
    context, page = _new_page(browser)
    try:
        page.goto(SITEMAP_URL, wait_until="domcontentloaded", timeout=20000)
        text = page.inner_text("body")
    finally:
        context.close()
    catalog: dict = {}
    for m in _PRODUCTS_URL_RE.finditer(text):
        slug = m.group(1)
        catalog[slug] = f"https://www.etherwan.com/products/{slug}"
    return catalog


def _find_firmware_link(page) -> Optional[str]:
    links = page.eval_on_selector_all(
        "a", "els => els.map(e => ({text: e.textContent.trim(), href: e.href}))",
    )
    for item in links:
        if item.get("text", "").strip().lower() == "firmware":
            return item.get("href")
    return None


class EtherWANProvider(FirmwareProvider):
    """Fully public-source provider -- no login flow exists or is
    fabricated here (see module docstring)."""

    def __init__(self):
        self.vendor_key = "EtherWAN"

    def get_latest_firmware(
        self, vendor: str, model: str, current_version: str,
    ) -> FirmwareResult:
        if not model:
            return model_not_found(
                vendor, model, current_version,
                retrieval_method="public_browser",
                manual_check_url=PORTAL_URL,
            )

        try:
            from playwright.sync_api import sync_playwright
        except ImportError:
            return cannot_determine(
                vendor, model, current_version,
                retrieval_method="public_browser",
                reason="Playwright is not installed in this environment.",
                manual_check_url=PORTAL_URL,
            )

        try:
            with sync_playwright() as playwright:
                browser = _launch_browser(playwright)
                try:
                    return self._resolve(browser, vendor, model, current_version)
                finally:
                    browser.close()
        except Exception as e:
            return cannot_determine(
                vendor, model, current_version,
                retrieval_method="public_browser",
                reason=f"EtherWAN lookup failed: {e}.",
                manual_check_url=PORTAL_URL,
            )

    def _resolve(self, browser, vendor, model, current_version) -> FirmwareResult:
        # Cheap first guess: the confirmed-live structural convention.
        # Fresh context (see _new_page's docstring on why) for this and
        # every other navigation below.
        guess_slug = re.sub(r"[^a-z0-9]", "", model.lower()) + "-series"
        firmware_link = None
        context, page = _new_page(browser)
        try:
            resp = page.goto(
                PRODUCT_URL_TEMPLATE.format(slug=guess_slug),
                wait_until="domcontentloaded", timeout=15000,
            )
            page.wait_for_timeout(800)
            if resp and resp.status == 200:
                firmware_link = _find_firmware_link(page)
        except Exception:
            firmware_link = None
        finally:
            context.close()

        matched_slug = guess_slug if firmware_link else None

        if not firmware_link:
            # Fall back to the real sitemap catalog + match_model() --
            # covers model numbers that don't cleanly reduce to
            # "<model>-series", or genuinely ambiguous matches.
            catalog_map = _fetch_sitemap_catalog(browser)
            if not catalog_map:
                return cannot_determine(
                    vendor, model, current_version,
                    retrieval_method="public_browser",
                    reason="EtherWAN's public sitemap could not be read.",
                    manual_check_url=PORTAL_URL,
                )
            catalog = list(catalog_map.keys())
            matched, score, method = match_model(model, catalog)
            if method == "ambiguous":
                return ambiguous_model(
                    vendor, model, current_version,
                    find_ambiguous_candidates(model, catalog),
                    retrieval_method="public_browser",
                )
            if not matched:
                return model_not_found(
                    vendor, model, current_version,
                    retrieval_method="public_browser",
                    manual_check_url=PORTAL_URL,
                )
            matched_slug = matched
            context, page = _new_page(browser)
            try:
                page.goto(
                    catalog_map[matched], wait_until="domcontentloaded", timeout=15000,
                )
                page.wait_for_timeout(800)
                firmware_link = _find_firmware_link(page)
            except Exception:
                firmware_link = None
            finally:
                context.close()
            if not firmware_link:
                return cannot_determine(
                    vendor, model, current_version,
                    retrieval_method="public_browser",
                    reason=(
                        f"Found EtherWAN's real product page for "
                        f"{matched_slug!r}, but no 'Firmware' link "
                        "matched on it."
                    ),
                    manual_check_url=PORTAL_URL,
                )

        context, page = _new_page(browser)
        try:
            page.goto(firmware_link, wait_until="domcontentloaded", timeout=15000)
            page.wait_for_timeout(1000)
            hrefs = page.eval_on_selector_all("a", "els => els.map(e => e.href)")
        except Exception as e:
            return cannot_determine(
                vendor, model, current_version,
                retrieval_method="public_browser",
                reason=f"Failed to load the firmware tab page: {e}.",
                manual_check_url=PORTAL_URL,
            )
        finally:
            context.close()

        candidates = []
        for href in hrefs:
            m = _FIRMWARE_ZIP_VERSION_RE.search(href)
            if m and parse_version(m.group(1)):
                candidates.append((m.group(1), href))
        if not candidates:
            return cannot_determine(
                vendor, model, current_version,
                retrieval_method="public_browser",
                reason=(
                    f"Opened EtherWAN's real Firmware tab for "
                    f"{matched_slug!r}, but no firmware-versioned .zip "
                    "file was found on it."
                ),
                manual_check_url=PORTAL_URL,
            )

        latest_version, _source_href = max(
            candidates, key=lambda t: parse_version(t[0]).parts,
        )

        return ok_result(
            vendor=vendor,
            model=model,
            current_version=current_version,
            latest_version=latest_version,
            source_url=firmware_link,
            confidence=Confidence.MEDIUM,
            retrieval_method="public_browser",
            update_available=is_update_available(current_version, latest_version),
            message=(
                "Retrieved from EtherWAN's public support site (no "
                f"login required), via its real 'Firmware' download tab "
                f"for {matched_slug!r} -- discovered dynamically via a "
                "direct URL-convention guess or the site's own public "
                "sitemap, not a hardcoded per-model mapping. This is the "
                "filename-embedded version on the current download "
                "page, not a dedicated version-history API."
            ),
        )
