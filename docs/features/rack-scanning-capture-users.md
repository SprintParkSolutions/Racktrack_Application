# Rack Scanning & Capture

**Feature Reference** · *Point your phone at a rack, and one photo becomes a fully mapped inventory — the first step of everything RackTrack does.*

**Category:** Core feature — the capture workflow, and the front door to the whole app · **Audience:** Field technicians and anyone who runs a scan · **Document date:** 24 July 2026 · Part of the RackTrack documentation set.

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

You stand in front of a server rack and take **one photo** with your phone or tablet. That's the whole ask. A few seconds later RackTrack hands you back that same photo with every device boxed and named, laid out unit by unit, ready to explore.

Capture is the doorway to the entire product. Nothing else — the port views, the topology, the reports, the record-checking — can happen until a rack has been captured, so this screen is built to make that first step easy and hard to get wrong. It gives you three ways in: **take a photo** with the live camera, **upload** a picture you already have, or, for a rack too tall to fit in one shot, take a **short set of overlapping photos** that RackTrack stitches into one tall image. You can also link a support ticket first, so the scan drops you straight onto the exact device and port the ticket is about.

The camera does not sit there passively. While you're framing the shot it watches the picture, coaches you ("move closer", "hold steady"), and only unlocks the shutter once the rack is sharp, well-lit and filling the frame — so the photo you take is one the AI can actually read.

## 2. At a glance

| | |
|---|---|
| **Category** | Core capture workflow — the entry point to every other feature. |
| **Who uses it** | Field technicians standing in front of a rack. No special role needed. |
| **Where input comes from** | The device camera (photo or video), or a file you choose or drag in. |
| **What it outputs** | A completed scan, opened on the Results screen with every device labelled. |
| **Data source** | REAL — every scan runs on genuine media you supply; there is no sample image. |

## 3. How it works — step by step

```
Capture or upload            →  live camera photo, a video clip, or a file
        ↓
Quality gate                 →  is it sharp, well-lit, straight, and actually a rack?
        ↓
Send for analysis            →  the media goes to RackTrack's service
        ↓
The AI reads the rack        →  units → devices → ports → cables → make/model
        ↓
Structured result assembled  →  devices, positions, ports and cabling pieced together
        ↓
Open Results                 →  your photo, annotated, ready to explore
```

**Walkthrough**

1. Open the **Scan** screen from the capture button in the navigation.
2. Choose how to bring in the rack: **Camera** (take a photo now), **Upload** (a single file you already have), or **Multi** (several overlapping photos of a tall rack). You can also pick a video.
3. In camera **Photo** mode, frame the rack. The corner guides turn green and the shutter unlocks only once the image is sharp, the rack fills the frame, and the lighting is good — the on-screen hint tells you what to fix until then.
4. Optionally, link a support incident so the scan targets a specific device and port.
5. Press the main button — **Analyze Rack**, or **Stitch & Analyze** for a tall multi-shot rack.
6. Watch the analysing overlay step through preprocessing, boundary detection, component identification and port/cable mapping.
7. Land on the **Results** screen with the rack annotated and every deeper view a tap away.

## 4. Where the input comes from

- **Live camera photo** — a full-resolution still captured from the rear camera, cropped to exactly what you framed on screen (so the saved photo is not "wider than what you saw").
- **Live camera video** — a short clip you record in the camera view; RackTrack picks the single best frame from it and analyses that.
- **A single upload** — one image (JPG, PNG, or an iPhone HEIC) or a video (MP4, MOV, WEBM), chosen or dragged onto the drop area.
- **Several photos of a tall rack** — 2 to 8 overlapping shots, top to bottom, for a rack that won't fit in one frame.
- **An optional incident link** — an active support ticket, which puts the scan into "ticket mode" and points it at the device and port that needs attention.

## 5. What it produces (output)

- **A completed scan** — opened straight onto the Results "Overview" screen.
- **Detected devices** — each with a type, a rack-unit position, a size, and a box drawn on your photo.
- **A port layout** — how many ports each device has, and of what type.
- **Cabling** — an inferred wiring layout that feeds the topology views.
- **A make/model reading** — the vendor, model and firmware where the faceplate label is legible.
- **A timing badge** — a "Done in *[time]*" mark showing how long detection took.

## 6. What you see on screen

- **Capture tabs** — Upload and Camera, with Single / Multi / Video modes underneath the upload option.
- **Upload drop area** — a viewfinder-style zone listing the accepted formats, which highlights when you drag a file over it.
- **Live viewfinder** — the camera feed with corner framing guides and a Photo/Video toggle.
- **Coaching line** — a live hint that reads "Move closer so the rack fills the frame", "Hold steady — keep still for focus", or "Looks great — tap the shutter below".
- **Live labels** — as the camera streams, boxes and names are drawn over devices it recognises in real time, so you can see it's working before you even shoot.
- **Multi-photo list** — thumbnails of your tall-rack shots with up / down / remove controls and an "N/8" counter.
- **Analysing overlay** — a small animated 3D rack with a progress bar and status text that steps through the stages.
- **Warnings** — a camera-permission message if access is blocked, a quality prompt offering **Retake** or **Proceed anyway**, and, in ticket mode, a "wrong rack" notice if the photo doesn't match the rack on the ticket.

