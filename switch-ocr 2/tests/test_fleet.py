"""Fleet regression test: every make/model from the user's real photo set.

Each case simulates what the OCR layer typically hands the identifier for
that photo (brand logo text, model string, surrounding panel words). The
identifier must produce the right make + model for ALL of them.
"""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from switch_ocr.identify import identify_device
from switch_ocr.types import TextDetection


def det(text, conf=0.85, box=(0, 0, 100, 14)):
    x1, y1, x2, y2 = box
    return TextDetection(text=text, confidence=conf, box=list(box),
                         polygon=[[x1, y1], [x2, y1], [x2, y2], [x1, y2]])


# (photo description, OCR strings, expected brand, expected model)
FLEET = [
    ("TL-SG108PE angled", ["TP-LINK", "8-Port Gigabit Easy Smart Switch with 4-Port PoE",
                           "TL-SG108PE", "PoE", "Reset"], "TP-Link", "TL-SG108PE"),
    ("TL-SG108 front", ["tp-link", "8-Port Gigabit Desktop Switch", "Link/Act",
                        "TL-SG108", "Power"], "TP-Link", "TL-SG108"),
    ("TL-SG1016D", ["tp-link", "TL-SG1016D", "16-Port Gigabit Switch",
                    "1000Mbps"], "TP-Link", "TL-SG1016D"),
    ("D-Link 24p PoE", ["D-Link", "DGS-1028P", "PoE OK"], "D-Link", "DGS-1028P"),
    ("Juniper EX4400", ["JUNIPER", "EX4400", "junos"], "Juniper", "EX4400"),
    ("TL-SG2428P rack", ["tp-link", "TL-SG2428P", "JetStream",
                         "28-Port Gigabit Smart", "Switch with 24-Port PoE+",
                         "Speed or PoE", "PoE MAX", "FAN", "SYS"],
     "TP-Link", "TL-SG2428P"),
    ("DGS-1016D close-up", ["D-Link", "DGS-1016D"], "D-Link", "DGS-1016D"),
    ("DGS-1024C", ["D-Link", "Gigabit Switch", "DGS-1024C", "10/100M Link Act",
                   "1000M Link Act"], "D-Link", "DGS-1024C"),
    ("Juniper SSG 140 strip", ["Juniper", "SSG 140"], "Juniper", "SSG 140"),
    ("Zyxel GS1100-16", ["ZYXEL", "GS1100-16", "LNK/ACT", "PWR",
                         "100/1000Base-T Port (1-16)"], "Zyxel", "GS1100-16"),
    ("DGS-1024D strip", ["D-Link", "DGS-1024D"], "D-Link", "DGS-1024D"),
    ("TL-SG1218MPE wide", ["tp-link", "TL-SG1218MPE", "PoE Status", "Link /Act",
                           "Reset"], "TP-Link", "TL-SG1218MPE"),
    ("Omada SG3428XPP-M2", ["tp-link | omada", "SG3428XPP-M2",
                            "2.5G PoE++/PoE++ L2+ Managed Switch"],
     "TP-Link", "SG3428XPP-M2"),
    ("TL-SF1009P", ["tp-link", "TL-SF1009P", "9-Port 10/100Mbps Desktop Switch",
                    "with 8-Port PoE+", "Uplink"], "TP-Link", "TL-SF1009P"),
    ("TL-SG608E crop", ["tp-link", "TL-SG608E", "8-Port Gigabit Easy Smart Switch",
                        "1000M", "10M/100M"], "TP-Link", "TL-SG608E"),
    ("TL-SG1006PP", ["tp-link", "TL-SG1006PP", "PoE++", "PoE Max"],
     "TP-Link", "TL-SG1006PP"),
    ("TL-SG1024DE top", ["TP-LINK", "TL-SG1024DE", "24-Port Gigabit Easy Smart Switch"],
     "TP-Link", "TL-SG1024DE"),
    ("Zyxel GS1900-24 strip", ["ZyXEL", "GS1900-24", "PWR", "LNK/ACT"],
     "Zyxel", "GS1900-24"),
    ("DGS-1210-28P web smart", ["D-Link", "WEB SMART SWITCH", "DGS-1210-28P",
                                "Link/Act"], "D-Link", "DGS-1210-28P"),
    ("DGS-1100-16 strip", ["D-Link", "DGS-1100-16", "Power"], "D-Link", "DGS-1100-16"),
    ("DES-1210-52", ["D-Link", "DES-1210-52", "Web Smart Switch", "Power"],
     "D-Link", "DES-1210-52"),
    ("Juniper MX80", ["Juniper", "NETWORKS", "MX80", "CONSOLE"], "Juniper", "MX80"),
    ("TP-Link ER7206", ["tp-link", "ER7206", "Omada Gigabit VPN Router",
                        "WAN", "WAN/LAN", "SFP WAN"], "TP-Link", "ER7206"),
    # OCR-degraded versions of the hard rack shots
    ("SG2428P blurry read", ["tp-lirk", "TL-5G2428P", "JetStream"],
     "TP-Link", "TL-SG2428P"),
    ("GS1100 dark, fragmented", ["ZYXEL", "GS1100", "-16"], "Zyxel", "GS1100-16"),
    # ---- broader vendor coverage ("any vendor") ----------------------- #
    ("Ruckus ICX", ["RUCKUS", "ICX7150-24P"], "Ruckus", "ICX7150-24P"),
    ("EnGenius", ["EnGenius", "EWS7928P"], "EnGenius", "EWS7928P"),
    ("Netonix WISP", ["NETONIX", "WS-12-250-AC"], "Netonix", "WS-12-250-AC"),
    ("NVIDIA Mellanox", ["NVIDIA", "SN2010"], "NVIDIA/Mellanox", "SN2010"),
    ("Alcatel OmniSwitch", ["Alcatel-Lucent", "OmniSwitch", "OS6360-P24"],
     "Alcatel-Lucent", "OS6360-P24"),
    ("QNAP", ["QNAP", "QSW-M408-4C"], "QNAP", "QSW-M408-4C"),
    ("Hikvision", ["HIKVISION", "DS-3E0326P-E"], "Hikvision", "DS-3E0326P-E"),
    ("TRENDnet", ["TRENDnet", "TEG-S24Dg"], "TRENDnet", "TEG-S24DG"),
    ("MikroTik CRS", ["MikroTik", "CRS326-24G-2S+"], "MikroTik", "CRS326-24G-2S+"),
    ("MikroTik CCR, logo unreadable", ["Cloud Core Router", "CCR1072-1G-8S+",
                                       "ccr1072.core.brs"],
     "MikroTik", "CCR1072-1G-8S+"),
    ("MikroTik CRS328 PoE", ["MikroTik", "Cloud Router Switch", "CRS328-24P-4S+RM"],
     "MikroTik", "CRS328-24P-4S+RM"),
    ("MikroTik CSS via family name", ["Cloud Smart Switch", "CSS326-24G-2S+RM"],
     "MikroTik", "CSS326-24G-2S+RM"),
    ("MikroTik CRS518", ["MikroTik", "CRS518-16XS-2XQ"], "MikroTik", "CRS518-16XS-2XQ"),
    ("Netgear JGS524E", ["NETGEAR", "ProSAFE JGS524E"], "Netgear", "JGS524E"),
    ("TP-Link SG3424 managed", ["TP-LINK", "TL-SG3424", "JetStream",
                                "L2 Managed Switch"], "TP-Link", "TL-SG3424"),
    ("Ubiquiti UniFi", ["UniFi", "USW-24-POE"], "Ubiquiti", "USW-24-POE"),
    # brand known, model format NOT in the pattern base -> generic rescue
    ("FS.com generic model", ["FS.COM", "S3900-24T4S"], "FS", "S3900-24T4S"),
    # ---- cases from the 59-photo field test ---------------------------- #
    ("FortiGate 100F", ["FORTINET.", "FortiGate 100F", "STATUS", "ALARM"],
     "Fortinet", "FORTIGATE 100F"),
    ("FortiGate 200F", ["FORTINET.", "FortiGate 200F"], "Fortinet", "FORTIGATE 200F"),
    ("TP-Link T-series", ["tp-link", "T1700G-28TQ",
                          "JetStream Gigabit Stackable Smart Switch"],
     "TP-Link", "T1700G-28TQ"),
    ("FS FSR router", ["FS", "FSR-3610"], "FS", "FSR-3610"),
    ("Zyxel one-line brand+model, OCR i", ["ZYXEL GSi100-16", "LNK/ACT"],
     "Zyxel", "GS1100-16"),
    # Damaged tp-link logo must not flip to TOTOLINK (dash is the signal).
    ("tp-link damaged logo", ["} of to-link", "ER7206"], "TP-Link", "ER7206"),
    ("Cambium cnMatrix", ["Cambium Networks", "cnMatrix", "EX2028"],
     "Cambium", "EX2028"),
]

