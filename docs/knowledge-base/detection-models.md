# Detection Models — the CV Model Catalog

*The six computer-vision models that turn a rack photo into a device-and-port inventory — what each one is, what it can see, and how the pipeline stitches them together.*

Technical · Engineers · Last verified: 26 July 2026 against the live code + checkpoints.

---

## 1. In simple terms

RackTrack does not use one big "AI" that looks at a rack photo and understands everything. It uses a **team of small, specialised models**, and each one is trained to answer exactly one narrow question really well. That is a deliberate design choice: a model that only has to learn "what kind of network port is this?" gets much more accurate than a single model asked to learn devices, ports, cables, and photo quality all at once.

Think of it like a line of inspectors, each with one job:

- The **first inspector** looks at the whole rack photo and finds the equipment — "here is a switch, here is a patch panel, here is a UPS," and draws a box around each one.
- The **second inspector** zooms into one device and finds every port on its face, labelling the *type* of each port — "this is an RJ45, this is an SFP, this is a console port."
- The **third inspector** looks at the same ports but answers a different question — "is this port *plugged in* or *empty*?"
- The **fourth inspector** is a specialist for power strips (PDUs) — it counts the power outlets and says which have a plug in them.
- The **fifth inspector** looks at a single cable and names its connector and colour — "RJ-45, Blue."
- The **sixth inspector** stands at the door before anyone else starts and asks one yes/no question — "is this rack photo *clear*, or is it so covered in cables that we should ask for a better picture?"

Why split it up this way? Three reasons. **Accuracy** — each model is small and focused, so it is easier to train and less likely to confuse itself. **Maintainability** — when port detection needs improving, you retrain *one* small model and swap the file, without touching device detection. **Honesty** — if one model is unsure, only its one answer is marked "unknown," and the rest of the report is unaffected.

The rest of this document names every model exactly, lists the real classes each one was trained on (read straight from the checkpoint files, not from memory), and shows where in the code each is loaded and used.

---

## 2. The catalog

Every model is a real file in the `Models/` folder. The **config key** is how `config.json` refers to it; the pipeline loads models by that key, never by a hard-coded path (except the occlusion model, which is loaded on its own — see below). Class counts and architectures below were read directly from each checkpoint.

| Model file | Type / architecture | What it detects | # classes | Config key | Where used |
|---|---|---|---|---|---|
| `devices_seg.pt` | YOLOv8**m-seg** instance segmentation (Ultralytics 8.3.176) | Rack equipment — one box (+mask) per device | **12** | `devices_seg` | `pipeline/detection.py` → `detect_devices_seg()` |
| `ports_9.pt` | YOLOv8**m** object detection (Ultralytics 8.4.71) | Port **TYPE** (RJ45 / SFP / QSFP / console / USB …) | **9** | `ports_typed` | `pipeline/port_pattern.py` → `classify_ports_by_pattern()` |
| `port_count.pt` | YOLOv8**m** object detection (Ultralytics 8.3.191) | Port **STATUS** — connected vs empty (also gives the count) | **2** | `ports_status` | `pipeline/port_pattern.py` → `status_detections()`, `detect_patch_panel_ports()` |
| `pdu_ports_v1_det_best.pt` | YOLOv8**m** object detection (Ultralytics 8.3.176) | PDU **power outlets** — connected vs empty | **2** | `pdu_ports` | `pipeline/port_pattern.py` → `detect_pdu_ports()` |
| `cable_eff_best` | **EfficientNet-B0** image classifier (torchvision) | Cable **connector + colour** on a single crop | **14** | `cable_classifier` | `pipeline/cable.py` → `classify_cable()` |
| `rack_classifier.pth` | **MobileNetV2** image classifier (torchvision) | Whole-photo **clear vs occluded** gate | **2** | *(loaded directly, not via config)* | `pipeline/occlusion_model.py` → `classify_occlusion()` |

Four are YOLO detectors (the `.pt` files, all the medium "m" size backbone), and two are plain torchvision image classifiers (`cable_eff_best` has no extension; `rack_classifier.pth`). That split matters: a YOLO detector finds *many things and their positions* in an image; an image classifier takes *one already-cropped picture* and returns a single label.

---

## 3. Each model in detail

### 3.1 `devices_seg.pt` — the device detector (12 classes)

**Purpose.** This is the first and most important model. Given a full rack photo, it finds each piece of equipment and draws a tight box around it. It is an *instance-segmentation* model, so it actually produces a pixel-level mask for every device as well as a box — but the pipeline currently only consumes the boxes (masks are computed and then ignored, because everything downstream keys off rectangular device regions).

