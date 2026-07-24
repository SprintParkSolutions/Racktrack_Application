# Multi-Rack Scans

**Feature Reference** · *One walkaround video, or a photo of each rack, becomes a whole row you can tab through and view together in 3D.*

**Category:** Core feature — multi-rack grouping · **Audience:** Technicians surveying several racks at once · **Document date:** 24 July 2026 · Part of the RackTrack documentation set.

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

A single scan documents one rack. But you're rarely in front of just one — you're standing in an aisle with a whole row of them. Multi-Rack Scans lets you capture that row in one go.

You have two ways in. **Pan a video** slowly across the racks, and RackTrack splits the clip into one best shot per rack, analyses each one, and ties them together. Or, if you'd rather, **take one photo of each rack** and RackTrack links those instead. Either way you end up with a **group** — a set of racks that were captured together and now belong to one scan.

Once they're grouped, each rack is a full scan in its own right: it has its own devices, ports, topology and report, exactly as if you'd scanned it alone. What the group adds on top is the ability to move between racks with a tap, and to open a **combined 3D view** that puts the whole row in one shared scene, side by side, with the uplink cables that run between the racks drawn in.

## 2. At a glance

| | |
|---|---|
| **Category** | Core feature — multi-rack grouping. |
| **Who uses it** | Technicians surveying multiple racks at once. |
| **Where input comes from** | A single walkaround video, or one photo per rack. |
| **What it outputs** | A rack group — each rack analysed, plus a combined 3D view of the row. |
| **Data source** | REAL — genuine frames; the grouping, labels and cross-rack cabling are generated. |

## 3. How it works — step by step

```
Capture a row               →  pan a video across the racks, or add a photo of each
        ↓
Split into racks            →  detect the pans / scene changes that mark a new rack
        ↓
Pick the best frame each    →  sharpest, most device-rich, most confident shot per rack
        ↓
Analyse each rack           →  the ordinary single-rack pipeline, one rack at a time
        ↓
Group + combined 3D         →  a group ties the racks together; tab between them or view the row
```

**Walkthrough**

1. Open the **Two racks** (multi-rack) flow from the navigation.
2. Choose **One video** — record or pick a slow pan across the aisle — or **Two photos** — add one photo per rack.
3. For a video, RackTrack cuts it into one segment per rack and keeps the single best frame from each.
4. Each frame runs the same analysis a normal single-rack scan does, so every rack gets its full detail.
5. The racks are linked into a group, and you land on the first rack's results with a rack-switcher strip across the top.
6. Tab between racks, or open the **combined 3D** view to see the whole row together.

## 4. Where the input comes from

- **A walkaround video** — a slow pan across the aisle. RackTrack samples it into evenly spaced frames to work out where one rack ends and the next begins.
- **One photo per rack** — an alternative to the video; you capture each rack yourself, and RackTrack links them.
- **The device detections in each frame** — used both to find the boundaries between racks and to pick the clearest frame for each one.

## 5. What it produces (output)

- **A rack group** — each member rack analysed individually and fully explorable on its own.
- **Rack tabs** — numbered chips to switch between the racks in the group.
- **A combined 3D view** — all the racks in one shared scene, side by side.
- **Per-rack labels** — "Rack 1, Rack 2, …" in the order you panned across them.
- **Inter-rack cabling** — the handful of uplink cables that cross *between* racks, drawn in the combined view.

## 6. What you see on screen

- **Rack tabs** — numbered chips at the top of a rack's results; switching racks keeps you on the same sub-page (if you're on Ports for Rack 1, you land on Ports for Rack 2).
- **Combined 3D scene** — every rack on one shared floor, which you can orbit and zoom, with each rack selectable on its own.
- **Quick-jump chips** — a strip under the 3D scene to open any specific rack's detail.
- **Inter-rack connections panel** — a short list of the cables that run between racks, each showing which rack and device it leaves and where it lands.

## 7. The logic behind it

- **Three signals mark a new rack.** RackTrack starts a new rack when the camera makes a clear sideways pan, when the scene's colours change enough to be a different rack, or when it crosses a stretch of blurry, device-less frames mid-pan. Using all three catches racks that a single signal would miss — for example two different racks each filmed head-on.
- **Keep the best frame of each rack.** For every rack segment, RackTrack keeps the one frame with the best mix of device count, detection confidence and sharpness — so a shaky pan still yields a clean shot per rack.
- **Ignore camera shake.** A too-short segment — a flicker of a frame mid-pan — is discarded rather than turned into a phantom rack. If aggressive splitting somehow removes everything, the whole clip is treated as a single rack instead of returning nothing.
- **Don't invent rack-to-rack cables.** Each rack keeps its own core/aggregation device, and the few cross-rack links route through those, rather than fabricating direct cables between arbitrary devices.
- **Every rack is still a normal scan.** Grouping adds a parent record on top; it never changes how an individual rack is analysed, so per-rack reports, topology and everything else work exactly as they always did.

## 8. Detailed technical explanation

**Splitting a video into racks.** RackTrack samples a spread of frames across the whole clip — enough to catch a short pause on each rack without processing every frame. On each sampled frame it detects the devices and works out a "signature": roughly, where the cluster of devices sits horizontally in the frame. As you pan, that signature drifts; a sudden jump means you've moved to a new rack. Two extra signals back this up — a big change in the overall colour of the scene (a genuinely different rack, even if it's centred the same way), and a run of frames with no detections (the blur of a pan in progress). Wherever any of these fire, RackTrack starts a new rack.

**Choosing each rack's photo.** Within each rack's stretch of frames, every frame is scored on how many devices it shows, how confident those detections are, and how sharp it is. The top-scoring frame becomes that rack's image and is saved at full resolution; the rest are discarded. That single frame then goes through the ordinary single-rack analysis, so the rack comes out with the same devices, ports, cabling and report any solo scan would produce.

**Tying the racks together.** The racks are recorded as a group, scoped to your team, with each member's pan-order position, its auto label ("Rack 1", "Rack 2", …), how many devices it had and its selection score. That parent record is all the rack-switcher tabs and the combined 3D view need to find the other racks in the set. A rack can even belong to more than one group over time, and RackTrack resolves to the group you just created rather than an older one.

**Guarding against surprises.** If a rack was panned past too quickly to gather enough frames, it can be dropped from the result — but this is now reported rather than silent, so a missing rack has a visible reason. And if a two-rack photo flow resolves both photos to the same rack (because they're actually the same rack), it's flagged instead of quietly producing a group of one.

## 9. Real data vs. synthetic

| Thing on screen | Real or synthetic |
|---|---|
| Each rack's frame | **REAL** — the best still chosen from your video or the photo you took. |
| Each rack's analysis | **REAL** — identical to a single-rack scan. |
| Group membership & "Rack 1, 2, …" labels | **GENERATED** — assigned in pan order. |
| Combined-view cabling within each rack | **SYNTHETIC** — inferred wiring, same as single-rack topology. |
| Inter-rack uplink cables | **GENERATED** — a realistic handful of cross-rack links, not a full mesh. |

## 10. Use cases

- **Surveying a row.** One slow pan down an aisle documents the whole row — RackTrack produces a rack per bay, grouped and ready to review.
- **Whole-row review.** The combined 3D view shows the entire row in one scene, so you can see the layout and the cabling that runs between racks at a glance.
- **Two racks, fast.** When you only care about a pair — say, a switch stack and the rack it uplinks to — capture both and jump straight into the side-by-side view.

---

— Multi-Rack Scans —
