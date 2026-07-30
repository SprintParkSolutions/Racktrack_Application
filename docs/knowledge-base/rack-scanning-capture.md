# Rack Scanning & Capture

*Point your phone at a rack and one photo becomes a fully mapped inventory — this is the front door to everything RackTrack does.*

Core feature · Field technicians · Last verified: 26 July 2026 against the live code.

---

## 1. In simple terms

Rack Scanning & Capture is the screen where a rack becomes data. You stand in front of a server rack, you point your phone at it, and you either take a photo, upload one you already have, or shoot a short video. A few seconds later RackTrack hands the same picture back to you with every device found, boxed and named, laid out unit by unit, and ready to explore. Nothing else in the product — the port views, the topology, the network checks, the reports, the CMDB record‑matching — can happen until a rack has been captured here, so this one screen is deliberately built to make that first step easy and hard to get wrong.

There are two ways to bring a rack in, and three "modes" underneath one of them. The two top buttons are **Upload** and **Camera**. If you stay on Upload you get three sub‑modes: **SINGLE** (one photo or one file), **MULTI** (several overlapping photos of a rack too tall to fit in a single frame, which RackTrack stitches into one long image), and **VIDEO** (a clip, from which RackTrack pulls the single clearest frame and treats it like a photo). If you switch to Camera you get a live viewfinder that can take a still photo or record a video on the spot. Whatever path you pick, it all funnels into the same analysis and lands you on the same Results screen.

The camera is not a passive window. While you are framing the shot it is quietly grading the picture several times a second — is it sharp, is the rack filling the frame, is the lighting neither too dark nor blown out — and it keeps the shutter locked until all three are good, telling you in plain words what to fix ("Move closer so the rack fills the frame", "Hold steady — keep still for focus"). At the same time it sends tiny snapshots to the AI a couple of times a second purely to draw live labels over the devices it recognises, so you can see it working before you even press the button. That said, this on‑device grade is only the first gate: the real decision is made by the server after you commit the photo.

You can also link a support ticket before you scan. When you pick an active incident from the list, the scan goes into "ticket mode": it points itself straight at the exact device and port the ticket is about, and — if RackTrack knows which physical rack that incident belongs to — it first checks that the rack in your photo is actually the right one, and stops you with a "wrong rack" notice if it isn't. If you don't link a ticket, you just do a plain manual scan and choose the device and port yourself afterwards.

## 2. At a glance

| | |
|---|---|
| **Category** | Core capture workflow — the single entry point to every other RackTrack feature. |
| **Who uses it** | Field technicians standing in front of a rack; any signed‑in user. No special role is needed. |
| **Where in the app** | The **Scan** screen (`client/src/pages/ScanPage.jsx`), reached from the capture button in the navigation. |
| **Input** | A live camera still or video, an uploaded image (JPG, PNG, HEIC) or video (MP4, MOV, WEBM), or 2–8 overlapping photos for a tall rack — plus an optional incident link. |
| **Output** | A finished scan opened on `/results/<rackId>`, with every device labelled, positioned, port‑mapped and (where legible) read for make/model. |
| **Real vs. synthetic** | **REAL** — every path runs on genuine media you supply. There is no demo or sample image anywhere on this screen. |

## 3. How it works — step by step

```
Capture or upload           →  camera still / camera video / a file / 2–8 tall-rack photos
        ↓
Client media pre-check      →  validateMedia() — light sanity check; fails OPEN on decode trouble
        ↓
POST to the server          →  /api/analyze (photo or video best-frame)
                               /api/stitch  (tall-rack MULTI)
                               /api/analyze-for-ticket (ticket mode)
        ↓
Normalise + rack id         →  EXIF-rotate → mozjpeg JPEG; RK- id = hash(org-scope + bytes)
        ↓
Cache check                 →  same photo already scanned? → return the stored result instantly
        ↓
Quality gate + presence     →  tilt / framing / occlusion, then a "is this even a rack?" pass
        ↓
Vision pipeline             →  units → devices → ports → cables → make/model OCR
        ↓
Open Results                →  navigate('/results/<rackId>') with the annotated overview
```

**Walkthrough**

