# The Computer-Vision Pipeline

*How one photo of a rack becomes a fully-mapped, U-by-U inventory of devices, ports and cables.*

Technical · Engineers & curious users · Last verified: 26 July 2026 against the live code.

---

## 1. In simple terms

Imagine you hand RackTrack a single photo of the front of a server rack. In a few seconds it hands you back a labelled diagram: "U01 is a Switch, U02 is a Patch Panel, U05-U06 is a Server," and for the switch it can even tell you "24 network ports, and port 7 has a blue RJ-45 cable plugged in." That transformation — from a flat picture to a structured inventory — is the job of the computer-vision (CV) pipeline.

Here is the whole thing as a story a smart non-expert can follow.

**First, is this even a rack?** Before doing any real work, RackTrack takes a quick glance at the photo. If the picture is a person, a laptop, a wall, or anything with no rack equipment in it, the pipeline stops right there and asks the user to point the camera at the front of a rack. It also checks whether the rack is buried under a mess of cables; if so, it warns the user that devices hidden behind the bundles might be missed, and offers to take side-angle photos.

**Second, where is the rack in the frame?** The photo usually has some background around the rack — a bit of floor, a wall, the edge of a door. RackTrack draws a box around the rack itself so everything after this only looks at the equipment, not the room.

**Third, what devices are in the rack?** This is the heart of it. A trained model sweeps the rack and outlines every piece of equipment it recognises — switches, patch panels, servers, firewalls, PDUs, UPSes, and so on. Each outline comes with a guess at what the thing is and how confident the model is.

**Fourth, which U-slot is each device in?** Racks are measured in "U" (rack units) — the standardised 1.75-inch slots you count up the side. RackTrack works out how tall one U is (by looking at the switches and patch panels, which are almost always exactly 1U tall) and then lays an invisible ruler down the whole rack. Every device is snapped onto that ruler, so a tall server correctly reads as "occupies U05 and U06," not just "somewhere in the middle."

**Fifth, what ports does each device have?** For the devices that actually have ports on the front — switches, routers, firewalls, gateways, patch panels — RackTrack zooms into each one and finds the individual jacks. It reads two things about every port: what *kind* it is (an ordinary RJ-45 network port, a fibre SFP slot, a console port, a USB port) and whether it is *occupied or empty*. Patch panels get special treatment because they are just a long grid of identical jacks. PDUs (power strips) get their own treatment because their "ports" are power outlets, not network ports.

**Sixth, what's plugged in?** For a port that reads as occupied, RackTrack can look at the cable and name its connector and colour ("RJ-45 Blue," "LC Aqua fibre"). For an empty port it can try to name the bare socket type.

**Seventh, can we read the label?** Many switches have their model number printed on the faceplate. RackTrack reads that text and, when it recognises a known model, uses the manufacturer's real port count to correct a visual count that cables may have thrown off.

**Finally, it writes everything down.** The pipeline saves one machine-readable file (`device_unit_map.json`) that lists every device, its U-slot, and its ports, plus a handful of annotated images — the rack with boxes drawn on it — so a human can see exactly what the machine saw.

That is the entire journey: **rack gate → find the rack → find the devices → build the U ruler → find the ports → read cables and labels → save the map.**

---

## 2. At a glance

| Aspect | What it is |
| --- | --- |
| **Input** | One rack photo (JPEG/PNG). For video, a best frame is extracted first; for a multi-rack pan, one frame per rack. |
| **Orchestrator** | `pipeline/runner.py` — `main()` runs every stage in order. |
| **How the server calls it** | `runPipelineAnalyze()` in `server/app.js` → warm Python worker (`pipeline/worker.py` → `runner.main()` with `--detect_only`). Results are read back with `buildResponse()`. |
| **Device model** | `Models/devices_seg.pt` — 12-class YOLO segmentation model (config runs in `seg` mode). |
| **Port models** | `Models/ports_9.pt` (port **type**) + `Models/port_count.pt` (port **status**). |
| **Patch-panel / PDU** | `port_count.pt` used directly for patch-panel grids; `Models/pdu_ports_v1_det_best.pt` for PDU outlets. |
| **Cable model** | `Models/cable_eff_best` — EfficientNet-B0, 14 colour classes. |
| **Quality / rack gate** | `Models/rack_classifier.pth` — MobileNetV2 clear-vs-occluded classifier; plus a device-count "not-a-rack" gate on the server. |
| **OCR** | `switch-ocr` engine (device faceplate text); `pipeline/device_db.py` for port-count grounding. |
| **Primary output** | `outputs/<rackId>/device_unit_map.json` |
| **Annotated images** | `outputs/<rackId>/images/`: `1_units_only.png`, `2_devices_only.png`, `3_units_and_devices.png`, `7_rack_all_ports.png` (always); `4_selected_device.png`, `5_selected_device_with_port.png`, `6_full_rack_selected_port.png` (only when a single port is picked). |
| **Config** | `config.json` — `models` map + `detection` thresholds. |

