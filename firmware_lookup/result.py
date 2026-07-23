"""
Output contract for the firmware_lookup module.

Every provider returns a FirmwareResult, always — never raises, never
fabricates a version. The exact-string factory functions below are the
single source of truth for the literal messages the spec requires, so no
provider can typo them.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Optional


class Confidence(str, Enum):
    HIGH = "High"
    MEDIUM = "Medium"
    LOW = "Low"


class Status(str, Enum):
    OK = "ok"
    CANNOT_DETERMINE = "cannot_determine"
    AUTH_REQUIRED = "auth_required"
    NOT_IMPLEMENTED = "not_implemented"
    MODEL_NOT_FOUND = "model_not_found"
    AMBIGUOUS_MODEL = "ambiguous_model"


AUTH_REQUIRED_MESSAGE = (
    "Firmware version cannot be determined automatically.\n"
    "Vendor authentication or support entitlement required."
)
NOT_IMPLEMENTED_MESSAGE = "Provider not implemented."
MODEL_NOT_FOUND_MESSAGE = "Model not found."


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


@dataclass
class FirmwareResult:
    vendor: str
    model: str
    current_version: Optional[str]
    latest_version: Optional[str] = None
    update_available: Optional[bool] = None
    source_url: Optional[str] = None
    confidence: Optional[Confidence] = None
    retrieval_method: str = ""
    last_checked: str = field(default_factory=_now)
    status: Status = Status.CANNOT_DETERMINE
    message: str = ""

    def to_dict(self) -> dict:
        """Exactly the 8 spec-required keys (plus vendor/model/current_version)."""
        return {
            "vendor": self.vendor,
            "model": self.model,
            "current_version": self.current_version,
            "latest_version": self.latest_version,
            "update_available": self.update_available,
            "source_url": self.source_url,
            "confidence": self.confidence.value if self.confidence else None,
            "retrieval_method": self.retrieval_method,
            "last_checked": self.last_checked,
        }

    def to_full_dict(self) -> dict:
        d = self.to_dict()
        d["status"] = self.status.value
        d["message"] = self.message
        return d


def ok_result(
    vendor: str,
    model: str,
    current_version: Optional[str],
    latest_version: str,
    source_url: str,
    confidence: Confidence,
    retrieval_method: str,
    update_available: Optional[bool] = None,
    message: str = "",
) -> FirmwareResult:
    return FirmwareResult(
        vendor=vendor,
        model=model,
        current_version=current_version,
        latest_version=latest_version,
        update_available=update_available,
        source_url=source_url,
        confidence=confidence,
        retrieval_method=retrieval_method,
        status=Status.OK,
        message=message,
    )


def cannot_determine(
    vendor: str,
    model: str,
    current_version: Optional[str],
    retrieval_method: str,
    reason: str,
    manual_check_url: Optional[str] = None,
) -> FirmwareResult:
    """`manual_check_url`, when given, is the vendor's own real portal --
    the final-fallback link handed to the user when both the automatic
    public lookup AND (where applicable) login have already been tried
    and neither resolved. Same "never a dead end" pattern as
    not_implemented()'s manual_check_url."""
    message = reason
    if manual_check_url:
        message = f"{reason} You can check the current version yourself using the link below."
    return FirmwareResult(
        vendor=vendor,
        model=model,
        current_version=current_version,
        retrieval_method=retrieval_method,
        status=Status.CANNOT_DETERMINE,
        source_url=manual_check_url,
        message=message,
    )


def auth_required(
    vendor: str, model: str, current_version: Optional[str],
    manual_check_url: Optional[str] = None,
) -> FirmwareResult:
    message = AUTH_REQUIRED_MESSAGE
    if manual_check_url:
        message = (
            f"{AUTH_REQUIRED_MESSAGE} You can check the current version "
            "yourself using the link below."
        )
    return FirmwareResult(
        vendor=vendor,
        model=model,
        current_version=current_version,
        retrieval_method="login_required",
        status=Status.AUTH_REQUIRED,
        source_url=manual_check_url,
        message=message,
    )


def not_implemented(
    vendor: str, model: str, current_version: Optional[str],
    manual_check_url: Optional[str] = None,
    user_reason: Optional[str] = None,
) -> FirmwareResult:
    """`manual_check_url`, when given, is a real vendor page a HUMAN can
    open directly -- used for vendors whose site blocks automated
    access (bot/WAF challenges) but is perfectly reachable in a real
    browser. We don't fabricate a version or try to evade the block;
    we just hand the user the real link instead of a dead end.

    `user_reason`, when given, is a SHORT, user-facing explanation of
    a confirmed structural gap (e.g. "the hardware supports multiple
    Network Operating Systems, so no single vendor-tracked firmware
    version exists") -- distinct from a bot-wall, where the page is
    genuinely reachable but was never going to have a version number
    to find. Takes priority over the generic bot-wall wording below."""
    message = NOT_IMPLEMENTED_MESSAGE
    if user_reason:
        message = f"Firmware Version: Not Found\nReason: {user_reason}"
    elif manual_check_url:
        # Don't repeat the raw URL here -- source_url already carries it
        # as a real clickable link in the UI (see index.html's "Proof /
        # source" row); pasting it again as plain text is redundant and
        # reads as unpolished.
        message = (
            f"{NOT_IMPLEMENTED_MESSAGE} This vendor's site blocks "
            "automated access, but the link below goes straight to "
            "their real support page -- you can check the current "
            "version there yourself."
        )
    return FirmwareResult(
        vendor=vendor,
        model=model,
        current_version=current_version,
        retrieval_method="not_implemented",
        status=Status.NOT_IMPLEMENTED,
        source_url=manual_check_url,
        message=message,
    )


def model_not_found(
    vendor: str, model: str, current_version: Optional[str],
    retrieval_method: str = "",
    manual_check_url: Optional[str] = None,
) -> FirmwareResult:
    message = MODEL_NOT_FOUND_MESSAGE
    if manual_check_url:
        message = (
            f"{MODEL_NOT_FOUND_MESSAGE} You can check the current "
            "version yourself using the link below."
        )
    return FirmwareResult(
        vendor=vendor,
        model=model,
        current_version=current_version,
        retrieval_method=retrieval_method,
        status=Status.MODEL_NOT_FOUND,
        source_url=manual_check_url,
        message=message,
    )


def ambiguous_model(
    vendor: str, model: str, current_version: Optional[str],
    candidates: list[str], retrieval_method: str = "",
) -> FirmwareResult:
    """Distinct from model_not_found: we found MORE THAN ONE equally
    plausible candidate and refused to guess between them, rather than
    finding zero candidates at all."""
    listed = ", ".join(candidates) if candidates else "more than one candidate"
    message = (
        f"Multiple possible models matched '{model}' and none could be "
        f"selected with confidence: {listed}. Please specify the exact "
        "model name (including any SKU or hardware-revision suffix) to "
        "get a firmware result."
    )
    return FirmwareResult(
        vendor=vendor,
        model=model,
        current_version=current_version,
        retrieval_method=retrieval_method,
        status=Status.AMBIGUOUS_MODEL,
        message=message,
    )