1. Open the **Scan** screen from the capture button.
2. Choose **Upload** or **Camera**. Under Upload, pick a mode: **SINGLE**, **MULTI** (tall rack), or **VIDEO**. Tapping **Upload** while you are already on an upload mode re‑opens the file picker; it does not reset the form.
3. If you are on Camera **Photo**, frame the rack. The corner brackets turn green and the shutter unlocks only once the picture is sharp, the rack fills the frame, and the lighting is good — the coaching line tells you what to fix until then. In Camera **Video** the shutter is enabled as soon as the camera is ready.
4. Optionally open the **Incident link** picker and choose a ticket to target a specific device and port. Leave it on "Manual scan" to choose those yourself later.
5. Press the main button — **Analyze Rack** for a single photo or video, or **Stitch & Analyze (N)** for a tall multi‑shot rack.
6. Watch the analysing overlay — a small animated 3D rack and a progress bar — step through preprocessing, boundary detection, component identification and port/cable mapping.
7. Land on the **Results** screen for that rack, with every deeper tab a tap away.

## 4. What you see on screen

**The two capture tabs — Upload and Camera.** Two buttons at the top. Upload is the default. The one that is "on" is highlighted. Tapping **Upload** when you are already on an upload mode opens the file picker (it is an action, not just a switch); tapping **Camera** opens the live viewfinder and remembers which upload mode you came from, so a photo you take can be routed back to it.

**The three upload modes — SINGLE, MULTI, VIDEO.** These appear as a row of pill buttons underneath the tabs, but only while you are not in the camera. SINGLE is a normal one‑file scan. MULTI is the tall‑rack flow. VIDEO accepts a clip. Switching mode clears any file you had picked.

**The upload drop zone.** A viewfinder‑style box with corner brackets and a centred focus icon. It reads "Drop rack image here — tap to browse · JPG, PNG, HEIC, MP4" (or, in Video mode, "Drop rack video here — tap to browse · MP4, MOV, WEBM"). It highlights when you drag a file over it. Tapping it, or dropping a file on it, selects that file. (On desktop it also shows format pills and a "READY · NO FILE SELECTED" caption; on a phone those are hidden.)

**The preview card.** Once a file is chosen it replaces the drop zone with a thumbnail (a still image, or an inline muted video player for a clip) plus a small "×" button to clear it.

**The multi‑photo list (MULTI mode).** Before any photos are added you see a "Tall rack — multi shot" prompt: "Take 2‑8 overlapping photos of the rack. Any order — we'll arrange them automatically" and a **Select photos** button. After adding, each photo is a row with a thumbnail, its filename, a "Photo N · <size> KB" label, and up / down / remove controls. A header reads "N photos · auto‑arranged" with an "N/8" counter, and an **Add more** button appears while you have fewer than 8. The hard cap is 8; you need at least 2 to submit.

**The live viewfinder (Camera).** A full‑screen camera feed from the rear camera. Over it you get:

- **Corner brackets** — the framing guide. In Photo mode they turn **green** once every quality check passes. While recording a video they turn **red**.
- **The coaching line** (Photo mode), which is exactly one of:
  - "Starting camera…" (before the feed is ready)
  - "Looks great — tap the shutter below" (everything passes)
  - "Move closer so the rack fills the frame" (rack isn't filling enough of the frame)
  - "Move to better lighting" (too dark or too bright)
  - "Hold steady — keep still for focus" (not sharp enough)
  - "Align full rack within the frame" (fallback)
- **The coaching line** (Video mode), one of: "Starting camera…", "Tap shutter to start recording the rack", or "Recording — tap shutter to stop".
- **A Photo / Video toggle** to switch capture type. Photo is disabled while a recording is in progress.
- **The shutter button.** In Photo mode it is disabled until all three quality checks pass; tapping it grabs the still and briefly flashes the screen. In Video mode it starts/stops recording and shows a red dot; a "REC MM:SS" badge counts up at the top while recording.
- **A close ("×") button** to leave the camera.
- **Live detection labels** — small coloured boxes with a device type ("Switch", "Patch Panel", "Server", …) drawn over devices the AI recognises in the live feed. These are a real‑time preview, not the final result.

**The incident picker.** Only shown when there are active tickets. A labelled "Incident link (Optional)" dropdown. Its trigger shows either "Manual scan (tap to link an incident)" or, once chosen, the incident number with its target device:port and priority. The menu lists a "Manual scan · no ticket" opt‑out at the top followed by each incident with its number, target, priority and short description. Picking one shows a one‑line headline of the ticket above the picker.

**The main call‑to‑action.** A full‑width button that reads **Analyze Rack** for a single photo/video, or, in MULTI mode, **Add N more photo** while you have fewer than two, then **Stitch & Analyze (N)**. It is dimmed and disabled until you have a valid selection.

**The analysing overlay.** A dimmed screen with a small animated 3D rack, a title "Analyzing rack…", the current step text, a progress bar and a percentage. The steps cycle through "Preprocessing image…", "Detecting rack boundaries…", "Identifying components…", "Mapping ports and cables…", "Locating incident target…". On success it snaps to 100% and shows "Target located!" (or "Port located!" in ticket mode, "Rack analyzed!" for a stitch). In ticket mode a separate "Verifying rack identity…" overlay can appear first.

**Warnings and prompts.**
- **Camera blocked** — if permission is denied, the camera view shows "Camera access denied. Allow camera permission or use Upload."
- **A plain error banner** — for hard failures (e.g. "Analysis failed. Try again.").
- **The quality choice card** — when the media is borderline: it shows the specific reason and offers **Retake** or **Proceed anyway**. "Proceed anyway" re‑runs the scan telling the server to skip its quality gate.
- **The "Wrong rack" modal** (ticket mode) — when the labels read off your photo don't match the rack on the incident. It shows the labels detected on your image beside the labels expected on the rack, and offers **Dismiss** or **Upload correct rack**.

## 5. The logic behind it

**Grade quality on the phone, but let the server decide.** The live camera loop exists to coach you and to stop you wasting a trip to the server on an obviously bad frame — it keeps the shutter locked until the picture is sharp, framed and lit. But it is only an advisory first pass. The authoritative quality judgement happens server‑side after you commit the photo, which is why an uploaded image (which never went through the live loop at all) is still fully checked. The client's separate pre‑check, `validateMedia()`, is deliberately lenient: if the browser can't even decode the file, it lets the upload through and defers to the server rather than blocking a perfectly good photo.

**Reject non‑racks early.** After the tilt/framing gate, the server runs a quick "is there even a rack here?" detection pass. A photo of a person, a desk or a wall passes the tilt check but contains zero rack devices, so this catches it in about a second and returns a clear "this doesn't look like a server rack" message — instead of leaving you staring at a spinner that returns nothing.

**Identity from content means free de‑duplication.** A rack's id is a hash of the photo's bytes (scoped to your organisation), so scanning the same image twice collapses onto the same rack and returns the stored result instantly. That is also what makes a dropped‑then‑retried upload safe: a retry that actually reached the server the first time just hits the cache instead of creating a duplicate scan.

**Stitch tall racks instead of cropping them.** For a rack too tall for one frame, you add 2–8 overlapping photos in any order. The server figures out the top‑to‑bottom order itself by detecting where the images overlap, trims the duplication, and merges them into one long image before analysing. Where an overlap can't be found confidently, the images are butted flush and that seam is flagged as "uncertain".

**Turn a video into one clean frame.** A video in the main Scan flow isn't analysed frame‑by‑frame; the server scores the frames and pulls out the single sharpest, most device‑rich one, then analyses that exactly like a photo. A shaky clip still yields a solid result.

**Ticket mode targets the work — and guards against the wrong rack.** Linking an incident points the scan at the exact device and port in question and can first verify you're photographing the right physical rack, refusing to proceed on a mismatch. Waving that check is possible (once you've confirmed), but by default it protects you from documenting the wrong rack against a ticket.

## 6. Under the hood

**Client capture and send (`client/src/pages/ScanPage.jsx`).** A camera still is grabbed from the live `getUserMedia` feed through a hidden `<canvas>`, cropped to exactly the `object-fit: cover` region you framed so the saved JPEG matches what you saw, and encoded with `toBlob('image/jpeg', 0.92)`. The photo‑mode quality loop runs about every 350 ms on a 192‑px‑wide downscale and sets three booleans: `sharp` (Laplacian variance > 60), `framed` (edge density > 0.035) and `lit` (mean luma between 35 and 235); the shutter enables only when all three are true. A separate live loop posts a 320‑px JPEG to `POST /api/detect` about every 400 ms and tracks the returned detections entirely on the client — matching frame‑to‑frame by IoU (`TRACK_IOU_MIN = 0.2`), dropping anything under `MIN_CONF = 0.45`, requiring two consecutive hits before a label renders (`MIN_HITS_TO_SHOW = 2`), expiring a track after a single missed cycle (`TRACK_TTL_FRAMES = 1`), smoothing boxes with an EMA (`α = 0.6`) and de‑duplicating overlaps with NMS (`NMS_IOU = 0.25`). These live labels are a preview only; no scan is written for them.