**Exact classes (12), read from the checkpoint's `model.names`:**

| id | class | id | class |
|---|---|---|---|
| 0 | Closed Unit | 6 | Patch Panel |
| 1 | Empty | 7 | Router |
| 2 | Firewall | 8 | Server |
| 3 | Gateway | 9 | Storage unit |
| 4 | Load Balancer | 10 | Switch |
| 5 | PDU | 11 | UPS |

Note the checkpoint stores class 9 literally as **"Storage unit"** (lower-case *u*). The pipeline normalises the raw YOLO strings to Title-Case forms the backend expects — for example `detection.py::_normalize_seg_label` maps `storage unit → "Storage Unit"`, `patchpanel → "Patch Panel"`, `pdu → "PDU"`, `ups → "UPS"`. So the model's raw label and the label you see in the report can differ by capitalisation; the *set* of things it can recognise is exactly the 12 above.

**How the pipeline uses it.** `config.json` sets `detection.device_detect_mode: "seg"`, so `runner.py` loads this model by the `devices_seg` key and calls `detect_devices_seg(img, model, conf=…)` (config `devices_conf` = 0.20). Each detection comes back as `{class_id, class_name, confidence, box[xyxy], center, source:"seg_model"}`. From there the runner post-processes the boxes into a clean rack stack: it removes gross overlaps, snaps every device to a common width, closes tiny gaps, builds a unit (U-position) grid, and assigns each device its `u01…uNN` rows. Any grid row that no device claims becomes an "Unidentified" placeholder rather than a false "Empty."

**How it was trained (from `train_args` in the checkpoint):** base model `yolov8m-seg.pt`, task `segment`, **100 epochs**, image size **640**, optimizer **AdamW**, initial LR **0.001**, batch 16, on a Colab dataset (`/content/dataset_extract/data.yaml`). Exported with Ultralytics 8.3.176 on 2026-06-29.

> The older `detect_devices_dual()` path in `detection.py` (a two-model "server model + general model" scheme, and its comments about `best 33.pt` / `best 32.pt` and a `PSU` class) is **legacy** and is not what runs today — the live config selects the single 12-class segmentation model above.

### 3.2 `ports_9.pt` — the port **type** detector (9 classes)

**Purpose.** Once a device is cropped out, this model finds every port on its face and says **what kind of port** it is. It says nothing about whether a port is plugged in — that is a separate model (3.3).

**Exact classes (9), read from `model.names`:** `AUX`, `CONSOLE`, `MANAGEMENT_PORT`, `QSFP`, `RJ45`, `SFP`, `USB_A`, `USB_B`, `USB_C`.

The pipeline groups those nine types into four report buckets (`port_pattern.py::_TYPE_TO_CATEGORY`):

- **main** ← `RJ45`
- **sfp** ← `SFP`, `QSFP`
- **console** ← `CONSOLE`, `AUX`, `MANAGEMENT_PORT`
- **other** ← `USB_A`, `USB_B`, `USB_C`

**How the pipeline uses it.** Loaded by the `ports_typed` key. Per device crop, `classify_ports_by_pattern()` runs this model (config `ports_conf` = 0.23), de-duplicates its boxes with per-class NMS at IoU 0.45–0.5, and then binds a *status* to each typed port from the status model (below). Ports fall into the four buckets, each bucket numbered for the picker UI.

**How it was trained:** base `yolov8m.pt`, task `detect`, **100 epochs**, image size **640**, optimizer **AdamW**, LR **0.001**, batch 16. Ultralytics 8.4.71, 2026-06-19.

### 3.3 `port_count.pt` — the port **status / count** model (2 classes)

**Purpose.** Same ports, different question. This model answers "is each port **connected** (a cable is in it) or **empty**?" — and by counting its detections, it is also how the pipeline gets a **port count** for a device.

**Exact classes (2), read from `model.names`:** `Connected_port`, `Empty_port`.

**How the pipeline uses it.** Loaded by the `ports_status` key as the `status_model`. `status_detections()` runs it once per crop; those connected/empty boxes are then IoU-matched (overlap ≥ 0.3) onto the typed-port boxes from `ports_9.pt`, so every typed port inherits a status. A typed port with no overlapping status box stays `"unknown"`. For **patch panels**, `detect_patch_panel_ports()` uses *this* model directly (a patch panel has no port "types" to speak of — just occupied/free jacks), and the combined connected+empty count is snapped to the nearest standard panel size (24 or 48) with missing slots synthesised and low-confidence extras dropped.

