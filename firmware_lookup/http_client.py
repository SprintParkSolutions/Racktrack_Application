"""
Shared HTTP client for firmware_lookup providers: retries with backoff,
sensible timeouts, a TTL-based disk cache, conditional requests
(ETag/If-Modified-Since), and per-domain rate limiting.

Deliberately NOT the old scrapers/base.py pattern (permanent forever-cache,
no retries) -- "latest firmware version" data changes over time, so a
permanent cache would go silently stale. Default TTL is 12 hours.
"""
from __future__ import annotations

import hashlib
import json
import logging
import threading
import time
from pathlib import Path
from typing import Optional
from urllib.parse import urlparse

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

logger = logging.getLogger("firmware_lookup.http")

CACHE_ROOT = Path(__file__).parent / "cache_dir"
DEFAULT_TIMEOUT = (5, 15)  # (connect, read) seconds
DEFAULT_TTL_SECONDS = 12 * 3600
DEFAULT_MIN_DELAY_SECONDS = 1.0
DEFAULT_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
)

# Per-domain last-request timestamps, shared across every FirmwareHttpClient
# instance in this process (one instance per vendor) so the rate limit is
# enforced per DOMAIN, not per vendor object.
_domain_lock = threading.Lock()
_domain_last_request: dict[str, float] = {}


class TTLCache:
    """On-disk cache keyed by SHA1(url), each entry storing a fetch
    timestamp + optional ETag/Last-Modified alongside the body, so expired
    entries are treated as a miss without needing a separate index file."""

    def __init__(self, cache_dir: Path, ttl_seconds: int = DEFAULT_TTL_SECONDS):
        self.cache_dir = cache_dir
        self.ttl_seconds = ttl_seconds
        self.cache_dir.mkdir(parents=True, exist_ok=True)

    def _paths(self, key: str) -> tuple[Path, Path]:
        h = hashlib.sha1(key.encode()).hexdigest()
        return self.cache_dir / f"{h}.body", self.cache_dir / f"{h}.meta"

    def _read_meta(self, key: str) -> Optional[dict]:
        _, meta_path = self._paths(key)
        if not meta_path.exists():
            return None
        try:
            return json.loads(meta_path.read_text())
        except (json.JSONDecodeError, OSError):
            return None

    def get(self, key: str) -> Optional[bytes]:
        """Body if present AND within TTL, else None."""
        meta = self._read_meta(key)
        if meta is None:
            return None
        if time.time() - meta.get("fetched_at", 0) > self.ttl_seconds:
            return None
        return self.get_body_ignoring_ttl(key)

    def get_meta(self, key: str) -> Optional[dict]:
        """Raw metadata (etag/last_modified/fetched_at) even if TTL-expired
        -- used to build conditional-request headers from a stale entry."""
        return self._read_meta(key)

    def get_body_ignoring_ttl(self, key: str) -> Optional[bytes]:
        body_path, _ = self._paths(key)
        if not body_path.exists():
            return None
        try:
            return body_path.read_bytes()
        except OSError:
            return None

    def touch(self, key: str) -> None:
        """Rewrite fetched_at = now() without re-fetching the body --
        called after a 304 confirms the cached body is still current."""
        meta = self._read_meta(key) or {}
        meta["fetched_at"] = time.time()
        _, meta_path = self._paths(key)
        try:
            meta_path.write_text(json.dumps(meta))
        except OSError as e:
            logger.warning("cache touch failed for %s: %s", key, e)

    def set(
        self, key: str, value: bytes, *,
        etag: Optional[str] = None, last_modified: Optional[str] = None,
    ) -> None:
        body_path, meta_path = self._paths(key)
        try:
            body_path.write_bytes(value)
            meta_path.write_text(json.dumps({
                "fetched_at": time.time(),
                "key": key,
                "etag": etag,
                "last_modified": last_modified,
            }))
        except OSError as e:
            logger.warning("cache write failed for %s: %s", key, e)

    def is_known_negative(self, key: str) -> bool:
        """True if we already confirmed (within TTL) that this URL 404s.
        Lets probing code (e.g. MikroTik's boundary search) skip
        re-fetching an already-known-nonexistent URL on repeat calls."""
        meta = self._read_meta(key)
        if not meta or not meta.get("negative"):
            return False
        return time.time() - meta.get("fetched_at", 0) <= self.ttl_seconds

    def set_negative(self, key: str) -> None:
        """Record that `key` returned 404, without a body file."""
        _, meta_path = self._paths(key)
        try:
            meta_path.write_text(json.dumps({
                "fetched_at": time.time(), "key": key, "negative": True,
            }))
        except OSError as e:
            logger.warning("negative-cache write failed for %s: %s", key, e)