---

## 3. The stages, in order

This section follows the code path that actually runs on a live scan. In production, `/api/analyze` calls `runPipelineAnalyze()`, which asks the warm worker to run `runner.main()` with the `--detect_only` flag. Everything up to and including step 3.7 runs on every analyze; the single-device / single-port selection (3.8) runs only when a user later inspects one port.

### 3.0 The gates that run *before* the pipeline

Two checks decide whether the pipeline runs at all. Neither lives in `runner.py`; both sit in front of it.

- **Quality / occlusion gate** (`pipeline/worker.py::handle_quality_check` → `pipeline/occlusion_model.py::classify_occlusion`). The uploaded photo is judged clear-vs-occluded by the trained MobileNetV2 in `Models/rack_classifier.pth` (loaded through `pipeline/rack_classifier.py`). If the model calls the image occluded with probability at or above `0.55` (`OCCLUSION_HARD_CONF`), the upload is a hard, *retryable* stop that offers multi-angle re-capture; between the 0.50 argmax boundary and 0.55 it is a soft warning and the scan proceeds. If torch or the weights are missing, it falls back to the older edge/saturation heuristic (`quality_check.check_occlusion`) rather than blocking uploads.
- **Rack-presence ("not-a-rack") gate** (`server/app.js`, ~line 2705). Before the full run, the server fires a fast `detect_only` request. If it comes back with **zero** devices, the server returns a `400` with `kind: 'not_a_rack'` and the message "This doesn't look like a server rack…". This is best-effort: if detection errors, the full pipeline runs and its own zero-device check still catches it.

> Note: `rack_classifier.py` / `occlusion_model.py` implement the *clear-vs-occluded* judgement. The *is-there-a-rack-at-all* judgement is the server's zero-device check. They are two different gates, described together here because both run on upload.

### 3.1 Load config and image

`runner.main()` reads `config.json`, resolves the model paths from `config["models"]`, and reads detection thresholds from `config["detection"]` (`devices_conf` 0.20, `server_conf` 0.25, `iou_dedup` 0.5, `ports_conf` 0.23, `pdu_conf` 0.40). The image is loaded with `cv2.imread`; a missing file raises immediately. Model objects are loaded once and cached (`_MODEL_CACHE`) so the long-lived worker pays the load cost a single time.

**In:** image path, config path, output dir. **Out:** loaded models, threshold values, the decoded image.

### 3.2 Find the rack in the frame — `detect_rack_bounds`

`detection.detect_rack_bounds(img)` converts to grayscale, blurs, runs Canny edges, then `HoughLinesP` to find long near-horizontal and near-vertical line segments (the rack rails and frame). The bounding box of those segments becomes the rack crop. If Hough finds no rack-like structure, the code falls back to using the **whole image** as the rack bounds so the pipeline still runs.

**In:** full image. **Out:** `rack_box = (x1, y1, x2, y2)`; `rack_crop` = the image cropped to it.

### 3.3 Detect the devices — `detect_devices_seg`

Device detection runs on the rack crop. The live config sets `device_detect_mode: "seg"`, so `detection.detect_devices_seg(rack_crop, seg_model, conf, iou)` runs `Models/devices_seg.pt` — a single YOLO segmentation model. Only its bounding boxes are consumed (mask polygons are ignored); each box is shrunk 2 px per side to suppress border noise, and boxes smaller than 10×10 after the shrink are dropped. Class strings are normalised to Title Case via `_normalize_seg_label` (e.g. `patchpanel` → `Patch Panel`).

