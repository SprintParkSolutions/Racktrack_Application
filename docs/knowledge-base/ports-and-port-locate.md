# Ports & Port Locate

*Pick a device, pick a port type, type the port number — and RackTrack marks that exact port on the photo. When it can't count a device's ports, it stops and asks you to set the count first, so it never points at a port that isn't there.*

Core feature · All users · Last verified: 26 July 2026 against the live code.

---

## 1. In simple terms

When you scan a rack, RackTrack finds the devices in the photo — switches, patch panels, routers, firewalls, gateways, PDUs. **Port Locate** is the next step down: it lets you point at *one specific port* on one of those devices and see exactly where it is.

You do three small things:

1. **Pick a device** from the list (or tap it in the rack image).
2. **Pick a port type** — RJ45, SFP, Console, or USB — using the little buttons.
3. **Type a port number** and press **Find Port**.

RackTrack then draws a close-up of that device with the port you asked for circled, plus a full-rack shot with the same port highlighted, so you can walk up to the rack and put your finger on it. If a cable is plugged into that port, it also tells you the cable's colour and connector type.

The important thing to understand — and the thing that surprises people — is **where the port count comes from**. RackTrack counts a device's ports by *looking at the photo* with its computer-vision (CV) models, not by logging in to the switch. Most of the time that works and you just type a number. But sometimes the models can't read the ports — the photo is dark, the ports are hidden behind cables, the models aren't loaded on that server, or the device simply has no RJ45 jacks at all. When that happens the count comes back as **zero**, and RackTrack will **not** let you locate a port until you tell it how many ports the device really has. It says, in plain words:

> *"We couldn't read how many ports this device has. Set the port count below, then pick a port."*

That is deliberate. If it didn't know the count and let you type "port 34" on a 24-port switch anyway, it would happily point at empty metal. Asking you first keeps it honest.

There is also a companion, separate view — the **live Ports tab** — which is a different thing: it logs in to the *real switch* over the network and shows which ports are free right now. That view answers "how full is this switch?"; Port Locate answers "where is port N on this device in the photo?" Section 4 explains how they differ.

## 2. At a glance

| | |
|---|---|
| **What it is** | Point at one specific port on a scanned device and see it marked on the photo. |
| **Who uses it** | Every technician — planning a patch, finding a port a ticket named, checking a cable. |
| **Where you find it** | Open a scan → the results view → pick a device → pick a port type → **Find Port**. |
| **What you pick** | A device, a port **category** (RJ45 / SFP / Console / USB), and a port **number**. |
| **Where the port count comes from** | The **CV pipeline reading the photo** (`ports_9.pt` for type + `port_count.pt` for status) — **not** the live switch. |
| **What it produces** | A device close-up with the port marked, a full-rack shot with it highlighted, and the port's status (occupied / free) plus cable colour + connector when a cable is in. |
| **When it asks you first** | When the CV count is **0** — you must set the port count before locating. |
| **The engine** | `POST /api/select` runs the pipeline against the cached photo. |
| **Related but different** | The live **Ports tab** reads the real switch over SSH for live free/used counts. |

## 3. How it works — step by step

**Step 1 — Pick a device.** The results view has a device picker (a dropdown, and you can also tap a device in the rack image). Only *port-bearing* devices are offered: **Switch, Patch Panel, Router, Gateway, Firewall, and PDU**. Servers, UPSes, load balancers and the like still show on the annotated image but aren't selectable, because there's no user-inspectable port to point at. Each entry in the picker shows a short breakdown, for example `RVEW-CORE-SW01 · Switch · 24 RJ45 · 2 SFP · 1 Console`, so you can tell at a glance what the device has.

**Step 2 — Pick a port type (category).** Once a device is selected, RackTrack shows a small row of type buttons — but **only the categories that device actually has**, each with its count:

- **RJ45** (the copper Ethernet jacks — internally called the *main* ports)
- **SFP** (fibre / transceiver cages — includes QSFP)
- **Console** (console / AUX / management ports)
- **USB** (USB-A / B / C — internally the *other* bucket)

