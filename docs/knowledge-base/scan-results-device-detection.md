# Scan Results & Device Detection

*The annotated rack — everything RackTrack found in your photo, laid out slot by slot, and your one-tap chance to confirm or correct it.*

Core feature · All users · Last verified: 26 July 2026 against the live code.

---

## 1. In simple terms

You point the camera at a rack and take a single photo. A few seconds later RackTrack shows you that same photo with every piece of equipment boxed and named — *a switch here, a patch panel there, a PDU at the bottom* — and each one placed on the rack unit (the "U" slot) it sits in.

That screen is the **results hub**. It is where you land after every scan, and it is the doorway to everything deeper: live port checks, cable tracing, a topology map, network discovery, switch firmware, and change history. It is built so you can trust it at a glance and fix anything it got wrong in a couple of taps.

Three ideas run through the whole feature:

- **The photo is the source of truth.** The boxes, names, port counts and cable colours all come from RackTrack *looking at your picture*. Nothing on your live network is touched just to draw this screen.
- **You only go live when you ask.** RackTrack reaches out to a real switch only when you open a specific port to check it. Until then the screen stays fast and your equipment stays undisturbed.
- **Every correction sticks and teaches.** When you tell the app "that's not a switch, it's a PDU," that fix is saved, reused next time, and fed back so the app gets better on the gear *you* actually own.

## 2. At a glance

| | |
|---|---|
| **What it is** | The results hub for a scanned rack: an interactive annotated photo plus every deeper view. |
| **Who uses it** | Everyone who runs a scan. |
| **Where the input comes from** | Your one photo (analysed by the vision + text models) and, on demand, live data read from a switch. |
| **What it produces** | An annotated rack image, a per-device breakdown, a per-port live view, a shareable report, and training feedback. |
| **How a device is found** | A single segmentation model (`devices_seg.pt`) detects equipment; text on the faceplate (OCR) refines the make, model and sometimes the class. |
| **Data source** | REAL — read from your photo. Live port checks are REAL/LIVE from the switch. Only unclassified "Unidentified" filler rows are synthetic. |
| **Where you land after a scan** | `ResultsPage.jsx` — one tabbed page: Overview · Switches · Ports · Topology · Network · Drift. |

## 3. How it works — step by step

From a finished scan to a fully mapped rack:

```
Scan finishes                →  the photo has been analysed on the server
        ↓
Results hub opens            →  /results/<rackId>, Overview tab
        ↓
Devices are boxed & named    →  each detection drawn on your original photo
        ↓
Names are refined            →  OCR reads faceplate labels; some devices are
                                re-typed by the brand it reads
        ↓
Rack is laid out by unit     →  every U slot has a row; gaps become placeholders
        ↓
You pick a device            →  switch / panel / router / gateway / firewall / PDU
        ↓
You check a port (optional)  →  Find Port → the app reads that one port LIVE
        ↓
You confirm or correct       →  "Detected as Switch — right?"  Yes / No + fix
        ↓
You branch out or share      →  Ports · Topology · Network · Switches · Drift · Report
```

**What happens in each stage**

1. **The scan finishes and the hub opens.** After the photo is analysed the app navigates to `/results/<rackId>`. If you arrived some other way — from Recent Scans, a deep link, or the back button — the page refetches the latest saved result so port counts and corrections are always current.
2. **Devices are drawn on your photo.** RackTrack overlays a coloured box on every detected device, with a small name chip on each (for example `U12-SW01`). The boxes are drawn straight from each detection's pixel coordinates, so they stay lined up exactly as you pinch-zoom.
3. **Names and types are refined by reading the labels.** In the background the app reads the text printed on each faceplate. If it reads a real device label (like `RVEW-CORE-SW01`) it uses that as the name. If it reads a brand it recognises (Planar, Sony, Tripp-Lite, AudioCodes/MediaPack, CEdge, and others) it can *re-type* a device the shape-only model guessed wrong — for example bumping a box the model called "UPS" up to "Controller."
4. **The rack is laid out unit by unit.** Every rack row gets an entry. Rows where nothing could be identified become "Unidentified" placeholders so the U-map has no holes.
5. **You choose a device to inspect.** A dropdown (and, in the All Components view, a set of cards) lets you pick any port-bearing device. A switch or panel shows its port breakdown; a PDU shows its power outlets.
6. **You check a specific port (only if you want to).** Pick a port type (RJ45 / SFP / Console / USB), type a port number, and press **Find Port**. This can query the real switch for that one port's live state and what is on the far end of the cable.
7. **You confirm or correct.** Quick Yes/No cards ask, e.g. *"Detected as Switch — right?"* and *"Detected 24 RJ45 ports — right?"*. Your answers are saved and reused.
8. **You branch out.** The tab bar and the report row open every deeper view, or produce a report you can view, download, or send.

