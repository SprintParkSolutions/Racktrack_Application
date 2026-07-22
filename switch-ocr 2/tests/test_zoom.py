"""Tests for the zoom-and-retry second-look pass."""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from switch_ocr.config import OCRConfig
from switch_ocr.preprocess import plan_zoom_regions, zoom_region
from switch_ocr.types import TextDetection


def det(text, conf, box):
    x1, y1, x2, y2 = box
    return TextDetection(text, conf, list(box),
                         [[x1, y1], [x2, y1], [x2, y2], [x1, y2]])


class TestPlanZoomRegions(unittest.TestCase):
    def test_regions_surround_detections(self):
        cfg = OCRConfig()
        # >=3 detections -> no blind-sweep bands, only detection regions
        dets = [det("D-Link", 0.9, (100, 40, 160, 60)),
                det("Power", 0.8, (110, 70, 150, 85)),
                det("x", 0.7, (120, 90, 130, 100))]
        regions = plan_zoom_regions((200, 1000, 3), dets, cfg)
        self.assertEqual(len(regions), 1)  # overlapping -> merged to one
        x1, y1, x2, y2 = regions[0]
        # generously larger than the detections, clamped to the image
        self.assertLess(x1, 100); self.assertGreater(x2, 160)
        self.assertLess(y1, 40); self.assertGreater(y2, 60)
        self.assertGreaterEqual(x1, 0); self.assertLessEqual(y2, 200)

    def test_sparse_pass_adds_bands_and_covers_detection(self):
        cfg = OCRConfig()
        dets = [det("D-Link", 0.9, (100, 40, 160, 60))]
        regions = plan_zoom_regions((200, 1000, 3), dets, cfg)  # strip shape
        self.assertGreaterEqual(len(regions), 1)
        covered = any(r[0] <= 100 and r[2] >= 160 and r[1] <= 40 and r[3] >= 60
                      for r in regions)
        self.assertTrue(covered, f"detection not covered by any region: {regions}")

    def test_overlapping_regions_merge_and_cap(self):
        cfg = OCRConfig(zoom_max_regions=3)
        dets = [det(f"t{i}", 0.5 + i * 0.01, (100 + i * 10, 40, 150 + i * 10, 60))
                for i in range(10)]  # heavily overlapping
        regions = plan_zoom_regions((200, 1000, 3), dets, cfg)
        self.assertLessEqual(len(regions), 3)
        self.assertEqual(len(regions), 1)  # all overlap -> one union region

    def test_blind_first_pass_sweeps_strip_in_bands(self):
        cfg = OCRConfig()
        regions = plan_zoom_regions((150, 900, 3), [], cfg)  # strip shape, no dets
        self.assertEqual(len(regions), 3)
        self.assertTrue(all(b[3] - b[1] == 150 for b in regions))  # full height

    def test_blind_first_pass_quadrants_on_normal_photo(self):
        cfg = OCRConfig()
        regions = plan_zoom_regions((800, 1000, 3), [], cfg)
        self.assertEqual(len(regions), 4)


class TestZoomRegion(unittest.TestCase):
    def test_coordinates_roundtrip(self):
        cfg = OCRConfig()
        img = np.random.default_rng(0).integers(0, 255, (150, 900, 3), dtype=np.uint8)
        box = [100, 30, 300, 120]
        zoomed, (ox, oy), scale = zoom_region(img, box, cfg)
        self.assertEqual((ox, oy), (100, 30))
        self.assertGreater(scale, 1.0)
        self.assertLessEqual(scale, cfg.zoom_max_scale)
        # a point at zoomed centre maps back inside the original box
        zx, zy = zoomed.shape[1] / 2, zoomed.shape[0] / 2
        X, Y = zx / scale + ox, zy / scale + oy
        self.assertTrue(box[0] <= X <= box[2] and box[1] <= Y <= box[3])

    def test_empty_crop_is_safe(self):
        cfg = OCRConfig()
        img = np.zeros((100, 100, 3), dtype=np.uint8)
        zoomed, _, scale = zoom_region(img, [50, 50, 50, 90], cfg)
        self.assertIsNone(zoomed)


class TestRotateAndBinarize(unittest.TestCase):
    def test_rotation_roundtrip(self):
        from switch_ocr.preprocess import rotate_image
        img = np.zeros((200, 400, 3), dtype=np.uint8)
        img[95:105, 195:205] = 255  # marker near centre
        rotated, inv = rotate_image(img, 7.0)
        ys, xs = np.where(rotated[:, :, 0] > 200)
        pt = np.array([[xs.mean(), ys.mean(), 1.0]])
        back = pt @ inv.T
        self.assertAlmostEqual(back[0, 0], 200, delta=3)
        self.assertAlmostEqual(back[0, 1], 100, delta=3)

    def test_otsu_auto_polarity(self):
        from switch_ocr.preprocess import otsu_binarize
        # white text on dark chassis -> must come out dark-on-light
        dark = np.full((60, 200, 3), 30, np.uint8)
        dark[20:40, 50:150] = 230
        out = otsu_binarize(dark)
        self.assertGreater(float(np.mean(out)), 127)
        # dark text on light label -> unchanged polarity
        light = np.full((60, 200, 3), 220, np.uint8)
        light[20:40, 50:150] = 20
        out2 = otsu_binarize(light)
        self.assertGreater(float(np.mean(out2)), 127)

    def test_time_budget_skips_escalation(self):
        import time as _t
        from switch_ocr import OCRConfig, SwitchTextReader
        cfg = OCRConfig(time_budget=0.001, engine="tesseract")
        r = SwitchTextReader(cfg)
        t0 = _t.perf_counter()
        res = r.read("tests/data/dlink_rack_strip.png")
        elapsed = _t.perf_counter() - t0
        self.assertTrue(res.ok)
        self.assertFalse([d for d in res.detections if d.variant in ("zoom", "rotate")])
        # baseline only: must be far below an un-budgeted escalated run
        self.assertLess(elapsed, 60)

    def test_config_validation(self):
        with self.assertRaises(ValueError):
            OCRConfig(time_budget=-1).validate()
        OCRConfig(time_budget=0).validate()  # 0 = unlimited


if __name__ == "__main__":
    unittest.main(verbosity=2)