class FirmwareHttpClient:
    """One instance per provider/vendor. Never raises -- get_text()/
    get_json() return None on any failure and log a warning."""

    def __init__(
        self,
        vendor: str,
        ttl_seconds: int = DEFAULT_TTL_SECONDS,
        user_agent: Optional[str] = None,
        timeout=DEFAULT_TIMEOUT,
        min_delay_seconds: float = DEFAULT_MIN_DELAY_SECONDS,
    ):
        self.vendor = vendor
        self.session = requests.Session()
        # CONFIRMED BUG, found live against Lenovo: support.lenovo.com
        # accepts the TCP/TLS connection (a real, valid cert) but then
        # never responds to the actual HTTP request at all -- a
        # deliberate silent-drop bot mitigation, not a normal error.
        # `total=3` alone applies to EVERY retry category (connect,
        # read, status) in urllib3's Retry, so a single hanging
        # request got retried 3 times, each redoing the full 5s
        # connect + 15s read budget -- a live /api/lookup call for
        # this vendor hung for 60+ seconds and never returned at all,
        # not just slow. `connect=0, read=0` disables retrying
        # transport-level failures/timeouts (retrying a silent drop
        # gains nothing, it'll hang the same way every time) while
        # `status=3` keeps the original intent: still retry the
        # specific transient HTTP status codes below.
        retries = Retry(
            total=3,
            connect=0,
            read=0,
            status=3,
            backoff_factor=0.5,
            status_forcelist=[429, 500, 502, 503, 504],
            allowed_methods=["GET", "HEAD"],
        )
        adapter = HTTPAdapter(max_retries=retries)
        self.session.mount("https://", adapter)
        self.session.mount("http://", adapter)
        self.session.headers["User-Agent"] = user_agent or DEFAULT_UA
        self.cache = TTLCache(
            CACHE_ROOT / vendor.replace(" ", "_").lower(), ttl_seconds,
        )
        self.default_timeout = timeout
        self.min_delay_seconds = min_delay_seconds
        # Best-effort signal for the orchestrator's structured log (Item
        # 10) -- reflects the outcome of the most recent get_bytes() call.
        self.last_cache_hit: Optional[bool] = None

    def _rate_limit(self, url: str) -> None:
        """Sleep just enough to enforce min_delay_seconds since the last
        request to this URL's domain, shared across all vendor client
        instances -- separate from urllib3's retry backoff, which only
        fires on error responses, not on normal successful requests."""
        domain = urlparse(url).netloc
        with _domain_lock:
            last = _domain_last_request.get(domain, 0.0)
            wait = self.min_delay_seconds - (time.time() - last)
            if wait > 0:
                time.sleep(wait)
            _domain_last_request[domain] = time.time()

    def get_bytes(
        self, url: str, *, timeout=None, force_refresh: bool = False,
    ) -> Optional[bytes]:
        timeout = timeout or self.default_timeout
        if not force_refresh:
            cached = self.cache.get(url)
            if cached is not None:
                self.last_cache_hit = True
                return cached
            if self.cache.is_known_negative(url):
                self.last_cache_hit = True
                return None
        self.last_cache_hit = False

        self._rate_limit(url)

        headers = {}
        meta = self.cache.get_meta(url)  # possibly TTL-expired, still useful
        if meta:
            if meta.get("etag"):
                headers["If-None-Match"] = meta["etag"]
            if meta.get("last_modified"):
                headers["If-Modified-Since"] = meta["last_modified"]

        logger.info("[%s] GET %s", self.vendor, url)
        try:
            resp = self.session.get(
                url, timeout=timeout, allow_redirects=True, headers=headers,
            )
        except requests.RequestException as e:
            logger.warning("[%s] GET %s failed: %s", self.vendor, url, e)
            return None

        if resp.status_code == 304 and meta:
            body = self.cache.get_body_ignoring_ttl(url)
            if body is not None:
                self.cache.touch(url)
                self.last_cache_hit = True
                return body
            # 304 but we have no cached body to serve -- fall through to
            # treat as a miss rather than returning nothing.

        if resp.status_code == 404:
            self.cache.set_negative(url)
            logger.warning("[%s] GET %s -> 404", self.vendor, url)
            return None

        if resp.status_code != 200:
            logger.warning("[%s] GET %s -> %d", self.vendor, url, resp.status_code)
            return None

        self.cache.set(
            url, resp.content,
            etag=resp.headers.get("ETag"),
            last_modified=resp.headers.get("Last-Modified"),
        )
        return resp.content

    def get_text(self, url: str, **kw) -> Optional[str]:
        b = self.get_bytes(url, **kw)
        if b is None:
            return None
        return b.decode("utf-8", errors="replace")

    def get_json(self, url: str, **kw) -> Optional[dict]:
        text = self.get_text(url, **kw)
        if text is None:
            return None
        try:
            return json.loads(text)
        except (ValueError, TypeError):
            return None

    def post_text(
        self, url: str, *, data: str, headers: Optional[dict] = None,
        timeout=None,
    ) -> Optional[str]:
        """POST is not cached (unlike get_bytes/get_text) -- these calls
        are one-off per lookup (e.g. Ruijie's search API), so the extra
        cache-key complexity of hashing the request body isn't worth it
        yet. Not retried on failure either (POST isn't safely
        idempotent-retryable the way the shared Retry adapter assumes
        for GET/HEAD)."""
        timeout = timeout or self.default_timeout
        self._rate_limit(url)
        logger.info("[%s] POST %s", self.vendor, url)
        try:
            resp = self.session.post(
                url, data=data, headers=headers or {}, timeout=timeout,
            )
        except requests.RequestException as e:
            logger.warning("[%s] POST %s failed: %s", self.vendor, url, e)
            return None
        if resp.status_code != 200:
            logger.warning("[%s] POST %s -> %d", self.vendor, url, resp.status_code)
            return None
        return resp.text
        try:
            return json.loads(text)
        except ValueError:
            logger.warning("[%s] GET %s -> non-JSON response", self.vendor, url)
            return None
