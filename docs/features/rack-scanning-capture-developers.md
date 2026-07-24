# Rack Scanning & Capture

**Feature Reference** · *Capture-to-result for a single rack: camera/upload → quality gate → worker-pool detection → annotated Results.*

**Category:** Core feature — the capture workflow and entry point to the app · **Audience:** The team (assumes you know the product) · **Document date:** 24 July 2026 · Part of the RackTrack documentation set.

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

The Scan screen captures one rack — from the live camera or a file — runs it through a quality gate, hands it to the Python vision pipeline via a persistent worker pool, and navigates to the Results page keyed on a content-addressed rack id. Everything downstream (Ports, Topology, Network, Drift, report, CMDB reconciliation) reads the artifacts this flow produces.

There is one hot path (`POST /api/analyze` on a single JPEG) and three variants that funnel into it: live-preview detection (`POST /api/detect`), tall-rack stitching (`POST /api/stitch`), and ticket-mode analyze (`POST /api/analyze-for-ticket`). Videos in the main Scan flow are reduced to a single best frame and analysed as a photo; multi-rack grouping is a separate flow (see the Multi-Rack Scans doc).

## 2. At a glance

| | |
|---|---|
| **Category** | Core capture workflow — the entry point to every other feature. |
| **Who uses it** | Field technicians on site; any signed-in user. |
| **Where input comes from** | `getUserMedia` still / file upload / video, posted as multipart form-data. |
| **What it outputs** | A rack folder (`outputs/<rackId>/`) and a navigate to `/results/<rackId>`. |
| **Data source** | REAL — genuine media only; no fixture/sample image exists in this path. |

## 3. How it works — step by step

```
Capture / upload             →  ScanPage.jsx: getUserMedia still or <input type=file>
        ↓
Client pre-check             →  validateMedia() (utils/validateMedia)
        ↓
POST /api/analyze            →  multer upload.single('image')  (server/app.js)
        ↓
normalizeImage()             →  sharp EXIF-rotate → mozjpeg; video → extract_best_frame
        ↓
computeRackId()              →  RK- + SHA-256(scope + '\0' + bytes)[:8]
        ↓
Quality gate + presence      →  quality_check + detect_only (0 devices → not_a_rack)
        ↓
runPipelineAnalyze()         →  worker pool: pipeline.worker → device/port/PDU/OCR
        ↓
writeCanonicalScanResult()   →  scan_result.json (schema scan_result.v1)
        ↓
navigate('/results/:rackId') →  ResultsPage renders the annotated overview
```

**Walkthrough**

1. `client/src/pages/ScanPage.jsx` captures a still (hidden `<canvas>`, `toBlob('image/jpeg', 0.92)`) or takes an uploaded file/video.
2. `analyze()` runs a client-side `validateMedia()` pre-check, then builds a `FormData` with field `image` and posts to `/api/analyze` via `authFetch`.
3. The server normalises the image, computes the rack id, and returns the cached result if `outputs/<rackId>/device_unit_map.json` already exists.
4. On a cache miss it runs the quality gate, a rack-presence check, then the full pipeline in the worker pool.
5. The handler writes the rack folder and responds; `ScanPage` prefetches per-rack data and `navigate`s to `/results/<rackId>`.
6. A single network-level retry is safe because the rack id is a content hash — a retry that actually landed the first time hits the cache.

## 4. Where the input comes from

- **Live camera still** — `navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: 1920, height: 1080 } })`; captured through a hidden canvas cropped to the `object-fit: cover` region so the saved JPEG matches the framed view.
- **File upload** — `<input type="file" accept="image/*,image/heic,image/heif,.heic,.heif,video/*">`; the Multi zone accepts up to 8 images.
- **Video** — recorded via `MediaRecorder` (mp4/webm) or uploaded (MP4/MOV/WEBM); reduced to a best frame server-side.
- **Endpoints consumed:** `/api/analyze` (single image/best-frame), `/api/detect` (live preview), `/api/stitch` (tall rack), `/api/analyze-for-ticket` (ticket mode). Incident list from `/api/incidents/active`; rack-identity verify from `/api/incidents/:num/verify-rack`.
- **Rate limits** — both `scanLimit` and `detectLimit` come from `uploadLimiter()` (`server/lib/rate_limit.js`).

## 5. What it produces (output)

