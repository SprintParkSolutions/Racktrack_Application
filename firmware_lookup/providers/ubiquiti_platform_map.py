"""
Manually curated Ubiquiti UniFi-switch marketing-name -> platform-code
mapping.

NOT live-fetched. Verified live this session that fw-update.ui.com's
firmware API never exposes a marketing name anywhere in its response --
the `product` field is always the literal string "unifi-firmware", and
`platform` is always an internal code (e.g. "US24PL2"). ui.com's own
download-center and community.ui.com pages are client-rendered SPAs with
no server-rendered mapping table either. No official live source
publishes this mapping, so it has to be maintained here.

One marketing name can map to multiple platform codes (different
hardware revisions of "the same" product line share a marketing name but
ship different firmware) -- that's intentional; ubiquiti.py treats more
than one of a name's codes being present in the live API response as a
genuine hardware-revision ambiguity (ambiguous_model), not a bug.

Extend as new models are confirmed. Entries should be spot-checked
against ui.com/download/unifi or an official spec sheet before trusting
them for a new model -- this table is not authoritative, it's a
best-effort bridge between what customers type and what the API returns.
"""
from __future__ import annotations

UNIFI_SWITCH_PLATFORM_MAP: dict[str, list[str]] = {
    "USW-Lite-16-PoE":  ["US16P150"],
    "USW-24":           ["US24"],
    "USW-24-PoE":       ["US24P250"],
    "USW-24-PoE-500W":  ["US24P500"],
    "USW-24-Gen2":      ["US24PL2"],
    "USW-Pro-24":       ["US24PRO"],
    "USW-Pro-24-PoE":   ["US24PRO2"],
    "USW-48":           ["US48"],
    "USW-48-PoE":       ["US48P500"],
    "USW-48-PoE-750W":  ["US48P750"],
    "USW-48-Gen2":      ["US48PL2"],
    "USW-Pro-48":       ["US48PRO"],
    "USW-Pro-48-PoE":   ["US48PRO2"],
    "USW-6XG-150":      ["US624P"],
    # Legacy "UniFi Switch" naming (pre-USW rename) -- codes observed
    # live this session, names inferred from Ubiquiti's public product
    # history. Spot-check before extending.
    "US-16-150W":       ["S216150"],
    "US-24-250W":       ["S224250"],
    "US-24-500W":       ["S224500"],
    "US-48-500W":       ["S248500"],
    "US-48-750W":       ["S248750"],
    "US-8-150W":        ["S28150"],
}

# Common customer-typed variants (matched via matching.normalize_model,
# so case/whitespace/punctuation differences are already handled --
# these cover WORD-level differences, like dropping "UniFi"/"Switch").
UNIFI_ALIASES: dict[str, str] = {
    "unifi switch 24 poe": "USW-24-PoE",
    "unifi switch 48 poe": "USW-48-PoE",
    "switch 24 poe": "USW-24-PoE",
    "switch 48 poe": "USW-48-PoE",
    "pro 24 poe": "USW-Pro-24-PoE",
    "pro 48 poe": "USW-Pro-48-PoE",
    "usw24poe": "USW-24-PoE",
    "usw48poe": "USW-48-PoE",
}
