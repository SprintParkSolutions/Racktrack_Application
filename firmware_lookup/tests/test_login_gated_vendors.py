"""
Tests for the vendors given a generic browser-assisted login flow
(Arista, Aruba, Dell, Extreme, H3C, Huawei, Juniper, Nokia, RUCKUS),
built by generalizing what was proven -- and debugged through several
rounds of real live bugs -- for Cisco specifically (see
providers/cisco.py's module docstring, and test_cisco.py for the
detailed regression tests of each of those bugs).

Juniper was REMOVED from this list once (after live evidence showed
login wasn't required for the common case) and then ADDED BACK
2026-07-16 as a login FALLBACK: a real live networkidle timeout proved
the public-only version had nowhere to go on failure. It keeps its own
check_public_source() (tested in test_juniper.py) as the fast, no-login
common path -- login only kicks in if that fails, same pattern now also
used by Aruba, H3C, and RUCKUS (each has real check_public_source()
logic of its own, tested in their own dedicated test files; these
generic tests only cover the shared login-gated wiring).

These providers are UNVERIFIED against real accounts for the vendors
that have no confirmed working login yet (no test credentials
available) -- these tests confirm the WIRING is correct (registered,
inherits the right base, degrades safely with no session) using the
same mocking approach as everywhere else in this suite, not that every
real login flow works end-to-end.
"""
import pytest

from firmware_lookup.providers.adtran import AdtranProvider
from firmware_lookup.providers.advantech import AdvantechProvider
from firmware_lookup.providers.aerohive import AerohiveProvider
from firmware_lookup.providers.alcatel_lucent_enterprise import (
    AlcatelLucentEnterpriseProvider,
)
from firmware_lookup.providers.allied_telesis import AlliedTelesisProvider
from firmware_lookup.providers.amg_systems import AmgSystemsProvider
from firmware_lookup.providers.araknis_networks import AraknisNetworksProvider
from firmware_lookup.providers.arista import AristaProvider
from firmware_lookup.providers.aruba import ArubaProvider
from firmware_lookup.providers.avaya import AvayaProvider
from firmware_lookup.providers.base import BrowserAuthenticatedProvider
from firmware_lookup.providers.beckhoff import BeckhoffProvider
from firmware_lookup.providers.beijer_electronics import BeijerElectronicsProvider
from firmware_lookup.providers.belden import BeldenProvider
from firmware_lookup.providers.cdata import CDataProvider
from firmware_lookup.providers.celestica import CelesticaProvider
from firmware_lookup.providers.ciena import CienaProvider
from firmware_lookup.providers.datto import DattoProvider
from firmware_lookup.providers.dell import DellProvider
from firmware_lookup.providers.extreme import ExtremeProvider
from firmware_lookup.providers.h3c import H3CProvider
from firmware_lookup.providers.huawei import HuaweiProvider
from firmware_lookup.providers.ip_infusion import IPInfusionProvider
from firmware_lookup.providers.juniper import JuniperProvider
from firmware_lookup.providers.kyland import KylandProvider
from firmware_lookup.providers.lantronix import LantronixProvider
from firmware_lookup.providers.micas_networks import MicasNetworksProvider
from firmware_lookup.providers.nokia import NokiaProvider
from firmware_lookup.providers.nomadix import NomadixProvider
from firmware_lookup.providers.noviflow import NoviFlowProvider
from firmware_lookup.providers.omnitron_systems import OmnitronSystemsProvider
from firmware_lookup.providers.oracle import OracleProvider
from firmware_lookup.providers.oring import OringProvider
from firmware_lookup.providers.qnap import QnapProvider
from firmware_lookup.providers.red_lion import RedLionProvider
from firmware_lookup.providers.ruckus import RuckusProvider
from firmware_lookup.providers.supermicro import SupermicroProvider
from firmware_lookup.providers.tejas_networks import TejasNetworksProvider
from firmware_lookup.providers.telco_systems import TelcoSystemsProvider
from firmware_lookup.providers.totolink import TotolinkProvider
from firmware_lookup.providers.versa_networks import VersaNetworksProvider
from firmware_lookup.providers.vertiv import VertivProvider
from firmware_lookup.providers.yokogawa import YokogawaProvider
from firmware_lookup.providers.zte import ZTEProvider