## 4. What you see on screen

### The annotated image (the "hero")

- **Your photo, with boxes.** Every real detection is outlined in a colour keyed to its type, each with a name chip. Placeholder rows (Empty, Closed Unit, Unidentified) are deliberately left off the overlay — they are rack-slot fillers, not something you can act on.
- **A colour per type.** Switches, patch panels, servers, PDUs, firewalls and so on each get their own accent colour so the rack reads at a glance.
- **A "Done in *[time]*" badge, a scan-line sweep, corner HUD marks and an "ANALYZED" tag** — the visual polish confirming the read is finished.
- **Zoom and focus.** Pinch or use the on-screen +/- buttons (0.8×–2.5×). Tapping a device selects it; tapping the highlighted device again enters *focus mode*, which hides every other box for a clean drill-in, with a "Back to rack" button to exit.
- **Selected-device view.** When a device is selected the hero switches to the port overlay (the render with the coloured port boxes baked in) so you can see that device's ports, with a bright highlight and corner brackets around the chosen device.

### The device list and selection

- **The device dropdown** (Overview) lists only the *pickable* device types — Switch, Patch Panel, Router, Gateway, Firewall and PDU — the kinds with something to inspect. Other detected gear (servers, UPSes, load balancers) still shows on the image but is not offered for selection.
- **The All Components card view** shows each pickable device as a card: its name, its type, its unit range (e.g. `U01-U02`), port pills (for example `24p` RJ45, `2s` SFP, `1c` console), and, once the background cable pass has run, cable chips like "RJ-45 Blue ×12." A PDU card shows a power summary such as "24 outlets · 18 in use."
- **If nothing is pickable**, the screen explains why — using the scan's own quality note when there is one ("No devices could be read from this photo. …"), otherwise a plain "try again from straight on with the whole rack in frame."

### Per-device and per-port information

- Selecting a switch/panel/router/gateway/firewall lets you enter a port and press **Find Port**. A port view then shows the port's **status** (connected / empty / unknown), its **cable type and colour** (shown as a real colour swatch, not the app's monochrome theme), and — when the app can work it out — the **device on the far end**.
- A **Port Report** can be produced from the switch console transcript (link status, learned MACs, LLDP neighbour, cable diagnostics, spanning-tree state, and a plain-English verdict).
- A PDU instead shows its **power outlets** (total, in use, free, powered).

### The tabs

The results page is one page with a tab bar:

