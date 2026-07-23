import time

import pytest

from firmware_lookup.providers.arista import AristaProvider
from firmware_lookup.providers.cisco import CiscoProvider, CiscoSessionManager


@pytest.fixture
def isolated_session_dir(tmp_path, monkeypatch):
    import firmware_lookup.session as session_mod
    monkeypatch.setattr(session_mod, "SESSION_DIR", tmp_path)
    return tmp_path


@pytest.fixture(autouse=True)
def no_live_browser_calls(monkeypatch):
    """Cisco's check_public_source() (see providers/cisco.py) makes a
    REAL Playwright browser call for Catalyst 9200/9300/9400/9500/9600
    models before falling back to login -- same pattern as Aruba/Juniper/
    etc elsewhere in this suite. Autouse + raising immediately keeps
    every test in this file fast and deterministic (no live network
    calls) while still exercising the real fallback-to-login code path,
    since check_public_source() catches this and returns None either
    way."""
    import playwright.sync_api as sync_api_mod

    def fake_sync_playwright():
        raise RuntimeError("no live browser calls in tests")

    monkeypatch.setattr(sync_api_mod, "sync_playwright", fake_sync_playwright)


def test_no_session_returns_auth_required(isolated_session_dir):
    p = CiscoProvider()
    r = p.get_latest_firmware("Cisco", "Catalyst 9300", "17.3.4")
    assert r.status.value == "auth_required"
    assert "authentication or support entitlement required" in r.message


def test_check_public_source_empty_model_returns_none():
    """No model given -- can't derive a family slug at all -- must fall
    through to login without attempting a browser call."""
    p = CiscoProvider()
    assert p.check_public_source("Cisco", "", "1.0") is None


def test_derive_family_slug():
    """CONFIRMED real finding: search-based discovery is unreliable for
    'what's the latest' (search relevance doesn't correlate with
    recency -- see module docstring). The reliable mechanism is a real,
    structural URL convention verified live for both Catalyst and Nexus
    -- this derives the family slug from WHATEVER family number is in
    the model string, not a fixed table, so an unverified-but-plausible
    model like "Catalyst 3850" or "Nexus 5548" still gets a real,
    structurally-grounded attempt (verified live before ever being
    trusted -- see check_public_source) rather than being skipped
    outright the way a fixed allow-list would."""
    from firmware_lookup.providers.cisco import _derive_family_slug

    assert _derive_family_slug("Catalyst 9300") == "catalyst-9300"
    assert _derive_family_slug("C9300-24T") == "catalyst-9300"
    assert _derive_family_slug("Catalyst 3850") == "catalyst-3850"
    assert _derive_family_slug("Nexus 9300") == "nexus-9000"
    assert _derive_family_slug("N9K-C93180YC-EX") == "nexus-9000"
    assert _derive_family_slug("Nexus 7018") == "nexus-7000"
    assert _derive_family_slug("Nexus 5548") == "nexus-5000"
    assert _derive_family_slug("Nexus 3048") == "nexus-3000"
    assert _derive_family_slug("") is None
    assert _derive_family_slug("ASR1001-X") is None
    assert _derive_family_slug("ASA5525-X") is None


