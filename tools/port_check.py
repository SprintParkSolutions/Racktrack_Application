#!/usr/bin/env python3
"""
port_check.py - the port reading, on its own, so somebody can check it.

Why this exists
---------------
The owner reported on 22 September 2026 that on every device in a rack "the
ports are starting on the panel, not on the port area", and asked for the port
logic standalone so a colleague could verify it without the server, the
database, an account or the phone app.

So this is exactly the pipeline the product runs, with nothing else attached:

    photograph -> devices_seg.pt        -> one box per device
    device box -> crop (padded by 8px)  -> the crop the port models see
    crop       -> ports_13.pt           -> a box and a TYPE per port
                  port_count.pt         -> connected or empty per port
    crop box   -> + crop origin         -> where that port is in the photograph

and it writes out what it found, twice: as pictures a person can look at, and
as JSON a person can diff.

What it writes, into --out (default ./port-check-out):

    rack.jpg                  the photograph with every device box, and every
                              port box drawn inside it, mapped back to the
                              photograph's own pixels
    dev-01-Switch.jpg         one image per port-bearing device: the crop the
                              models were given, with its ports numbered in
                              reading order
    ports.json                every device, every port: the box in CROP
                              coordinates, the same box in IMAGE coordinates,
                              the crop origin used to convert between them,
                              the type, the status and the confidence

Reading the answer
------------------
Two different faults look alike on a phone screen, and the JSON tells them
apart:

  * `box_image` right, `box_crop` right    the reading is correct and the app
                                           is drawing it wrongly.
  * ports clustered at the left edge of    the type model is firing on the
    the crop, low confidence               faceplate or a label, not on jacks.
  * ports outside `device.box`             the crop is picking up the
                                           neighbouring panel's jacks - the
                                           crop is padded, and devices in a
                                           rack are stacked tight.

Running it
----------
    python3 tools/port_check.py rack.jpg
    python3 tools/port_check.py rack.jpg --device 3      # one device only
    python3 tools/port_check.py rack.jpg --conf 0.30     # stricter port model
    python3 tools/port_check.py crop.jpg --no-detect     # the image IS a device

Needs: the weights in ./models (devices_seg.pt, ports_13.pt, port_count.pt),
python with opencv and ultralytics - the same two the pipeline already uses.
Nothing else: no server, no sign-in, no network.
"""

import argparse
import json
import os
import sys
from pathlib import Path

# Where the pipeline and the weights are. In the repository this file lives in
# tools/, so both sit one level up; in the zip we hand to somebody outside the
# team it sits beside them. Both layouts work without an install step.
HERE = Path(__file__).resolve().parent
ROOT = HERE if (HERE / "pipeline").is_dir() else HERE.parent
sys.path.insert(0, str(ROOT))

try:
    import cv2
except ImportError:  # pragma: no cover - a person running this gets the sentence
    sys.exit("opencv is not installed here. Try: pip install opencv-python-headless")

from pipeline.detection import detect_devices_seg  # noqa: E402
from pipeline.port_pattern import (  # noqa: E402
    classify_ports_by_pattern,
    confine_to_device,
    detect_patch_panel_ports,
)
from pipeline.selection import crop_device_with_origin  # noqa: E402

# The same two sets the runner keeps, copied here rather than imported so this
# file states its own rules and cannot drift silently when the runner changes.
PORT_BEARING = {"Switch", "Patch Panel", "Firewall", "Gateway", "Router"}
PANEL_ONLY = {"Patch Panel"}

# Crop padding. Zero, as the product now reads ports: padding is what let a
# device's crop reach into its neighbour. A flag, so it can be put back to
# see the difference.
DEFAULT_PAD = 0

COLOUR = {
    "main": (60, 160, 60),        # RJ45 and the rest of the copper
    "sfp": (200, 140, 40),        # the optical cages
    "console": (170, 90, 200),    # console and management
    "other": (150, 150, 150),     # USB and anything unbucketed
    "device": (230, 120, 40),
    "empty": (80, 80, 210),
}


