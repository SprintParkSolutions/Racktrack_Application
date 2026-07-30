# Ground Truth

*The owner-only step where you tell RackTrack what each device in a scan really is — so the model's guesses become verified facts and the model can be taught where it was wrong.*

Owner feature · Owners only · Last verified: 26 July 2026 against the live code.

---

## 1. In simple terms

When you scan a rack, RackTrack's model looks at the photo and makes a guess about every device it can see: "that's a switch," "that's a patch panel," "that's a firewall." It gets most of them right, but not all — and on its own, the system has no way of knowing which guesses are wrong. A wrong guess sits in the results looking exactly as confident as a right one.

**Ground Truth is how an owner fixes that.** After a rack has been scanned and analysed, an owner opens Ground Truth for that one scan, walks down the list of devices the model detected, and for each one answers a simple question: *is this what the model says it is, or not?* If the model got it right, you tap **Correct**. If it got it wrong, you tap **Not this** and pick the real device type from a list. That answer is the "ground truth" — the human-verified fact about a real piece of equipment.

Every answer is useful in two ways. A confirmation tells us the model was right and nudges the measured accuracy up. A correction does more: it fixes the device's label everywhere in the scan, and it becomes a labelled training example so the model can learn to recognise that kind of device next time. Over many scans, all those small human answers add up to a model that gets things right more often.

The name is deliberate. In machine learning, "ground truth" means the known-correct answer you measure a model against. That is exactly what an owner is producing here — one device at a time.

## 2. At a glance

| | |
|---|---|
| **What it is** | An owner-only screen for verifying, device by device, what the model detected in a single scan. |
| **Who can use it** | Platform owners only. Members and org admins cannot see or open it. |
| **How you reach it** | From a specific rack's results — the **Ground Truth** link in that rack's sub-navigation (owners only). The web address is `/ground-truth/<rackId>`. |
| **Scope** | One scan at a time. It shows the devices from the rack you opened it from — not a global queue across every scan. |
| **What you answer** | For each device: **Correct** (the model was right) or **Not this** → choose the actual device type. |
| **What it lists** | Real detected devices only — including "Unidentified" ones. Blank rack slots ("Empty" and "Closed Unit") are hidden. |
| **What it produces** | A verified label per device, a fixed label in the scan when you correct, and a labelled training example for the model. |
| **Data source** | REAL — the model's own detections from your real photo, plus your verified human answer. |

## 3. How it works — step by step

```
You scan a rack               →   the model detects each device + a confidence score
        ↓
Open Ground Truth for it       →   from that rack's sub-nav (owners only)
        ↓
It lists the real devices      →   position · model's guess · confidence, for each device
        ↓
You judge each one             →   "Correct"   ·   or   "Not this" → pick the real type
        ↓
The answer is saved as truth   →   a confirmation, or a correction that also fixes the label
        ↓
The model learns               →   corrections feed the accuracy score and the retraining loop
```

1. **Scan and analyse a rack as normal.** Ground Truth has nothing to do until a scan exists, because it works on the devices that scan detected.
2. **Open Ground Truth for that scan.** As an owner, open the rack's results and choose **Ground Truth** from the rack's sub-navigation. You land on a page tied to that one rack.
3. **Read the device list.** The page loads the annotated scan image at the top and, below it, one row for every real device the model detected — each showing its rack position, the model's guessed type, and how confident the model was.
4. **Judge each device.** For a device the model got right, press **Correct**. For one it got wrong, press **Not this**, choose the true device type from the dropdown, and press **Save truth**.
5. **Watch the row settle.** Once you answer, that row shows a small badge — **Confirmed** for a device you agreed with, or **Corrected → <type>** for one you fixed. A **Change** link lets you revisit your answer.
6. **Work down the list.** Repeat for as many devices as you want to verify. There is no "finish" button — each answer is saved on its own the moment you give it.

## 4. What you see on screen

When an owner opens Ground Truth for a scan, the page shows:

- **A header** reading "Ground Truth" with the subtitle "Verify what the model detected in this scan," and a back control that returns to the rack's results.
- **A "Back to results" link** at the top of the list, which takes you back to that rack's overview.
- **The scan heading** — the rack's ID, the date and time it was scanned, and a count of how many devices are in the list.
- **The annotated scan image** — the processed rack photo with the model's detections drawn on it, so you can see the equipment you are verifying in context. (This is the whole-rack image; the page does not show a separate cropped close-up for each row.)
- **A row for each real device.** Every row has three pieces of information on the left:
  - **Position** — where the device sits in the rack, as a rack-unit range (for example `U03–U04`), or a dash if it could not be placed.
  - **Class** — the device type the model guessed, such as "Switch," "Patch Panel," or "Unidentified."
  - **Confidence** — a small coloured chip reading, for example, "82% confident." It is green when the model was fairly sure (75% and above), amber for the middle (50–74%), and red when it was unsure (below 50%). If there is no score, it reads "confidence n/a."