- **`outputs/<rackId>/device_unit_map.json`** — master detection map (devices, classes, confidences, boxes, units, ports, PDU power).
- **`outputs/<rackId>/scan_result.json`** — canonical merged record (`schema: scan_result.v1`, `SCAN_RESULT_SCHEMA` in `app.js`).
- **`outputs/<rackId>/scan_meta.json`** — `rackId`, `userId`, `tenantId`, `imageHash`, `imagePath`, `timestamp`, and the `quality` block (metrics + `qualityWarning` / `qualityWarningMsg`).
- **`outputs/<rackId>/ocr_devices.json`** — per-device make/model/firmware from OCR.
- **`outputs/<rackId>/original_image.jpg`** + rendered stage PNGs under `images/`.
- **Response body** — `buildResponse(rackId, cached)` plus `timings`; `/api/stitch` adds a `stitch` block (seams, uncertain, auto_order).

## 6. What you see on screen

- **Capture tabs / modes** — Upload vs Camera; Single / Multi / Video sub-modes (`ScanPage` `tab` state).
- **Live viewfinder** — `<video>` feed with corner-bracket framing guides that turn green when `quality.sharp && quality.framed && quality.lit` all pass; the shutter is `disabled` until then (photo mode).
- **Live detection overlay** — 2D HTML labels tracked frame-to-frame by IoU, smoothed with an EMA, NMS-deduplicated; only tracks with ≥2 hits render.
- **Coaching hint** — derived from the live quality booleans ("Move closer…", "Hold steady…", "Looks great…").
- **Analysing overlay** — `AnalyzingOverlay` with a lazy-loaded `MiniRack3D` and a stepped progress ticker.
- **Quality choice / reject modals** — `qualityChoice` (Retake / Proceed anyway) and `VerifyRejectModal` (ticket-mode wrong-rack diff).

## 7. The logic behind it

- **Client and server both gate quality.** The client's live loop unlocks the shutter; the server re-checks with the real pipeline so an uploaded (un-gated) image is still validated. `skipQualityCheck=1` (the "Proceed anyway" override) is honoured server-side.
- **Reject non-racks before the expensive pass.** After the tilt/occlusion gate, a `detect_only` pass rejects images with zero devices as `kind: 'not_a_rack'` (~1s) rather than running the full pipeline.
- **Content-addressed identity = free idempotency + caching.** `computeRackId` scopes the hash to the org/tenant, so a duplicate upload is a cache hit and a dropped-then-retried upload can't create a second scan.
- **Corrections and confirmed racks short-circuit.** A re-shot photo of a user-confirmed rack can be served from the confirmed alias without re-detection; active-learning corrections are auto-applied on both cache hit and miss before the canonical result is written.
- **Models stay resident.** The worker pool keeps YOLO/OCR checkpoints warm across requests; a per-request wall-clock cap recycles a hung worker.

## 8. Detailed technical explanation

**Capture & send.** `client/src/pages/ScanPage.jsx` captures from `getUserMedia` (still grabbed via a hidden `<canvas>`, `toBlob('image/jpeg', 0.92)`) or a file/video upload. The photo-mode quality loop runs every ~350 ms on a 192px-wide downscale, computing Laplacian-variance sharpness (`> 60`), edge density (`> 0.035`), and mean luma (`35–235`); the shutter enables only when all three pass. A separate live loop posts a 320px JPEG to `POST /api/detect` every ~400 ms and tracks detections client-side (IoU match `TRACK_IOU_MIN=0.2`, `MIN_CONF=0.45`, `MIN_HITS_TO_SHOW=2`, `TRACK_TTL_FRAMES=1`, EMA `α=0.6`, `NMS_IOU=0.25`). `analyze()` posts `FormData` field `image` to `POST /api/analyze` and, on success, `navigate`s to `/results/<rackId>`; one retry is issued on a network-level failure.

**Server entry & normalisation.** `POST /api/analyze` (`server/app.js:2557`, `scanLimit` + `multer upload.single('image')`) blocks users in a pending org, then calls `normalizeImage()` (`app.js:662`): `sharp().rotate().jpeg({ quality: 92, mozjpeg: true })` → `_norm.jpg`. A video input is instead handed to the worker `extract_best_frame` command (`pipeline/frame_selector.py`, a tall-vertical-contour heuristic that also re-runs `check_letterbox`/`check_tilt`) → `_frame.jpg`. `computeRackId(path, rackScope(auth))` (`app.js:712`) = `RK-` + first 8 hex of `SHA-256(scope + '\0' + bytes)`, `scope ∈ org:<id> | tenant:<id> | global`. `tenant.claimRack` records the tenant's ownership claim (`server/lib/tenant.js`).