def test_list_link_and_mode_heading_parse_real_markup_shape():
    """Regression guard for the real markup found live: both Catalyst's
    and Nexus's release-notes list pages use an (almost) identical
    `<a data-id="linkN" class="" href="...">TITLE</a>` pattern -- just a
    different link-number suffix -- matched generically here rather than
    hardcoded to one page's exact number. Also confirms the Nexus-only
    'in NX-OS Mode' section heading is detected so ACI-mode entries
    elsewhere on the same page are never accidentally matched instead."""
    from firmware_lookup.providers.cisco import (
        _LIST_LINK_RE, _NXOS_MODE_HEADING_RE,
    )

    catalyst_html = (
        '<li><a data-id="link3" class="" href="https://x/26-1.html">'
        "Release Notes for Cisco Catalyst 9300 Series Switches, "
        "Cisco IOS XE 26.1.x</a></li>"
    )
    match = _LIST_LINK_RE.search(catalyst_html)
    assert match.groups() == (
        "https://x/26-1.html",
        "Release Notes for Cisco Catalyst 9300 Series Switches, "
        "Cisco IOS XE 26.1.x",
    )

    nexus_html = (
        '<div class="heading">Release Notes for Cisco Nexus 9000 Series '
        "Switches in ACI Mode</div>"
        '<li><a data-id="link4" class="" href="https://x/aci.html">'
        "Cisco Nexus 9000 Series ACI-Mode Switches Release Notes, "
        "Release 16.2(2)</a></li>"
        '<div class="heading">Release Notes for Cisco Nexus 9000 Series '
        "Switches in NX-OS Mode</div>"
        '<li><a data-id="link4" class="" href="https://x/nxos.html">'
        "Cisco Nexus 9000 Series NX-OS Release Notes, "
        "Release 10.6(3)F</a></li>"
    )
    heading = _NXOS_MODE_HEADING_RE.search(nexus_html)
    assert heading is not None
    scoped = nexus_html[heading.start():]
    scoped_match = _LIST_LINK_RE.search(scoped)
    assert scoped_match.groups() == (
        "https://x/nxos.html",
        "Cisco Nexus 9000 Series NX-OS Release Notes, Release 10.6(3)F",
    )


def test_extract_title_version():
    """Real title shapes found live across three different Cisco product
    lines: Nexus's "... Release 8.3" / "... Release 10.6(3)F" and
    Catalyst's "... Cisco IOS XE 17.18.x" (no literal "Release" keyword
    at all) -- the version is always the LAST version-shaped token in
    the title, so this is not anchored to one specific phrasing (that
    would only cover the exact strings already observed, defeating the
    point of being generic across whatever product a user searches
    for). Also confirms a bare, patch-less "8.x" train reference (no
    real digit after the dot) correctly yields no match, rather than a
    fabricated "8" or "8.x" answer."""
    from firmware_lookup.providers.cisco import _extract_title_version

    assert _extract_title_version(
        "Cisco Nexus 7000 Series NX-OS Release Notes, Release 8.3",
    ) == "8.3"
    assert _extract_title_version(
        "Cisco Nexus 9000 Series NX-OS Release Notes, Release 10.6(3)F",
    ) == "10.6(3)F"
    assert _extract_title_version(
        "Release Notes for Cisco Catalyst 9300 Series Switches, "
        "Cisco IOS XE 17.18.x",
    ) == "17.18"
    assert _extract_title_version(
        "Cisco Nexus 7000 Series NX-OS Release Notes, Release 8.x",
    ) is None
    assert _extract_title_version("No version here at all") is None


def test_change_history_table_parses_real_markup_shape():
    """Regression guard for the real markup found live: a <table> with
    a 'Document Change History' caption whose first data row is the
    newest dated patch -- tried opportunistically against whatever page
    a search result points to, not gated to one specific product family.
    Exercises the actual parsing regex against a minimal fixture shaped
    exactly like the real page, without any browser or network call."""
    from firmware_lookup.providers.cisco import _CHANGE_HISTORY_ROW_RE

    notes_html = (
        '<tbody class="tbody">\n<tr>\n'
        '<td class="entry"><p class="p">April 15, 2026</p></td>\n'
        '<td class="entry"><p class="p">17.18.3</p></td>\n'
        "</tr>"
    )
    row = _CHANGE_HISTORY_ROW_RE.search(notes_html)
    assert row.groups() == ("April 15, 2026", "17.18.3")


def test_check_public_source_missing_playwright_returns_none_not_raise(monkeypatch):
    import builtins
    real_import = builtins.__import__

    def fake_import(name, *args, **kwargs):
        if name == "playwright.sync_api" or name.startswith("playwright"):
            raise ImportError("no playwright")
        return real_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", fake_import)
    p = CiscoProvider()
    assert p.check_public_source("Cisco", "Catalyst 9300", "17.3.4") is None


def test_check_public_source_unexpected_browser_error_never_raises():
    # no_live_browser_calls (autouse) already makes sync_playwright()
    # raise -- confirms check_public_source() catches it and returns
    # None instead of propagating.
    p = CiscoProvider()
    assert p.check_public_source("Cisco", "Catalyst 9300", "17.3.4") is None


