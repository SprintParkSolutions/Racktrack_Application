"""
Tier-2 login session framework.

Sessions are captured via a real browser-assisted login (see
browser_login.py) -- not a scripted POST, since modern vendor portals use
JS-driven SSO/MFA that plain requests can't drive (the same problem
nvidia_poc/nvidia.py already ran into for NVIDIA's own login). Once
captured, a session is persisted ENCRYPTED at rest: cryptography's
Fernet, with the key derived via PBKDF2-HMAC-SHA256 from a passphrase you
type once per process via getpass(). The passphrase is never stored,
never cached to disk, and never auto-remembered across process runs --
that's the whole point of encrypting it. A random salt is generated per
session file and stored alongside the ciphertext (the salt isn't secret;
it's needed to re-derive the same key from the same passphrase next run).

Username/password are ALSO stored in this same encrypted envelope (see
save_credentials/load_credentials), so a re-login after expiry doesn't
require retyping them -- the browser form gets auto-filled. This is
DELIBERATELY NOT full unattended auto-login: if the vendor's SSO prompts
for MFA (very likely for an enterprise portal), a human still has to
complete that step in the opened browser. Auto-filling username/password
saves the retyping; it does not and cannot skip a second factor.

login() itself still raises NotImplementedError by default -- only
vendors with a real implementation (see providers/cisco.py) override it.
ensure_session() only ever LOADS and VALIDATES an existing session; it
never triggers an interactive browser login on its own (a normal
lookup call must not block on a human being present) -- real
(re-)login only happens via the `login` CLI subcommand.
"""
from __future__ import annotations

import base64
import json
import logging
import os
import secrets
import sys
import time
from getpass import getpass
from pathlib import Path
from typing import Optional

from cryptography.fernet import Fernet, InvalidToken
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

logger = logging.getLogger("firmware_lookup.session")

SESSION_DIR = Path(__file__).parent / "session_dir"
PBKDF2_ITERATIONS = 480_000  # OWASP 2023 minimum guidance for PBKDF2-SHA256


