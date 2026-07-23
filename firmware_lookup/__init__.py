"""
firmware_lookup -- standalone provider-based firmware version lookup.

Given (vendor, model, current_version), returns only the latest official
firmware version, whether an update is available, and where the answer
came from. No changelogs, no CVE data, no bug-fix lists -- accuracy over
coverage, never fabricates a version.

    from firmware_lookup import get_latest_firmware
    result = get_latest_firmware("Cisco", "Catalyst 9300", "17.3.4")

This module is standalone and does not import from, or get imported by,
the existing firmware.py / firmware_fetchers.py / cli.py pipeline.
"""
from firmware_lookup.orchestrator import PROVIDERS, get_latest_firmware
from firmware_lookup.result import Confidence, FirmwareResult, Status

__all__ = [
    "get_latest_firmware",
    "FirmwareResult",
    "Confidence",
    "Status",
    "PROVIDERS",
]