- **The truth control on the right of each row.** Before you answer, it shows two buttons:
  - **Correct** — press this when the model's guess is right.
  - **Not this** — press this when it is wrong. The row then asks "What is it actually?" and shows a dropdown ("Select device type…") of the possible types, plus a **Save truth** button and a **Back** button if you change your mind. You must pick a type before you can save.
- **A truth badge after you answer.** Once a device is verified, the control is replaced by a badge: a green **Confirmed**, or a red **Corrected → <type>** showing what you changed it to. Each badge has a **Change** link that reopens the control so you can redo the answer.

The list of device types you can choose from when correcting is fixed and shared with the correction picker on the Results screen, so a truth given here and a correction given there produce identical records. The types are: Switch, Patch Panel, Firewall, Router, Server, Load Balancer, Modem, Controller, Recorder, Amplifier, Gateway, PDU, PSU, and UPS.

If a non-owner somehow reaches the page, they see only the message "Ground Truth is restricted to platform owners."

## 5. The logic behind it — which devices appear, and which don't

Ground Truth is careful about what it puts in front of you. The goal is to show you real equipment worth verifying and nothing else.

**Real devices are shown — including the unidentified ones.** Every genuine device the model detected appears in the list. That very much includes devices the model labelled "Unidentified" — a device it saw but could not classify. Those are not noise; they are exactly what Ground Truth exists to fix, because a human can name what the model could not.

**Blank rack slots are hidden.** A rack scan does not only produce devices. The model also emits a row for empty and closed rack units — the blank "U01 / unit" placeholders that show up as **"Empty"** or **"Closed Unit."** These are not equipment, so there is nothing to verify about them, and they would only pad the list. Ground Truth drops them. This matches how the rest of RackTrack hides these placeholder rows on the Results view.

**The position numbers stay correct after hiding those slots.** This is a subtle but important detail. Each device is numbered by its position in the scan's raw detection list *before* the blank slots are removed. Because the numbering is fixed first and the filtering happens second, every device you see keeps its original index. That matters because the index is what the system uses to line up your verdict — and, if needed, the device's image crop — with the exact device in the underlying scan data. If the index shifted when rows were hidden, a correction could land on the wrong device; it doesn't.

**One honest question, reusing the proven path.** Ground Truth only asks about the device *type* — a fast, unambiguous decision that keeps the data clean. And when you answer, it does not invent a new way of saving; it goes through the same, already-trusted device-feedback pipeline that the Results screen's correction picker uses. So a "truth" recorded here behaves exactly like a correction made there.

## 6. Under the hood

This section is for engineers and support staff who need the exact mechanics. All paths are relative to the repository root.

**Client (`client/src/pages/GroundTruthPage.jsx`).** The page reads `rackId` from the route (`useParams`) and checks the signed-in user's role. Non-owners get a refusal message. Owners get a per-scan detail view (the component named `BrowseDetail`) for that `rackId` — there are no global "Worklist" or "Browse all scans" tabs in what the page renders. `BrowseDetail` calls `GET /api/ground-truth/scan/<rackId>`, renders the annotated scan image and one row per returned device, and for each row shows either a `TruthControl` (Correct / Not this → pick type → Save truth) or, once answered, a `TruthBadge` (Confirmed / Corrected → X, with a Change link). Because rack imagery is auth-gated and an `<img>` tag cannot send a bearer token, images are fetched as blobs through `authFetch` and handed to the tag as object URLs (the `AuthImg` helper).

