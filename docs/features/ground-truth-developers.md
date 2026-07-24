# Ground Truth (Developer)

**Feature Reference** · *Owner-only tooling to verify what the model detected, measure accuracy, and produce labelled training data — with the real endpoints and files.*

**Category:** Owner tool — model quality · **Audience:** Engineers · **Document date:** 24 July 2026 · Part of the RackTrack documentation set. *A plain-English version is in [ground-truth-users.md](ground-truth-users.md).*

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

Ground Truth is an owner-only screen for turning the model's *guesses* into human-verified *facts*. It surfaces the devices the model was least sure about, one at a time, asks a technician to confirm or correct the device type, and records the answer. Confirmations raise the measured accuracy; corrections become labelled training data. The write path is not new — it reuses the platform's existing device-feedback pipeline — so a "truth" recorded here behaves exactly like a correction made on the results screen.

## 2. At a glance

| | |
|---|---|
| **Category** | Owner tool for measuring and improving model accuracy. |
| **Who uses it** | Platform owners today; server + client are written so it opens to other roles with a one-line change. |
| **Where input comes from** | Every rack scan the caller may see (`outputs/<rackId>/`) plus the technician's confirm/correct answers. |
| **What it outputs** | Verified labels in `feedback.jsonl`, a live accuracy score, and active-learning training examples. |
| **Data source** | REAL — model detections from real photos and a human's verified answer. |

## 3. How it works — step by step

```
Server walks outputs/<rackId>/   →  reads each device's confidence
        ↓
Drops already-truthed devices     →  by scanning each rack's feedback.jsonl
        ↓
Sorts least-confident first       →  unrecognised units (no confidence) lead
        ↓
Client shows one device           →  cropped photo + guess + confidence chip
        ↓
Confirm / correct                 →  POST /api/feedback/device (reused path)
        ↓
Map + log + AL memory update       →  scoreboard moves; correction is labelled
```

**Walkthrough**

