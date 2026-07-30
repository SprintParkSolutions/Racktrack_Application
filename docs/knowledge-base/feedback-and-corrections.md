# Feedback & Corrections

*When RackTrack reads a device or a port wrong, you tell it the truth in one tap — and that correction updates RackTrack's record and teaches the model, without ever touching the real hardware.*

Reference · All users · Last verified: 26 July 2026 against the live code.

---

## On this page

1. In simple terms
2. At a glance
3. Correcting a device type
4. Correcting a port type
5. Correcting the port count (and how ports re-lay-out)
6. What happens under the hood
7. Does it change my hardware?
8. Common questions

---

## 1. In simple terms

When you scan a rack, RackTrack's computer-vision models make their best guess about what they see: this box is a **Switch**, that jack is an **RJ45** port, this switch has **24** ports. Most of the time they're right. Sometimes they're not — a dark, dusty, or angled photo can make a switch look like a UPS, or make the model miss a few ports at the end of a row.

**Feedback & Corrections is how you fix those guesses.** On the results screen, RackTrack asks you plain yes/no questions right next to what it detected:

- *"Detected as Switch — right?"*
- *"Detected 24 RJ45 ports — right?"*
- *"Port type: RJ45 — right?"*

If it's right, you tap **Yes** and move on. If it's wrong, you tap **No**, pick the real answer from a short list (or type it), and RackTrack corrects itself.

Two things are worth understanding up front, because they're the whole point of this feature:

1. **You are teaching it, safely.** A correction does two useful things at once. First, it fixes *this* scan's record — the device now reads "Switch," the count now reads 24 — so your report and everyone who opens the scan sees the truth. Second, it feeds RackTrack's learning system, so the model gets better at reading racks like yours next time. You are, quite literally, training the model by using the app.

2. **You are never touching the real switch.** This is the safety part. A correction edits RackTrack's *notes about* your equipment — its stored JSON records and its training data. It does **not** log into the switch, change a port, cut power, or alter a cable. Correcting "this is a Switch, not a UPS" is exactly as safe as fixing a typo in a spreadsheet. Nothing in the rack moves.

So you can correct freely. The worst case of a wrong correction is a wrong *note* that you can correct again — never a wrong action on live hardware.

---

## 2. At a glance

| | |
|---|---|
| **What it does** | Lets you confirm or correct what the model detected — device type, port type, and port count — plus port number and cable colour. |
| **Where you use it** | The **Results** screen (`ResultsPage`), as small yes/no cards under each detection. |
| **Who can use it** | Any signed-in user who can open the scan (their tenant owns that rack). See "Who can make corrections" below. |
| **What a correction changes** | RackTrack's *record* of the scan, and RackTrack's *training data*. |
| **What it never changes** | The real switch, ports, power, or cabling. Read-only with respect to hardware. |
| **The five endpoints** | `POST /api/feedback` (port number + cable colour), `POST /api/feedback/device` (device type), `POST /api/feedback/port-type` (physical port type), `POST /api/feedback/port-count` (how many ports), `POST /api/feedback/port/verified` (save a whole verified port layout). |
| **Ground Truth** | The owner-only Ground Truth tab writes device corrections through the **same** `POST /api/feedback/device` path — it is device feedback, gathered as a worklist. |
| **Security** | Every feedback endpoint is behind `auth.requireAuth` (you must be signed in) plus a tenant ownership check on the scan. |

---

## 3. Correcting a device type

This is the most common correction: RackTrack labelled a box in the rack and you want to change that label — for example, it said **UPS** and it's actually a **Switch**.

### On screen

Once you've selected a device, RackTrack shows a card:

> **Detected as UPS — right?**  ·  **Yes** / **No**

- Tap **Yes** and RackTrack records that its guess was correct.
- Tap **No** and a short list of device types appears: *Switch, Patch Panel, Firewall, Router, Server, Load Balancer, Modem, Controller, Recorder, Amplifier, Gateway, PDU, PSU, UPS* — plus an **Other** box where you can type a type that isn't in the list. Pick **Switch**, submit, and the correction is sent.

After you correct it, the card changes to *"Device: Switch — you set this"* so it's clear the value is now yours, not the model's. The device picker, the "Selected Device" line, and Recent Scans all update to **Switch** without a refresh.

### What the correction sends