**Quality gate.** On a cache miss the server runs `runQualityCheck` → worker `quality_check` → `handle_quality_check` in `pipeline/worker.py`, which chains `check_letterbox`, `check_tilt` (`TILT_TOLERANCE_DEG=6.0`, perspective/skew `5.0`), `check_side_view` (soft warning), and occlusion. Occlusion is a trained **MobileNetV2** classifier `Models/rack_classifier.pth` (`classify_occlusion`), falling back to the edge-orientation + saturation heuristic `check_occlusion` (`pipeline/quality_check.py`) when torch/weights are absent. Hard fails return `ok:false` with a `kind` (`framing`/`angle`/`occlusion`) and `retryable:true`; metrics land in `scan_meta.json` under `quality`. A follow-up `detect_only` pass rejects zero-device images as `not_a_rack`.

**Detection pipeline.** `runPipelineAnalyze()` dispatches through the persistent worker pool (`server/worker-pool.js`, `class WorkerPool`), spawned as `python3 -u -m pipeline.worker` with `RACKTRACK_WORKERS` workers (default 1), newline-delimited JSON over stdin/stdout, models resident, default per-request timeout 120000 ms (`RACKTRACK_WORKER_TIMEOUT_MS`) with crash-loop backoff. Models (from `config.json`): device/unit segmentation `Models/devices_seg.pt` (`devices_conf` 0.20), typed ports `Models/ports_9.pt`, port status/occupancy `Models/port_count.pt`, PDU outlets `Models/pdu_ports_v1_det_best.pt`, cable-colour `Models/cable_eff_best`; make/model OCR runs just after and writes `ocr_devices.json`. Frameworks (`requirements.txt`): PyTorch `>=2.1.0`, Ultralytics YOLO `>=8.3.43`, EasyOCR `>=1.7.1`. Test seams: `RACKTRACK_POOL_MODULE`, `RACKTRACK_SKIP_WORKER_POOL=1`.

**Post-pipeline gating & canonical write.** From `device_unit_map.json` the handler re-gates on `deviceCount === 0` (front-of-rack retry) and `unitCount < 3` (move-back retry) unless `skipQualityCheck`. It then runs active-learning auto-apply (`runActiveLearningCli` `apply_to_scan`), calls `writeCanonicalScanResult(rackId)` (`app.js:1728`) to build `scan_result.json` (`SCAN_RESULT_SCHEMA = 'scan_result.v1'`), `scheduleCanonicalRefresh`, and responds with `buildResponse(rackId, false)` + `timings`.

**Tall-rack stitch.** `POST /api/stitch` (`app.js:2906`, `upload.array('images', 8)`) normalises each input, then `runStitcher()` spawns `python … pipeline/rack_stitch.py --inputs … --output …` (a subprocess, not the worker pool). `stitch_images()` infers top-to-bottom order via `auto_arrange_images()` (brute-force permutations for N≤7, greedy above) and edge-based `find_overlap()` seam detection; uncertain seams are butted flush and surfaced in `uncertain`. The stitched JPEG then re-enters the same `/api/analyze` flow (rack id, quality gate, pipeline). Live preview: `POST /api/detect` (`app.js:2497`) → worker `detect_only` at reduced imgsz, returning `{ devices, image_size }` only (no rack folder, no OCR).

## 9. Real data vs. synthetic

| Thing on screen | Real or synthetic |
|---|---|
| Captured still / video | **REAL** — from `getUserMedia` or the user's files. |
| Live viewfinder labels | **REAL** — genuine `/api/detect` frames, tracked client-side. |
| Devices, ports, PDU power | **REAL** — from `devices_seg.pt` / `ports_9.pt` / `port_count.pt` / `pdu_ports_v1_det_best.pt`. |
| Cable colour / type | **REAL** — `Models/cable_eff_best`, with confidence. |
| Make / model / firmware | **REAL** — OCR (`ocr_devices.json`), where legible. |
| Demo / sample media | **NONE** — no fixture image exists on this path. |

## 10. Use cases

- **Documenting a new rack.** One `POST /api/analyze` produces the full `device_unit_map.json` + `scan_result.json` the CMDB registration and every tab read from.
- **Working a ticket.** `/api/analyze-for-ticket` runs analyze + auto-targets the incident's device/port + LLDP in one call, gated by the rack-identity verify (`/api/incidents/:num/verify-rack`, 409 on mismatch).
- **Tall rack.** `/api/stitch` merges 2–8 overlapping shots into one panorama before the standard pipeline runs.
- **Resilience on flaky mobile links.** Content-addressed rack ids make the client's single upload retry idempotent, and let a re-shot confirmed rack short-circuit to the cached result.

---

— Rack Scanning & Capture —