An all-fibre switch, for example, won't show an RJ45 button at all — it'll show SFP and Console. If a device somehow has no categories detected, RackTrack falls back to showing just the RJ45 button.

**Step 3 — Type a port number and Find Port.** The input accepts whole numbers only, and it's capped at the device's port count for the chosen category, so you can't ask a 24-port switch for port 1000 or port 1.23. Press **Find Port** (or Enter).

**Step 4 — RackTrack locates it.** It sends your device, port number, and category to the server, which runs the pipeline against the *cached photo of the rack* and returns two images plus a small facts block. A "Locating port…" spinner shows while it works.

**Step 5 — Read the result, or jump to another port.** You see the marked-up images and the port's details. A second, compact input lets you jump straight to **another port** on the same device — and you can switch the type there too (e.g. locate an SFP port right after an RJ45 one) without going back.

**The fork in the road — when the count is unknown.** If the device's detected port count for your chosen category is **0** *and* its overall RJ45 count is also 0, there is no valid upper bound, so **Find Port refuses to run** and shows the "couldn't read how many ports" message. To get past it, answer the **port-count question** further down the panel (see Section 5) — tell RackTrack the real number. The moment you do, the input's 1–N limit updates and Find Port works.

```
Pick a device  →  Pick a port type (RJ45/SFP/Console/USB)  →  Type port # (1–N)
                                                                     │
                              count known (N > 0) ──────────────► Find Port ─► marked photo + port facts
                                                                     │
                              count unknown (N = 0) ─► "couldn't read how many ports"
                                                     └► set the real count below ─► input unlocks ─► Find Port
```

## 4. What you see on screen

