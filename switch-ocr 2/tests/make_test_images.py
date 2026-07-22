"""Generate synthetic test photos that mimic real rack shots of switches.

Recreates the hard conditions from the field: a wide low-resolution strip
photo of a rack, tiny model text (like "DGS-1100-16" on a D-Link faceplate),
port numbers, glare, blur and sensor noise. Ground truth is known, so the
pipeline can be scored.
"""
from __future__ import annotations

from pathlib import Path

import cv2
import numpy as np

OUT = Path(__file__).parent / "data"
OUT.mkdir(exist_ok=True)

FONT = cv2.FONT_HERSHEY_SIMPLEX
FONT_BOLD = cv2.FONT_HERSHEY_DUPLEX


def _noise(img: np.ndarray, sigma: float) -> np.ndarray:
    noise = np.random.default_rng(42).normal(0, sigma, img.shape)
    return np.clip(img.astype(np.float64) + noise, 0, 255).astype(np.uint8)


def dlink_rack_strip() -> tuple:
    """Wide rack strip like the user's example: D-Link DGS-1100-16."""
    # Draw at 4x then shrink -> naturally small, slightly soft text.
    W, H = 3920, 684
    img = np.full((H, W, 3), 38, np.uint8)  # dark rack background

    # Top device: dark patch panel with white port numbers
    cv2.rectangle(img, (0, 0), (W, 150), (52, 52, 52), -1)
    for i, num in enumerate(range(2, 25)):
        x = 60 + i * 165
        cv2.putText(img, f"{num:02d}", (x, 100), FONT, 1.6, (235, 235, 235), 4, cv2.LINE_AA)

    # Middle device: silver D-Link switch faceplate
    cv2.rectangle(img, (420, 170), (3460, 560), (196, 198, 200), -1)
    cv2.rectangle(img, (420, 170), (3460, 560), (140, 140, 140), 6)
    # Brand logo (dark text on silver)
    cv2.putText(img, "D-Link", (600, 330), FONT_BOLD, 3.2, (40, 40, 40), 10, cv2.LINE_AA)
    # Tiny model text under the logo — THE critical target
    cv2.putText(img, "DGS-1100-16", (560, 520), FONT, 1.5, (60, 60, 60), 4, cv2.LINE_AA)
    # Small LED labels
    cv2.putText(img, "Power", (600, 400), FONT, 1.0, (90, 90, 90), 2, cv2.LINE_AA)
    # Port blocks (RJ45 look-alikes)
    for bx in range(1300, 3300, 250):
        for by in (240, 400):
            cv2.rectangle(img, (bx, by), (bx + 180, by + 120), (60, 60, 60), -1)
            cv2.rectangle(img, (bx, by), (bx + 180, by + 120), (120, 120, 120), 3)

    # Cables crossing the faceplate (occlusion)
    rng = np.random.default_rng(7)
    for cx in range(900, 3400, 260):
        col = int(rng.integers(180, 230))
        cv2.line(img, (cx, 0), (cx + int(rng.integers(-80, 80)), H),
                 (col, col, col), int(rng.integers(28, 44)), cv2.LINE_AA)

    # Downscale hard (like the 980px-wide example), blur + noise
    img = cv2.resize(img, (980, 171), interpolation=cv2.INTER_AREA)
    img = cv2.GaussianBlur(img, (3, 3), 0.8)
    img = _noise(img, 6)
    truth = {"brand": "D-Link", "model": "DGS-1100-16"}
    return img, truth


def cisco_label() -> tuple:
    """Straight-on shot of a Cisco Catalyst with small model text + low contrast."""
    W, H = 1600, 500
    img = np.full((H, W, 3), 70, np.uint8)
    cv2.rectangle(img, (40, 40), (W - 40, H - 40), (85, 85, 88), -1)
    cv2.putText(img, "CISCO", (120, 180), FONT_BOLD, 2.4, (150, 150, 152), 8, cv2.LINE_AA)
    cv2.putText(img, "Catalyst 2960-X Series", (120, 280), FONT, 1.3,
                (130, 130, 132), 3, cv2.LINE_AA)
    cv2.putText(img, "WS-C2960X-24TS-L", (120, 380), FONT, 1.0,
                (120, 120, 122), 2, cv2.LINE_AA)
    cv2.putText(img, "10/100/1000", (900, 380), FONT, 0.9, (120, 120, 122), 2, cv2.LINE_AA)
    img = cv2.GaussianBlur(img, (5, 5), 1.4)  # heavy blur + very low contrast
    img = _noise(img, 8)
    truth = {"brand": "Cisco", "model": "WS-C2960X-24TS-L"}
    return img, truth


def netgear_tiny() -> tuple:
    """Small, angled-feel Netgear shot with tiny text."""
    W, H = 1100, 300
    img = np.full((H, W, 3), 110, np.uint8)
    cv2.rectangle(img, (20, 30), (W - 20, H - 30), (60, 62, 66), -1)
    cv2.putText(img, "NETGEAR", (60, 120), FONT_BOLD, 1.6, (230, 230, 230), 5, cv2.LINE_AA)
    cv2.putText(img, "ProSAFE GS724T", (60, 200), FONT, 0.9, (200, 200, 200), 2, cv2.LINE_AA)
    cv2.putText(img, "24-Port Gigabit Smart Switch", (60, 250), FONT, 0.7,
                (170, 170, 170), 1, cv2.LINE_AA)
    img = cv2.resize(img, (640, 175), interpolation=cv2.INTER_AREA)  # shrink -> tiny text
    img = _noise(img, 5)
    truth = {"brand": "Netgear", "model": "GS724T"}
    return img, truth


def main():
    cases = {
        "dlink_rack_strip.png": dlink_rack_strip,
        "cisco_blurry.png": cisco_label,
        "netgear_tiny.png": netgear_tiny,
    }
    truths = {}
    for name, fn in cases.items():
        img, truth = fn()
        cv2.imwrite(str(OUT / name), img)
        truths[name] = truth
        print(f"wrote {OUT / name}  {img.shape[1]}x{img.shape[0]}  truth={truth}")
    import json
    (OUT / "ground_truth.json").write_text(json.dumps(truths, indent=2))


if __name__ == "__main__":
    main()
