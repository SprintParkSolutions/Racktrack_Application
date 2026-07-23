import time

import pytest

from firmware_lookup.session import LoginSessionManager


@pytest.fixture
def isolated_session_dir(tmp_path, monkeypatch):
    import firmware_lookup.session as session_mod
    monkeypatch.setattr(session_mod, "SESSION_DIR", tmp_path)
    return tmp_path


def _manager_with_passphrase(vendor, passphrase):
    mgr = LoginSessionManager(vendor)
    mgr._passphrase = passphrase
    return mgr


def test_save_and_load_roundtrip(isolated_session_dir):
    mgr = _manager_with_passphrase("TestVendor", "correct-horse")
    mgr.save_session({"expires_at": time.time() + 3600, "storage_state": {"cookies": []}})

    mgr2 = _manager_with_passphrase("TestVendor", "correct-horse")
    assert mgr2.is_session_valid() is True
    data = mgr2.load_session()
    assert data["storage_state"] == {"cookies": []}


def test_file_is_actually_encrypted(isolated_session_dir):
    mgr = _manager_with_passphrase("TestVendor", "correct-horse")
    mgr.save_session({"expires_at": time.time() + 3600, "storage_state": {"secret": "shh"}})
    raw = mgr.session_file.read_text()
    assert "shh" not in raw
    assert "secret" not in raw


def test_wrong_passphrase_fails_cleanly(isolated_session_dir):
    mgr = _manager_with_passphrase("TestVendor", "correct-horse")
    mgr.save_session({"expires_at": time.time() + 3600, "storage_state": {}})

    mgr2 = _manager_with_passphrase("TestVendor", "wrong-passphrase")
    assert mgr2.load_session() is None
    assert mgr2.is_session_valid() is False


def test_expired_session_is_invalid(isolated_session_dir):
    mgr = _manager_with_passphrase("TestVendor", "correct-horse")
    mgr.save_session({"expires_at": time.time() - 10, "storage_state": {}})

    mgr2 = _manager_with_passphrase("TestVendor", "correct-horse")
    assert mgr2.is_session_valid() is False


def test_ensure_session_never_prompts_when_no_file_exists(isolated_session_dir):
    """ensure_session() must never trigger an interactive login on its
    own -- a normal lookup call must not block waiting on a human."""
    mgr = LoginSessionManager("NeverLoggedIn")
    assert mgr.ensure_session() is None


def test_login_raises_not_implemented_by_default(isolated_session_dir):
    mgr = LoginSessionManager("SomeGatedVendor")
    with pytest.raises(NotImplementedError):
        mgr.login()


def test_check_login_prompt_text_threads_through_to_run_browser_login(
    isolated_session_dir, monkeypatch,
):
    """Regression guard for a real bug found live against ORing: a
    genuinely successful login was never detected because the site's
    nav bar keeps a static 'Sign In' link regardless of real auth
    state. CHECK_LOGIN_PROMPT_TEXT (default True) must reach
    run_browser_login() as check_login_prompt_text, so a vendor can
    disable just that one veto without losing the password-field
    check."""
    from firmware_lookup.session import BrowserLoginSessionManager

    captured = {}

    def fake_run_browser_login(*args, **kwargs):
        captured.update(kwargs)
        return {"storage_state": {}}

    monkeypatch.setattr(
        "firmware_lookup.browser_login.run_browser_login", fake_run_browser_login,
    )

    class DefaultMgr(BrowserLoginSessionManager):
        HOME_URL = "https://example.com/login"

    mgr = DefaultMgr("DefaultVendor")
    mgr.login()
    assert captured["check_login_prompt_text"] is True

    class QuietMgr(BrowserLoginSessionManager):
        HOME_URL = "https://example.com/login"
        CHECK_LOGIN_PROMPT_TEXT = False

    captured.clear()
    mgr2 = QuietMgr("QuietVendor")
    mgr2.login()
    assert captured["check_login_prompt_text"] is False