ALL_PROVIDER_CLASSES = [
    ("Adtran", AdtranProvider),
    ("Advantech", AdvantechProvider),
    ("Aerohive", AerohiveProvider),
    ("Alcatel-Lucent Enterprise", AlcatelLucentEnterpriseProvider),
    ("Allied Telesis", AlliedTelesisProvider),
    ("AMG Systems", AmgSystemsProvider),
    ("Araknis Networks", AraknisNetworksProvider),
    ("Arista", AristaProvider),
    ("Aruba", ArubaProvider),
    ("Avaya", AvayaProvider),
    ("Beckhoff", BeckhoffProvider),
    ("Beijer Electronics", BeijerElectronicsProvider),
    ("Belden", BeldenProvider),
    ("C-Data", CDataProvider),
    ("Celestica", CelesticaProvider),
    ("Ciena", CienaProvider),
    ("Datto", DattoProvider),
    ("Dell", DellProvider),
    ("Extreme", ExtremeProvider),
    ("H3C", H3CProvider),
    ("Huawei", HuaweiProvider),
    ("IP Infusion", IPInfusionProvider),
    ("Juniper", JuniperProvider),
    ("Kyland", KylandProvider),
    ("Lantronix", LantronixProvider),
    ("Micas Networks", MicasNetworksProvider),
    ("Nokia", NokiaProvider),
    ("Nomadix", NomadixProvider),
    ("NoviFlow", NoviFlowProvider),
    ("Omnitron Systems", OmnitronSystemsProvider),
    ("Oracle", OracleProvider),
    ("ORing", OringProvider),
    ("QNAP", QnapProvider),
    ("Red Lion", RedLionProvider),
    ("RUCKUS", RuckusProvider),
    ("Supermicro", SupermicroProvider),
    ("Tejas Networks", TejasNetworksProvider),
    ("Telco Systems", TelcoSystemsProvider),
    ("TOTOLINK", TotolinkProvider),
    ("Versa Networks", VersaNetworksProvider),
    ("Vertiv", VertivProvider),
    ("Yokogawa", YokogawaProvider),
    ("ZTE", ZTEProvider),
]


@pytest.fixture
def isolated_session_dir(tmp_path, monkeypatch):
    import firmware_lookup.session as session_mod
    monkeypatch.setattr(session_mod, "SESSION_DIR", tmp_path)
    return tmp_path


@pytest.fixture(autouse=True)
def no_live_browser_calls(monkeypatch):
    """Aruba's check_public_source() (see providers/aruba.py) makes a
    REAL Playwright browser call before falling back to login -- found
    live that this made the whole suite take ~30s instead of ~2s.
    Autouse + raising immediately keeps every test in this file fast
    and deterministic (no live network calls, same rule as everywhere
    else in this suite) while still exercising the real fallback-to-
    login code path, since check_public_source() catches this and
    returns None either way."""
    import playwright.sync_api as sync_api_mod

    def fake_sync_playwright():
        raise RuntimeError("no live browser calls in tests")

    monkeypatch.setattr(sync_api_mod, "sync_playwright", fake_sync_playwright)


@pytest.mark.parametrize("vendor_key,cls", ALL_PROVIDER_CLASSES)
def test_is_browser_authenticated_provider(vendor_key, cls):
    """Confirms each vendor really got the generic login flow, not just
    the plain honest-stub LoginGatedProvider."""
    p = cls()
    assert isinstance(p, BrowserAuthenticatedProvider)
    assert p.HOME_URL, f"{vendor_key} has no HOME_URL configured"


@pytest.mark.parametrize("vendor_key,cls", ALL_PROVIDER_CLASSES)
def test_no_session_returns_auth_required(vendor_key, cls, isolated_session_dir):
    p = cls()
    r = p.get_latest_firmware(vendor_key, "SomeModel", "1.0")
    assert r.status.value == "auth_required"
    assert "authentication or support entitlement required" in r.message


@pytest.mark.parametrize("vendor_key,cls", ALL_PROVIDER_CLASSES)
def test_session_manager_home_url_matches_provider(vendor_key, cls):
    """The session manager's HOME_URL/ACCOUNT_CHECK_URL must match the
    provider's -- otherwise login() would open the wrong page for a
    lookup that expects a different one."""
    p = cls()
    assert p.session_manager.HOME_URL == p.HOME_URL
    assert p.session_manager.ACCOUNT_CHECK_URL == p.HOME_URL


@pytest.mark.parametrize("vendor_key,cls", ALL_PROVIDER_CLASSES)
def test_credential_resolution_never_hangs_without_terminal(
    vendor_key, cls, isolated_session_dir, monkeypatch,
):
    """Same regression guard as Cisco's, applied to every vendor sharing
    the generic base -- confirms the isatty() fix lives in the shared
    base class, not just Cisco's now-removed override."""
    prefix = vendor_key.upper().replace(" ", "_").replace("-", "_")
    monkeypatch.delenv(f"{prefix}_USERNAME", raising=False)
    monkeypatch.delenv(f"{prefix}_PASSWORD", raising=False)
    monkeypatch.setattr("sys.stdin.isatty", lambda: False)
    monkeypatch.setattr(
        "builtins.input",
        lambda prompt="": (_ for _ in ()).throw(AssertionError("must not call input() without a tty")),
    )
    p = cls()
    p.session_manager._passphrase = "test-pass"
    assert p.session_manager._resolve_credentials() == (None, None)


def test_get_latest_firmware_never_raises_for_any_login_gated_vendor(isolated_session_dir):
    """End-to-end smoke test through the real orchestrator entry point
    for all 9, confirming none of them crash."""
    from firmware_lookup import get_latest_firmware

    for vendor_key, _ in ALL_PROVIDER_CLASSES:
        r = get_latest_firmware(vendor_key, "SomeModel", "1.0")
        assert r.status.value == "auth_required"