## 7. The logic behind it

- **Guard the quality up front.** The shutter stays locked until sharpness, framing and lighting all pass, so the picture that reaches the AI is inside the range it was trained on. A blurry or side-on shot is caught before it wastes your time.
- **Reject non-racks early.** A quick first look rejects a photo that isn't a rack at all — a person, a desk, a wall — before the full analysis runs, so you're not left watching a spinner return nothing.
- **Stitch tall racks instead of cropping them.** Overlapping photos can be added in any order; RackTrack works out the top-to-bottom order itself by finding where the images overlap, and merges them into one tall image before analysing.
- **Turn a video into one clean frame.** A video is scanned for its sharpest, most device-rich frame, and that single frame is analysed like a photo — so a shaky clip still yields a solid result.
- **Ticket mode targets the work.** Linking an incident points the scan at the exact device and port in question, and can first check you're photographing the right rack before it scores anything.
- **No demo media.** There is no canned sample image anywhere on this screen. Every path needs a real photo or video, because the whole point is to document *your* rack.

## 8. Detailed technical explanation

**Capturing the photo.** In camera mode the app shows a live feed from your rear camera. A photo is a still grabbed from that feed at full resolution, cropped to precisely the region you framed on screen. While you frame, the app quietly measures the picture several times a second — how sharp it is, how much of the frame the rack fills, and whether the lighting is neither too dark nor blown out — and only lets you press the shutter once all three are good. Alongside that, it sends small snapshots to the AI a couple of times a second purely to draw the live device labels you see floating over the viewfinder; those labels are a preview and are not the final result.

**Checking the media.** Once you commit a photo (or upload one), it goes through a quality gate before any real analysis. The gate looks for large black bands (a screenshot or a badly rotated image), for tilt (a photo taken on a slant), for a side-on angle where the rack's shelves visibly converge, and for heavy cable clutter blocking the equipment. A clearly bad photo is rejected with a specific reason and a **Retake** button; a borderline one raises a soft warning you can wave past with **Proceed anyway**. A separate quick check confirms the image actually contains rack equipment.

**Reading the rack.** The media is sent to RackTrack's service, which runs it through a chain of trained vision models, in order: one finds the rack's unit grid, one places each device at its unit and works out its size and type, one derives the ports and their types, one reads the cables (presence and colour), and a text reader lifts the make, model and firmware from the faceplates. If a first pass with the usual settings finds nothing, a more lenient second pass is tried, trading a little precision for the chance to catch a hard frame. Several scans can be worked on at once, and a finished result is remembered — so if you (or a colleague) send the exact same photo again, it comes straight back without re-analysing.

**Tall racks and videos.** For a tall rack, your overlapping photos are first merged into one long image — the service detects how much each pair overlaps, trims the duplication, and lines them up even if your hand drifted sideways between shots. For a video, the clip is scanned and its single best frame is picked out, then treated exactly like a photographed still. Either way, from that point on the rest of the analysis is identical to a normal single-photo scan.

**Getting to the result.** When analysis finishes, the app opens the Results screen for that rack. Because a rack's identity is derived from the photo itself, an accidental double-send simply lands back on the same result instead of creating a duplicate — which is also why, if your connection drops mid-upload, the app can safely retry once.

## 9. Real data vs. synthetic

| Thing on screen | Real or synthetic |
|---|---|
| The photo or video you capture | **REAL** — from your device camera or your own files. |
| The live labels on the viewfinder | **REAL** — genuine frames analysed on the fly as a preview. |
| Detected devices, ports and cabling | **REAL** — read from your image by the vision models. |
| Make / model / firmware | **REAL** — read from the faceplate where the label is legible. |
| A demo or sample image | **NONE** — no canned media exists anywhere on this screen. |

## 10. Use cases

- **Documenting a new rack.** A technician finishes an install and captures the rack once; RackTrack builds the full inventory in seconds and can offer to register it against your records.
- **Working a support ticket.** Link the incident, scan, and land straight on the device and port the ticket is about — with a check that you're at the right rack first.
- **Surveying a tall rack.** Take a few overlapping shots top-to-bottom; RackTrack stitches them into one image so a rack taller than a single frame is captured accurately.
- **Salvaging an imperfect shot.** A borderline photo doesn't dead-end — you're told exactly what's wrong and can retake, or proceed anyway and accept whatever the AI can find.

---

— Rack Scanning & Capture —