def test_oring_provider_disables_login_prompt_text_check():
    """Regression guard: ORingProvider must override
    CHECK_LOGIN_PROMPT_TEXT to False on its OWN session manager
    instance (not the shared class default), confirmed live necessary
    since oringnet.com's nav shows 'Sign In' even when authenticated."""
    from firmware_lookup.providers.oring import OringProvider

    p = OringProvider()
    assert p.session_manager.CHECK_LOGIN_PROMPT_TEXT is False
    # Regression guard for a third real bug, found live right after the
    # first two were fixed: the background confirmation ping always
    # re-checks the bare HOME_URL (never "?view=profile"), so it can
    # never demonstrate the one positive signal that actually proves
    # authentication here -- same class of problem as Dell's Akamai
    # 403, same fix (trust the local URL check alone).
    assert p.session_manager.REQUIRE_LOGIN_CONFIRM_REQUEST is False

    # Other vendors must be unaffected -- this is an instance override,
    # not a class-wide change.
    from firmware_lookup.providers.extreme import ExtremeProvider
    p2 = ExtremeProvider()
    assert p2.session_manager.CHECK_LOGIN_PROMPT_TEXT is True


def test_oring_is_authenticated_treats_view_profile_as_a_positive_signal():
    """Regression guard for a second real bug found live, immediately
    after fixing the first: oringnet.com's genuinely-authenticated
    Profile page URL is .../en/user-login?view=profile -- it still
    contains the literal substring "login" in its permanent path, which
    the generic marker-based check (DEFAULT_NOT_AUTHENTICATED_MARKERS)
    would otherwise treat as a not-authenticated signal forever, even
    after a real, confirmed login. "view=profile" must be checked as a
    positive signal BEFORE the generic markers so it can't be shadowed
    by the false "login" match."""
    from firmware_lookup.providers.oring import OringSessionManager

    mgr = OringSessionManager("ORing")
    assert mgr._is_authenticated(
        "https://oringnet.com/en/user-login?view=profile", 200,
    ) is True
    # Still correctly rejects the real logged-out login form itself.
    assert mgr._is_authenticated(
        "https://oringnet.com/en/user-login", 200,
    ) is False
    # Still correctly rejects a 401/403 even with a view=profile-shaped URL.
    assert mgr._is_authenticated(
        "https://oringnet.com/en/user-login?view=profile", 403,
    ) is False


def test_credentials_save_and_load_roundtrip(isolated_session_dir):
    mgr = _manager_with_passphrase("TestVendor", "correct-horse")
    mgr.save_credentials("alice", "hunter2")

    mgr2 = _manager_with_passphrase("TestVendor", "correct-horse")
    username, password = mgr2.load_credentials()
    assert username == "alice"
    assert password == "hunter2"


def test_credentials_file_is_actually_encrypted(isolated_session_dir):
    mgr = _manager_with_passphrase("TestVendor", "correct-horse")
    mgr.save_credentials("alice", "hunter2")
    raw = mgr.credentials_file.read_text()
    assert "hunter2" not in raw
    assert "alice" not in raw


def test_credentials_wrong_passphrase_fails_cleanly(isolated_session_dir):
    mgr = _manager_with_passphrase("TestVendor", "correct-horse")
    mgr.save_credentials("alice", "hunter2")

    mgr2 = _manager_with_passphrase("TestVendor", "wrong-passphrase")
    assert mgr2.load_credentials() == (None, None)


def test_credentials_missing_file_returns_none_tuple(isolated_session_dir):
    mgr = _manager_with_passphrase("NeverSaved", "whatever")
    assert mgr.load_credentials() == (None, None)


def test_session_and_credentials_are_independent_files(isolated_session_dir):
    """Saving a session must not clobber separately-saved credentials,
    and vice versa -- they live in separate encrypted files."""
    mgr = _manager_with_passphrase("TestVendor", "correct-horse")
    mgr.save_credentials("alice", "hunter2")
    mgr.save_session({"expires_at": time.time() + 3600, "storage_state": {}})

    mgr2 = _manager_with_passphrase("TestVendor", "correct-horse")
    assert mgr2.load_credentials() == ("alice", "hunter2")
    assert mgr2.is_session_valid() is True