1. The **Worklist** tab calls `GET /api/ground-truth/queue?limit=150`. The server enumerates rack directories, reads `device_unit_map.json` per rack, removes devices already in that rack's `feedback.jsonl`, sorts the rest least-confident-first, and returns them with platform-wide stats.
2. Each card fetches its crop from `GET /api/ground-truth/crop/:rackId/:index` (fetched as a blob via `authFetch`, because `<img>` can't send a Bearer token).
3. **Correct** posts `{ scanId, device_index, is_correct: true }`; **Not this → pick type → Save truth** posts `{ scanId, device_index, is_correct: false, actual_device_class }` — both to `POST /api/feedback/device`.
4. The card advances to the next queue item; stats update optimistically on the client.
5. The **Browse** tab calls `GET /api/ground-truth/scans` (per-scan progress) → `GET /api/ground-truth/scan/:rackId` (all devices in one scan), where any device can be confirmed/corrected in place.

## 4. Where the input comes from

- **`outputs/<rackId>/device_unit_map.json`** — the detected devices, their `class_name`, `confidence`, `box` and `units`.
- **`outputs/<rackId>/feedback.jsonl`** — device-type verdicts already given (`feedback_type === 'device'`), used to exclude truthed devices and compute the scoreboard.
- **`scan_meta.json`** — the scan timestamp and, indirectly, the original photo (`imagePath`) used for the crop.
- **The technician's answer** — a boolean `is_correct` plus, when false, an `actual_device_class` from `DEVICE_CLASS_OPTIONS` (14 types).

## 5. What it produces (output)

- **Verified labels** — appended to both `server/feedback.jsonl` and `outputs/<rackId>/feedback.jsonl`, each with the original prediction, the answer, a timestamp and the device crop.
- **An accuracy score** — correct/wrong/accuracy across everything reviewed, returned by the queue endpoint and mirrored in each scan's `scan_result.json` `feedback` block.
- **Active-learning examples** — a correction fires `fireMemoryCorrection('devices', crop, predicted, actual, …, orgId)` so visually similar devices auto-apply the label on future scans.
- **Cached crops** — `outputs/<rackId>/gt_crops/dev<index>.png`.

## 6. What you see on screen

- **Two tabs** — Worklist (one-at-a-time queue) and Browse scans.
- **A stats strip** — Remaining · Truthed · Model accuracy · Scans.
- **The device card** — a cropped photo, the model's guess, a confidence chip (green ≥75% / amber ≥50% / red <50%), and the scan id.
- **The answer control** — Correct / Not this → device-type `<select>` → Save truth.
- **Truth badges** (Browse) — Confirmed (green) / Corrected → *X* (red), each with a **Change** link.

## 7. The logic behind it

- **Weakest first.** Sorting by ascending confidence (unrecognised units coerced to the front) spends a technician's time where the model is least reliable.
- **Reuse, don't reinvent.** Writes go through `POST /api/feedback/device`, which already does the atomic map update, append-only log, crop capture, active-learning memory and scoreboard refresh — so there is one write path to trust, not two.
- **Defence in depth.** Every endpoint is `auth.requireRole('owner')`; the route is wrapped in `OwnerRoute`; the nav entry is hidden from non-owners. Three independent gates.
- **Future-proof visibility.** The queue already computes an allowed-rack set by role, so opening the tool to members/admins needs no query change.

## 8. Detailed technical explanation

**Server (`server/app.js`).** Four owner-only endpoints, all `auth.requireRole('owner')`:
- `GET /api/ground-truth/queue` — walks `fs.readdirSync(outputsDir)` for `RK-*`, builds each scan's device list via a helper (`_gtScanDevices`), reads device verdicts via `_gtDeviceFeedbackMap` (last-write-wins per `device_index`), filters to untruthed, sorts by `(confidence ?? -1)` ascending, slices to `limit`, and returns `{ items, truncated, stats }`.
- `GET /api/ground-truth/scans` — one row per visible scan: `deviceCount`, `truthedCount`, `correct`, `wrong`, overlay image.
- `GET /api/ground-truth/scan/:rackId` — the full device list for one scan (`:rackId` is additionally guarded by the app-wide `rackOwnershipParam`).
- `GET /api/ground-truth/crop/:rackId/:index` — validates the index, reads the device `box`, crops the original photo with `cropBoxImage(...)` into `gt_crops/dev<index>.png` (cached), and streams the PNG with `Cache-Control: private, max-age=3600`.

Rack visibility is computed by `_gtAllowedRacks(req.user)` — `owner → null` (all), `org_admin → tenant.orgRackIds(orgId)`, otherwise `tenant.tenantUserRackIds(...)` — mirroring `GET /api/scans`.

**The write path.** The client posts to `POST /api/feedback/device` (unchanged). That handler: guards access via `canAccessRack`; on a correction, atomically rewrites `device_unit_map.json` (`class_name`, preserving `class_name_original`, stamping `class_name_source: 'user_corrected'`); appends an immutable row to the global + per-rack `feedback.jsonl`; saves the wrong-crop; calls `scheduleCanonicalRefresh`; and fires `fireMemoryCorrection` into the org-scoped active-learning store. The model-vs-truth scoreboard lives in `scan_result.json`'s `feedback` block via `buildScanReportData`.

**Client (`client/src/pages/GroundTruthPage.jsx` + `.module.css`).** A single page with Worklist and Browse. An `AuthImg` component fetches crops/overlays through `authFetch` and hands the tag an object URL (revoked on unmount). Truth submits reuse a small `submitTruth()` wrapper around `POST /api/feedback/device`. Wired via `client/src/App.jsx` (route `/ground-truth` inside `OwnerRoute`), `client/src/nav/navLinks.jsx` (owner-gated entry + `GroundTruthIcon`), and `client/src/components/DesktopShell.jsx` (`PAGE_TITLE`).

**Opening it to all roles later.** Drop the `isOwner` wrap on the nav entry, swap `OwnerRoute` → `ProtectedRoute` on the route, and relax the endpoint guards from `requireRole('owner')` to `requireAuth`. The `_gtAllowedRacks` logic already scopes results per role.

## 9. Real data vs. synthetic

| Thing | Real or synthetic |
|---|---|
| Device crops + the model's guesses | **REAL** — from detections on real photos. |
| Confidence + queue order | **REAL** — the model's per-device certainty. |
| Accuracy score | **REAL** — human-verified agreement rate. |
| A verified label | **REAL** — a technician's answer. |
| "Unidentified" leaders in the queue | REAL devices the model couldn't classify (`source: synthetic_unidentified` in the map) — surfaced on purpose. |

## 10. Use cases

- **Measuring the real error rate** — turn "we don't know which detections are wrong" into a queue a human clears and a number you can watch.
- **Building a training set with no new scanning** — every correction is a labelled example from racks you already have.
- **Per-rack clean-up** — Browse to one scan and verify every device in it.

---

— Ground Truth (Developer) —