def test_untouched_login_gated_vendor_still_auth_required(isolated_session_dir):
    """Regression guard: adding the authenticated_lookup hook to the base
    class must not change behavior for the other login-gated vendors
    without a real login() implementation. (Juniper used to be the
    example here -- removed after real live evidence proved it's
    actually a Tier-1 public source, not login-gated at all; see
    providers/juniper.py's module docstring.)"""
    p = AristaProvider()
    r = p.get_latest_firmware("Arista", "DCS-7050SX3-48YC8", "4.28.0F")
    assert r.status.value == "auth_required"


def test_looks_authenticated_heuristic():
    # The real bug this test guards against: software.cisco.com serves a
    # 403 AT THE SAME URL when unauthenticated (verified live) -- a
    # same-URL check must not be fooled by that, or "login" would always
    # report false-positive success with zero real authentication.
    mgr = CiscoSessionManager("Cisco")
    assert mgr._is_authenticated("https://software.cisco.com/download/home", 403) is False
    assert mgr._is_authenticated("https://software.cisco.com/download/home", 401) is False
    assert mgr._is_authenticated("https://software.cisco.com/download/home", 200) is True
    assert mgr._is_authenticated("https://idp.cisco.com/idp/sso", 200) is False
    assert mgr._is_authenticated("https://sso.cisco.com/auth", 200) is False
    assert mgr._is_authenticated("https://software.cisco.com/login", 200) is False
    # Widened markers (found necessary live: account-creation pages
    # don't contain "login"/"signin" at all).
    assert mgr._is_authenticated("https://id.cisco.com/register", 200) is False


def test_valid_session_reaches_authenticated_lookup(isolated_session_dir, monkeypatch):
    """With a valid (mocked) session present, get_latest_firmware should
    call authenticated_lookup rather than returning auth_required."""
    p = CiscoProvider()
    # Set the in-memory session data directly (bypassing file
    # encryption, which is covered separately in test_session.py) so
    # is_session_valid() short-circuits without needing a passphrase --
    # this test is only about the wiring in get_latest_firmware, and
    # also needs a session file to exist so ensure_session() doesn't
    # short-circuit on "no file at all".
    p.session_manager.session_file.parent.mkdir(parents=True, exist_ok=True)
    p.session_manager.session_file.write_text("{}")
    p.session_manager._session_data = {
        "expires_at": time.time() + 3600, "storage_state": {"cookies": []},
    }

    called = {}

    def fake_authenticated_lookup(vendor, model, current_version, session):
        called["session"] = session
        from firmware_lookup.result import ok_result
        from firmware_lookup.result import Confidence
        return ok_result(vendor, model, current_version, "17.12.5",
                          "https://software.cisco.com", Confidence.MEDIUM, "authenticated_browser")

    monkeypatch.setattr(p, "authenticated_lookup", fake_authenticated_lookup)
    r = p.get_latest_firmware("Cisco", "Catalyst 9300", "17.3.4")
    assert r.status.value == "ok"
    assert r.latest_version == "17.12.5"


def test_credential_resolution_prefers_env_vars(isolated_session_dir, monkeypatch):
    monkeypatch.setenv("CISCO_USERNAME", "env-user")
    monkeypatch.setenv("CISCO_PASSWORD", "env-pass")
    mgr = CiscoSessionManager("Cisco")
    # Even with stored credentials present, env vars should win (and no
    # prompt/passphrase should be needed to decide that).
    username, password = mgr._resolve_credentials()
    assert (username, password) == ("env-user", "env-pass")


def test_credential_resolution_falls_back_to_stored(isolated_session_dir, monkeypatch):
    monkeypatch.delenv("CISCO_USERNAME", raising=False)
    monkeypatch.delenv("CISCO_PASSWORD", raising=False)
    mgr = CiscoSessionManager("Cisco")
    mgr._passphrase = "test-pass"
    mgr.save_credentials("stored-user", "stored-pass")

    mgr2 = CiscoSessionManager("Cisco")
    mgr2._passphrase = "test-pass"
    username, password = mgr2._resolve_credentials()
    assert (username, password) == ("stored-user", "stored-pass")