def load(name):
    """One YOLO model by file name, from whichever models/ folder is here."""
    from ultralytics import YOLO
    for base in (ROOT, HERE):
        path = base / "models" / name
        if path.exists():
            return YOLO(str(path))
    sys.exit(f"missing weights: {name} (looked in {ROOT / 'models'} and {HERE / 'models'})")


def ports_of(crop, panel, type_model, status_model, conf, confine=True):
    """Every port the models find in one device crop, in crop coordinates.

    `confine` is the product's own rule (pipeline.port_pattern), which keeps
    the ports that form this device's bands and drops the plugs hanging in
    front and a neighbour's jacks caught by the edge of the crop. Pass
    --raw to see what the models said before it.
    """
    read = detect_patch_panel_ports if panel else classify_ports_by_pattern
    found = read(crop, type_model, conf=conf, status_model=status_model)
    if confine:
        found = confine_to_device(found, crop_shape=crop.shape[:2])
    out = []
    for bucket in ("main_ports", "sfp_ports", "console_ports", "other_ports"):
        for p in found.get(bucket, []):
            out.append({**p, "bucket": bucket.replace("_ports", "")})
    # Reading order: top row first, then left to right, which is how a person
    # counts ports and how the app numbers them.
    out.sort(key=lambda p: (round(p["box"][1] / 20), p["box"][0]))
    for i, p in enumerate(out, start=1):
        p["index"] = i
    return out, found.get("pattern_info", {})


def draw(img, boxes, colour, label=None, thick=1):
    for b in boxes:
        x1, y1, x2, y2 = (int(v) for v in b)
        cv2.rectangle(img, (x1, y1), (x2, y2), colour, thick)
    if label and boxes:
        x1, y1 = int(boxes[0][0]), int(boxes[0][1])
        cv2.putText(img, label, (x1, max(12, y1 - 4)),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.4, colour, 1, cv2.LINE_AA)


