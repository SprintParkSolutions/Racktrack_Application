import time
from unittest.mock import MagicMock

import pytest
import requests

from firmware_lookup.http_client import FirmwareHttpClient


@pytest.fixture
def client(tmp_path, monkeypatch):
    import firmware_lookup.http_client as hc
    monkeypatch.setattr(hc, "CACHE_ROOT", tmp_path)
    return FirmwareHttpClient("test_vendor", min_delay_seconds=0.0)


def test_retry_policy_does_not_retry_connect_or_read_timeouts(client):
    """Regression guard for a real bug found live against Lenovo:
    support.lenovo.com accepts the TCP/TLS connection but never
    responds to the actual HTTP request (a deliberate silent-drop bot
    mitigation) -- with the old Retry(total=3, ...) config, urllib3
    applies `total` to EVERY retry category (connect, read, status),
    so one hanging request got retried 3 times, each redoing the full
    connect+read timeout budget. A live /api/lookup call for Lenovo
    hung for 60+ seconds and never returned. Fixed with connect=0,
    read=0 (never retry transport-level timeouts -- a silent drop
    hangs the same way every retry) while status=3 preserves retrying
    the specific transient HTTP status codes."""
    adapter = client.session.get_adapter("https://example.com")
    retry = adapter.max_retries
    assert retry.connect == 0
    assert retry.read == 0
    assert retry.status == 3
    assert set(retry.status_forcelist) == {429, 500, 502, 503, 504}


def test_cache_hit_avoids_network(client, monkeypatch):
    calls = []

    def fake_get(url, **kw):
        calls.append(url)
        resp = MagicMock(status_code=200, content=b"hello", headers={})
        return resp

    monkeypatch.setattr(client.session, "get", fake_get)
    first = client.get_text("https://example.com/a")
    second = client.get_text("https://example.com/a")
    assert first == "hello"
    assert second == "hello"
    assert len(calls) == 1  # second call served from cache
    assert client.last_cache_hit is True


def test_304_reuses_cached_body_without_redownload(client, monkeypatch):
    call_count = {"n": 0}

    def fake_get(url, **kw):
        call_count["n"] += 1
        if call_count["n"] == 1:
            return MagicMock(status_code=200, content=b"original",
                              headers={"ETag": '"abc123"'})
        # Second call (force_refresh) -- server says not modified.
        return MagicMock(status_code=304, content=b"", headers={})

    monkeypatch.setattr(client.session, "get", fake_get)
    first = client.get_text("https://example.com/b")
    second = client.get_text("https://example.com/b", force_refresh=True)
    assert first == "original"
    assert second == "original"  # served from cache after 304, not re-downloaded
    assert call_count["n"] == 2


def test_404_is_negative_cached(client, monkeypatch):
    calls = []

    def fake_get(url, **kw):
        calls.append(url)
        return MagicMock(status_code=404, content=b"", headers={})

    monkeypatch.setattr(client.session, "get", fake_get)
    first = client.get_text("https://example.com/missing")
    second = client.get_text("https://example.com/missing")
    assert first is None
    assert second is None
    assert len(calls) == 1  # second call short-circuited via negative cache


def test_network_exception_returns_none_never_raises(client, monkeypatch):
    def fake_get(url, **kw):
        raise requests.exceptions.Timeout("simulated timeout")

    monkeypatch.setattr(client.session, "get", fake_get)
    result = client.get_text("https://example.com/timeout")
    assert result is None


def test_non_json_returns_none(client, monkeypatch):
    monkeypatch.setattr(client, "get_text", lambda url, **kw: "not json {{{")
    assert client.get_json("https://example.com/bad.json") is None


def test_rate_limit_enforces_delay(tmp_path, monkeypatch):
    import firmware_lookup.http_client as hc
    monkeypatch.setattr(hc, "CACHE_ROOT", tmp_path)
    monkeypatch.setattr(hc, "_domain_last_request", {})
    client = FirmwareHttpClient("rl_test", min_delay_seconds=0.2)

    sleep_calls = []
    monkeypatch.setattr(time, "sleep", lambda s: sleep_calls.append(s))

    def fake_get(url, **kw):
        return MagicMock(status_code=200, content=b"x", headers={})

    monkeypatch.setattr(client.session, "get", fake_get)
    client.get_text("https://ratelimited.example.com/1", force_refresh=True)
    client.get_text("https://ratelimited.example.com/2", force_refresh=True)
    assert len(sleep_calls) >= 1