**Client pre‑check (`client/src/utils/validateMedia.js`).** Before uploading, `validateMedia()` runs a light check. HEIC/HEIF is skipped entirely and deferred to the server (browsers can't decode it in JS). For an image it checks the shorter side is ≥ 480 px and Laplacian‑variance sharpness ≥ 100. For a video it sanity‑checks dimensions and a 1–120 s duration. Crucially it **fails open**: if the browser can't decode the image or video at all, it returns `ok: true` with a `skipped` note and lets the server be the judge — because failing closed here was rejecting good full‑resolution phone photos. A `retryable` failure surfaces the Retake / Proceed‑anyway card; a non‑retryable one is a plain error.

**Which endpoint gets called.** The single‑photo and single‑video flows post a `FormData` field named `image` to `POST /api/analyze` (the client hard‑codes `useMultiRack = false`, so a Scan‑page video goes through `/api/analyze`, whose normaliser extracts the best frame — it does **not** call the multi‑rack video endpoint). MULTI posts an `images` array to `POST /api/stitch`. When an incident with a device and port is selected, the flow instead posts to `POST /api/analyze-for-ticket` (after first calling `POST /api/incidents/:num/verify-rack` unless it's a video). Every request goes through `authFetch`, carries a random `clientJobId` (so an iOS‑suspended scan can be reclaimed via `GET /api/analyze/result/:jobId`), and is retried once on a raw network drop.

**Authentication — what actually requires it.** This is where the current code differs from earlier descriptions, so to be exact: `POST /api/analyze` is guarded by `auth.requireAuth` (and additionally returns 403 if your organisation is still awaiting owner approval), and `POST /api/analyze-video` is guarded by `auth.requireAuth` and further requires a tenant (401 otherwise). But `POST /api/stitch`, `POST /api/detect` and `POST /api/analyze-for-ticket` are **not** wrapped in `auth.requireAuth`; they read the caller's token softly via `softAuthPayload()` and fall back to a `global` scope if none is present. In practice the client always sends a token via `authFetch`, so every real scan is attributed — but the hard server‑side gate lives on `/api/analyze` and `/api/analyze-video`, not on stitch or detect.

**Normalisation and the rack id (`server/app.js`).** `normalizeImage()` runs `sharp().rotate().jpeg({ quality: 92, mozjpeg: true })` to produce an upright standard JPEG (`_norm.jpg`); a video input is instead handed to the worker's `extract_best_frame` command, which writes the single best frame (`_frame.jpg`). `computeRackId(path, rackScope(auth))` returns `RK-` + the first 8 hex of `SHA‑256(scope + '\0' + bytes)`, where the scope is `org:<id>`, `tenant:<id>` or `global`. The scope prefix keeps identical photos in different organisations from colliding onto one shared id.

**Cache, confirmed‑rack bypass, quality gate, presence (the `/api/analyze` handler).** If `outputs/<rackId>/device_unit_map.json` already exists, the upload is a cache hit: it discards the duplicate, re‑applies any active‑learning corrections, refreshes the timestamp and returns the stored result. On a miss, a re‑shot photo that perceptually matches an already‑**confirmed** rack can be served from that confirmed result instead of re‑detecting. Otherwise the server runs `runQualityCheck()` (worker `quality_check` — letterbox/tilt/side‑view/occlusion), and if that passes, a `detect_only` presence pass that rejects a zero‑device image as `kind: 'not_a_rack'`. A hard quality failure returns `ok:false` with a `kind` and `retryable:true`. Passing `skipQualityCheck=1` (the "Proceed anyway" override) is honoured and bypasses these gates.

**The vision pipeline (`runPipelineAnalyze`).** On a cache miss the image is dispatched through the persistent Python worker pool (`server/worker-pool.js`, spawned as `python -u -m pipeline.worker` with models kept resident). The models come from `config.json`: device/unit segmentation `Models/devices_seg.pt` (`devices_conf` 0.20), typed ports `Models/ports_9.pt`, port status/occupancy `Models/port_count.pt`, PDU outlets `Models/pdu_ports_v1_det_best.pt`, and cable classifier `Models/cable_eff_best`; make/model OCR runs just after and writes `ocr_devices.json`. `ensurePortCounts(rackId)` re‑runs analysis if any device is missing its `port_count` (scoped to the rack's org so active‑learning corrections re‑apply). Afterwards the handler re‑gates on `deviceCount === 0` ("take the photo from the front of the rack") and `unitCount < 3` ("only N rack units could be made out…") unless the user overrode, auto‑applies active‑learning device‑class corrections, writes the canonical `scan_result.json`, and responds with `buildResponse(rackId, cached)` plus a `timings` block.

**Tall‑rack stitch (`/api/stitch`).** Each input is normalised, then `runStitcher()` spawns `pipeline/rack_stitch.py` as a subprocess (not the worker pool). `stitch_images(auto_order=True)` calls `auto_arrange_images()` to infer the top‑to‑bottom order and `find_overlap()` to place the seams; uncertain seams are butted flush and returned in `uncertain`. The stitched JPEG then re‑enters the same analyze flow (rack id → quality gate → pipeline), and the response carries a `stitch` block (`seams`, `uncertain`, `auto_order`, `input_order`) so the client can warn on an uncertain seam.

**Landing on Results.** On success the client prefetches the per‑rack data and `navigate`s to `/results/<rackId>`, passing the response as router state (and, in ticket mode, the ticket) so the overview renders immediately. Because the rack id is content‑addressed, the single automatic retry on a dropped upload is idempotent.

## 7. Edge cases & limits

- **Blurry photo.** The live camera keeps the shutter locked until sharpness passes, so a hand‑held blur usually never gets taken. An uploaded blurry file is caught client‑side (Laplacian variance < 100) with a retryable "looks blurry" warning, and again server‑side by the quality gate. Either way you get **Retake** or **Proceed anyway**.
- **Low‑resolution or oversized image.** If the shorter side is under 480 px the client warns it's low‑res (retryable). A very large full‑resolution phone photo that the browser can't decode in memory is **not** blocked — `validateMedia` fails open and the server, which normalises and re‑encodes every upload, handles it.
- **HEIC / HEIF (iPhone default).** Skipped by the client entirely and normalised to JPEG on the server by `sharp`. The Upload zone explicitly accepts `.heic`/`.heif`.
- **Not a rack.** A person, a desk, a wall — anything with zero detected devices — is rejected before the expensive pipeline by the `detect_only` presence pass, with "This doesn't look like a server rack…".
- **Front‑of‑rack / too few units.** Even after detection, a photo with zero devices, or with fewer than three rack units visible, is returned as a retryable prompt ("take the photo from the front of the rack" / "only N rack units could be made out…") unless you chose "Proceed anyway".
- **Browser decode failure (image or video).** Both defer to the server rather than failing — the server's OpenCV/`sharp` path reads many files the browser's `<img>`/`<video>` element rejects.
- **Tall racks → stitch.** A rack too tall for one frame goes to MULTI: 2–8 overlapping photos, any order, merged server‑side. An uncertain seam doesn't fail the scan; it produces a usable panorama and a (non‑blocking) console warning.
- **Video.** Accepted as MP4/MOV/WEBM up to ~120 s; reduced to one best frame in the main flow. WEBM recorded in‑browser often reports an `Infinity` duration — the client tolerates that and defers to the server. Recording needs `MediaRecorder`; where it's unsupported you're told to use Upload.
- **Flaky mobile connection.** One automatic retry after a 1.2 s pause on a raw network drop; content‑addressed ids make it safe. If iOS suspends the app mid‑analysis, the scan is remembered by `clientJobId` and can be reclaimed on resume.
- **Ticket‑mode wrong rack.** If the OCR'd labels don't match the incident's rack, the server returns HTTP 409 `rack_mismatch` and the client shows the "Wrong rack" modal with a detected‑vs‑expected diff. A "no labels detected" result passes through so you can still proceed.
- **Organisation pending approval.** `/api/analyze` returns 403 until an owner approves your organisation.

## 8. Real data vs. synthetic

| Thing on screen | Real or synthetic |
|---|---|
| The photo or video you capture | **REAL** — from your device camera or your own files. |
| The live viewfinder labels | **REAL** — genuine `/api/detect` frames analysed on the fly as a preview. |
| Detected devices, units, ports, PDU power | **REAL** — read from your image by `devices_seg.pt` / `ports_9.pt` / `port_count.pt` / `pdu_ports_v1_det_best.pt`. |
| Cable colour / type | **REAL** — from `Models/cable_eff_best`. |
| Make / model / firmware | **REAL** — OCR from the faceplate (`ocr_devices.json`), where legible. |
| A demo or sample image | **NONE** — no canned media exists anywhere on this screen; every path needs your real rack. |

## 9. Use cases

- **Documenting a new rack.** A technician finishes an install and captures the rack once; a single `POST /api/analyze` produces the full `device_unit_map.json` + `scan_result.json` that CMDB registration and every other tab read from.
- **Working a support ticket.** Link the incident, scan, and land straight on the device and port the ticket is about — with a rack‑identity check first so you can't document the wrong rack.
- **Surveying a tall rack.** Take a few overlapping shots top‑to‑bottom in any order; `/api/stitch` merges them into one panorama before the standard pipeline runs.
- **Salvaging an imperfect shot.** A borderline photo doesn't dead‑end — you're told exactly what's wrong and can retake, or "Proceed anyway" and accept whatever the AI can find.
- **Scanning on a weak signal.** Content‑addressed rack ids make the automatic upload retry idempotent, and a suspended‑app scan can be reclaimed on resume.

## 10. Common questions

**Q: Why won't the shutter let me take the photo?**
In Camera Photo mode the shutter stays locked until three things pass: the picture is sharp, the rack fills the frame, and the lighting is neither too dark nor too bright. The coaching line tells you which one to fix ("Move closer…", "Hold steady…", "Move to better lighting"). Once all three pass the corner brackets turn green and the shutter unlocks. In Video mode the shutter works as soon as the camera is ready.

**Q: My photo is fine but it said "please upload a clearer photo" / "take it from the front" — why?**
Those come from the server's checks after upload. "Take the photo from the front of the rack" means the pipeline found no devices face‑on; "only N rack units could be made out" means fewer than three units were visible. Both are retryable — move so the whole rack front is in frame, or hit **Proceed anyway** to accept what was found. A true "couldn't read the image" only appears for a genuinely unreadable file.

**Q: Can I scan a photo from my gallery instead of taking a new one?**
Yes. Use the **Upload** tab (SINGLE mode) and pick or drag in a file. Uploads skip the live camera coaching but go through the exact same server‑side quality gate and pipeline.

**Q: It's an iPhone HEIC photo — will that work?**
Yes. The app deliberately doesn't try to decode HEIC in the browser; it uploads it and the server converts it to JPEG before analysing. The Upload zone accepts `.heic`/`.heif` explicitly.

**Q: My rack is too tall to fit in one shot. What do I do?**
Use **MULTI** mode. Add 2 to 8 overlapping photos (top to bottom, but the order doesn't have to be right — the server works it out from the overlaps), then tap **Stitch & Analyze**. RackTrack merges them into one long image and analyses that.

**Q: Do I have to add the tall‑rack photos in the correct order?**
No. The header even says "auto‑arranged". The stitcher infers top‑to‑bottom order by detecting where images overlap. The up / down / remove controls are there if you want to override, but "drop them in and hit Analyze" is the intended flow.

**Q: What happens with a video — does it analyse the whole clip?**
No. In the main Scan flow the server scores the frames and picks the single sharpest, most device‑rich one, then analyses that one frame like a photo. So a short, slightly shaky pan still gives a clean result.

**Q: The live boxes on the camera look a bit jumpy or briefly wrong. Is that the result?**
No — those live labels are a real‑time preview only, drawn from lightweight detection frames and smoothed on the device. A label only appears after two consecutive detections and disappears quickly when the device leaves view. The authoritative result comes from the full analysis after you press the shutter.

**Q: I scanned the same rack twice — did I create a duplicate?**
No. A rack's id is a hash of the image content (scoped to your organisation), so re‑scanning the exact same photo returns the stored result instantly instead of creating a second scan. Its "recent" timestamp is refreshed so it still shows as just‑scanned.

**Q: My upload failed / the connection dropped mid‑scan. Do I lose the work?**
The app retries once automatically after a brief pause, and because the rack id is content‑based, a retry that actually landed the first time just returns the same scan. If your phone suspended the app mid‑analysis, the scan is remembered and can be picked back up when you return.

**Q: What is "ticket mode" and the "Wrong rack" pop‑up?**
If you link an active incident before scanning, the scan targets that incident's specific device and port. When RackTrack knows which physical rack the incident belongs to, it compares the labels read off your photo against the expected rack; if they don't match it stops you with a "Wrong rack" modal showing detected vs. expected labels, so you don't attach the wrong rack to the ticket.

**Q: Do I need to be signed in to scan?**
For a normal photo scan, yes — `/api/analyze` requires authentication (and your organisation must be approved). The client always sends your credentials automatically, so in day‑to‑day use you won't notice; you just need to be logged in.

---

*Rack Scanning & Capture — verified against `ScanPage.jsx`, `validateMedia.js`, and the `/api/analyze`, `/api/stitch`, `/api/analyze-video` and `/api/detect` handlers in `server/app.js`.*
