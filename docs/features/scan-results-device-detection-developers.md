# Scan Results & Device Detection

**Feature Reference** · *The annotated rack: what the AI found, and your chance to confirm it.*

**Category:** Core feature — the results hub for a scanned rack · **Audience:** The team (assumes you know the product) · **Document date:** 24 July 2026 · Part of the RackTrack documentation set.

---

## On this page

1. In simple terms
2. At a glance
3. How it works — step by step
4. Where the input comes from
5. What it produces (output)
6. What you see on screen
7. The logic behind it
8. Detailed technical explanation
9. Real data vs. synthetic
10. Use cases

---

## 1. In simple terms

You point the camera at a rack and take one photo. A few seconds later RackTrack shows you that same photo with every device boxed and labelled — *switch here, patch panel there, PDU at the bottom* — laid out unit by unit. From that screen you can zoom into any device, drill into a single port to see what's plugged in, and, whenever the app gets something wrong, tell it so in one tap.

This is the **results hub**: the screen you land on after every scan, and the doorway to every deeper view — live ports, cable tracing, 3D topology, firmware checks, and change history. It is designed to be trusted at a glance and corrected in seconds.

## 2. At a glance

| | |
|---|---|
| **Category** | Core feature — the results hub for a scanned rack. |
| **Who uses it** | Everyone who runs a scan. |
| **Where input comes from** | The completed scan, plus on-demand live switch data and your corrections. |
| **What it outputs** | An interactive annotated rack, per-port detail, and training feedback. |
| **Data source** | REAL — detections from your photo; live port checks from the switch. |

## 3. How it works — step by step

```
Take one photo                →  camera or file upload
        ↓
Quality gate                  →  is it straight, clear, and actually a rack?
        ↓
Detection pipeline            →  devices, ports, PDUs, and make/model are found
        ↓
Annotated overview            →  every device boxed and labelled on your photo
        ↓
Pick a device / find a port   →  drill into a switch, panel or PDU; query a port live
        ↓
Confirm or correct            →  answer the "Right?" prompts; fixes are remembered
        ↓
Branch out                    →  Ports · Topology · Network · Switches · Drift · Report
```

**Walkthrough**

1. On the **Scan** screen, take a photo with the live camera or upload one. The app sends it, then opens the results page for that rack.
2. The result loads and draws coloured boxes over your original photo — one per detected device — with a name chip on each.
3. Pinch-zoom or tap a device to focus on it.
4. Open the device dropdown and choose a device to inspect. For a switch or panel you'll see its port breakdown; for a PDU you'll see its power outlets.
5. To check a specific port, pick a port type (RJ45 / SFP / Console / USB) and type a port number, then press **Find Port** — this can query the switch live for that port's real state.
6. Answer the confirm/correct prompts, e.g. *"Detected as Switch. Right?"* and *"Detected 24 RJ45 ports. Right?"* Your fixes stick.
7. Use the tab bar (Overview / Switches / Ports / Topology / Network / Drift) or the report row to open any deeper view.

## 4. Where the input comes from

- **Your photo** — a single still, taken with the in-app camera or uploaded. It becomes the base image the overlay is drawn on.
- **The detection pipeline** — device classes, unit positions, port counts and cable reads all come from the AI models that process the photo.
- **On-demand live switch data** — fired only when you open a specific port, to read that interface's real, current state. Nothing talks to a switch until you ask.
- **Your confirmations** — the Yes/No answers and typed corrections you give to device type, port count and port type.

## 5. What it produces (output)

- **An annotated rack** — your zoomable photo with a labelled box on every device.
- **A per-port dashboard** — status, cable type and colour, confidence, and the device resolved on the far end of the cable.
- **A canonical result record** — one tidy, merged description of the rack that every other screen and the report read from.
- **Feedback records** — each correction, stored with the image crop it refers to, ready to retrain the models.
- **A launch point** — direct entry into Ports, Topology, Network, Switch info, Drift, and the shareable report.

