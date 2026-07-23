"""
Model matching: exact -> normalized -> fuzzy (only above a high threshold,
and only if unambiguous). Never returns firmware for the wrong device --
if confidence is insufficient, the caller must return model_not_found()
instead of guessing.
"""
from __future__ import annotations

import re
from difflib import SequenceMatcher
from typing import Optional

FUZZY_THRESHOLD = 0.86
# A fuzzy match is only accepted if the runner-up isn't within this margin
# of the best score -- avoids picking between two equally-plausible SKUs.
AMBIGUITY_MARGIN = 0.02


def normalize_model(s: str) -> str:
    """lowercase, collapse whitespace, strip common punctuation."""
    s = s.strip().lower()
    s = re.sub(r"[-_/]+", " ", s)
    s = re.sub(r"\s+", " ", s)
    return s.strip()


def match_model(requested: str, catalog: list[str]) -> tuple[Optional[str], float, str]:
    """
    Returns (matched_model_or_None, score, method) where method is one of
    "exact", "normalized", "contains", "fuzzy", "ambiguous", "none".

    "none" means zero plausible candidates were found (safe to treat as
    "model not found"). "ambiguous" means MULTIPLE equally plausible
    candidates were found and none could be safely selected -- callers
    must NOT treat this the same as "none"; it should surface as a
    distinct ambiguous-model result rather than a not-found one.
    """
    if not requested or not catalog:
        return None, 0.0, "none"

    # 1. Exact match (case-sensitive).
    if requested in catalog:
        return requested, 1.0, "exact"

    # 2. Normalized match (case/whitespace/punctuation-insensitive).
    norm_req = normalize_model(requested)
    norm_map: dict[str, str] = {}
    for candidate in catalog:
        norm_map.setdefault(normalize_model(candidate), candidate)
    if norm_req in norm_map:
        return norm_map[norm_req], 0.99, "normalized"

    # 3. Containment: the requested name is a whole-word prefix/substring
    # of exactly one candidate (e.g. "ioLogik 2500" vs "ioLogik 2500
    # Series"), or vice versa. Only accepted if unambiguous.
    contains_matches = [
        orig for norm_cand, orig in norm_map.items()
        if re.search(rf"(^|\s){re.escape(norm_req)}(\s|$)", norm_cand)
        or re.search(rf"(^|\s){re.escape(norm_cand)}(\s|$)", norm_req)
    ]
    if len(contains_matches) == 1:
        return contains_matches[0], 0.95, "contains"
    if len(contains_matches) > 1:
        return None, 0.95, "ambiguous"

    # 4. Fuzzy match -- only if it clears the threshold AND is unambiguous.
    scored = sorted(
        ((SequenceMatcher(None, norm_req, cand_norm).ratio(), cand_orig)
         for cand_norm, cand_orig in norm_map.items()),
        key=lambda t: t[0],
        reverse=True,
    )
    if not scored:
        return None, 0.0, "none"
    best_score, best_candidate = scored[0]
    runner_up_score = scored[1][0] if len(scored) > 1 else 0.0
    if best_score >= FUZZY_THRESHOLD:
        if (best_score - runner_up_score) > AMBIGUITY_MARGIN:
            return best_candidate, best_score, "fuzzy"
        return None, best_score, "ambiguous"

    return None, best_score, "none"


def find_ambiguous_candidates(requested: str, catalog: list[str]) -> list[str]:
    """Re-derives the candidate set match_model() flagged as "ambiguous"
    (either the >1 containment matches, or the fuzzy top-scorers within
    AMBIGUITY_MARGIN of the best score) -- used to build a human-readable
    ambiguous_model() message. Only meaningful after match_model()
    returned method == "ambiguous"."""
    if not requested or not catalog:
        return []
    norm_req = normalize_model(requested)
    norm_map: dict[str, str] = {}
    for candidate in catalog:
        norm_map.setdefault(normalize_model(candidate), candidate)

    contains_matches = [
        orig for norm_cand, orig in norm_map.items()
        if re.search(rf"(^|\s){re.escape(norm_req)}(\s|$)", norm_cand)
        or re.search(rf"(^|\s){re.escape(norm_cand)}(\s|$)", norm_req)
    ]
    if len(contains_matches) > 1:
        return sorted(contains_matches)

    scored = sorted(
        ((SequenceMatcher(None, norm_req, cand_norm).ratio(), cand_orig)
         for cand_norm, cand_orig in norm_map.items()),
        key=lambda t: t[0],
        reverse=True,
    )
    if not scored:
        return []
    best_score = scored[0][0]
    return sorted(
        orig for score, orig in scored
        if best_score - score <= AMBIGUITY_MARGIN
    )
