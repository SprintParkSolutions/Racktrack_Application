"""
Shared pytest fixtures. Mocking is always per-INSTANCE
(monkeypatch.setattr(provider.http, "get_text", ...)), never global class
patching -- so tests never leak state into each other and never touch
the real network.
"""
from __future__ import annotations

from pathlib import Path

import pytest

FIXTURES_DIR = Path(__file__).parent / "fixtures"


def sample_html(name: str) -> str:
    return (FIXTURES_DIR / name).read_text()


def sample_text(name: str) -> str:
    return (FIXTURES_DIR / name).read_text()


@pytest.fixture
def mock_get_text(monkeypatch):
    """mock_get_text(provider, {url: response_or_None})"""
    def _apply(provider, mapping: dict):
        monkeypatch.setattr(
            provider.http, "get_text",
            lambda url, **kw: mapping.get(url),
        )
    return _apply


@pytest.fixture
def mock_get_json(monkeypatch):
    """mock_get_json(provider, {url: response_dict_or_None})"""
    def _apply(provider, mapping: dict):
        monkeypatch.setattr(
            provider.http, "get_json",
            lambda url, **kw: mapping.get(url),
        )
    return _apply


@pytest.fixture
def mock_post_text(monkeypatch):
    """mock_post_text(provider, response_or_None) -- Ruijie's
    check_public_source() is the first (and so far only) provider using
    FirmwareHttpClient.post_text(); unlike get_text there's only ever
    one real POST call per lookup here, so this mocks a single response
    rather than a url-keyed mapping."""
    def _apply(provider, response):
        monkeypatch.setattr(
            provider.http, "post_text",
            lambda url, **kw: response,
        )
    return _apply


@pytest.fixture
def mock_get_text_fn(monkeypatch):
    """mock_get_text_fn(provider, callable(url, **kw) -> str|None)
    for cases needing dynamic responses (e.g. MikroTik's version-parameterized probing)."""
    def _apply(provider, fn):
        monkeypatch.setattr(provider.http, "get_text", fn)
    return _apply