class LoginSessionManager:
    """One instance per Tier-2 vendor."""

    def __init__(self, vendor_key: str):
        self.vendor_key = vendor_key
        slug = vendor_key.lower().replace(" ", "_")
        self.session_file = SESSION_DIR / f"{slug}_session.enc"
        self.credentials_file = SESSION_DIR / f"{slug}_credentials.enc"
        self._session_data: Optional[dict] = None
        # In-memory only for this process -- never persisted, never
        # cached across runs. Prompted lazily, at most once per instance.
        self._passphrase: Optional[str] = None

    def credentials(self) -> tuple[Optional[str], Optional[str]]:
        """Reads {VENDOR}_USERNAME / {VENDOR}_PASSWORD env vars. Never
        hardcoded, never logged. (Used only to decide whether an
        interactive login attempt makes sense -- the actual login is
        always a real browser, these env vars are not submitted to any
        form directly.)"""
        prefix = self.vendor_key.upper().replace(" ", "_").replace("-", "_")
        return (
            os.environ.get(f"{prefix}_USERNAME"),
            os.environ.get(f"{prefix}_PASSWORD"),
        )

    def _get_passphrase(self) -> str:
        if self._passphrase is None:
            try:
                self._passphrase = getpass(
                    f"Passphrase to unlock/encrypt the {self.vendor_key} session: "
                )
            except EOFError as e:
                raise RuntimeError(
                    "Could not read a passphrase: no interactive terminal "
                    "is attached to this process. `login`/`register` must "
                    "be run from a real terminal you control directly "
                    "(not through an automated/relayed shell), since "
                    "entering the encryption passphrase requires live "
                    "keyboard input this process can't receive otherwise."
                ) from e
        return self._passphrase

    def _derive_fernet(self, salt: bytes) -> Fernet:
        kdf = PBKDF2HMAC(
            algorithm=hashes.SHA256(), length=32, salt=salt,
            iterations=PBKDF2_ITERATIONS,
        )
        key = base64.urlsafe_b64encode(kdf.derive(self._get_passphrase().encode()))
        return Fernet(key)

    def _encrypt_to_file(self, path: Path, data: dict) -> None:
        # CONFIRMED GAP, found live against Supermicro: a real login
        # completed and printed "Session captured", but no session file
        # ever appeared on disk afterward, with zero warnings logged --
        # the narrow `except OSError` here would silently swallow any
        # OTHER exception type (e.g. a bad self._passphrase from
        # _derive_fernet) with NO log line at all, since the caller
        # never even reaches this try/except in that case. Widened to
        # catch and log any Exception, plus an explicit success log, so
        # the next attempt's log shows definitively whether this ran
        # and what happened, instead of silent inference.
        try:
            SESSION_DIR.mkdir(parents=True, exist_ok=True)
            salt = secrets.token_bytes(16)
            ciphertext = self._derive_fernet(salt).encrypt(json.dumps(data).encode())
            envelope = {
                "salt": base64.urlsafe_b64encode(salt).decode(),
                "ciphertext": base64.urlsafe_b64encode(ciphertext).decode(),
            }
            path.write_text(json.dumps(envelope))
            logger.info(
                "[%s] session saved to %s (%d bytes)",
                self.vendor_key, path, path.stat().st_size,
            )
        except Exception as e:
            logger.exception(
                "[%s] FAILED to write %s: %s", self.vendor_key, path.name, e,
            )

    def _decrypt_from_file(self, path: Path) -> Optional[dict]:
        if not path.exists():
            return None
        try:
            envelope = json.loads(path.read_text())
            salt = base64.urlsafe_b64decode(envelope["salt"])
            ciphertext = base64.urlsafe_b64decode(envelope["ciphertext"])
        except (json.JSONDecodeError, KeyError, ValueError, OSError) as e:
            logger.warning("[%s] %s unreadable: %s", self.vendor_key, path.name, e)
            return None
        try:
            plaintext = self._derive_fernet(salt).decrypt(ciphertext)
        except InvalidToken:
            logger.warning(
                "[%s] could not decrypt %s (wrong passphrase or corrupt "
                "file).", self.vendor_key, path.name,
            )
            return None
        try:
            return json.loads(plaintext)
        except json.JSONDecodeError:
            return None

    def load_session(self) -> Optional[dict]:
        """Decrypts and loads the saved session, prompting for the
        passphrase if needed. Returns None (never raises) if no session
        file exists, the file is corrupt, or the passphrase is wrong."""
        self._session_data = self._decrypt_from_file(self.session_file)
        return self._session_data

    def save_session(self, data: dict) -> None:
        self._encrypt_to_file(self.session_file, data)

    def invalidate_session(self) -> None:
        """Discards a saved session that turned out NOT to actually be
        authenticated (confirmed live against Cisco: the login-detection
        heuristic can false-positive and persist a session with a valid
        expires_at that Cisco itself still bounces to a login page --
        is_session_valid() only checks the timestamp, so a bad session
        would otherwise keep getting silently reused for its whole
        8-hour lifetime instead of prompting a real login again)."""
        self._session_data = None
        try:
            self.session_file.unlink(missing_ok=True)
        except Exception:
            logger.exception("[%s] failed to remove stale session file", self.vendor_key)

    def load_credentials(self) -> tuple[Optional[str], Optional[str]]:
        """Decrypts previously-saved username/password, prompting for
        the passphrase if needed. Returns (None, None) -- never raises --
        if nothing is stored, the file is corrupt, or the passphrase is
        wrong."""
        data = self._decrypt_from_file(self.credentials_file)
        if not data:
            return None, None
        return data.get("username"), data.get("password")

    def save_credentials(self, username: str, password: str) -> None:
        self._encrypt_to_file(
            self.credentials_file, {"username": username, "password": password},
        )

    def is_session_valid(self) -> bool:
        data = self._session_data or self.load_session()
        if not data:
            return False
        expires_at = data.get("expires_at")
        return bool(expires_at) and time.time() < expires_at

    def login(self, extractor=None) -> dict:
        """Real per-vendor login flow. Default: deliberately not
        implemented (no test credentials, and untested login automation
        against a portal we can't verify would itself be a form of
        guessing). Subclasses (currently just Cisco) override this with
        real browser-assisted automation.

        `extractor`, if given, is a callable(page) run in the SAME
        authenticated browser session right after login succeeds, before
        it closes -- see BrowserLoginSessionManager.login() and
        providers/base.py's login_and_fetch(). Accepted here (and
        ignored) purely so ensure_session_interactive() can call
        `self.login(extractor=...)` uniformly regardless of which
        subclass is in play."""
        raise NotImplementedError(
            f"Login flow not implemented for {self.vendor_key} "
            "(framework-only by design)."
        )

    def ensure_session(self) -> Optional[dict]:
        """Load and validate an existing session ONLY -- never triggers
        an interactive browser login (a normal lookup call must not
        block waiting on a human). Returns None if no valid session
        exists, so callers fall through cleanly to auth_required()."""
        if not self.session_file.exists():
            return None
        return self._session_data if self.is_session_valid() else None

    def ensure_session_interactive(self, extractor=None) -> Optional[dict]:
        """Used by the `login`/`register` CLI subcommand and by
        login_and_fetch(): load a valid existing session if there is
        one, otherwise perform a real (browser-assisted) login and
        persist the result. `extractor`, if given, only ever actually
        runs when a FRESH login happens -- if a valid session already
        exists, no browser opens at all here, so there's nothing for it
        to run inside; callers should fall back to a normal
        already-authenticated lookup in that case (see
        providers/base.py's login_and_fetch())."""
        if self.is_session_valid():
            return self._session_data
        try:
            data = self.login(extractor=extractor)
        except NotImplementedError as e:
            logger.info("[%s] %s", self.vendor_key, e)
            return None
        self._session_data = data
        self.save_session(data)
        return data


