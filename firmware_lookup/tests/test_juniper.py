"""
Juniper is a BrowserAuthenticatedProvider (login-gated base) again as of
2026-07-16, with a real, verified check_public_source() shortcut that
was proven live to work with zero login for the common case -- login
only kicks in as an honest fallback if that doesn't resolve. See
providers/juniper.py's module docstring for the full history (public-
only -> restored login fallback, after a real live networkidle timeout
had nowhere else to go).

Generic login-gated wiring (session manager, auth_required with no
session, credential resolution never hanging) is already covered by
test_login_gated_vendors.py's parametrized suite, which Juniper is back
in. These tests focus on what's Juniper-specific: check_public_source()
itself, without making real network or browser calls.
"""
import pytest

from firmware_lookup.providers.base import BrowserAuthenticatedProvider
from firmware_lookup.providers.juniper import JuniperProvider
from firmware_lookup.result import Status


def test_is_login_gated_with_public_shortcut():
    p = JuniperProvider()
    assert isinstance(p, BrowserAuthenticatedProvider)


def test_check_public_source_empty_model_returns_none():
    p = JuniperProvider()
    assert p.check_public_source("Juniper", "", "20.1R1") is None


def test_check_public_source_missing_playwright_returns_none_not_raise(monkeypatch):
    import builtins
    real_import = builtins.__import__

    def fake_import(name, *args, **kwargs):
        if name == "playwright.sync_api" or name.startswith("playwright"):
            raise ImportError("no playwright")
        return real_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", fake_import)
    p = JuniperProvider()
    assert p.check_public_source("Juniper", "SRX300", "20.1R1") is None


def test_check_public_source_unexpected_browser_error_never_raises(monkeypatch):
    class ExplodingPlaywright:
        def __enter__(self):
            raise RuntimeError("simulated browser launch failure")

        def __exit__(self, *args):
            return False

    def fake_sync_playwright():
        return ExplodingPlaywright()

    import playwright.sync_api as sync_api_mod
    monkeypatch.setattr(sync_api_mod, "sync_playwright", fake_sync_playwright)

    p = JuniperProvider()
    assert p.check_public_source("Juniper", "SRX300", "20.1R1") is None


def test_no_session_falls_through_to_auth_required(monkeypatch, tmp_path):
    """End-to-end: with Playwright unavailable (so check_public_source
    can't resolve) and no saved session, the full get_latest_firmware()
    must honestly report auth_required rather than raise or dead-end --
    the real gap this fallback was built to close."""
    import firmware_lookup.session as session_mod
    monkeypatch.setattr(session_mod, "SESSION_DIR", tmp_path)

    import builtins
    real_import = builtins.__import__

    def fake_import(name, *args, **kwargs):
        if name == "playwright.sync_api" or name.startswith("playwright"):
            raise ImportError("no playwright")
        return real_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", fake_import)

    p = JuniperProvider()
    r = p.get_latest_firmware("Juniper", "SRX300", "20.1R1")
    assert r.status == Status.AUTH_REQUIRED