**Server device list (`_gtScanDevices` in `server/app.js`).** This helper builds the normalised device list shared by all the Ground Truth read routes. For a given rack it:
1. Reads that scan's `outputs/<rackId>/device_unit_map.json`; returns `null` if the scan has no map yet.
2. Reads the scan's timestamp and the annotated overlay image (`3_units_and_devices.png`, falling back to `7_rack_all_ports.png`).
3. Loads that rack's prior device verdicts from `outputs/<rackId>/feedback.jsonl` via `_gtDeviceFeedbackMap`, where the last write for a given device index wins.
4. Maps each raw device to a normalised record — assigning its 1-based `device_index` (`i + 1`), its predicted `class_name`, `confidence`, formatted rack `position`, whether it has been `truthed`, its current `truth` verdict, and a `cropUrl`.
5. **Filters out the blank-slot rows after that numbering is done** — `.filter(d => !GT_UNIT_CLASSES.has(d.predicted_class))`, where `const GT_UNIT_CLASSES = new Set(['Empty', 'Closed Unit'])`. "Unidentified" is deliberately *not* in that set, so unidentified devices are kept. Filtering after indexing is what preserves each kept device's original `device_index`.

**Read endpoints (all owner-only, `auth.requireRole('owner')`).**
- `GET /api/ground-truth/scan/:rackId` — the full device list for one scan; this is the one the current page uses. `:rackId` is additionally tenant-scoped by the app-wide rack param guard.
- `GET /api/ground-truth/scans` — one summary row per visible scan (device count, truthed count, correct/wrong, overlay image).
- `GET /api/ground-truth/queue?limit=150` — all still-untruthed devices across visible scans, least-confident first, with platform-wide stats.
- `GET /api/ground-truth/crop/:rackId/:index` — a tight crop of one device from the original photo, made on first request with `cropBoxImage(...)` and cached to `outputs/<rackId>/gt_crops/dev<index>.png`, then streamed with a private one-hour cache header. It reads the device box from the raw map at `devices[index - 1]`, so it relies on the preserved index to fetch the right device.

(The `scans`, `queue`, and `crop` endpoints still exist and are exercised by helper components in the file, but the per-scan page an owner actually opens uses only `scan/:rackId`.)

**Rack visibility (`_gtAllowedRacks`).** Owner → all racks (`null`); `org_admin` → their org's racks; otherwise → that tenant user's racks. Today the guards are owner-only, but this logic is already role-correct, so opening Ground Truth to other roles later is essentially a guard change rather than a query rewrite.

**The write path (`POST /api/feedback/device`).** Ground Truth does not have its own save endpoint; the client's `submitTruth()` posts to this shared, `requireAuth`-guarded feedback endpoint with `{ scanId, device_index, is_correct, actual_device_class }`. That handler:
- Confirms the caller can access the rack, then loads the device from `device_unit_map.json`.
- **On a correction only:** atomically rewrites the map (setting `class_name` to the new type, stamping `class_name_source: 'user_corrected'`, and preserving the first value in `class_name_original`), so the fix shows up everywhere the scan is re-opened.
- Appends an immutable record (`feedback_type: 'device'`, original prediction, the answer, a timestamp, the device box, and the saved crop filename) to both the global `feedback.jsonl` and the per-rack `outputs/<rackId>/feedback.jsonl`.
- **On a correction only:** saves the wrong device's crop and calls `fireMemoryCorrection('devices', …)` so the active-learning memory can auto-apply the corrected label to visually similar devices on future scans.
- Refreshes the scan's canonical data (`scheduleCanonicalRefresh`) and triggers active learning.

A **confirmation** (`is_correct: true`) writes only the append-only feedback record — it does not rewrite the map, save a crop, or fire memory learning. That is expected: there is nothing to correct.

**Three independent access gates.** The route is wrapped in `OwnerRoute` in `client/src/App.jsx` (non-owners are redirected home); the page itself refuses non-owners; and the nav entry only appears for owners in `client/src/components/DesktopShell.jsx`. On the server, every Ground Truth read endpoint is `auth.requireRole('owner')`.

## 7. Edge cases and limits

- **You must open it from a scan.** The route requires a rack ID (`/ground-truth/:rackId`). There is no global "all scans" Ground Truth view in the current page.
- **A scan with no analysed devices** shows "No devices were detected in this scan." A scan whose device map hasn't been produced yet returns a not-found from the server.
- **A scan that is only empty and closed slots** will show an empty device list once those placeholders are filtered out — there is genuinely nothing to verify.
- **Confirming doesn't change your data.** Only a correction rewrites the device's stored class. A confirmation just records agreement.
- **Type only.** You can verify or fix a device's *type*. Ground Truth does not edit the device's position, port count, or other attributes — those have their own feedback flows.
- **Re-answering is allowed.** The **Change** link lets you redo a verdict; because the feedback log is append-only and last-write-wins per device index, your latest answer is the one that counts.
- **Corrections propagate; the crop and learning only fire when a crop could be made.** If the device's image crop can't be produced, the correction and its record are still saved, but the active-learning example depends on having that crop.
- **A failed image just degrades gracefully.** If the scan image can't be loaded, the page shows a "No image available" placeholder rather than a broken tag.

