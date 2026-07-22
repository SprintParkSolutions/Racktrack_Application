"""Regression tests from the user's REAL production run (RapidOCR engine).

Each case reproduces the exact OCR strings from that run's CSV and asserts
the identifier now produces truth-or-nothing instead of promoted garbage.
"""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from switch_ocr.identify import (VENDORS, VENDOR_MODELS, _rebuild_model_index,
                                 identify_device)
from switch_ocr.types import TextDetection


def det(text, conf=0.8, box=(10, 10, 110, 26)):
    x1, y1, x2, y2 = box
    return TextDetection(text, conf, list(box),
                         [[x1, y1], [x2, y1], [x2, y2], [x1, y2]])


def dets(strings, confs=None, tall=None):
    out = []
    for i, s in enumerate(strings):
        conf = confs[i] if confs else 0.8
        h = 40 if (tall and i in tall) else 14
        y = 30 * i
        out.append(det(s, conf, (10, y, 10 + 8 * len(s), y + h)))
    return out


class TestMisreadBrandsResolveToTruth(unittest.TestCase):
    """OCR-damaged logos must resolve to the REAL vendor, never verbatim junk."""

    def test_qhap_is_qnap(self):          # test29.png: "Ufi | QHAP | S"
        got = identify_device(dets(["Ufi", "QHAP", "S"], confs=[0.5, 0.85, 0.4]))
        self.assertEqual(got.brand, "QNAP")

    def test_netoiar_is_netgear(self):    # test16.png: "NETOIAR | ZSTX | 0"
        got = identify_device(dets(["NETOIAR", "ZSTX", "0"],
                                   confs=[0.8, 0.4, 0.4], tall={0}))
        self.assertEqual(got.brand, "Netgear")

    def test_nstoear_is_netgear(self):    # test32.png (logo = prominent text)
        got = identify_device(dets(["NSTOEAR", "24 x 1000"],
                                   confs=[0.7, 0.6], tall={0}))
        self.assertEqual(got.brand, "Netgear")

    def test_small_lowconf_word_never_relaxed_matched(self):
        # A small, mid-confidence word similar to a vendor name ("Poule" ~
        # "Perle") must NOT become a brand — this is the zoom-noise case.
        got = identify_device(dets(["Poule", "12 13 14"], confs=[0.7, 0.6]))
        self.assertIsNone(got.brand)


class TestArtifactsNeverBecomeBrands(unittest.TestCase):
    """LED rows / port dots OCR as repeated letters — never a brand."""

    def test_cccccr(self):                # test13.png: "22 23 24 | 16 | 17 | CCCCCR"
        got = identify_device(dets(["22 23 24", "16", "17", "CCCCCR"],
                                   confs=[0.7, 0.7, 0.7, 0.8], tall={3}))
        self.assertIsNone(got.brand)

    def test_yyyyyy(self):                # test25.png: "a | YYYYYY | 5 | H"
        got = identify_device(dets(["a", "YYYYYY", "5", "H"],
                                   confs=[0.4, 0.8, 0.5, 0.5], tall={1}))
        self.assertIsNone(got.brand)


class TestFakeModelsSuppressed(unittest.TestCase):
    def test_as_number_is_not_a_model(self):   # test1.png
        got = identify_device(dets(
            ["Cloud Core Router", "Cr..rs", "Milkylan", "AS57199"],
            confs=[0.85, 0.5, 0.6, 0.9]))
        self.assertEqual(got.brand, "MikroTik")
        self.assertIsNone(got.model)

    def test_fragment_soup_no_brand_no_model(self):   # test23.png
        got = identify_device(dets(["0-", "P", "mmn", "910"],
                                   confs=[0.5, 0.5, 0.5, 0.5]))
        self.assertIsNone(got.brand)
        self.assertIsNone(got.model)

    def test_low_conf_fragments_never_join_into_model(self):  # test44.png
        got = identify_device(dets(["FOATINET.", "I", "oor", "3i0"],
                                   confs=[0.8, 0.4, 0.5, 0.5]))
        self.assertEqual(got.brand, "Fortinet")
        self.assertIsNone(got.model)


class TestCatalogReconciliation(unittest.TestCase):
    BRAND = "TestCo"

    def setUp(self):
        VENDORS[self.BRAND] = (["testco"], [])
        VENDOR_MODELS[self.BRAND] = [f"ABC-{n}000" for n in range(1, 11)]
        _rebuild_model_index()

    def tearDown(self):
        VENDORS.pop(self.BRAND, None)
        VENDOR_MODELS.pop(self.BRAND, None)
        _rebuild_model_index()

    def test_near_miss_snaps_to_catalog(self):
        got = identify_device(dets(["TestCo", "ABX-1000"], confs=[0.9, 0.8]))
        self.assertEqual(got.brand, self.BRAND)
        self.assertEqual(got.model, "ABC-1000")

    def test_unknown_token_gets_dampened(self):
        got = identify_device(dets(["TestCo", "ZZZ-9999"], confs=[0.9, 0.8]))
        self.assertEqual(got.brand, self.BRAND)
        # dampened guesses must fall below a 0.6 "only truth" gate
        self.assertLess(got.confidence, 0.6)

    def test_base_sku_not_extended_by_catalog(self):
        # Photo says the base SKU; catalog only has the "-R" variant.
        # We must report what the photo says, not invent the suffix.
        VENDOR_MODELS[self.BRAND] = ["QQQ-24T4S-R"]
        _rebuild_model_index()
        got = identify_device(dets(["TestCo", "QQQ-24T4S"], confs=[0.9, 0.8]))
        self.assertEqual(got.model, "QQQ-24T4S")

    def test_fragment_recovers_model_from_catalog(self):
        # "clate 100F" case: window-match whole strings against the catalog.
        VENDOR_MODELS[self.BRAND] = ["SUPERGATE 100F", "SUPERGATE 200F"]
        _rebuild_model_index()
        got = identify_device(dets(["TestCo", "clate 100F"], confs=[0.9, 0.75]))
        self.assertEqual(got.brand, self.BRAND)
        self.assertEqual(got.model, "SUPERGATE 100F")


if __name__ == "__main__":
    unittest.main(verbosity=2)