The client calls `POST /api/feedback/device` with the scan id, the device index, `is_correct: false`, and `actual_device_class: "Switch"`. (Tapping **Yes** sends the same call with `is_correct: true` and no actual class — that's how RackTrack records a confirmed-correct guess.)

### What the server does with it

For a *wrong* device correction, the server (in `server/app.js`) does all of the following:

1. **Rewrites `device_unit_map.json`.** It opens the scan's device map, finds that device, and edits it in place: it saves the model's original guess into `class_name_original` (only the first time, so the true original is never lost), sets `class_name` to your value ("Switch"), and stamps `class_name_source: "user_corrected"`. The file is written safely — to a temporary file first, then renamed over the real one — so a half-written file can never be read.
2. **Appends to the feedback log** — see [Under the hood](#6-what-happens-under-the-hood).
3. **Crops the device** out of the original photo and files that small image under the corrected label, so it can be used to retrain the model.
4. **Triggers active learning** and **fires a memory correction** so future scans of a similar-looking device auto-apply "Switch."
5. **Refreshes the canonical scan result**, so the corrected label shows up everywhere the scan is read — the UI, exports, and any ServiceNow sync.

### Ground Truth uses this exact path

The owner-only **Ground Truth** tab is a worklist of the least-confident, not-yet-confirmed devices across your scans. When a technician tells Ground Truth the real identity of a device, it writes through this **same** `POST /api/feedback/device` endpoint — the same atomic map update, the same feedback log, the same active-learning memory, the same accuracy tally. Ground Truth only *adds* owner-only screens for *finding* devices to correct; the correction itself is ordinary device feedback.

---

## 4. Correcting a port type

Every physical jack has a type — RJ45, SFP, and so on. After you locate a specific port, RackTrack shows what type it thinks that jack is and lets you confirm or correct it.

### On screen

Once a port is located, a card appears:

> **Port type: RJ45 — right?**  ·  **Yes** / **No**

The list of types you can choose from is exactly the set the type model knows: **RJ45, SFP, QSFP, CONSOLE, AUX, MANAGEMENT_PORT, USB_A, USB_B, USB_C** (shown in friendly form, e.g. "Usb A"). Pick the real one and tap **Save**; the card confirms *"Saved — thanks, this trains the model."* and then *"Port type: SFP — you set this."*

### One behaviour worth knowing

For the port-type card, tapping **Yes** does **not** call the server — it just quietly marks the question answered on your screen. Only a *correction* (tapping **No** and saving a different type) is sent, via `POST /api/feedback/port-type`. This is different from the device and port-count cards, where **Yes** *is* sent and recorded as a confirmed-correct answer.

### What the server does with it

`POST /api/feedback/port-type` validates that your chosen type is one of the nine known types, then:

1. **Crops that port** from the photo and files the crop under the corrected type, so it feeds retraining.
2. **Appends the correction** to the feedback log (as a `port_type` entry).
3. **Triggers active learning** and **fires a memory correction** (org-scoped) so a re-scan of the same port auto-applies the corrected type.

A port-type correction does **not** rewrite `device_unit_map.json` — it's a per-port learning signal, not a change to the device's stored layout. (Because port-type entries don't carry a right/wrong flag, they also don't move the accuracy tally described below.)

---

## 5. Correcting the port count (and how ports re-lay-out)

RackTrack counts how many main ports it detected on a device. A dim or angled photo can make it miss the last few jacks in a row — so it might say **11** when the switch clearly has **24**. This correction is special: fixing the *number* actually **re-lays-out the ports** to match.

### On screen

After you've answered the device-type question, RackTrack asks about the count:

> **Detected 11 RJ45 ports — right?**  ·  **Yes** / **No**

If the device has more than just RJ45 (say SFP cages too), the prompt shows the full breakdown, e.g. *"Detected 26 total ports (24 RJ45, 2 SFP) — right?"*. Tap **No**, pick a common count (8, 12, 16, 24, 48) or type the exact number in **Other**, and submit. (This card is skipped for PDUs, because a PDU has power outlets, not RJ45 ports — the Power card already summarises those.)

### What the correction sends

The client calls `POST /api/feedback/port-count` with the scan id, device index, `is_correct: false`, and `actual_port_count: 24`. Tapping **Yes** sends `is_correct: true` and confirms the model's count.

### How the re-layout works

This is the part that makes port-count feedback more than a note. When you supply a real count, the server logs the correction and then **re-runs port detection for just that one device** with your number as the target (`target_count`). In the pipeline worker, `handle_relabel_port_count` does the following:

- It re-crops that device from the original image and runs the port models against the crop with your target count.
- **If detection now finds more ports than you said** (model found 30, you said 24), it **trims** down to the first 24 real detections and renumbers them 1–24.
- **If detection finds fewer than you said** (model found 11, you said 24), it **lays out a clean grid of exactly 24 ports** across the device's face. It chooses **two rows** when the count is even and the face is short and wide (a typical switch), otherwise a **single row** (a patch panel or small device). Two-row switches are numbered column-major (top of a column, then bottom, moving left to right); single rows are numbered left to right — matching how the app normally numbers a switch. Each synthesised port copies the connected/empty **status** of the nearest real detection, so the layout stays realistic.
- It writes the new layout back into `device_unit_map.json` (again atomically), sets `port_count` to your number, and stamps `port_count_source: "user_relabeled"`.
- It **redraws the device image** (`5_selected_device_with_port.png`) so the port view immediately shows a dot and an index for every one of the 24 ports.

Back on your screen, the device picker updates to the new count straight away and the port image is cache-busted so you see the corrected dots without a refresh. From then on, when you go to **locate** a port on that device, RackTrack uses your confirmed count — so "port 24" really is the 24th position on the face. (If the re-layout can't run for some reason, RackTrack still records your real count locally so the port-number entry box only accepts 1–24.)

**Key point:** re-laying-out the ports rearranges RackTrack's *drawing and record* of the ports. It does not renumber, enable, or disable anything on the actual switch.

---

## 6. What happens under the hood

Every correction fans out into a few small, well-defined jobs. Here's the whole machinery in plain terms.

### The map rewrite

Device-type and port-count corrections edit the scan's `device_unit_map.json` — the file that holds each detected device, its box, its class, and its ports. Writes are **atomic** (write a `.tmp` file, then rename it into place), so the map can never be read half-written. The model's original guess is preserved (`class_name_original`), and the source of the current value is stamped (`class_name_source` / `port_count_source` = `user_corrected` / `user_relabeled`), so it's always clear whether a value came from the model or from you. Port-number and cable-colour corrections don't rewrite the map directly — they're applied as an **overlay** (below).

### The feedback log

Every correction — and every confirmed-correct "Yes" on the device, port-count, and port cards — is appended as one JSON line to a feedback log. It's written in **two** places: a single server-wide `server/feedback.jsonl`, and a per-scan `feedback.jsonl` inside that scan's folder. The log is append-only and rotates when it grows large (at 50 MB), so it's a durable, ordered history of every judgement made on every scan.

### The overlay (so corrections "stick" everywhere)

Because port-number, cable-colour, device-class, and port-count corrections all live in the feedback log, RackTrack has a step (`applyFeedbackOverrides`) that reads the latest correction for each item and lays it on top of the model's predictions whenever it rebuilds the canonical `scan_result.json`. For each device, the **most recent** correction wins (so re-correcting something is always safe — it doesn't stack or compound). The original model value is kept alongside in a small `_correction` audit trail, so nothing is ever truly overwritten. This is why a correction shows up consistently in the UI, in exports, and in any ServiceNow sync — they all read the same overlaid result.

### Active learning

Each correction kicks off a fire-and-forget background training cycle (`retraining_learning.run_loop --once`): it ingests the new corrections, checks whether there's enough new signal to retrain, and retrains when ready. It's deduplicated and coalesced, so a burst of feedback doesn't spawn a pile of parallel jobs — if a cycle is already running, one more pass is queued for when it finishes. The trainer runs in its own subprocess, isolated from the API server, and the whole thing can be turned off with the environment variable `ACTIVE_LEARNING_AUTOTRAIN=0`.

### Memory corrections (auto-apply on the next scan)

Alongside training, device, cable-colour, and port-type corrections also write a **memory correction** (`fireMemoryCorrection` → the active-learning CLI). This stores a perceptual hash and a ResNet-18 image embedding of the corrected crop, tagged with your organisation. The effect: the *next* scan that contains a visually similar device, cable, or port can **auto-apply** your corrected label immediately — before any retraining even happens. It's scoped to your organisation, so your corrections improve your own scans first.

### The accuracy tally

RackTrack keeps a running right/wrong count over the feedback log (`feedbackTally`) — every entry that carries a right/wrong flag counts as correct or incorrect. This drives the owner dashboard's accuracy figure and the `GET /api/feedback/stats` breakdown (total, correct, wrong, overall accuracy, and accuracy per device class). The tally is computed cheaply — it's cached and only re-scans the log when the file actually changes — so the dashboard can poll it often without slowing the server. (Port-type corrections don't carry a right/wrong flag, so they train the model but don't move this accuracy number.)

### Verified port layouts

There's one more, heavier correction: `POST /api/feedback/port/verified` saves a **whole** user-verified port layout for a scan's image. Once saved, a later upload of the same (or a visually similar) image returns that verified layout and **skips the port-detection model entirely** — "the user already fixed it, show that." A companion check endpoint powers the **VERIFIED** badge you see on a scan whose layout has been locked in this way.

---

## 7. Does it change my hardware?

**No. A correction never touches your equipment.** This is the single most important thing to understand about the feature, so here it is plainly.

When you correct something, RackTrack changes only two kinds of thing, both of which live entirely inside RackTrack:

1. **Its record of the scan** — JSON files like `device_unit_map.json` and the rebuilt `scan_result.json`. These are RackTrack's *notes* about what it saw in your photo.
2. **Its training data** — the small cropped image and the logged correction that help the model read racks better next time.

What a correction does **not** do:

- It does **not** connect to the switch, router, firewall, or any device.
- It does **not** change a port's state, VLAN, speed, or configuration.
- It does **not** enable, disable, or renumber a physical port.
- It does **not** cut, restore, or change power on a PDU or UPS.
- It does **not** move, add, or remove a cable.

Even the dramatic-sounding "re-lay-out the ports" from the port-count correction is just RackTrack redrawing its own diagram to match the count you gave it. The switch on the rack is completely unaware any of this happened. The safe way to think about it: **you are correcting a document, not operating a machine.** That's why you should correct freely and often — the only thing you can get wrong is a note, which you can simply correct again.

---

## 8. Common questions

**Q: How do I fix a wrong device?**
A: On the Results screen, select the device. Under it you'll see *"Detected as \<type\> — right?"*. Tap **No**, choose the real type from the list (or type it in **Other**), and submit. RackTrack updates the label everywhere and records the correction. Nothing on the physical device changes.

**Q: How do I correct the device type specifically?**
A: Same card — *"Detected as X — right?"* → **No** → pick the correct type from *Switch, Patch Panel, Firewall, Router, Server, Load Balancer, Modem, Controller, Recorder, Amplifier, Gateway, PDU, PSU, UPS*, or type your own in **Other**. It saves through `POST /api/feedback/device` and the card then reads *"Device: \<type\> — you set this."*

**Q: How do I tell it a device is a Switch, not a UPS?**
A: Select that device, tap **No** on *"Detected as UPS — right?"*, choose **Switch**, and submit. The stored class flips from UPS to Switch, the picker and reports follow immediately, and RackTrack remembers so a similar-looking device auto-reads as a Switch on your next scan.

**Q: The port count is wrong — how do I fix it?**
A: Answer the device-type question first, then you'll see *"Detected N RJ45 ports — right?"*. Tap **No**, pick a common count (8/12/16/24/48) or type the exact number, and submit. RackTrack re-lays-out the ports to your number and redraws the device so every port shows.

**Q: What actually happens when I correct the port count?**
A: The server re-runs port detection for just that device using your number as the target. If it now finds too many, it trims to your count; if too few, it lays out a clean grid of exactly your count (one or two rows, numbered the way the app numbers a switch), copying each real port's connected/empty status. It saves the new layout and redraws the device image.

**Q: Does correcting the port count change the ports on my actual switch?**
A: No. It only rearranges RackTrack's drawing and record of the ports. The physical ports are untouched — nothing is renumbered, enabled, or disabled on the hardware.

**Q: Does correcting anything change my switch or other hardware?**
A: No. Every correction edits only RackTrack's stored records and its training data. RackTrack never logs into or alters any device, port, cable, or power. Think of it as fixing notes, not operating equipment.

**Q: What happens when I say something is wrong?**
A: RackTrack (1) updates its record for this scan, (2) logs the correction to an append-only feedback log, (3) saves a cropped image of the item under the correct label, (4) kicks off a background learning cycle, and (5) stores a "memory" so a similar item auto-corrects on your next scan. All of this is inside RackTrack; none of it reaches the hardware.

**Q: Does my correction help the model get better?**
A: Yes — that's a core purpose. Each correction is saved as training data and feeds an active-learning cycle, and a memory of it is stored so visually similar devices, ports, or cables on future scans can auto-apply your label right away, even before a retrain.

**Q: Do I have to correct things, or can I just confirm?**
A: You can just confirm. Tapping **Yes** on the device and port-count cards records that the model's guess was right — that's useful signal too, and it feeds the accuracy score. Only tap **No** when something is actually wrong.

**Q: If I tap "Yes," does anything get sent?**
A: For the **device** and **port-count** cards, yes — a "correct" answer is recorded on the server. For the **port-type** card, tapping **Yes** is local only (nothing is sent); only a *changed* port type is submitted.

**Q: Can I correct the port type of a jack?**
A: Yes, after you locate a port. The card *"Port type: X — right?"* lets you set it to one of RJ45, SFP, QSFP, CONSOLE, AUX, MANAGEMENT_PORT, USB_A, USB_B, or USB_C. Saving it trains the type model and is remembered for re-scans of that port.

**Q: Can I fix the port number or the cable colour too?**
A: Yes. When you've located a port, RackTrack asks *"Port \<n\> — right?"* and *"Cable colour is \<colour\> — right?"*. Correcting the number re-anchors that port and shifts the device's numbering to match; correcting the colour updates that cable. Both go through the base `POST /api/feedback` endpoint and appear via the overlay.

**Q: Where do my corrections show up?**
A: Everywhere the scan is read — the Results UI, the device picker, Recent Scans, exported reports, and any ServiceNow sync. RackTrack rebuilds the canonical scan result with your corrections overlaid, so all consumers see the same corrected values.

**Q: If I correct the same thing twice, do the corrections stack?**
A: No. The most recent correction always wins. Port-number shifts, for example, are stored as absolute offsets so repeated corrections can't compound into a runaway shift — the latest one simply replaces the previous.

**Q: Is my original detection lost when I correct it?**
A: No. RackTrack keeps the model's original value (e.g. `class_name_original`) and a small `_correction` audit trail alongside the new value, so the original prediction is always recoverable.

**Q: Who can make corrections?**
A: Any signed-in user who can open that scan. Every feedback endpoint requires authentication (`auth.requireAuth`) and checks that your tenant owns the rack — if it doesn't, the request is refused as "not found." The Ground Truth *worklist* screens are owner-only, but the device correction it submits is the same one available on any scan you can view.

**Q: Do corrections work across my whole organisation?**
A: The learned memory is scoped to your organisation, so your corrections improve your organisation's future scans. The record change applies to the specific scan you corrected.

**Q: Why did the device image change after I fixed the port count?**
A: Because RackTrack redrew that device's port view to match your count — placing a dot and an index for every port. It's a fresh drawing of RackTrack's record, not a change to the switch.

**Q: The count re-layout put ports in two rows — why?**
A: RackTrack uses two rows when your count is even and the device face is short and wide (a typical rack switch), and a single row otherwise (patch panels, small devices). It numbers two-row switches column-by-column and single rows left to right, matching the app's normal switch numbering.

**Q: What if the automatic re-layout can't run?**
A: RackTrack still records the real count you entered, so the port-number entry box is bounded to 1–N straight away. You just won't get the freshly redrawn grid until it can re-run.

**Q: Does a wrong correction ever risk the hardware?**
A: No. The worst outcome of a mistaken correction is a wrong note in RackTrack, which you can correct again. Because corrections never reach the equipment, there is no hardware risk in experimenting.

**Q: Can I lock in a whole port layout I've verified?**
A: Yes. RackTrack can save a fully verified port layout for a scan (`POST /api/feedback/port/verified`). After that, re-uploading the same or a visually similar image returns your verified layout and skips port detection entirely — and the scan shows a VERIFIED badge.

**Q: How is accuracy measured from my feedback?**
A: RackTrack tallies right vs wrong answers across the feedback log to produce an overall accuracy figure and a per-device-class breakdown (via `GET /api/feedback/stats`), shown on the owner dashboard. Confirmed-correct "Yes" answers count as right; corrections count as wrong-then-fixed. (Port-type answers don't carry a right/wrong flag, so they train the model but don't move this number.)

**Q: Does correcting stuff slow the app down?**
A: No. The learning and memory work runs in the background in separate processes, and the accuracy tally is cached, so your correction returns immediately while the heavier work happens out of the way.