## 8. Real data vs. synthetic

Everything in Ground Truth is real. Nothing on this screen is mocked or filled with sample data.

| Thing on screen | Real or synthetic |
|---|---|
| The device rows (position, type, confidence) | **REAL** — straight from the model's detections on your photo. |
| The confidence chips | **REAL** — the model's own certainty for each device. |
| The annotated scan image | **REAL** — your processed rack photo. |
| A verified label ("ground truth") | **REAL** — an owner's answer about real equipment. |
| "Unidentified" devices in the list | **REAL** devices the model could not classify — surfaced on purpose so a human can name them. |
| The device image crops (under the hood) | **REAL** — cut from your original photo. |

The only things deliberately *removed* are the blank "Empty" and "Closed Unit" rack slots — and those are hidden, not faked.

## 9. Use cases

- **Cleaning up one rack's record.** Open Ground Truth for a scan you care about and verify every device in it, so that rack's inventory is fully human-checked.
- **Fixing what the model missed.** Turn "Unidentified" rows into real, named devices — the single highest-value thing a human can add.
- **Measuring how good the model really is.** Because each answer is a confirmation or a correction, Ground Truth turns "we don't know which detections are wrong" into a countable record.
- **Building training data with no extra scanning.** Every correction becomes a labelled example, gathered from a rack you already scanned, at the moment a person notices the mistake.
- **Feeding continuous improvement.** Corrections flow into the active-learning memory, so future scans of similar-looking gear can auto-apply the right label.

## 10. Common questions

**Q: Who can use Ground Truth?**
Platform owners only. Members and org admins do not see the Ground Truth link and cannot open the page — the route redirects them, the page refuses them, and the server endpoints reject them. There are three independent gates on purpose.

**Q: How do I open it?**
Scan and analyse a rack, open that rack's results, and choose **Ground Truth** from the rack's sub-navigation. It always opens against the specific scan you came from.

**Q: Why don't I see the empty or closed rack slots?**
Because they aren't equipment. A rack scan produces a row for every rack unit, including blank ones, which come through as "Empty" or "Closed Unit." There is nothing to verify about an empty slot, so Ground Truth hides those rows and shows you only real devices — exactly as the Results view does.

**Q: Then why do I still see "Unidentified" devices?**
Those are real devices the model saw but couldn't classify. They are the most valuable thing to verify, because a human can give them a name the model couldn't. Ground Truth keeps them deliberately.

**Q: What happens when I press "Correct"?**
It records that the model's guess was right for that device. It adds a confirmation to the feedback log but does not change the device's stored type — there is nothing to change.

**Q: What happens when I press "Not this"?**
You pick the real device type and press Save truth. That fixes the device's type in the scan (so it shows correctly everywhere the scan is re-opened), records the correction, saves the device's image crop, and feeds that labelled example into the model's active-learning memory.

**Q: Will my correction change what the results screen shows?**
Yes. A correction rewrites the device's class in the scan's stored data, so re-opening the scan — and the Recent Scans and pickers — reflects your corrected type. The original guess is preserved underneath as a record.

**Q: Can I change my mind after answering?**
Yes. Each verified row has a **Change** link that reopens the control. The feedback log keeps every answer, and the most recent one for a device wins.

**Q: Is the page showing me a real photo of each device?**
The page shows the whole annotated scan image at the top and text rows (position, type, confidence) for each device. RackTrack does produce a tight per-device crop under the hood — used for training and available through a crop endpoint — but the per-scan verification page itself displays the full rack image rather than a separate close-up per row.

**Q: Does confirming a device improve the model?**
Confirmations improve the *measured accuracy* — they tell us how often the model was right. It is corrections that produce new training examples. Both matter: one tells us how we're doing, the other makes us better.

**Q: Where does my answer actually go?**
Into the same device-feedback pipeline the Results screen uses: an append-only `feedback.jsonl` (both global and per-rack), the scan's stored device map (on corrections), and the active-learning memory (on corrections). It's a proven path, not a new one built just for Ground Truth.

**Q: Could Ground Truth be opened to members later?**
It's built so it could be. The rack-visibility logic on the server already scopes results by role, so opening it up would mainly be a matter of relaxing the owner gates — but as verified today, it is strictly owner-only.

---

— Ground Truth —