# Shared default "definitely not logged in yet" URL markers -- login,
# SSO, and account-creation pages across most enterprise portals tend to
# use some subset of these words. Verified against ONE real vendor
# (Cisco) this session, after finding live that too narrow a list causes
# false positives (declaring success mid-signup) -- see cisco.py's
# _looks_authenticated for the full story. Vendor subclasses can extend
# this via EXTRA_NOT_AUTHENTICATED_MARKERS if they learn vendor-specific
# ones from real testing.
DEFAULT_NOT_AUTHENTICATED_MARKERS = (
    "idp.", "sso.", "login", "signin", "sign-in", "register",
    "registration", "signup", "sign-up", "create-account",
    "createaccount", "verify", "mfa", "authenticate", "password",
    "captcha", "consent",
)


class BrowserLoginSessionManager(LoginSessionManager):
    """Generic browser-assisted login, reusable across any Tier-2
    vendor. Built by generalizing what was proven -- and had real bugs
    found and fixed via live testing -- for Cisco specifically (see
    providers/cisco.py's module docstring for that history: an input()
    hang with no terminal attached, buffered stdout hiding diagnostics,
    a false-positive auth check that closed the browser mid-signup,
    Akamai blocking headless requests even with a valid session).

    ***HONESTY FLAG***: this class is UNVERIFIED for every vendor except
    Cisco, since there is no test account for any of the others. Expect
    the same categories of bugs Cisco had until each vendor is
    individually tested live -- subclasses should treat
    EXTRA_NOT_AUTHENTICATED_MARKERS and any selector overrides as
    starting guesses, not confirmed behavior.

    Subclasses set HOME_URL (and optionally ACCOUNT_CHECK_URL, if it
    differs from HOME_URL) and are done -- login(), credential
    resolution, and the authenticated-check heuristic are all generic.
    """

    HOME_URL: str = ""
    ACCOUNT_CHECK_URL: str = ""  # defaults to HOME_URL if left blank
    SESSION_LIFETIME_SECONDS = 8 * 3600
    EXTRA_NOT_AUTHENTICATED_MARKERS: tuple = ()
    # CONFIRMED BUG, found live against Dell (real login, real evidence):
    # the lightweight background confirmation ping in browser_login.py
    # got a 403 from Akamai on EVERY poll for 5+ minutes straight, with
    # zero exceptions, while the free local URL check passed the whole
    # time -- a confirmation step that can never pass for a given vendor
    # is worse than no confirmation, since it just runs out the full
    # timeout on a guaranteed-false negative even after a real login.
    # Default True (matches Cisco, where this ping DID eventually
    # succeed for real); set False on a vendor's session manager once
    # live evidence shows this exact permanent-403 pattern.
    REQUIRE_LOGIN_CONFIRM_REQUEST: bool = True
    # CONFIRMED BUG, found live against ORing (real login, real
    # screenshot evidence): a genuinely successful login (a real
    # Profile page showing the actual account's name/username/
    # registration date) still had a static "Sign In" link in the
    # site's own nav bar, regardless of auth state -- ran the full
    # login timeout on a guaranteed-false negative even though the
    # user had already logged in correctly. Default True (matches every
    # other vendor, where this veto is a correct, needed signal); set
    # False on a vendor's session manager once live evidence shows its
    # nav keeps "Log In"/"Sign In" text no matter what.
    CHECK_LOGIN_PROMPT_TEXT: bool = True

    def _is_authenticated(self, url: str, status_code: Optional[int]) -> bool:
        if status_code in (401, 403):
            return False
        u = url.lower()
        markers = DEFAULT_NOT_AUTHENTICATED_MARKERS + self.EXTRA_NOT_AUTHENTICATED_MARKERS
        return not any(marker in u for marker in markers)

    def _resolve_credentials(self) -> tuple[Optional[str], Optional[str]]:
        """Resolution order: env vars (explicit override, e.g. for CI)
        -> previously-saved encrypted credentials -> prompt
        interactively and save for next time. Returns (None, None) if
        nothing resolves (never raises)."""
        username, password = self.credentials()  # env vars
        if username and password:
            return username, password

        username, password = self.load_credentials()
        if username and password:
            return username, password

        # CONFIRMED BUG, found live against Cisco: plain input() does
        # NOT reliably raise EOFError with no interactive terminal
        # attached the way getpass() does -- it can hang forever. Check
        # isatty() up front and skip straight to "no prefill" instead of
        # ever risking that hang; the browser still opens normally, the
        # user just types credentials directly into the real page.
        if not sys.stdin.isatty():
            logger.info(
                "[%s] No saved credentials and no interactive terminal "
                "attached -- skipping the prompt, browser will open "
                "without prefill.", self.vendor_key,
            )
            return None, None

        print(f"No saved credentials for {self.vendor_key}. Enter them once "
              "and they'll be stored encrypted for next time (username/"
              "password only -- this does NOT skip MFA if your account "
              "has it, it just saves retyping the first two fields).")
        try:
            username = input(f"{self.vendor_key} username: ").strip()
            password = getpass(f"{self.vendor_key} password: ")
        except EOFError:
            return None, None
        if username and password:
            self.save_credentials(username, password)
        return username or None, password or None

    def login(self, extractor=None) -> dict:
        from firmware_lookup.browser_login import run_browser_login

        if not self.HOME_URL:
            raise NotImplementedError(
                f"No HOME_URL configured for {self.vendor_key}."
            )
        account_check_url = self.ACCOUNT_CHECK_URL or self.HOME_URL

        username, password = self._resolve_credentials()
        prefill = (username, password) if username and password else None

        state = run_browser_login(
            self.HOME_URL, account_check_url, self._is_authenticated,
            prefill=prefill, extractor=extractor, vendor_key=self.vendor_key,
            require_confirm_request=self.REQUIRE_LOGIN_CONFIRM_REQUEST,
            check_login_prompt_text=self.CHECK_LOGIN_PROMPT_TEXT,
        )
        if state is None:
            raise NotImplementedError(
                f"Manual {self.vendor_key} login was not completed within "
                "the timeout."
            )
        return {
            "expires_at": time.time() + self.SESSION_LIFETIME_SECONDS,
            "storage_state": state,
        }
