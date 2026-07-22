"""Adapter tests for the RapidOCR backend, using mocked rapidocr modules.

Verifies the two things that actually broke in the field:
1. The detector input-size cap is raised (params passed on init).
2. Both rapidocr API generations (2.x object / 1.x tuple) are parsed.
"""
from __future__ import annotations

import sys
import types
import unittest
from pathlib import Path
from types import SimpleNamespace

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from switch_ocr.config import OCRConfig
from switch_ocr.engines.rapidocr_engine import RapidEngine

IMG = np.zeros((50, 100, 3), dtype=np.uint8)
POLY = [[10, 10], [90, 10], [90, 20], [10, 20]]


class TestModernRapidOCR(unittest.TestCase):
    def setUp(self):
        self.init_kwargs = {}
        captured = self.init_kwargs

        class FakeRapidOCR:
            def __init__(self, **kwargs):
                captured.update(kwargs)

            def __call__(self, img):
                return SimpleNamespace(
                    boxes=np.array([POLY], dtype=np.float32),
                    txts=("DGS-1100-16",),
                    scores=(0.91,),
                )

        mod = types.ModuleType("rapidocr")
        mod.RapidOCR = FakeRapidOCR
        sys.modules["rapidocr"] = mod

    def tearDown(self):
        sys.modules.pop("rapidocr", None)

    def test_detector_cap_is_raised_and_results_parsed(self):
        cfg = OCRConfig(engine="rapidocr")
        engine = RapidEngine(cfg)
        hits = engine.run(IMG)

        params = self.init_kwargs.get("params")
        self.assertIsNotNone(params, "tuned params must be passed to RapidOCR 2.x")
        self.assertEqual(params["Det.limit_side_len"], cfg.det_limit_side_len)
        self.assertGreaterEqual(params["Det.limit_side_len"], 2560)
        self.assertEqual(params["Det.thresh"], cfg.det_thresh)

        self.assertEqual(len(hits), 1)
        poly, text, score = hits[0]
        self.assertEqual(text, "DGS-1100-16")
        self.assertAlmostEqual(score, 0.91)
        self.assertEqual(poly.shape, (4, 2))


class TestLegacyRapidOCR(unittest.TestCase):
    def setUp(self):
        self.init_kwargs = {}
        captured = self.init_kwargs

        class FakeRapidOCR:
            def __init__(self, **kwargs):
                captured.update(kwargs)

            def __call__(self, img):
                return ([[POLY, "GS724T", 0.83]], [0.1, 0.0, 0.2])

        # Make `import rapidocr` fail so the legacy path is taken.
        sys.modules.pop("rapidocr", None)
        mod = types.ModuleType("rapidocr_onnxruntime")
        mod.RapidOCR = FakeRapidOCR
        sys.modules["rapidocr_onnxruntime"] = mod

    def tearDown(self):
        sys.modules.pop("rapidocr_onnxruntime", None)

    def test_legacy_kwargs_and_tuple_result(self):
        cfg = OCRConfig(engine="rapidocr")
        engine = RapidEngine(cfg)
        hits = engine.run(IMG)

        self.assertEqual(self.init_kwargs.get("det_limit_side_len"),
                         cfg.det_limit_side_len)
        self.assertEqual(len(hits), 1)
        _, text, score = hits[0]
        self.assertEqual(text, "GS724T")
        self.assertAlmostEqual(score, 0.83)

    def test_old_versions_without_params_fall_back(self):
        # A RapidOCR that rejects every kwarg must still come up on defaults.
        class Strict:
            def __init__(self, **kwargs):
                if kwargs:
                    raise TypeError("unexpected kwargs")

            def __call__(self, img):
                return (None, None)

        sys.modules["rapidocr_onnxruntime"].RapidOCR = Strict
        engine = RapidEngine(OCRConfig(engine="rapidocr"))
        self.assertEqual(engine.run(IMG), [])


if __name__ == "__main__":
    unittest.main(verbosity=2)
