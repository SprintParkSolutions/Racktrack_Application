"""
Model-backed occlusion gate for uploaded rack photos.

This replaces the hand-tuned heuristic in quality_check.check_occlusion() with
the trained MobileNetV2 classifier (Models/rack_classifier.pth). It runs at the
same point in the pipeline as every other quality check — on upload, before the
image enters analysis — and returns the SAME contract, so nothing downstream
(worker, server, client modal) has to change:

    {"ok": True,  "metrics": {...}}                       # clear
    {"ok": True,  "warning": "occlusion", ...}            # cabled, proceed-able
    {"ok": False, "kind": "occlusion", "retryable": True} # severe -> offer re-capture

Why swap the heuristic out: it inferred "cables" indirectly from edge-orientation
ratios and colour saturation. That misfires both ways — a rack of vividly
labelled devices reads as cable clutter, while a wall of grey/white cables (the
common case) barely moves either signal. The classifier was trained on actual
clear vs occluded racks, so it judges the thing we care about instead of a proxy.

The heuristic is kept as a FALLBACK, not deleted: if torch is missing or the
weights file isn't deployed, uploads must still work. A quality gate that hard-
fails closed would block every scan on a box where the model wasn't shipped.
"""
import os
import pathlib
import threading

# Repo root = parent of pipeline/. Resolved from __file__ so it works regardless
# of cwd or drive letter (this runs on macOS in dev and D:\ on the Windows box).
_REPO_ROOT = pathlib.Path(__file__).resolve().parent.parent
_DEFAULT_MODEL = _REPO_ROOT / "Models" / "rack_classifier.pth"

# Env override for deployments that stage weights elsewhere.
MODEL_FILE = pathlib.Path(os.environ.get("RACK_CLASSIFIER_PATH", str(_DEFAULT_MODEL)))

# Confidence at or above which "occluded" is treated as SEVERE — a hard stop that
# offers multi-angle re-capture. Below it, "occluded" is a soft warning and the
# scan proceeds.
#
# Deliberately conservative. A false hard-fail blocks a legitimate upload, which
# is far worse than letting a marginal image through with a warning: the scan
# still runs and the user still gets a result. Tune against a labelled set before
# lowering — on the sample available here a heavily-cabled patch-panel rack scored
# 0.601, so this threshold currently routes it to a warning rather than a block.
OCCLUSION_HARD_CONF = float(os.environ.get("RACK_CLASSIFIER_HARD_CONF", "0.85"))

_lock = threading.Lock()
_model = None
_classes = None
_load_error = None


def _ensure_loaded():
    """Load the weights once per process. Cached because the worker is
    long-lived and handles many uploads; reloading a 9MB checkpoint per
    request would dominate the request time."""
    global _model, _classes, _load_error
    if _model is not None or _load_error is not None:
        return
    with _lock:
        if _model is not None or _load_error is not None:
            return
        try:
            from pipeline.rack_classifier import load_model
            _model, _classes = load_model(MODEL_FILE)
        except Exception as e:          # missing torch, missing/corrupt weights
            _load_error = str(e)


def available():
    """True if the classifier is usable — lets callers report which detector ran."""
    _ensure_loaded()
    return _model is not None


def classify_occlusion(bgr_img):
    """Judge a rack photo. `bgr_img` is an OpenCV BGR array (what the worker holds).

    Returns the quality-check contract, or None if the model is unavailable so
    the caller can fall back to the heuristic.
    """
    _ensure_loaded()
    if _model is None:
        return None

    try:
        import cv2
        from PIL import Image
        from pipeline.rack_classifier import predict_image

        # cv2 gives BGR; the model's transform expects PIL RGB. Skipping this
        # conversion silently swaps the red and blue channels, which shifts the
        # colour statistics the network learned and quietly degrades accuracy.
        pil = Image.fromarray(cv2.cvtColor(bgr_img, cv2.COLOR_BGR2RGB))
        label, confidence, probs = predict_image(pil, _model, _classes)
    except Exception as e:
        # Never let an inference error break an upload — fall back.
        return None

    metrics = {
        "occlusion_detector": "model",
        "occlusion_label": label,
        "occlusion_conf": round(float(confidence), 3),
        "p_occluded": round(float(probs.get("occluded", 0.0)), 3),
        "p_clear": round(float(probs.get("clear", 0.0)), 3),
    }

    if label != "occluded":
        return {"ok": True, "metrics": metrics}

    p_occ = float(probs.get("occluded", confidence))

    if p_occ >= OCCLUSION_HARD_CONF:
        return {
            "ok": False,
            "kind": "occlusion",
            "retryable": True,
            "error": (
                "This rack is heavily covered by cables, so devices behind the "
                "bundles may be missed. For better accuracy, take additional photos "
                "from the left and right sides of the rack, or proceed with this "
                "image anyway."
            ),
            "metrics": metrics,
        }

    return {
        "ok": True,
        "warning": "occlusion",
        "warning_msg": (
            "Cables cover much of the rack — some devices behind cable bundles may "
            "not be detected. Side-angle photos would improve accuracy."
        ),
        "metrics": metrics,
    }