**How it was trained:** base `yolov8m.pt`, task `detect`, configured for **130 epochs** but the saved checkpoint is **epoch 19** with `best_fitness ≈ 0.380`, image size **640**, optimizer **auto**, LR **0.01**, batch 8, trained on **CPU** (Windows box path `…\ports.v2i.yolov8 (2)\data.yaml`). Ultralytics 8.3.191, 2025-10-09. It is the weakest-trained of the detectors and tends to **under-detect** in dark or blurry crops — which is exactly why the patch-panel count reconciliation and the confidence floor (`PORT_STATUS_CONF_MIN` = 0.35, below which status is `"unknown"`) exist.

### 3.4 `pdu_ports_v1_det_best.pt` — the PDU power-outlet detector (2 classes)

**Purpose.** A dedicated specialist for **power strips (PDUs)**. Power outlets look nothing like network ports, so they get their own model. It finds each outlet on a PDU and says whether a plug is in it.

**Exact classes (2), read from `model.names`:** `power_port_connected`, `power_port_empty`.

**How the pipeline uses it.** Loaded by the `pdu_ports` key. When a detected device is a PDU, `detect_pdu_ports()` runs this model (config `pdu_conf` = 0.40), numbers the outlets left-to-right, and returns `{power_ports, power_total, power_connected, power_empty, powered}` — where `powered` is simply "at least one outlet has a plug in it." Any class name containing `connect` is counted as connected; everything else as empty.

**How it was trained:** base `yolov8m.pt`, task `detect`, **120 epochs**, image size **640**, optimizer **AdamW**, LR **0.001**, batch 16. Ultralytics 8.3.176, 2026-06-29.

### 3.5 `cable_eff_best` — the cable classifier (14 classes)

**Purpose.** Given a small crop of a single cable/connector, name it: connector family **and** jacket colour. This is **not** a detector — it does not find cables in a scene; it classifies one already-cropped picture into one of 14 labels.

**Architecture.** An **EfficientNet-B0** (torchvision). The file `cable_eff_best` is a raw PyTorch `state_dict` (an `OrderedDict` of weights, no wrapper) — its final layer `classifier.1.weight` has shape **(14, 1280)**, i.e. 14 output classes over EfficientNet-B0's 1280-dim features.

**Exact classes (14).** Important truth: **the checkpoint does not store any class names** — it is only weights. The label list therefore lives *in code*, in `cable.py::FALLBACK_CABLE_CLASSES`, and its order is the argmax→label contract (it is `sorted(os.listdir(train_dir))` from the training run, which is why the hyphenated `RJ-45 Violet` sorts up at index 1, right after `LC_Aqua`, ahead of the underscore `RJ_45 …` names):

```
0  LC_Aqua        5  RJ_45 Green    10  RJ_45 White
1  RJ-45 Violet   6  RJ_45 Grey     11  RJ_45 Yellow
2  RJ_45 Black    7  RJ_45 Orange   12  SC_Orange
3  RJ_45 Blue     8  RJ_45 Pink     13  SC_Yellow
4  RJ_45 Brown    9  RJ_45 Red
```

So it recognises three connector families — **RJ-45** (copper Ethernet, ten colours), **LC** (fibre, Aqua), and **SC** (fibre, Orange/Yellow). `parse_cable_type_color()` splits each label into `(connector, colour)`, e.g. `RJ_45 Blue → ("RJ-45","Blue")`, `LC_Aqua → ("LC","Aqua")`.

**How the pipeline uses it.** Loaded by the `cable_classifier` key via `load_cable_model()`. `classify_cable(crop, model)` returns `(label, confidence)` from a softmax. **Preprocessing must match training exactly:** `Resize((256, 256))` then `ToTensor()`, with **no ImageNet normalization** — the code comments warn that adding normalization back (or a wrong size) collapses the softmax toward uniform and makes predictions look random. The same EfficientNet loader also backs an optional `port_identify` (port-type-from-crop) model, but no `port_identify` path is configured in `config.json`, so that step is inactive today.

### 3.6 `rack_classifier.pth` — the occlusion gate (2 classes)

**Purpose.** The bouncer at the door. Before a photo enters analysis, this model judges the *whole picture*: is the rack **clear**, or is it so buried in cables/clutter that devices behind the bundles will be missed? It gives the pipeline a chance to ask the user for better (side-angle) photos.

**Architecture.** A **MobileNetV2** (torchvision). The `.pth` is a dict with two keys — `model_state` (the weights) and `classes` — and the final layer `classifier.1.weight` has shape **(2, 1280)**.

**Exact classes (2), read from the checkpoint's `classes` key:** `clear`, `occluded`.

**How the pipeline uses it.** This model is **not** in `config.json`. `occlusion_model.py` loads it directly from `Models/rack_classifier.pth` (overridable via the `RACK_CLASSIFIER_PATH` env var) and runs `classify_occlusion()` on upload. Decision logic on the `occluded` probability:

- `p_occluded ≥ 0.55` → **hard stop** (`ok:False`, retryable): prompt the user to add left/right side-angle photos or proceed anyway.
- `0.50–0.55` → **soft warning**: proceed, but note some devices may be hidden.
- otherwise → **clear**, proceed silently.

**Preprocessing:** `Resize((224,224))`, `ToTensor()`, **with** ImageNet normalization (mean `[0.485,0.456,0.406]`, std `[0.229,0.224,0.225]`) — the opposite of the cable model, so the two must not share a transform. If torch or the weights file is missing, the gate **fails open**: it falls back to the old edge/saturation heuristic so uploads are never blocked by a missing model.

---

## 4. How they fit together in the pipeline

A single scan flows through the models roughly in this order:

1. **Occlusion gate (`rack_classifier.pth`).** On upload, `classify_occlusion()` judges the whole photo. A severely occluded rack is bounced back for re-capture before any detection runs.
2. **Device detection (`devices_seg.pt`).** `detect_devices_seg()` finds all 12-class equipment in the rack image. The runner cleans up the boxes and builds the U-position grid, so every device gets its `u01…uNN` slot.
3. **Per-device port detection (`ports_9.pt` + `port_count.pt`).** For each detected device, the runner crops the device face and runs **both** port models: `ports_9.pt` says *what type* each port is, `port_count.pt` says *connected or empty*. The status boxes are IoU-matched onto the typed boxes so each port has both a type and a status. Patch panels skip the type model and use the status model alone, reconciled to 24/48.
4. **PDU outlets (`pdu_ports_v1_det_best.pt`).** If a device is a PDU, `detect_pdu_ports()` counts and statuses its power outlets instead of network ports.
5. **Cable identification (`cable_eff_best`).** Where a cable crop is available, `classify_cable()` names its connector + colour and enriches the map.

Each stage's output is independent enough that a weak or missing model degrades only its own field. A missing cable model means "cables unlabelled," not "scan failed." A missing status model means ports show up but their connected/empty state is `unknown`.

---

## 5. Real vs synthetic — these run on real photos

Every model in this catalog runs on **real camera photographs of real racks** — the images a user actually captures in a data centre or comms room. None of them is a simulation, and there is no "demo/fake" mode that fabricates detections. The word *synthetic* does appear in the code, but it means something narrow and honest:

- When the device grid has a gap no real detection covers, the runner inserts a placeholder row labelled **"Unidentified"** (`source: "synthetic_unidentified"`) — never "Empty," because a rack row almost always holds *something* and a false "Empty" would be over-claiming.
- The patch-panel reconciliation may **synthesise** the boxes for jacks the status model missed (to reach a standard 24/48), and `grid_ports()` may draw code-generated port cells when a user sets an exact count. These synthesised *positions* still get their connected/empty **status from the real `port_count.pt` detections** underneath them — the model signal is real; only the box geometry is drawn.

So "synthetic" here is about filling in geometry to keep the grid honest and complete, not about inventing devices, ports, or connections. The classifications themselves always come from a model looking at the actual photo.

---

## 6. Operational notes

- **The models ship separately from the code.** The `Models/` directory is **git-ignored** — the six weight files are not in the repo and are distributed/staged onto each machine out of band. A fresh checkout has the *code* but not the *weights*. If a model file is absent, that stage cannot run.
- **Loaded by config key, cached once.** `config.json → models` maps five keys (`devices_seg`, `ports_typed`, `ports_status`, `pdu_ports`, `cable_classifier`) to their files. The occlusion model is the exception — it is loaded directly by `occlusion_model.py` (env `RACK_CLASSIFIER_PATH`, default `Models/rack_classifier.pth`). `detection.py::load_model()` caches each YOLO model in-process, so a long-lived worker pays the load cost once.
- **A missing port model → 0 ports.** If `ports_9.pt` / `port_count.pt` are not present (or the path is wrong), the port stage detects nothing and devices come back with **`port_count = 0`** and empty port lists — the rest of the report (devices, U-positions) is unaffected. Likewise a missing `pdu_ports` model → PDUs show 0 outlets, and a missing `cable_classifier` → cables unlabelled.
- **Occlusion fails open.** If torch or `rack_classifier.pth` is missing, `classify_occlusion()` returns `None` and the pipeline falls back to the legacy heuristic rather than blocking the upload.
- **Preprocessing is model-specific and load-bearing.** Cable model: 256×256, **no** normalization. Occlusion model: 224×224, **with** ImageNet normalization. Swapping these (or the BGR→RGB conversion) silently wrecks accuracy — they are not interchangeable.
- **Class names come from two places.** The four YOLO models store their class names *inside* the checkpoint (`model.names`), so they are self-describing. The cable classifier does **not** — its 14 labels live in `cable.py` and must stay in sync with the training folder order. Retraining the cable model with a different folder set without updating that list will silently mislabel colours.