A second mode exists in the code — `"dual"`, which combines a Server-only model (`best 33.pt`) with a general model (`best 32.pt`) via `detect_devices_dual` and `_normalize_label_dual`, IoU-deduped between the two passes. It is fully wired but **not** what the current `config.json` selects; the live models map only ships `devices_seg`. Both detectors return the identical dict shape — `{class_id, class_name, confidence, box[xyxy], center[cx,cy], source}` — so every stage after this is mode-agnostic.

`shift_boxes` then translates every box from rack-crop coordinates back into full-image coordinates.

**In:** rack crop. **Out:** a list of device dicts in full-image coordinates.

### 3.4 Clean up the device stack

Detections are sorted top-to-bottom, then three physical-rack rules are enforced:

- `remove_overlapping_devices(max_overlap_ratio=0.3)` drops gross duplicate boxes (highest-confidence wins).
- `normalize_device_stack` snaps every device to a shared median left/right edge (all one width) and closes *small* overlaps or gaps between vertically adjacent devices by moving their shared edge to the midpoint. A *large* gap — a genuine blank U — is left alone (threshold: `0.4 ×` the median device height).
- `validate_device_stack` logs any residual overlap as a warning.

Optionally, when an `org_id` is supplied and that organisation has stored device-class corrections, each device crop is matched against the org's active-learning memory; a hit overrides the model's class (recording `class_name_original` and `class_name_corrected`). This runs *before* the unit grid and port detection so a corrected class drives the right downstream strategy.

**In:** raw detections. **Out:** a de-duplicated, edge-aligned, optionally class-corrected device stack.

### 3.5 Build the U ruler — `derive_unit_height` + `build_contiguous_unit_grid`

`derive_unit_height(devices)` picks the true 1U height from the **median height of detected Switches**, falling back to **Patch Panels**. If neither class is present it returns `None` and no grid is built (the report then shows every row as "Unidentified").