## 6. What you see on screen

- **Hero image** — the photo with device boxes, name chips, a brief scan-line animation, and a "Done in *[time]*" badge.
- **Device dropdown** — each device's class and a port breakdown (or, for a PDU, a power-outlet summary).
- **Port dashboard** — status (connected / empty / unknown), the device class and cable type with a confidence figure, the cable colour shown as a real swatch, and the end device when a neighbour resolves.
- **Feedback cards** — *"Detected as Switch. Right?"* and *"Detected 24 RJ45 ports. Right?"*, each with Yes/No and a correction input.
- **"Your correction" badge** — marks any value that came from you rather than from the model.
- **Report row** — View, Report, Console, and Share actions.
- **Tab bar** — Overview, Switches, Ports, Topology, Network, Drift.

## 7. The logic behind it

- **Trust the photo, fetch live only on demand.** The overview reflects exactly what the scan saw. A switch is only queried live when you open one of its ports, which keeps the hub fast and avoids hammering equipment.
- **Every correction teaches the model.** Each fix is captured together with the precise image crop it refers to and the model's original guess, so the next retraining round learns from exactly where *your* fleet differs from the training set.
- **Hide the clutter.** Empty, closed and unidentified rack rows are kept out of the overlay and the device picker, so you see equipment, not noise.
- **Corrections are sticky.** A value you fix is remembered and reused — reopening the scan, or re-scanning the same rack, shows your correction, not the old guess.
- **The same photo always makes the same rack.** A rack's identity is derived from the image itself, so an accidental re-upload lands on the existing record instead of creating a duplicate.

## 8. Detailed technical explanation

**Capture and send.** The Scan screen (`client/src/pages/ScanPage.jsx`) captures either from the live camera (`getUserMedia`, still grabbed via a hidden canvas) or a file upload, and posts the image as multipart form-data to `POST /api/analyze`. While the viewfinder is open it also streams frames at about one per second to get a real-time box preview. On success it navigates to `/results/<rackId>`. A single automatic retry is safe because a rack's id is a hash of the image, so a retry simply hits the cache.

**Quality gate.** Before detection, the image passes a validation pass (`pipeline/quality_check.py`): letterbox detection, tilt/rotation, side-angle perspective, and an occlusion classifier (a MobileNetV2 model, `Models/rack_classifier.pth`, with a heuristic fallback). Badly tilted or heavily obscured photos are hard-rejected with a specific reason; milder issues raise a soft warning the user can override with "Proceed anyway". A fast rack-presence check rejects photos that aren't a rack at all. All of these metrics are stored on the scan (`scan_meta.json`, under `quality`).

**Detection.** Analysis runs in a persistent Python worker pool (`python -m pipeline.worker`; `server/worker-pool.js`). The models, in order:
- **Device / unit segmentation** (`Models/devices_seg.pt`) finds each device, its class, a confidence score and a bounding box, and maps it to rack units. Any rack unit left unclaimed is filled with a placeholder marked `synthetic_unidentified` so the U-map stays continuous.
- **Port detection** (`Models/ports_9.pt` for typed ports — RJ45, SFP, QSFP, Console, and so on — plus `Models/port_count.pt` for occupied/empty status) produces the per-port list and the connected-port count for each switch or panel.
- **PDU outlets** (`Models/pdu_ports_v1_det_best.pt`) produce the power totals for PDUs, which carry no network ports.
- **Make / model OCR** (`pipeline/ocr_devices.py`) runs just after the scan, reads the faceplate text on each device, and writes `ocr_devices.json` with make, model and firmware version where it can read them.

