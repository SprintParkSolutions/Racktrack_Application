"""Unit tests for the engine-independent parts of the pipeline.

Run:  python -m pytest tests/ -v      (or: python -m unittest discover tests)
"""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from switch_ocr.config import OCRConfig
from switch_ocr.identify import identify_device
from switch_ocr.merge import merge_detections, _iou
from switch_ocr.preprocess import build_variants
from switch_ocr.types import TextDetection


def det(text, conf, box, variant="original"):
    x1, y1, x2, y2 = box
    poly = [[x1, y1], [x2, y1], [x2, y2], [x1, y2]]
    return TextDetection(text=text, confidence=conf, box=list(box),
                         polygon=poly, variant=variant)


class TestMerge(unittest.TestCase):
    def test_iou(self):
        self.assertAlmostEqual(_iou([0, 0, 10, 10], [0, 0, 10, 10]), 1.0)
        self.assertEqual(_iou([0, 0, 10, 10], [20, 20, 30, 30]), 0.0)

    def test_dedup_keeps_best_confidence(self):
        a = det("DGS-1100-16", 0.95, (10, 10, 100, 30), "upscaled")
        b = det("DGS-11OO-16", 0.60, (12, 11, 99, 29), "original")
        merged = merge_detections([a, b])
        self.assertEqual(len(merged), 1)
        self.assertEqual(merged[0].text, "DGS-1100-16")

    def test_containment_dedup(self):
        whole = det("D-Link DGS-1100-16", 0.9, (0, 0, 200, 30))
        part = det("DGS-1100-16", 0.85, (100, 5, 195, 28))
        merged = merge_detections([whole, part])
        self.assertEqual(len(merged), 1)
        self.assertEqual(merged[0].text, "D-Link DGS-1100-16")

    def test_low_confidence_dropped_and_reading_order(self):
        keep = det("SERIAL", 0.9, (0, 50, 50, 70))
        first = det("TOP", 0.8, (0, 0, 30, 20))
        drop = det("noise", 0.1, (200, 200, 220, 210))
        merged = merge_detections([keep, first, drop], min_confidence=0.35)
        self.assertEqual([d.text for d in merged], ["TOP", "SERIAL"])

    def test_empty_text_dropped(self):
        merged = merge_detections([det("   ", 0.99, (0, 0, 10, 10))])
        self.assertEqual(merged, [])


class TestIdentify(unittest.TestCase):
    def test_dlink_brand_and_model(self):
        dev = identify_device([
            det("D-Link", 0.91, (10, 10, 60, 25)),
            det("DGS-1100-16", 0.88, (10, 40, 80, 55)),
            det("Power", 0.70, (10, 70, 40, 80)),
        ])
        self.assertEqual(dev.brand, "D-Link")
        self.assertEqual(dev.model, "DGS-1100-16")
        self.assertGreater(dev.confidence, 0.5)

    def test_ocr_errors_still_identified(self):
        dev = identify_device([
            det("D-Lirk", 0.55, (0, 0, 50, 10)),        # fuzzy brand
            det("DGS-11OO-16", 0.62, (0, 20, 80, 30)),  # O instead of 0
        ])
        self.assertEqual(dev.brand, "D-Link")
        self.assertEqual(dev.model, "DGS-1100-16")

    def test_model_alone_implies_brand(self):
        dev = identify_device([det("WS-C2960X-24TS-L", 0.8, (0, 0, 100, 12))])
        self.assertEqual(dev.brand, "Cisco")
        self.assertEqual(dev.model, "WS-C2960X-24TS-L")

    def test_panel_words_not_mistaken_for_model(self):
        dev = identify_device([
            det("GIGABIT ETHERNET", 0.9, (0, 0, 90, 10)),
            det("10/100/1000", 0.9, (0, 20, 60, 30)),
            det("CONSOLE", 0.9, (0, 40, 40, 50)),
        ])
        self.assertIsNone(dev.model)

    def test_netgear(self):
        dev = identify_device([
            det("NETGEAR", 0.93, (0, 0, 70, 12)),
            det("ProSAFE GS724T", 0.81, (0, 20, 90, 32)),
        ])
        self.assertEqual(dev.brand, "Netgear")
        self.assertEqual(dev.model, "GS724T")

    def test_empty(self):
        dev = identify_device([])
        self.assertIsNone(dev.brand)
        self.assertEqual(dev.display_name, "unknown device")

    def test_split_model_rejoined_across_fragments(self):
        # OCR split "DGS-1100-16" into two neighbouring boxes on one line.
        dev = identify_device([
            det("D-Link", 0.9, (10, 10, 60, 25)),
            det("DGS-1100", 0.8, (10, 40, 70, 55)),
            det("-16", 0.7, (74, 41, 95, 55)),
        ])
        self.assertEqual(dev.model, "DGS-1100-16")

    def test_split_suffix_rejoined(self):
        dev = identify_device([
            det("NETGEAR", 0.9, (0, 0, 70, 12)),
            det("GS724", 0.8, (0, 30, 50, 42)),
            det("T", 0.75, (52, 30, 60, 42)),
        ])
        self.assertEqual(dev.model, "GS724T")

    def test_weak_cisco_series_pattern(self):
        dev = identify_device([det("2960-X", 0.6, (0, 0, 60, 12))])
        self.assertEqual(dev.brand, "Cisco")
        self.assertIn("2960", dev.model)

    def test_distant_fragments_not_joined(self):
        # Same row but far apart -> port label digits must not fuse into a
        # fake model number.
        dev = identify_device([
            det("01", 0.9, (0, 0, 20, 12)),
            det("02", 0.9, (300, 0, 320, 12)),
        ])
        self.assertIsNone(dev.model)


class TestPreprocess(unittest.TestCase):
    def _img(self, w=400, h=200):
        rng = np.random.default_rng(0)
        return rng.integers(0, 255, (h, w, 3), dtype=np.uint8)

    def test_variants_shapes_and_scales(self):
        cfg = OCRConfig()
        variants = build_variants(self._img(), cfg)
        names = [v[0] for v in variants]
        self.assertEqual(names, ["original", "enhanced", "upscaled"])
        for name, img, scale in variants:
            self.assertEqual(img.dtype, np.uint8)
            if name == "upscaled":
                self.assertGreater(scale, 1.0)
                self.assertLessEqual(scale, cfg.max_upscale + 1e-9)
                self.assertEqual(img.shape[1], int(round(400 * scale)))
            else:
                self.assertEqual(scale, 1.0)
                self.assertEqual(img.shape[:2], (200, 400))

    def test_big_image_not_upscaled(self):
        cfg = OCRConfig()
        big = self._img(w=3000, h=1500)
        for name, img, scale in build_variants(big, cfg):
            self.assertEqual(scale, 1.0)  # falls back to enhanced

    def test_config_validation(self):
        with self.assertRaises(ValueError):
            OCRConfig(variants=["nope"]).validate()
        with self.assertRaises(ValueError):
            OCRConfig(engine="bad").validate()
        OCRConfig.fast().validate()
        OCRConfig.accurate().validate()


if __name__ == "__main__":
    unittest.main(verbosity=2)