def main():
    ap = argparse.ArgumentParser(description="Read the ports of a rack photograph, on their own.")
    ap.add_argument("image", help="a rack photograph, or one device's crop with --no-detect")
    ap.add_argument("--out", default="port-check-out", help="where to write the pictures and the JSON")
    ap.add_argument("--conf", type=float, default=0.25, help="confidence for the port models")
    ap.add_argument("--device-conf", type=float, default=0.25, help="confidence for the device model")
    ap.add_argument("--pad", type=int, default=DEFAULT_PAD, help="pixels of padding round a device crop")
    ap.add_argument("--device", type=int, default=None, help="only this device, by its number in the output")
    ap.add_argument("--no-detect", action="store_true", help="the image IS one device, do not look for devices")
    ap.add_argument("--clip", action="store_true",
                    help="drop ports whose centre falls outside the device's own box")
    ap.add_argument("--raw", action="store_true",
                    help="what the models said, before the product confines it to the device")
    args = ap.parse_args()

    img = cv2.imread(args.image)
    if img is None:
        sys.exit(f"could not read the image: {args.image}")
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    type_model = load("ports_13.pt")
    status_model = load("port_count.pt")

    if args.no_detect:
        devices = [{
            "class_name": "Switch", "confidence": 1.0,
            "box": [0, 0, img.shape[1] - 1, img.shape[0] - 1],
        }]
    else:
        devices = detect_devices_seg(img, load("devices_seg.pt"), conf=args.device_conf)
        devices.sort(key=lambda d: d["box"][1])          # top of the rack first

    rack = img.copy()
    report = {
        "image": os.path.abspath(args.image),
        "imageSize": {"w": img.shape[1], "h": img.shape[0]},
        "pad": args.pad,
        "portConf": args.conf,
        "devices": [],
    }

    for n, dev in enumerate(devices, start=1):
        if args.device and n != args.device:
            continue
        x1, y1, x2, y2 = (int(v) for v in dev["box"])
        cv2.rectangle(rack, (x1, y1), (x2, y2), COLOUR["device"], 2)
        cv2.putText(rack, f'{n} {dev["class_name"]}', (x1, max(14, y1 - 6)),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.5, COLOUR["device"], 1, cv2.LINE_AA)

        entry = {
            "n": n,
            "class": dev["class_name"],
            "confidence": round(float(dev.get("confidence", 0)), 3),
            "box": [x1, y1, x2, y2],
            "portBearing": dev["class_name"] in PORT_BEARING,
            "ports": [],
        }
        report["devices"].append(entry)
        if not entry["portBearing"]:
            continue

        crop, (ox, oy) = crop_device_with_origin(img, [x1, y1, x2, y2], pad=args.pad)
        if crop is None or crop.size == 0:
            entry["note"] = "the crop came out empty"
            continue
        entry["cropOrigin"] = [int(ox), int(oy)]
        entry["cropSize"] = {"w": crop.shape[1], "h": crop.shape[0]}

        ports, pattern = ports_of(crop, dev["class_name"] in PANEL_ONLY,
                                  type_model, status_model, args.conf,
                                  confine=not args.raw)
        # With --clip, a port whose centre lands outside the device's own box
        # is not this device's port. The crop is padded and racks are stacked
        # tight, so a switch's crop routinely contains the panel under it.
        if args.clip:
            kept = []
            for p in ports:
                cx = (p["box"][0] + p["box"][2]) / 2 + ox
                cy = (p["box"][1] + p["box"][3]) / 2 + oy
                if x1 <= cx <= x2 and y1 <= cy <= y2:
                    kept.append(p)
            entry["clippedAway"] = len(ports) - len(kept)
            ports = kept
            for i, p in enumerate(ports, start=1):
                p["index"] = i
        entry["patternInfo"] = pattern
        shot = crop.copy()
        for p in ports:
            bx1, by1, bx2, by2 = (int(v) for v in p["box"])
            colour = COLOUR["empty"] if p.get("status") == "empty" else COLOUR.get(p["bucket"], COLOUR["other"])
            cv2.rectangle(shot, (bx1, by1), (bx2, by2), colour, 1)
            cv2.putText(shot, str(p["index"]), (bx1, max(9, by1 - 2)),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.32, colour, 1, cv2.LINE_AA)
            # The same box, where it lands in the photograph. This one line is
            # what decides whether the app draws a port in the right place.
            cv2.rectangle(rack, (bx1 + ox, by1 + oy), (bx2 + ox, by2 + oy), colour, 1)
            entry["ports"].append({
                "index": p["index"],
                "type": p.get("class_name"),
                "bucket": p["bucket"],
                "status": p.get("status"),
                "confidence": round(float(p.get("confidence", 0)), 3),
                "box_crop": [bx1, by1, bx2, by2],
                "box_image": [bx1 + int(ox), by1 + int(oy), bx2 + int(ox), by2 + int(oy)],
                # True when this port's box falls outside the device's own
                # box, which means the crop reached into a neighbour.
                "outsideDevice": bool(bx1 + ox < x1 or bx2 + ox > x2 or by1 + oy < y1 or by2 + oy > y2),
            })
        entry["portCount"] = len(ports)
        entry["outsideDevice"] = sum(1 for p in entry["ports"] if p["outsideDevice"])
        name = f'dev-{n:02d}-{dev["class_name"].replace(" ", "-")}.jpg'
        cv2.imwrite(str(out_dir / name), shot)
        entry["crop"] = name
        stray = entry["outsideDevice"]
        tail = f'   {stray} outside the device box' if stray else ''
        print(f'{n:>2}  {dev["class_name"]:<12} {len(ports):>3} ports{tail}')

    cv2.imwrite(str(out_dir / "rack.jpg"), rack)
    (out_dir / "ports.json").write_text(json.dumps(report, indent=2))
    print(f"\nwrote {out_dir}/rack.jpg, one image per device, and ports.json")


if __name__ == "__main__":
    main()