---

## 7. Common questions

**Q1. What does each model actually do?**
`devices_seg.pt` finds the equipment (12 classes). `ports_9.pt` names each port's type (9 classes). `port_count.pt` says whether each port is connected or empty and gives the count (2 classes). `pdu_ports_v1_det_best.pt` does the same for PDU power outlets (2 classes). `cable_eff_best` names a cable's connector + colour (14 classes). `rack_classifier.pth` decides if the whole photo is clear or too occluded to trust (2 classes).

**Q2. Why are there so many models instead of one?**
Because each narrow model is more accurate, easier to retrain, and fails independently. A device model asked to also learn ports, cables, and photo quality would be worse at all of them, and a single unsure answer would taint the whole report.

**Q3. Why are ports sometimes 0?**
Most often the port models weren't available (files missing / wrong path), so the port stage detected nothing and the device came back with `port_count = 0`. It can also happen on genuinely portless or fully cable-occluded faces, or when the status model (`port_count.pt`, the weakest-trained one) under-detects on a dark/blurry crop — in which case ports may show but their status reads `unknown`.

**Q4. Which model detects the devices, and what can it recognise?**
`devices_seg.pt`, a YOLOv8m-seg model with exactly 12 classes: Closed Unit, Empty, Firewall, Gateway, Load Balancer, PDU, Patch Panel, Router, Server, Storage unit, Switch, UPS.

**Q5. Why are there *two* port models for the same ports?**
They answer different questions. `ports_9.pt` gives the **type** (RJ45 / SFP / console / USB …) but no status; `port_count.pt` gives the **status** (connected / empty) but no type. The pipeline runs both and matches their boxes so each port ends up with both a type and a status.

**Q6. Why does a PDU need its own model?**
Power outlets look nothing like network ports, so `pdu_ports_v1_det_best.pt` is trained only on `power_port_connected` / `power_port_empty`. It counts outlets and reports whether the rack is powered.

**Q7. How does the cable classifier know the colour and connector?**
`cable_eff_best` (EfficientNet-B0) classifies a cable crop into one of 14 labels combining connector and colour (e.g. `RJ_45 Blue`, `LC_Aqua`, `SC_Orange`). Code then splits that into `(connector, colour)`. It knows three connector families: RJ-45, LC, SC.

**Q8. Where do the class names come from — are they hard-coded?**
The four YOLO models carry their own class names inside the checkpoint (`model.names`), so they are self-describing and were read straight from the files for this doc. The cable classifier is the exception: its checkpoint holds only weights, so its 14 labels live in `cable.py` and must match the training folder order.

**Q9. What is the occlusion model and when does it run?**
`rack_classifier.pth` (MobileNetV2, classes `clear` / `occluded`) runs on upload, before analysis. If it's ≥ 0.55 sure the rack is occluded it hard-stops and asks for side-angle photos; 0.50–0.55 is a soft warning; below that it's clear. If the model or torch is missing, it falls back to a heuristic and never blocks the upload.

**Q10. Do these run on real photos or a simulation?**
Real photos, always. There is no fake-data mode. "Synthetic" in the code refers only to filling grid gaps and drawing port cells to keep the layout complete — the actual classifications always come from a model looking at the real image, and unclaimed rows are labelled "Unidentified," never a false "Empty."

**Q11. What architecture and training settings do the models use?**
The four detectors are all YOLOv8**m** (medium) — segmentation for devices, detection for the three port/PDU models — trained at image size 640. `devices_seg.pt`, `ports_9.pt`, and `pdu_ports_v1_det_best.pt` used AdamW at LR 0.001 for 100/100/120 epochs; `port_count.pt` used the "auto" optimizer at LR 0.01 (saved at epoch 19). The two classifiers are torchvision models: EfficientNet-B0 for cables (256×256, no normalization) and MobileNetV2 for occlusion (224×224, ImageNet normalization).

**Q12. A model file is missing on a machine — what breaks?**
Only that model's stage. Missing device model → no devices. Missing port models → `port_count = 0`, ports empty. Missing PDU model → PDUs show 0 outlets. Missing cable model → cables unlabelled. Missing occlusion model → falls back to the heuristic gate. The `Models/` folder is git-ignored, so weights must be staged onto each machine separately from the code.