**Artifacts.** Detection writes `outputs/<rackId>/device_unit_map.json` (the primary map — every device's class, confidence, box, units, ports and, for PDUs, power fields) plus a set of annotated renders under `images/` (`2_devices_only.png`, `3_units_and_devices.png`, `7_rack_all_ports.png`, and others). A device's `source` field records where it came from: `seg_model` (real detection), `synthetic_unidentified` / `synthetic_fill` (placeholders), or `user_corrected` (after feedback).

**Rack identity and caching.** `computeRackId` hashes the image bytes together with an ownership scope (`org:<id>`, else `tenant:<id>`, else `global`) with SHA-256 and takes the first 8 hex characters → `RK-XXXXXXXX`. `scanId` and `rackId` are the same value. Re-uploading an identical photo returns the cached result (`cached: true`) rather than re-detecting; a *re-shot* photo of a rack a user has confirmed can also short-circuit to that confirmed result.

**The canonical result.** `writeCanonicalScanResult` builds `outputs/<rackId>/scan_result.json` (schema `scan_result.v1`), the single tidy record every screen and the report read from. Each device there carries a stable `index`, a human label (e.g. `U12-SW01`), its U-position, port counts and power, with make/model/firmware merged in from OCR by position. User corrections are overlaid at this stage (`applyFeedbackOverrides`): the corrected value wins, but a `_correction` trail preserves the model's original prediction, and a running `feedback` block records total / correct / wrong / accuracy. Two read endpoints serve it — `GET /api/scan/:rackId` (the raw map view) and `GET /api/scan/:rackId/result` (the canonical record, regenerated on the fly if missing).

**The results screen.** `client/src/pages/ResultsPage.jsx` is a single tabbed page (Overview / Ports / Topology / Network / Switches / Drift, tab driven by the URL hash). It draws the device boxes from each detection's bounding box directly over the original photo, so zoom and focus stay pixel-aligned. "Find Port" calls `POST /api/select` for one device and port and pre-fetches the switch neighbour. The device-class picker offers a fixed list of fourteen types (Switch, Patch Panel, Firewall, Router, Server, Load Balancer, Modem, Controller, Recorder, Amplifier, Gateway, PDU, PSU, UPS).

**The feedback loop.** Corrections post to a small family of endpoints — device class (`/api/feedback/device`), port and cable colour (`/api/feedback`), port count (`/api/feedback/port-count`, which can re-run detection at the corrected count), port type (`/api/feedback/port-type`), and a fully verified port layout (`/api/feedback/port/verified`, which lets future matching scans skip the port model entirely). Every correction appends an immutable row to both a global and a per-rack `feedback.jsonl`, saves the image crop, refreshes the canonical result, and feeds the active-learning memory (`fireMemoryCorrection` — a perceptual hash plus a ResNet-18 embedding, scoped to the organisation) so visually similar devices in future scans can auto-apply the corrected label.

**The report.** From the same `scan_result.json`, the report is rendered as a self-contained HTML page (images inlined), a real PDF (headless Chromium), CSV and JSON. A short-lived (5-minute) report token lets the in-app report frame prove rack access without a login header, and the PDF can be shared straight to Slack, Teams or Outlook.

## 9. Real data vs. synthetic

| Thing on screen | Real or synthetic |
|---|---|
| Device boxes, classes, port counts | **REAL** — detected from your photo. |
| Cable colour / type | **REAL** — read by the vision models, with confidence. |
| Make / model / firmware | **REAL** — read by OCR from the faceplate, where legible. |
| Live port status & end device | **REAL / LIVE** — queried from the switch on demand. |
| "Unidentified" placeholder rows | SYNTHETIC — inserted for unclassified rack units; hidden from the overlay and picker. |
| Your corrections | **REAL** — your input, stored and reused. |

## 10. Use cases

- **Verifying an install.** Scan, confirm the switch and its port count, and trust the rest — the rack is documented in seconds rather than typed up by hand.
- **Chasing a bad port.** Selecting the port shows its live status and the device on the other end, without opening a terminal.
- **Improving accuracy over time.** Correcting a misread model or port count sharpens the model for the whole fleet, because the fix becomes a labelled training example.
- **Feeding downstream views.** The same detected rack is what Topology, Network, Drift and the CMDB registration all build on — get the results right once and every view benefits.

---

— Scan Results & Device Detection —
