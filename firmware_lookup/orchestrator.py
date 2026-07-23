"""
Top-level entry point: get_latest_firmware(vendor, model, current_version).
Never raises -- always returns a FirmwareResult.
"""
from __future__ import annotations

import logging
import time

from firmware_lookup.logging_format import log_pipeline, log_structured
from firmware_lookup.normalize import normalize_vendor
from firmware_lookup.providers import build_providers
from firmware_lookup.providers.base import FirmwareProvider
from firmware_lookup.result import FirmwareResult, cannot_determine, not_implemented

logger = logging.getLogger("firmware_lookup.orchestrator")

PROVIDERS: dict[str, FirmwareProvider] = build_providers()


def get_latest_firmware(vendor: str, model: str, current_version: str) -> FirmwareResult:
    """Look up the latest official firmware version for (vendor, model,
    current_version). Never raises."""
    normalized = normalize_vendor(vendor)
    provider = PROVIDERS.get(normalized) if normalized else None

    start = time.monotonic()
    if provider is None:
        result = not_implemented(vendor, model, current_version)
    else:
        try:
            result = provider.get_latest_firmware(normalized, model, current_version)
        except Exception as e:
            logger.exception("[%s] provider raised unexpectedly", normalized)
            result = cannot_determine(
                vendor, model, current_version,
                retrieval_method="error",
                reason=f"Internal error while querying {normalized}: {e}",
            )
    elapsed = time.monotonic() - start

    log_pipeline(vendor, normalized, model, current_version, result)
    # Best-effort: reflects the LAST HTTP call's cache state for
    # providers with a single `self.http` client. Providers that make
    # multiple internal HTTP calls with different cache outcomes (e.g.
    # MikroTik's channel probing) simply report the final call's state --
    # a documented simplification, not a correctness issue for the result
    # itself.
    cache_hit = getattr(getattr(provider, "http", None), "last_cache_hit", None)
    log_structured(vendor, normalized, model, current_version, result, elapsed, cache_hit)
    return result
