#!/usr/bin/env python3
"""Import collected vendor/model data into the switch-ocr knowledge base.

Input format (what field-collection tends to produce):
    [ {"name": "Vendor Name", "models": ["MODEL-1", "MODEL-2", ...]}, ... ]

Usage:
    python scripts/import_models.py collected.json [--kb switch_ocr/vendors.json]

The importer:
- maps vendor names onto existing KB brands (case/suffix tolerant:
  "Juniper Networks" -> Juniper, "TP-link" -> TP-Link, "Mikrotik" -> MikroTik),
- creates new vendor entries (name as alias) for unknown vendors,
- cleans messy model strings (multi-model cells, slash variants),
- deduplicates, and writes the merged vendors.json.

Data in, no code changes.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

SUFFIX_WORDS = {
    "networks", "network", "technologies", "technology", "systems", "system",
    "corporation", "corp", "inc", "ltd", "co", "enterprise", "enterprises",
    "electric", "electronics", "laboratories", "labs", "digital", "data",
    "communications", "communication", "solutions", "international", "group",
    "private", "limited", "gmbh", "ag", "srl", "sa",
}


def norm(s: str) -> str:
    return re.sub(r"[^a-z0-9]", "", s.lower())


def core_name(name: str) -> str:
    """Strip corporate suffixes and parentheticals: 'FS (FiberStore)' -> 'FS'."""
    base = re.sub(r"\([^)]*\)", " ", name)
    words = [w for w in re.split(r"[\s,]+", base) if w]
    core = [w for w in words if w.lower().strip(".") not in SUFFIX_WORDS]
    return " ".join(core) if core else name.strip()


def clean_models(raw_models) -> list:
    """Split multi-model cells, expand nothing fancy, drop junk."""
    out = []
    for cell in raw_models or []:
        if not isinstance(cell, str):
            continue
        # cells sometimes contain several models separated by wide whitespace
        for token in re.split(r"\s{2,}|\t+|\n+", cell.strip()):
            token = token.strip(" ,;")
            if not token:
                continue
            candidates = [token]
            if "/" in token:  # keep full compound AND its first variant
                first = token.split("/", 1)[0].strip()
                if len(first) >= 4:
                    candidates.append(first)
            for c in candidates:
                if 4 <= len(c) <= 40 and any(ch.isdigit() for ch in c):
                    out.append(c)
    return sorted(set(out))


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("input", help="collected JSON: [{name, models[]}, ...]")
    ap.add_argument("--kb", default=str(Path(__file__).resolve().parents[1]
                                        / "switch_ocr" / "vendors.json"))
    args = ap.parse_args()

    collected = json.load(open(args.input, encoding="utf-8"))
    kb = json.load(open(args.kb, encoding="utf-8"))
    vendors = kb["vendors"]

    # brand-name resolver: KB brand names + all aliases, suffix-stripped
    resolver = {}
    for brand, entry in vendors.items():
        resolver[norm(brand)] = brand
        resolver[norm(core_name(brand))] = brand
        for a in entry.get("aliases", []):
            resolver[norm(a)] = brand

    stats = {"matched": 0, "created": 0, "models_added": 0, "models_skipped": 0}
    for item in collected:
        raw_name = (item.get("name") or "").strip()
        if not raw_name:
            continue
        cname = core_name(raw_name)
        brand = resolver.get(norm(raw_name)) or resolver.get(norm(cname))
        if brand is None:
            brand = cname if len(cname) >= 2 else raw_name
            vendors[brand] = {"aliases": sorted({norm(raw_name) and raw_name.lower(),
                                                 cname.lower()} - {""}),
                              "patterns": []}
            resolver[norm(raw_name)] = brand
            resolver[norm(cname)] = brand
            stats["created"] += 1
        else:
            stats["matched"] += 1

        entry = vendors[brand]
        before = len(entry.get("models", []))
        cleaned = clean_models(item.get("models"))
        entry["models"] = sorted(set(entry.get("models", [])) | set(cleaned))
        stats["models_added"] += len(entry["models"]) - before
        stats["models_skipped"] += max(0, len(item.get("models") or []) - len(cleaned))

    json.dump(kb, open(args.kb, "w", encoding="utf-8"), indent=1)
    print(f"KB now has {len(vendors)} vendors | "
          f"vendor names matched to existing: {stats['matched']}, created: {stats['created']} | "
          f"models added: {stats['models_added']} (junk cells split/skipped: {stats['models_skipped']})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