Given a unit height, `build_contiguous_unit_grid(devices, unit_h, rack_bounds, img_shape)` lays a strictly uniform, contiguous grid: every row is exactly `unit_h` tall, rows are back-to-back with no gaps, and the grid is anchored to the topmost and bottommost *real* equipment (a `_REAL_EQUIP_CLASSES` set, so a rail misclassified as "Closed Unit" can't drag the grid into the ceiling or floor). If the Hough rack bounds extend at least `0.6 × unit_h` above the top anchor or below the bottom one, extra rows are added there — that space is almost certainly an undetected chassis, not frame. Labels follow rack convention: **u01 at the bottom**, increasing upward.

**In:** device stack + rack bounds. **Out:** a list of unit dicts (`label`, `box`, `center`).

### 3.6 Assign devices to units, protect the picker, fill the gaps

- `assign_devices_to_units` gives each device the top-N grid units it overlaps most, where `N = round(device_height / unit_h)`. So a 1U switch claims one unit even if the grid over-sliced that slot; a 2U server claims two.
- **Picker protection:** port-bearing classes (`Switch`, `Patch Panel`, `Firewall`, `Gateway`, `Router`) are kept even if they somehow ended up with zero units, so the port picker can always list them. Non-port-bearing devices with zero units are dropped.
- `ensure_every_unit_has_device` guarantees every grid row maps to something: any unit no real detection claimed gets a **synthetic "Unidentified"** placeholder (`source: "synthetic_unidentified"`). The code deliberately does *not* call these "Empty" — a rack row almost always contains *something*, and claiming "Empty" with no visual evidence would be a false certainty.

`build_device_mapping` then produces the `class_name → [units]` summary, and the JSON payload is assembled.

**In:** devices + units. **Out:** every device carries `units`; every unit is accounted for.

### 3.7 Detect and classify ports — `classify_ports_by_pattern` and friends

At this point the annotated images and the JSON exist; the `--detect_only` path (production analyze) now fills in ports for each device. Port detection runs **only** on `PORT_BEARING_CLASSES` (`Switch`, `Patch Panel`, `Firewall`, `Gateway`, `Router`), plus a separate path for PDUs. Every other class gets zeroed port fields — this is what stops the model from hallucinating port boxes on servers, storage chassis, and blank panels.

The port model topology is two specialised models, run per device crop:

- **`ports_9.pt` (typed)** — outputs a port's *type* only: `RJ45, SFP, QSFP, CONSOLE, AUX, MANAGEMENT_PORT, USB_A, USB_B, USB_C`. No occupancy signal.
- **`port_count.pt` (status)** — outputs a port's *status* only: `Connected_port` / `Empty_port`. No type signal.

`classify_ports_by_pattern` runs both, applies NMS within each, then IoU-matches each status box onto the typed box with the largest overlap (threshold 0.3). A typed port with no matching status box stays `"unknown"`. Types are bucketed into the JSON contract: `RJ45 → main`, `SFP`/`QSFP → sfp`, `CONSOLE`/`AUX`/`MANAGEMENT_PORT → console`, `USB_* → other`. Within each bucket, ports are numbered in reading order — a lone row left-to-right, a two-row grid interleaved column-major (top-then-bottom per column), with a perspective-tolerant "paired x-columns" heuristic to decide one row versus two.

Two device types diverge:

- **Patch Panel** (`MAIN_PORTS_ONLY`) is a pure RJ-45 grid, so `detect_patch_panel_ports` uses the **status** model directly, collapses overlapping connected+empty pairs on the same physical jack, and snaps the combined count to the nearest standard size — **24 or 48** — synthesising missing jacks (interior gaps first) or dropping the lowest-confidence extras. It weights the two directions asymmetrically: panels under-detect (dark/dust-capped jacks) far more than they over-count, so synthesising a slot is cheaper than discarding a real one.
- **PDU** uses `detect_pdu_ports` with `pdu_ports_v1_det_best.pt` (classes `power_port_connected` / `power_port_empty`). It counts outlets, numbers them left-to-right, and reports `powered = (connected > 0)`. A PDU carries power outlets, not network ports, so its network-port fields are zeroed.

**OCR grounding (Phase B).** After the visual count, `device_db.read_device_model(dev_crop)` OCRs the faceplate and matches it against a small known-model table (`DEVICE_MODELS`). If a model is recognised and the visual main-port count is under 75% of the model's expected count, the pipeline trusts the datasheet count instead and records `port_count_source: "ocr:<model>"`. If no OCR backend is installed this is a silent no-op.

**Two honesty guards** protect the map:

- `demote_if_no_ports` — a port-bearing device with *zero* detected ports is almost certainly a wrong class guess, so it is demoted to "Unidentified".
- `mark_port_detection_failed` — if port detection *crashes*, the device is tagged `port_detection_failed` before demotion, so a crash stays distinguishable from a device that genuinely has no ports (both otherwise land on "Unidentified").

**In:** device crops. **Out:** each device's `port_count`, `ports`, `console_ports`, `sfp_ports`, `other_ports`, `connected_ports` (and PDU `power_*`), saved into `device_unit_map.json`.

### 3.8 Pick one device / one port (the `select` path)

When a user inspects a single port, the server calls the pipeline *without* `--detect_only`. It selects the device, crops it, classifies its ports, and highlights the chosen port. If the port reads **connected**, the cable classifier (`cable_eff_best`) runs on an enlarged crop (~4× the port box, so it sees connector *and* a chunk of cable body) to name the connector and colour. If the port reads **empty** and a port-identify model is configured, the bare socket type is classified. Prior technician corrections (cable colour, port type) from the org's learning memory can override these. This path also writes images `4`, `5`, `6` and `selected_port_info.json`.

A separate background pass, `enrich_cables_on_map` (`--enrich_cables`), reuses the same recipe to classify the cable on *every* connected port of an already-analysed rack and write the `cable_*` fields back — scheduled after analyze so the first result stays fast.

---

## 4. The models it uses

Six trained models carry the pipeline. Weight-level detail (class lists, training data, input geometry) belongs in the companion document — *The Models Behind the Pipeline* (`cv-models.md` in this knowledge base). In brief:

| Model file | Job | Type |
| --- | --- | --- |
| `Models/devices_seg.pt` | Detect & classify the 12 device types | YOLO segmentation |
| `Models/ports_9.pt` | Port **type** (RJ45 / SFP / QSFP / console / USB…) | YOLO detection |
| `Models/port_count.pt` | Port **status** (connected / empty) | YOLO detection |
| `Models/pdu_ports_v1_det_best.pt` | PDU power outlets (connected / empty) | YOLO detection |
| `Models/cable_eff_best` | Cable connector + colour (14 classes) | EfficientNet-B0 classifier |
| `Models/rack_classifier.pth` | Clear-vs-occluded gate on upload | MobileNetV2 classifier |

The **12 device classes** (from `devices_seg.pt`, normalised): Closed Unit, Empty, Firewall, Gateway, Load Balancer, PDU, Patch Panel, Router, Server, Storage Unit, Switch, UPS.

---

## 5. What it produces

### `device_unit_map.json` (the canonical output)

Written to `outputs/<rackId>/device_unit_map.json`. This is the file the server reads through `buildResponse()` and the source of truth for the whole app. Top-level fields:

- `image` — the analysed image path.
- `rack_bounds` — the Hough (or full-image) rack box.
- `unit_source` — `"device_tiling"` when a grid was built, `"none"` when no Switch/Patch Panel gave a unit height.
- `units_detected` — the list of unit labels (`u01`, `u02`, …).
- `device_mapping` — `class_name → [units]` summary.
- `devices` — the full per-device list. Each device carries `class_name`, `confidence`, `box`, `center`, `units`, `port_count`, and the port lists (`ports`, `console_ports`, `sfp_ports`, `other_ports`, `connected_ports`). Each **port** carries `box` (in crop coordinates), `center`, `status`, `class_name`, `confidence`, `port_category`, and `index`.

### The annotated images

Written under `outputs/<rackId>/images/`. On every analyze:

- `1_units_only.png` — the U ruler drawn on the rack.
- `2_devices_only.png` — device boxes with `index:ClassName [units]` labels. This is the hero image `buildResponse` prefers.
- `3_units_and_devices.png` — both overlays combined.
- `7_rack_all_ports.png` — the testing overlay: every real device box plus every detected port box, colour-coded (red main, yellow SFP, cyan console). Placeholder classes in `HIDDEN_DEVICE_TYPES` (`Empty`, `Closed Unit`, `Unidentified`) are skipped so unit-like boundaries don't clutter it.

Only when a single port is selected:

- `4_selected_device.png` — the chosen device crop.
- `5_selected_device_with_port.png` — that crop with all ports dotted and the picked one highlighted green.
- `6_full_rack_selected_port.png` — the full rack with the selected device and port marked.

The plain-text `device_unit_report.txt` (a `U# → Device Type` table) sits at the rack root alongside the JSON. `ocr_devices.json` (per-device faceplate make/model/version) is produced separately by `pipeline/ocr_devices.py`.

---

## 6. The logic behind key decisions

**The rack gate.** A photo can pass the tilt/letterbox checks and still be a person or a laptop. Rather than run the whole pipeline and return nothing, the server does a ~1-second `detect_only` pass; zero devices means "not a rack," rejected with a friendly, retryable message. Occlusion is judged by a model trained on real clear-vs-occluded racks (not an edge/colour proxy), because the proxy misfired both ways — vividly labelled devices read as clutter, and a wall of grey cables barely moved the needle.

**The unit grid.** Racks obey physics: every slot is exactly 1U, slots are contiguous, and standard switches/patch panels are exactly 1U tall. The pipeline exploits all three — it measures 1U from the median switch height, tiles the grid with zero gaps, and anchors it to real equipment so a misread rail can't shift it. This is why a 2U server reads as "U05-U06" and not a vague midpoint.

**Hidden classes.** `Empty`, `Closed Unit`, and `Unidentified` are placeholders, not equipment. They are kept in the map and report (so no row silently vanishes) but hidden from the port overlay and the device picker — there is nothing to inspect on them. The same `HIDDEN_DEVICE_TYPES` set is mirrored in the client (`ResultsPage.jsx`) so server and app agree.

**Port counting — and occupancy honesty.** Type and status come from two different models on purpose; a port's *category* (main/SFP/console) is independent of whether it's *occupied*. Crucially, occupancy comes **only** from the status model's sweep. A port the sweep didn't tag is genuinely `unknown`, and the pipeline says so (`resolve_port_occupancy`) rather than guessing. It specifically must **not** be inferred from the cable classifier's confidence: that model's 14 outputs are *all* colours with no "no-cable" class, so its softmax answers "which colour," never "is a cable present" — thresholding it would fabricate connected/empty that then poison topology and the CMDB.

**Patch panels snap to 24/48.** Real panels come in standard sizes, and the detector under-counts (dark, dust-capped jacks) more than it over-counts. So the combined count is snapped to the nearest standard, weighting synthesise-a-missing-slot as cheaper than drop-a-real-one.

---

## 7. Under the hood

**Files, in the order they matter:**

- `pipeline/runner.py` — `main()` is the orchestrator; it runs the ordered stages above and writes all outputs.
- `pipeline/config_loader.py` + `config.json` — model paths and thresholds.
- `pipeline/detection.py` — rack bounds, device detection (seg + dual), the unit-grid math, device post-processing.
- `pipeline/rack_classifier.py` + `pipeline/occlusion_model.py` — the occlusion gate.
- `pipeline/port.py` + `pipeline/port_pattern.py` — port detection, status binding, bucketing, numbering, patch-panel/PDU handling.
- `pipeline/cable.py` — cable + port-type classifiers and crop helpers.
- `pipeline/ocr_devices.py` + `pipeline/device_db.py` — faceplate OCR and port-count grounding.
- `pipeline/annotation.py` — the drawn overlays and `save_json`.
- `pipeline/selection.py` — device pick + crop helpers.

**Order of stages** (analyze path): gates → load → `detect_rack_bounds` → `detect_devices_seg` → `shift_boxes` → `remove_overlapping_devices` → `normalize_device_stack` → (device-class learning) → `derive_unit_height` → `build_contiguous_unit_grid` → `assign_devices_to_units` → picker protection → `ensure_every_unit_has_device` → write images 1/2/3/7 + report → per-device port classification (`--detect_only`) → OCR grounding → demote/mark → save `device_unit_map.json`.

**Config.** `config.json` holds the `models` map (`devices_seg`, `ports_typed`, `ports_status`, `pdu_ports`, `cable_classifier`) and the `detection` block (`device_detect_mode: "seg"`, `devices_conf`, `server_conf`, `iou_dedup`, `ports_conf`, `pdu_conf`).

**How the server drives it.** `server/app.js::runPipelineAnalyze(imagePath, outputDir, orgId)` sends an `analyze` request to a pool of warm Python workers (`pipeline/worker.py`). The worker's `handle_pipeline` sets `sys.argv` and calls `runner.main()` with `--detect_only` (and `--org_id` when scoped), capturing stdout. The `select` command runs the same `runner.main()` without `--detect_only`. Results are read back with `buildResponse(rackId, cached)`, which parses `device_unit_map.json`, normalises the port fields, and points the client at `2_devices_only.png` (falling back to `3_units_and_devices.png`) and `7_rack_all_ports.png`.

**Where outputs live.** `outputs/<rackId>/` — JSON and text at the root, the numbered PNGs in the `images/` subfolder, the original photo as `original_image.<ext>`.

---

## 8. Edge cases and limits

- **Not a rack.** Zero devices → the server rejects with `kind: 'not_a_rack'`. The full pipeline also raises "No devices detected" if it ever reaches port selection with an empty list.
- **Occlusion.** A heavily cabled rack (model `p_occluded ≥ 0.55`) is a retryable hard stop offering side-angle capture; the narrow 0.50–0.55 band is a soft warning. On the reference Test_Image set, the eight clear racks scored 0.013–0.149 and the heavily-cabled patch-panel rack scored 0.601 — the threshold is tuned to *this* checkpoint and should be re-measured if the model is retrained.
- **No Switch or Patch Panel.** Without one of these, `derive_unit_height` returns `None`, no grid is built (`unit_source: "none"`), and every row reports as "Unidentified" — there is no reliable 1U reference to tile from.
- **Missing port models → 0 ports.** If the typed/status models don't fire on a device, its ports come back empty; a port-bearing class with zero ports is demoted to "Unidentified" (a crash is instead flagged `port_detection_failed`).
- **Occupancy unknown.** When the status sweep doesn't tag a port, it stays `unknown` — never silently defaulted to empty or connected, and never inferred from the cable classifier.
- **OCR misses.** If no OCR backend is installed, `read_device_model` returns nulls and the visual port count stands; a mis-read or unknown model simply doesn't override anything. The `port_identify` (empty-socket-type) model is not in the current config, so empty ports are not given a socket type on the live path.
- **Patch panels only snap to 24 or 48** — there is deliberately no 12-port option, so a genuine 12-jack panel would round up to 24.
- **PDUs** report power presence, not network topology; their network-port fields are always zero.

---

## 9. Real vs synthetic

Not everything in the map was seen by a model — some entries are *reconstructed* to keep the grid and port layouts complete. Consumers can tell them apart by explicit flags:

- **Synthetic units / devices.** An unclaimed grid row becomes a placeholder device with `class_name: "Unidentified"` and `source: "synthetic_unidentified"`. Grid rows tiled to fill gaps carry `source: "synthetic_fill"`.
- **Synthetic ports.** Code-drawn port cells (grid layouts for a user-confirmed count, and patch-panel gap fills) carry `synthesized: true`. They still get their connected/empty status from the real status model where one overlaps, not from thin air.
- **Grounded / corrected counts.** `port_count_source` is `"ocr:<model>"` when a datasheet count replaced the visual one, or `"user_relabeled"` when an operator confirmed the count.
- **Learned corrections.** `class_name_corrected`, `cable_color_corrected`, and `port_type_corrected` mark values overridden by an organisation's active-learning memory; `class_name_original` preserves the model's first guess.
- **Failures kept honest.** `port_detection_failed` / `port_detection_error` mark a crash, distinct from a device that truly has no ports.

The rule of thumb: a real detection has a model confidence and no `synthesized`/`synthetic_*` marker; everything reconstructed says so.

---

## 10. Common questions

**Q: Does one photo really produce the whole inventory?**
Yes. A single front-of-rack photo drives device detection, the U grid, and port classification. Video is reduced to a best frame first; a multi-rack pan is split into one frame per rack, each analysed independently.

**Q: Why did my rack come back with a row labelled "Unidentified"?**
Either no detector produced a confident class for that row (so a synthetic placeholder fills it), or a port-bearing device was demoted because no ports were found on it. It's kept visible so the row isn't lost, but it's hidden from the port picker.

**Q: The pipeline said a switch has 24 ports but I only see cables on some — how does it know which are used?**
Port *count* comes from the type model (`ports_9.pt`); *occupancy* comes from a separate status model (`port_count.pt`). A port with no status match reads `unknown`, not "empty" — the pipeline won't guess.

**Q: It found no ports on my server / storage array. Bug?**
No. Port detection runs only on `Switch`, `Patch Panel`, `Firewall`, `Gateway`, and `Router`. Servers, storage, and blank panels are intentionally skipped to avoid hallucinated ports. PDUs get power-outlet detection instead.

**Q: Why does my 26-port switch report as 24?**
Patch panels snap to 24/48, but switches don't — a switch count comes from the visual detector (optionally corrected by faceplate OCR). If a count looks off, cable occlusion or a two-row layout is the usual cause; the relabel flow lets an operator set the true count, which is stored as `port_count_source: "user_relabeled"`.

**Q: How does it decide the U numbers?**
It measures one rack unit from the median height of detected switches (or patch panels), tiles a gap-free grid anchored to real equipment, and numbers from the bottom up (u01 at the bottom), the standard rack convention.

**Q: Can the cable colour be wrong?**
The cable model names connector + colour on ports already known to be connected. It has no "no-cable" class, so it's never used to decide *whether* a cable is present — only *what* it is. Operator colour corrections are learned and reapplied on later scans of the same rack.

**Q: My rack is buried in cables. Will the scan still work?**
It may warn or hard-stop for occlusion and suggest side-angle photos. You can proceed anyway, but devices hidden behind bundles can be missed — that's exactly what the warning is about.

**Q: Where's the data the app shows me?**
Everything comes from `outputs/<rackId>/device_unit_map.json`, read by `buildResponse()`. The images you see are `2_devices_only.png` (device boxes) and `7_rack_all_ports.png` (the port overlay).

**Q: What if the model files aren't deployed?**
The occlusion gate falls back to a heuristic rather than blocking uploads; the OCR grounding becomes a no-op; missing port models simply yield zero ports (and demotion). The pipeline is built to degrade rather than hard-fail closed.

**Q: Does "seg" vs "dual" change my results?**
The live config runs `seg` (single `devices_seg.pt`). `dual` (two models, Server-only + general) is fully coded but not selected by the current models map. Both return the same shape, so nothing downstream changes if the mode is flipped.

**Q: Is the port numbering stable if I re-scan?**
Numbering is spatial (column-major, bottom-anchored units), so it's reproducible for the same layout. A user-confirmed count forces exactly that many main ports so "port 24" stays the 24th physical position on later selects.