def test_credential_resolution_prompts_and_saves_when_nothing_stored(
    isolated_session_dir, monkeypatch,
):
    monkeypatch.delenv("CISCO_USERNAME", raising=False)
    monkeypatch.delenv("CISCO_PASSWORD", raising=False)
    monkeypatch.setattr("sys.stdin.isatty", lambda: True)
    monkeypatch.setattr("builtins.input", lambda prompt="": "typed-user")
    monkeypatch.setattr(
        "firmware_lookup.session.getpass", lambda prompt="": "typed-pass",
    )
    mgr = CiscoSessionManager("Cisco")
    mgr._passphrase = "test-pass"

    username, password = mgr._resolve_credentials()
    assert (username, password) == ("typed-user", "typed-pass")

    # Saved for next time -- a fresh manager instance should now find it
    # without prompting again.
    monkeypatch.setattr(
        "builtins.input", lambda prompt="": (_ for _ in ()).throw(AssertionError("should not prompt again")),
    )
    mgr2 = CiscoSessionManager("Cisco")
    mgr2._passphrase = "test-pass"
    assert mgr2._resolve_credentials() == ("typed-user", "typed-pass")


def test_credential_resolution_never_hangs_without_a_terminal(
    isolated_session_dir, monkeypatch,
):
    """Regression guard for a real bug found live: plain input() does
    NOT reliably raise EOFError with no interactive terminal attached
    the way getpass() does -- it can hang forever. Confirm the isatty()
    guard skips the prompt entirely (and never calls input()) instead of
    risking that hang."""
    monkeypatch.delenv("CISCO_USERNAME", raising=False)
    monkeypatch.delenv("CISCO_PASSWORD", raising=False)
    monkeypatch.setattr("sys.stdin.isatty", lambda: False)
    monkeypatch.setattr(
        "builtins.input", lambda prompt="": (_ for _ in ()).throw(AssertionError("must not call input() without a tty")),
    )
    mgr = CiscoSessionManager("Cisco")
    mgr._passphrase = "test-pass"

    assert mgr._resolve_credentials() == (None, None)


def test_login_passes_resolved_credentials_as_prefill(isolated_session_dir, monkeypatch):
    """login() must hand (username, password) through to
    run_browser_login as `prefill` when credentials resolve, and None
    when they don't -- this is the actual wiring the feature depends on."""
    mgr = CiscoSessionManager("Cisco")
    monkeypatch.setattr(mgr, "_resolve_credentials", lambda: ("u", "p"))

    captured = {}

    def fake_run_browser_login(home_url, check_url, is_auth, *, prefill=None, **kw):
        captured["prefill"] = prefill
        return {"cookies": []}

    monkeypatch.setattr(
        "firmware_lookup.browser_login.run_browser_login", fake_run_browser_login,
    )
    mgr.login()
    assert captured["prefill"] == ("u", "p")


def test_undecryptable_session_degrades_to_auth_required_not_crash(
    isolated_session_dir, monkeypatch,
):
    """Regression guard for a real bug found via the web test UI: a
    session FILE can exist on disk while THIS process/instance has no
    passphrase cached (e.g. a fresh process, or a web login that used a
    different manager instance than the one lookups actually use).
    ensure_session() raising in that case must degrade to
    auth_required(), never crash the whole lookup with a raw internal
    error."""
    p = CiscoProvider()
    # A session file exists...
    p.session_manager.session_file.parent.mkdir(parents=True, exist_ok=True)
    p.session_manager.session_file.write_text('{"salt": "AA==", "ciphertext": "AA=="}')
    # ...but this instance has no cached _session_data AND no interactive
    # terminal to prompt through -- simulate exactly that EOFError path.
    def _raise_eof(*a, **kw):
        raise EOFError()
    monkeypatch.setattr("firmware_lookup.session.getpass", _raise_eof)

    r = p.get_latest_firmware("Cisco", "Catalyst 9300", "17.3.4")
    assert r.status.value == "auth_required"