**The device card and type buttons.** After you pick a device, a card appears titled **Port number**, with a sub-line that reads either *"Enter port number · N detected"* (when the CV found ports) or just *"Enter the port number"* (when it didn't). Below it are the RJ45 / SFP / Console / USB buttons — each labelled with its count, e.g. `RJ45 · 24`, `SFP · 2` — and the number input with a **Find Port** button.

**The locate result — two images.** When a port is found, RackTrack shows:

- **A device close-up** (`5_selected_device_with_port.png`) — the single device, cropped, with the port you asked for marked by a large green dot and its number. Once one port is highlighted, the other ports' markers are hidden so the one you want stands out.
- **A full-rack shot** (`6_full_rack_selected_port.png`) — the whole rack photo with that same port highlighted in place, so you can find it relative to everything else.

**Occupied vs free.** Alongside the images, RackTrack reports whether the located port is **occupied** (a cable is plugged in — status `connected`) or **free** (status `empty`). This reading comes from the CV *status* model looking at that exact port. When the model genuinely couldn't measure the port, the truthful answer is "unknown" — and on the Find-Port screen only, RackTrack shows that unknown as **empty** (the conservative reading: don't claim a link it didn't see). The honest value is preserved behind the scenes on `occupancy_source` and never leaks into topology or the CMDB.

**Cable details (only when occupied).** If the port is `connected`, RackTrack also reads the **cable colour** and **connector type** from the photo and shows them, and asks you to confirm the colour (you can correct it; your correction sticks on later re-locates).

**PDUs are different.** If you pick a PDU, there's no port-number input — instead you get a **Power** card summarising outlets, e.g. *"24 outlets · 18 in use · 6 free"*, with a Powered / No power badge. PDU outlets are counted by their own detector, not the port models.

**The live Ports tab (a separate view).** Elsewhere in the app there is a **Ports** tab that is *not* photo-based. It logs in to the real switch over the network and shows an **Available-ports summary** (a big "N of M free" badge, ETH vs SFP chips, a utilisation bar), a **faceplate grid** (one coloured cell per physical port — up / uplink / free), a per-port list, and Cables / Ping tools. Keep the two straight:

| | **Port Locate** (this doc's focus) | **Live Ports tab** |
|---|---|---|
| Source | The **photo**, read by CV models | The **real switch**, read live over SSH |
| Answers | "Where is port N on this device?" | "Which ports are free right now?" |
| Port count from | `ports_9.pt` + `port_count.pt` on the crop | The switch's own interface table |
| Categories | RJ45 / SFP / Console / USB (4) | ETH vs SFP (2) |

## 5. The logic behind it

**The four categories come from nine detector classes.** The port-type model knows nine physical connector shapes, which RackTrack collapses into four buckets:

| Category (bucket) | Button label | Detector classes folded in |
|---|---|---|
| `main` | **RJ45** | RJ45 |
| `sfp` | **SFP** | SFP, QSFP |
| `console` | **Console** | CONSOLE, AUX, MANAGEMENT_PORT |
| `other` | **USB** | USB_A, USB_B, USB_C |

A device's **`port_count`** is its **RJ45 (main) count** specifically. The SFP, Console, and USB categories carry their own separate counts. That's why the picker can say `24 RJ45 · 2 SFP · 1 Console` — three independent numbers, not one total.

**The upper bound for the number you type.** For the category you've chosen, the limit is that category's detected count. If that category shows 0, RackTrack falls back to the device's overall RJ45 `port_count`. If *both* are 0, the limit is unknown (0), and that's the trigger for the manual-count prompt.

**Why the manual-entry step exists.** RackTrack refuses to locate a port when it has no honest upper bound. Silently accepting any number is how "port 34" once got located on a 24-port switch — pointing at nothing. So when the count is unknown it blocks Find Port and routes you to the **port-count question**: a Yes/No prompt like *"Detected 24 RJ45 ports — right?"* (or *"Detected 26 total ports (24 RJ45, 2 SFP) — right?"*). Answer **No** and enter the real number (there are quick options for 8 / 12 / 16 / 24 / 48, or type your own). RackTrack then:

- updates the device's count locally so the port input's 1–N limit follows immediately, and
- sends the correction to the server, which can **re-detect** that device's ports laid out to exactly the count you gave — so port 24 becomes the 24th physical position — and redraw the device image.

**Your corrections are remembered.** If you've corrected a device's port *numbering* (e.g. "this is really port 5, the model called it 7"), later Find-Port requests translate your number back to the model's raw position, locate the right physical port, and re-stamp your number on the result — so your numbering, not the model's, is what you see. Cable-colour corrections for a specific port are re-applied the same way.

## 6. Under the hood

**The request.** Find Port calls **`POST /api/select`** with `{ scanId, device_index, port, port_category }`. The category must be one of `main` / `sfp` / `console` / `other` (defaults to `main`). Because this route takes the rack id from the request body rather than the URL, it shape-validates `scanId` against `RK-…` and checks rack ownership by hand before doing anything.

**Finding the image.** It locates the cached rack photo from `scan_meta.json`'s `imagePath`, falling back to `outputs/<rackId>/original_image.{jpg,jpeg,png}`. If the meta file is missing but the analysis is intact, it reconstructs and heals the meta rather than making you re-upload.

**Running the pipeline.** It calls `runPipelineSelect(...)` with the device index, the port number (after applying any stored numbering shift), the category, and — for RJ45/main — a **target count** if you've relabelled that device. Inside the pipeline (`runner.py`):

- **Patch panels** are detected as a fixed RJ-45 grid: the status model's boxes are snapped to the nearest standard size (**24 or 48**), synthesising missed jacks or dropping extras.
- **When you've set a target count**, `classify_ports_with_target_count` makes the main-port list *exactly* that many — trimming when the model over-counts, or laying out a clean N-port grid when it under-counts — so the numbering you confirmed is the numbering you get.
- **Otherwise**, `classify_ports_by_pattern` runs the normal two-model flow.

**The two models** (`pipeline/port.py`, `pipeline/port_pattern.py`):

- **`ports_9.pt`** — the **type** model. It labels each detected port's *shape* (RJ45, SFP, QSFP, CONSOLE, AUX, MANAGEMENT_PORT, USB_A/B/C). It carries no plugged/empty signal.
- **`port_count.pt`** — the **status** model. Its two classes are `Connected_port` and `Empty_port`. It carries no type signal — it only tells connected from empty.

Per device crop, both models run; each is de-duplicated (NMS) within itself; then every status box is IoU-matched onto the type box it overlaps most, copying its connected/empty verdict across. A typed port with no overlapping status box stays **unknown**. Ports are then bucketed into the four categories and numbered in reading order (column-major for two-row switch faces; strictly left-to-right for single-row panels and PDU outlets).

**The output.** The pipeline writes `selected_port_info.json` (`port_number`, `port_category`, `status`, `occupancy_source`, `class_name`, `confidence`, `location` bbox, and cable `type` / `connector` / `colour` when connected) and the two PNGs. `/api/select` copies the images into `outputs/<rackId>/ports/`, appends a line to `port_identifications.jsonl` (so the report can show every port you've inspected), and returns `{ resultImageUrl, rackImageUrl, portInfo, portClassification, timings }`. An unmeasured status is returned as `empty` for display, with `occupancy_source: "unknown"` and `status_measured` preserved.

## 7. Edge cases & limits

- **Zero ports detected → manual count required.** The headline case. If the CV models return 0 ports for your category *and* 0 RJ45 overall, Find Port is blocked with *"We couldn't read how many ports this device has. Set the port count below, then pick a port."* Set the count via the port-count question and you're unblocked. Causes include a dark or blurry crop, ports hidden behind a dense cable bundle, or **the port models not being present/loaded on that server** (no models → no detections → 0).
- **All-SFP and fibre/console-only devices legitimately show 0 RJ45.** The models detect *physical connector shapes*, not roles. A switch, router or firewall whose front panel is all SFP cages (and console) has genuinely zero RJ45 jacks, so its `port_count` (RJ45) is 0 — its ports live under the **SFP** and **Console** categories instead. This is correct behaviour, and it's why the type buttons only offer the categories a device actually has. (RackTrack has no concept of "routed L3 interface"; it only ever sees connectors in the photo.)
- **The port-count models can over- or under-count.** On busy, dark, or angled photos the type model may miss ports or fire twice on one jack (NMS and a containment check remove most duplicates), and the status model may not tag every port. That's exactly what the port-count confirmation and target-count re-layout are for — your confirmed number wins.
- **Occupancy can be genuinely unknown.** When the status model can't measure a specific port, the pipeline keeps it `unknown` rather than guessing. The Find-Port screen shows unknown as **empty** (conservative) — so a port shown as free *might* be unmeasured, not confirmed empty. Nothing downstream (topology, CMDB) trusts that display substitution.
- **PDUs have outlets, not ports.** A selected PDU shows the Power summary, not a port-number input.
- **Numbers only, and bounded.** The input rejects decimals, signs, and leading zeros, and clamps to the device's count — so out-of-range or malformed port numbers can't be submitted.

## 8. Real data vs. synthetic

| Thing on screen | Real or synthetic |
|---|---|
| Which ports exist and their type (RJ45/SFP/Console/USB) | **Real (CV)** — read from the photo by `ports_9.pt`. |
| Port count / per-category counts | **Real (CV)** — from the photo; **overridable by your correction**, which then re-lays-out the ports. |
| Located port's occupied/free status | **Real (CV)** — from `port_count.pt`; may be **unknown**, shown as *empty* for display only. |
| Cable colour + connector (when connected) | **Real (CV)** — read from the photo; overridable by your correction. |
| Ports synthesised to hit a confirmed count | **Synthetic layout** — code-drawn cells to fill a known count (patch-panel 24/48, or your target count), each still statused from the real status model where possible. |
| The marked-up close-up / full-rack images | **Real photo** with computed markers drawn on top. |
| The port *label* text (e.g. `…-IF-Gi1/0/7`) | **Synthetic** — a naming convention RackTrack mints; not read from the device. |

## 9. Use cases

- **Find the port a ticket named.** A ticket says "patch panel port 18" — pick the panel, type 18, and see exactly which jack that is on the photo before you touch anything.
- **Plan a patch.** Locate the next free RJ45 or SFP port, confirm it's empty, and note its position before running a cable.
- **Check a specific cable.** Locate an occupied port to read its cable colour and connector type without squinting at the rack.
- **Sort copper from fibre.** Use the type buttons to jump between RJ45 and SFP ports on the same device — handy on mixed switches when planning an uplink.
- **Fix the record as you go.** If the detected count or a port's number is wrong, correct it inline; the correction re-lays-out the ports and is remembered for next time.

## 10. Common questions

**Q: Why does it say "we couldn't read how many ports this device has"?**
Because the CV models — which count ports by looking at the photo — returned **zero** for this device. That happens when the crop is too dark/blurry, the ports are hidden behind cables, the device genuinely has no RJ45 jacks, or the port models aren't loaded on the server. Rather than let you locate a port with no honest upper bound (and risk pointing at nothing), RackTrack asks you to set the real count first. Answer the port-count question below the input and Find Port will work.

**Q: Does Port Locate log in to the switch?**
No. Port Locate works entirely from the **photo** of the rack using CV models. The separate **Ports tab** is the one that logs in to the live switch over SSH for real-time free/used counts.

**Q: Where does the port count come from, then?**
Two CV models on the device crop: `ports_9.pt` reads each port's *type*, and `port_count.pt` reads each port's *status* (connected/empty). The RJ45 tally becomes the device's `port_count`; SFP, Console, and USB get their own separate counts.

**Q: I set the count and now it works — did that change the switch?**
No. Your correction updates RackTrack's record of that device (and re-lays-out its ports so the numbering matches), and it's saved as feedback. It never touches the real hardware.

**Q: The port shows "empty" but I think a cable is plugged in — why?**
The status model reads occupancy from the photo. If it genuinely couldn't measure that port, RackTrack shows it as *empty* on this screen as the cautious default (it won't claim a link it didn't see). The angle, lighting, or a dust cap can cause a miss. Trust the live Ports tab or the switch itself for a definitive answer.

**Q: Why are there four port types but only RJ45/SFP on the other view?**
Port Locate distinguishes four physical categories — RJ45, SFP, Console, USB — folded from nine detector classes. The live Ports tab is a different feature that only splits copper (ETH) from fibre (SFP), because that's what the switch's own interface table gives it.

**Q: My device is all-fibre and shows 0 RJ45. Is that a bug?**
No. The models only see connector shapes. A device with no copper jacks correctly has 0 RJ45 — its ports are under the **SFP** (and maybe **Console**) buttons. You'll only see the type buttons for categories the device actually has.

**Q: Can I locate a second port without starting over?**
Yes. After a result, a compact "another port" input lets you type a new number — and you can switch the port type there too — to locate a different port on the same device immediately.

**Q: What are the two images I get?**
A cropped close-up of just that device with the port circled, and the full rack photo with the same port highlighted — so you can find it both up close and in context.

**Q: What happens to a port I locate — is it recorded?**
Yes. Each locate appends an entry to the device's port-identification log and archives the two images, so the report can show every port you've inspected, not just the last one.

**Q: Can I select a Server, PSU, or UPS?**
No. Only port-bearing types are selectable — Switch, Patch Panel, Router, Gateway, Firewall, and PDU. Other detected gear still appears on the annotated image but has no port to point at.

**Q: What if I pick a PDU?**
You get a Power summary (outlets total / in use / free and a Powered badge) instead of a port-number input. PDU outlets are counted by a dedicated power-outlet detector, not the port models.

**Q: Why won't it accept "port 34" on a 24-port switch?**
The input is capped at the device's detected (or your corrected) count, and Find Port validates against it. Out-of-range numbers, decimals, and signs are rejected — a guard added after an unbounded number once located a port that didn't exist.

---

*Two models read the photo — one for what each port is, one for whether it's in use. When they can't count, RackTrack asks you rather than guess.*
