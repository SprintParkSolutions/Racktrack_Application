"""
Centralized step logger. Called ONCE from orchestrator.py after a
provider returns -- never duplicated per-provider -- so logged content
and returned data can never drift apart.
"""
from __future__ import annotations

import json
import logging
from typing import Optional

from firmware_lookup.result import FirmwareResult, Status

logger = logging.getLogger("firmware_lookup")


def log_pipeline(
    vendor_raw: str,
    normalized_vendor: Optional[str],
    model: str,
    current_version: str,
    result: FirmwareResult,
) -> None:
    model_found = result.status not in (Status.MODEL_NOT_FOUND,)
    if result.update_available is None:
        update_str = "Unknown"
    else:
        update_str = "Yes" if result.update_available else "No"

    lines = [
        f"Selected Provider: {normalized_vendor or 'None'}",
        f"Normalized Vendor: {normalized_vendor or 'unrecognized'}",
        "Searching Official Source...",
        "Model Found" if model_found else "Model not found",
        f"Current Version: {current_version}",
        f"Latest Version: {result.latest_version or 'unknown'}",
        f"Update Available: {update_str}",
    ]
    logger.info("\n".join(lines))


def log_structured(
    vendor_raw: str,
    normalized_vendor: Optional[str],
    model: str,
    current_version: str,
    result: FirmwareResult,
    elapsed_seconds: float,
    cache_hit: Optional[bool] = None,
) -> None:
    """Additive companion to log_pipeline() -- does not replace or alter
    its exact-format contract. One structured line per lookup, covering
    every field requested for machine-readable / dashboard-style
    consumption: selected/normalized vendor, source used, model matched,
    version parsed, current/latest version, update-available, confidence,
    elapsed time, cache hit/miss, retrieval method, status."""
    fields = {
        "selected_provider": normalized_vendor or "None",
        "vendor_normalized": normalized_vendor or "unrecognized",
        "source_used": result.source_url or "none",
        "model_matched": result.model,
        "version_parsed": result.latest_version or "unknown",
        "current_version": current_version,
        "latest_version": result.latest_version or "unknown",
        "update_available": (
            "Unknown" if result.update_available is None
            else ("Yes" if result.update_available else "No")
        ),
        "confidence": result.confidence.value if result.confidence else "n/a",
        "elapsed_seconds": round(elapsed_seconds, 3),
        "cache_hit": cache_hit if cache_hit is not None else "n/a",
        "retrieval_method": result.retrieval_method,
        "status": result.status.value,
    }
    logger.info("firmware_lookup_structured %s", json.dumps(fields, default=str))