#: Completely unknown vendor: brand can't be named, but the model string
#: must still be surfaced by the generic detector.
UNKNOWN_VENDOR = (["SODOLA", "SL-SWTG124AS"], "SL-SWTG124AS")


class TestFleet(unittest.TestCase):
    def test_every_device_identified(self):
        failures = []
        for name, strings, want_brand, want_model in FLEET:
            dets = []
            for i, s in enumerate(strings):
                # lay strings out as separate lines; fragments ("-16") are
                # placed adjacent to the previous string on the same row
                if s.startswith("-") and dets:
                    prev = dets[-1]
                    box = (prev.box[2] + 3, prev.box[1],
                           prev.box[2] + 3 + 8 * len(s), prev.box[3])
                else:
                    box = (10, 20 * i, 10 + 8 * len(s), 20 * i + 14)
                dets.append(det(s, box=box))
            got = identify_device(dets)
            norm = lambda m: (m or "").replace(" ", "").replace("5G", "SG").upper()
            if got.brand != want_brand or norm(got.model) != norm(want_model):
                failures.append(f"{name}: want {want_brand} {want_model}, "
                                f"got {got.brand} {got.model}")
        self.assertEqual(failures, [], "\n" + "\n".join(failures))

    def test_unknown_vendor_still_yields_model_and_inferred_brand(self):
        strings, want_model = UNKNOWN_VENDOR
        dets = [det(s, box=(10, 20 * i, 10 + 8 * len(s), 20 * i + 14))
                for i, s in enumerate(strings)]
        got = identify_device(dets)
        # Brand is not in any knowledge base -> inferred from the faceplate.
        self.assertEqual(got.brand, "SODOLA")
        self.assertEqual((got.model or "").upper(), want_model)
        self.assertGreater(got.confidence, 0.1)

    def test_damaged_dashed_logo_beats_fuzzy_lookalike_brand(self):
        # Exact strings from field test58: no model evidence available, the
        # damaged "tp-link" wordmark alone must still resolve to TP-Link,
        # not TOTOLINK.
        got = identify_device([
            det("} of to-link", 0.68, (10, 5, 90, 30)),
            det("~~ om", 0.48, (10, 40, 40, 52)),
        ])
        self.assertEqual(got.brand, "TP-Link")

    def test_brand_fragments_not_promoted_to_new_brand(self):
        # "INET." is a fragment of FORTINET; "Cloud" of Cloud Smart Switch.
        for junk in ("INET.", "Cloud"):
            got = identify_device([det(junk, 0.9, (10, 5, 60, 40))])
            self.assertIsNone(got.brand, junk)

    def test_ocr_noise_is_never_promoted_to_brand(self):
        # Real failure from the 59-photo field test: junk at low confidence.
        got = identify_device([
            det("Toy peal", 0.12, (10, 5, 80, 40)),
            det("380 140 3", 0.70, (10, 60, 90, 72)),
        ])
        self.assertIsNone(got.brand)

    def test_port_number_soup_is_never_a_model(self):
        # "I124134" = concatenated port digits; must not become the model.
        got = identify_device([
            det("D-Link", 0.9, (10, 5, 70, 40)),
            det("I124134", 0.55, (10, 60, 80, 72)),
        ])
        self.assertEqual(got.brand, "D-Link")
        self.assertIsNone(got.model)

    def test_letter_prefix_survives_ocr_fix(self):
        from switch_ocr.identify import _digit_context_fix
        self.assertEqual(_digit_context_fix("ZYXEL GSI100-16"), "ZYXEL GS1100-16")
        self.assertEqual(_digit_context_fix("DGS-11OO-16"), "DGS-1100-16")
        self.assertEqual(_digit_context_fix("GS724T"), "GS724T")  # S untouched

    def test_unknown_vendor_prominent_logo(self):
        # Big logo + small descriptive text + model: logo wins by prominence.
        dets = [
            det("Nexxt", 0.9, box=(10, 5, 80, 45)),          # tall = logo
            det("Vertical Rackmount", 0.8, box=(10, 60, 150, 72)),
            det("NW-S24G", 0.85, box=(10, 80, 80, 92)),
        ]
        got = identify_device(dets)
        self.assertEqual(got.brand, "Nexxt")
        self.assertEqual(got.model, "NW-S24G")

    def test_extra_vendors_file_extends_kb_without_code_changes(self):
        import json
        import tempfile

        from switch_ocr.identify import VENDORS, load_extra_vendors
        self.assertNotIn("Sodola", VENDORS)
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as fh:
            json.dump({"vendors": {"Sodola": {
                "aliases": ["sodola"],
                "patterns": [r"\bSL-[A-Z0-9]+\b"],
            }}}, fh)
            path = fh.name
        load_extra_vendors(path)
        try:
            got = identify_device([
                det("SODOLA", 0.9, (0, 0, 60, 12)),
                det("SL-SWTG124AS", 0.85, (0, 20, 90, 32)),
            ])
            self.assertEqual(got.brand, "Sodola")
            self.assertEqual(got.model, "SL-SWTG124AS")
        finally:
            VENDORS.pop("Sodola", None)  # keep other tests isolated


if __name__ == "__main__":
    unittest.main(verbosity=2)