- **Overview** — the annotated image, device picker, and the confirm/correct cards (this document's main subject).
- **Switches** — live switch info (model, firmware, uptime, serial) read over SSH, plus vendor specs and firmware-update checks.
- **Ports** — the full per-port view for the rack.
- **Topology** — the rack's topology map.
- **Network** — network discovery (Netdisco) data.
- **Drift** — continuous change monitoring from watched switches.

In the mobile tab bar, **Overview, Switches, Ports and Topology** sit directly on the bar; **Network** and **Drift** live behind a **More** button. On desktop the same links appear in the shell sidebar.

### Relabeling (feedback)

Under a selected device you get small, one-at-a-time Yes/No cards:

- *"Detected as `<type>` — right?"* — No lets you pick the correct type from a list of 14 device types.
- *"Detected `N` RJ45 ports — right?"* (or a combined "Detected `N` total ports (…breakdown…) — right?") — No lets you set the real count. PDUs skip this (they have outlets, not RJ45 ports).
- *"Port type: `<type>` — right?"* — appears on a selected port so you can correct RJ45 vs SFP vs USB, etc.

Anything you set is marked with a **"Your correction"** badge so you never mistake your own confirmed value for a model guess, and the card collapses to "you set this."

### Reports and sharing

At the bottom of Overview is an action row with four buttons: **View**, **Share**, **Change Device** and **New Scan**.

- **View** opens the report inside the app (a self-contained HTML page with the images embedded).
- **Share** offers **Teams**, **Outlook** and **Slack**; you enter a recipient email (remembered for next time) and an optional note, and the report is sent to that channel.
- **Change Device** clears the selection and returns you to the picker; **New Scan** goes back to the Scan screen.
- From the report view you can also **download** it (PDF via the system, or the HTML/JSON/CSV formats the server produces).

A separate **Confirm rack** button (in the All Components header) marks the whole rack as correct, so a later re-photo of the same rack shows this confirmed result instead of re-detecting from scratch.

## 5. The logic behind it

### Device classes

Detection is done by a single YOLO **segmentation model**, `devices_seg.pt`, running in "seg" mode. Its native vocabulary is **12 classes**:

> Closed Unit · Empty · Firewall · Gateway · Load Balancer · PDU · Patch Panel · Router · Server · Storage Unit · Switch · UPS

Those 12 are what the model can tell apart from *shape alone*. Some device types you can end up seeing — **Controller, Recorder, Amplifier, Modem, Load Balancer** — are **not** produced by the vision model at all. They appear only when OCR reads a recognisable **brand** on the faceplate and upgrades the class (for example PLANAR → Controller, SONY → Recorder, Tripp-Lite → PDU, MediaPack/AudioCodes → Gateway, CEdge → Router). This is why the naming tables and the correction menu are larger than 12:

- The **label-code tables** (`CLASS_CODE` on the client, `CLASS_CODE_SRV` on the server) map **16** class names to short codes (the 12 above minus Storage Unit, plus Load Balancer, Modem, Controller, Recorder, Amplifier, and codes for Empty/Closed Unit).
- The **"what is this really?" correction menu** offers **14** types (the same list without Empty and Closed Unit — you wouldn't relabel a device *to* "empty").

### Confidence

The segmentation model keeps detections at or above a **0.2 (20%) confidence** threshold, with overlapping boxes de-duplicated (IoU 0.5). Each accepted box is trimmed by two pixels per side to shed border noise, and boxes smaller than 10×10 px are dropped. Cable reads carry their own confidence; when a cable read is **below 0.5** the port view shows a low-confidence nudge asking you to verify and correct it.

### Labels (the names on the boxes)

Each device gets a name, chosen in this order:

1. **A real label read off the rack.** If OCR read an identifier-shaped label on that device with at least ~0.4 confidence, that text is the name (e.g. `RVEW-CORE-SW01`), optionally with a stack-member suffix (`…/2`).
2. **A pattern-matched name.** If a confident label was found *somewhere* on the rack, the app infers the naming pattern and mints matching names for the rest (so an unlabelled PDU next to `RVEW-CORE-SW01` becomes `RVEW-CORE-PDU01`).
3. **A unit-prefixed fallback.** Otherwise the name is built from the device's U-position and type code plus a sequence number — e.g. `U12-SW01`, `U01-PP01`.

### What is hidden, and why

Three classes are treated as **hidden** on the results screen: **Empty**, **Closed Unit** and **Unidentified**. They are removed from the annotated overlay *and* from the device picker, because none of them is something you can inspect or act on. They are **not** deleted, though — they stay in the underlying rack record and U-map so the layout stays continuous and no rack row is silently lost.

## 6. Under the hood (technical)

**Where detection runs.** Analysis runs in a persistent Python worker pool (`python -m pipeline.worker`, managed by `server/worker-pool.js`). The active detector is selected in `config.json` (`detection.device_detect_mode`), which is set to **`seg`** in this build — so `pipeline/detection.py::detect_devices_seg` runs against `Models/devices_seg.pt`. (The code also carries a `dual` two-model path, but it is not the configured mode here.)

**The models used.**
- **Device/unit detection** — `Models/devices_seg.pt` (12 seg classes) finds each device, its class, a confidence and a box, then post-processing maps each device onto rack units and fills any unclaimed unit with an `Unidentified` placeholder (`source: synthetic_unidentified`) so the U-grid is continuous (numbered from the bottom: `u01` is the bottom slot).
- **Ports** — `Models/ports_9.pt` types each port (its 9 classes: RJ45, SFP, QSFP, CONSOLE, AUX, MANAGEMENT_PORT, USB_A/B/C) which the UI collapses into four buckets (RJ45→main, SFP/QSFP→sfp, Console/AUX/Mgmt→console, USB→other), and `Models/port_count.pt` marks each port occupied/empty.
- **PDU outlets** — `Models/pdu_ports_v1_det_best.pt` produces PDU power totals (PDUs carry outlets, not network ports).
- **Cables** — `Models/cable_eff_best` runs as a background enrichment pass, writing `cable_connector` / `cable_color` onto each *connected* port; the cable chips appear once it finishes.
- **OCR** — `pipeline/ocr_devices.py` reads each faceplate → `ocr_devices.json` (make/model/version by U-position); `pipeline/ocr_labels.py` reads full-image labels → `labels-front.json`.

**Key files written per rack** (`outputs/<rackId>/`): `device_unit_map.json` (the primary map — every device's class, confidence, box, units, ports, and for PDUs the power fields), `scan_result.json` (the canonical merged record), `ocr_devices.json`, `labels-front.json`, `feedback.jsonl` (this rack's corrections), `scan_meta.json`, annotated renders under `images/` (`2_devices_only.png`, `3_units_and_devices.png`, `7_rack_all_ports.png`, and others), and `report.html` / `report.pdf`.

**Rack identity and caching.** `computeRackId` hashes the image bytes together with an ownership scope (`org:<id>`, else `tenant:<id>`, else `global`) with SHA-256 and takes the first 8 hex characters → `RK-XXXXXXXX`. `scanId` and `rackId` are the same value. Re-uploading an identical photo returns the cached result (`cached: true`) instead of re-detecting; `POST /api/scan/:rackId/confirm-layout` registers the image's perceptual fingerprint so a *re-shot* photo of a confirmed rack can short-circuit to the confirmed result.

**The two read endpoints.**
- `GET /api/scan/:rackId` returns the raw `device_unit_map.json` view via `buildResponse()` — the devices array (each with its port sub-arrays), `units_detected`, `originalExt`, the annotated image URL (prefers `2_devices_only.png`, falls back to `3_units_and_devices.png`), an overlay URL (`7_rack_all_ports.png`) and any quality warning. Overview polls this on mount so port counts and cable chips stay in sync.
- `GET /api/scan/:rackId/result` returns the canonical `scan_result.json` (schema `scan_result.v1`), regenerating it on the fly if the file is missing.

**How the Overview screen assembles the view.** `client/src/pages/ResultsPage.jsx`:
- fetches `/api/ocr/labels/:rackId`, which returns `deviceLabels`, an inferred naming `pattern`, and `reclassifications`;
- builds `effectiveDevices` by applying the brand-token `reclassifications` over the detected devices — overriding `class_name` while recording `_reclassifiedFrom` and `_reclassifiedBrand`;
- builds `labels` via `buildDeviceLabels(effectiveDevices, units_detected, pattern)`, preferring a real OCR label (conf ≥ 0.4), then the pattern name, then the `U12-SW01` fallback;
- draws one box + chip per device (skipping `HIDDEN_DEVICE_TYPES`). The pipeline does not emit mask polygons, so the boxes are the detection bounding boxes.

**The canonical record.** `writeCanonicalScanResult` → `buildScanReportData` builds `scan_result.json`: each device gets a stable `index`, a label (using the server's `CLASS_CODE_SRV`), its U-position, port counts and power; make/model/firmware are merged in from `ocr_devices.json` by U-position; then `applyFeedbackOverrides` overlays user corrections (the corrected value wins, the model's original is preserved under a `_correction` trail, and a running feedback accuracy block is kept). The topology snapshot is regenerated after each write.

**Find Port.** Selecting a device + port and pressing Find Port calls `POST /api/select` for that one device/port and pre-fetches the switch neighbour; the live switch is only touched here.

**The feedback loop.** Corrections post to a small family of endpoints:
- **Device class** → `POST /api/feedback/device`. This persists the corrected class back into `device_unit_map.json` (setting `class_name_original` and `class_name_source: user_corrected`), saves the device crop, appends an immutable row to both the global and per-rack `feedback.jsonl`, refreshes the canonical result, and — via `fireMemoryCorrection` — stores a perceptual hash plus a ResNet-18 embedding scoped to your organisation, so visually similar devices in future scans can auto-apply the corrected label.
- **Port count** → `POST /api/feedback/port-count` (can re-run detection at the corrected count).
- **Port type** → `POST /api/feedback/port-type`; **port + cable colour** → `POST /api/feedback`; **a fully verified port layout** → `POST /api/feedback/port/verified` (lets future matching scans skip the port model).

**The report.** From `scan_result.json`, the report renders as a self-contained HTML page (images inlined as base64, shrunk copies used where available so it stays light in a mobile WebView), a real PDF (headless Chromium), plus JSON and CSV — served by `GET /api/scan/:rackId/report?format=html|json|csv` (and PDF). A short-lived **report token** (300 seconds) minted from `/api/scan/:rackId/report-token` lets the in-app report `<iframe>` prove rack access without an auth header. Sharing posts to `POST /api/scan/:rackId/{teams|outlook|slack}` with the recipient email and optional note.

## 7. Edge cases & limits

- **Unidentified devices.** When post-processing finds a rack unit that no detector claimed, it inserts an `Unidentified` placeholder rather than guessing "Empty" — because a rack row almost always contains *something*, and "Empty" would be a false certainty. These are hidden from the overview and the picker (there is nothing to inspect) but kept in the record so the U-map has no gaps. OCR can later rescue one: if it reads an identifier label whose code names a real class (e.g. `…-SW01` → Switch), the placeholder is upgraded.
- **Empty and Closed Unit.** These are genuine detections (a visibly empty slot, or a blanking/closed panel). They are hidden from the overview overlay and the picker for the same reason — not actionable — but they remain in the underlying map.
- **Low confidence.** Detections below 0.2 confidence are not kept. A cable read below 0.5 confidence triggers a visible nudge on the port view asking you to verify and correct — the model tells you plainly when it is unsure rather than presenting a guess as fact.
- **A brand fools the shape model.** AV controllers, recorders, media gateways and some PDUs look, in silhouette, like generic boxes and can be mis-typed by the vision model. OCR brand reclassification is the safety net; if it still lands wrong, your one-tap correction fixes it and teaches the app.
- **No devices found.** If the picker is empty, the screen surfaces the scan's own quality reason when it has one (bad angle, occluded rack, etc.); otherwise it asks you to re-shoot straight-on with the whole rack in frame.
- **Re-analysing.** *Change Device* resets the selection; *New Scan* starts over; correcting a port count can re-run detection at the right number; an identical re-upload is a cache hit; and *Confirm rack* makes a matching re-shot serve your confirmed result instead of re-detecting.
- **Stale navigation state.** Arriving from history or a deep link can carry an old snapshot, so the page always refetches `/api/scan/:rackId` (and the OCR labels) on mount and overwrites what it shows with what is on disk right now.

## 8. Real data vs. synthetic

| Thing on screen | Real or synthetic |
|---|---|
| Device boxes, classes, port counts | **REAL** — detected from your photo by the vision models. |
| Cable colour / type | **REAL** — read by the cable model in the background, with a confidence. |
| Make / model / firmware | **REAL** — read by OCR from the faceplate, where legible. |
| Brand re-typing (Controller, Recorder, Gateway, …) | **REAL** — driven by a brand name OCR actually read on the device. |
| Live port status & end device | **REAL / LIVE** — read from the switch over SSH, only when you open a port. |
| Device names like `U12-SW01` | **SYNTHESISED naming** — a generated label; replaced by a real name when OCR reads one. |
| "Unidentified" placeholder rows | **SYNTHETIC** — inserted for unclassified rack units; hidden from the overview and picker. |
| Your corrections | **REAL** — your input, stored, reused, and used to teach the model. |

## 9. Use cases

- **Documenting a rack in seconds.** Scan, glance at the boxes, confirm the switch and its port count, and you have an accurate inventory without typing anything up by hand.
- **Chasing a bad port.** Select the port, press Find Port, and see its live status and the device on the other end — without opening a terminal.
- **Fixing a mis-typed AV/telecom box.** When a controller or recorder is mistaken for a generic chassis, one tap sets it right and the fix carries to every similar unit in your fleet.
- **Sharing the result.** Send the report straight to Teams, Outlook or Slack, or download the PDF/CSV, so the rest of the team sees exactly what was found.
- **Feeding every other view.** The same detected rack is what Topology, Network, Drift and the CMDB registration all build on — get the results right once and every downstream view benefits.
- **Improving accuracy over time.** Each correction becomes a labelled training example and an active-learning memory entry, so the app sharpens on the equipment you actually have.

## 10. Common questions

**Q1. Does scanning touch my switches or network?**
No. Drawing the results screen uses only your photo. RackTrack contacts a real switch only when you open a specific port (Find Port) or open the Switches tab — and only for that one lookup.

**Q2. How does it know what each device is?**
A single vision model (`devices_seg.pt`) recognises equipment by shape into 12 base classes. Then OCR reads the faceplate: it can supply the real name, and if it reads a known brand it can correct the type (e.g. a box the model called "UPS" becomes a "Controller").

**Q3. Why do I sometimes see types like "Controller" or "Recorder" that aren't in the 12 classes?**
Those come from OCR reading the brand, not from the shape model. The shape model can't tell a Planar controller from a generic chassis, so the brand name on the label is what upgrades it.

**Q4. What do the names like `U12-SW01` mean?**
They are generated names: the unit position (`U12`) plus a type code (`SW` = Switch) and a sequence number. If RackTrack reads a real label on the rack, it uses that instead — and if it finds a naming pattern, it mints matching names for the rest.

**Q5. Why don't empty slots or "Unidentified" rows show up in the list?**
Because there's nothing to inspect or act on there. Empty, Closed Unit and Unidentified rows are hidden from the image overlay and the device picker, but they stay in the rack record so the layout has no gaps.

**Q6. I can see a device on the image but I can't select it. Why?**
Only port-bearing types you can drill into are selectable: Switch, Patch Panel, Router, Gateway, Firewall and PDU. Servers, UPSes and load balancers are shown but not offered for selection.

**Q7. It labelled a device wrong. How do I fix it, and does it stay fixed?**
Use the "Detected as … — right?" card, tap No, and choose the correct type. It is saved immediately, reused when you reopen the scan, and used to auto-correct visually similar devices later. Your value carries a "Your correction" badge so it's clearly yours.

**Q8. What does "Confirm rack" do?**
It marks the whole rack as correct and registers the photo's fingerprint. If you later re-photograph the same rack, RackTrack serves your confirmed result instead of detecting it all over again.

**Q9. If I upload the same photo twice, do I get a duplicate?**
No. A rack's ID is derived from the image itself (scoped to your org/tenant), so an identical re-upload lands on the existing record and returns the cached result.

**Q10. The port counts changed after I corrected one. Is that expected?**
Yes — correcting a port count can trigger a re-detection at the corrected number, and the screen refetches the saved result so it reflects what's now on disk.

**Q11. How do I get a report out, and in what formats?**
Use View to open it in the app, then download it as a PDF, or let the server produce HTML, JSON or CSV. Share sends it to Teams, Outlook or Slack by entering a recipient email.

**Q12. It says "no devices could be read." What should I do?**
Follow the reason shown (it often names the problem — too tilted, rack occluded by cabling, etc.). Generally: retake the photo straight-on with the whole rack in frame and good light.

---

*Source of truth: `client/src/pages/ResultsPage.jsx`, `server/app.js` (`buildResponse`, `buildScanReportData`/`writeCanonicalScanResult`, `/api/scan/:rackId`, `/api/scan/:rackId/result`, `/api/ocr/labels/:rackId`, `/api/feedback/device`, report + share endpoints), `pipeline/detection.py` (`detect_devices_seg`), `pipeline/runner.py`, and `config.json`. Verified 26 July 2026.*
