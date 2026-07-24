# Multi-Rack Scans

**Feature Reference** · *Split one pan video (or link per-rack photos) into a rack group: `multi_rack_split` → per-rack `analyze` → `rack_groups`, plus a shared-canvas combined 3D.*

**Category:** Core feature — multi-rack grouping · **Audience:** The team (assumes you know the product) · **Document date:** 24 July 2026 · Part of the RackTrack documentation set.

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

Multi-rack is a thin parent layer over the existing single-rack pipeline. A pan video is split into one best-frame per rack (`pipeline/multi_rack_split.py`), each frame runs the ordinary analyze path (its own `RK-` id, its own `outputs/<rackId>/`), and a `rack_groups` row plus `rack_group_members` rows tie the members together. Nothing in the per-rack pipeline is modified; the group is purely additive.

Two producers exist: `POST /api/analyze-video` (split a video → group) and `POST /api/rack-groups` (link already-analysed rack ids → group). The client surfaces both through `MultiRackNewPage.jsx`. Consumers are the `RackTabs` switcher on per-rack pages and `MultiRackTopologyPage.jsx`, which renders all members in one shared `@react-three/fiber` canvas.

## 2. At a glance

| | |
|---|---|
| **Category** | Core feature — multi-rack grouping (a parent record over single-rack scans). |
| **Who uses it** | Technicians surveying multiple racks; any signed-in user with a tenant. |
| **Where input comes from** | A walkaround video, or 2 per-rack photos, from `MultiRackNewPage.jsx`. |
| **What it outputs** | A `GRP-…` group id, `rack_group_members`, and a combined 3D topology view. |
| **Data source** | REAL frames; grouping, labels and inter-rack links are generated. |

## 3. How it works — step by step

```
Capture a row               →  MultiRackNewPage.jsx: one video, or two photos
        ↓
POST /api/analyze-video     →  multer upload.single('video')  (server/app.js:4036)
        ↓
split_video_racks           →  pipeline/multi_rack_split.py: sample → detect → segment
        ↓
per-rack normalize+analyze  →  computeRackId + runPipelineAnalyze on each best frame
        ↓
rackGroups.create/addMember →  rack_groups + rack_group_members  (server/lib/rack_groups.js)
        ↓
navigate /results/:id?group →  RackTabs (useGroupView) + MultiRackTopologyPage
```

**Walkthrough**

1. `client/src/pages/MultiRackNewPage.jsx` offers two modes: **One video** and **Two photos**.
2. Video mode posts `FormData` field `video` to `POST /api/analyze-video`; the handler requires a `tenantId` (else 401).
3. The worker `split_video_racks` command returns `racks[]` (position, label, best_frame_path, device_count, score).
4. Each best frame is normalised, given a rack id, analysed via the single-rack path, and added as a group member.
5. Photo mode instead calls `POST /api/analyze` per image, then `POST /api/rack-groups` with `{ rackIds: [...] }`.
6. The client navigates to `/results/<firstRackId>?group=<groupId>`; `RackTabs` and the combined topology read the group.

## 4. Where the input comes from

- **Video** — `FormData` field `video` → `POST /api/analyze-video` (`app.js:4036`, `scanLimit` + `multer upload.single('video')`).
- **Per-rack photos** — each → `POST /api/analyze` (field `image`) → `rackId`; then `POST /api/rack-groups` (`app.js:4230`, `auth.requireAuth`) with `{ rackIds }`.
- **Detections per sampled frame** — `pipeline/multi_rack_split.py` loads the device detector via `pipeline.detection.load_model` (sharing the worker's warm `_MODEL_CACHE`) at `detection.devices_conf` from `config.json`.
- **Group reads** — `GET /api/rack-group/:groupId` (`app.js:4176`), `GET /api/rack/:rackId/group` (`app.js:4194`, honours a `?group=` hint), `GET /api/rack-group/:groupId/links` (`app.js:4420`).

## 5. What it produces (output)

- **A `rack_groups` row** — `GRP-` + 12 hex upper (`rackGroups.create({ tenantId, userId, videoHash })`).
- **`rack_group_members` rows** — `(group_id, rack_id, position, label, device_count, score)`, PK `(group_id, rack_id)`.
- **Per-member rack folders** — a normal `outputs/<rackId>/` each (`device_unit_map.json`, `scan_result.json`, `scan_meta.json`, images).
- **Best-frame stills** — written by the splitter to `outputs/multi/<video_hash>/rack_N.jpg` before per-rack analysis copies them in as `original_image.jpg`.
- **Response** — `{ ok, groupId, count, durationMs, racks: [{ rackId, position, label, deviceCount, score, cached }] }`.

## 6. What you see on screen

- **`RackTabs`** (`client/src/components/RackTabs.jsx`) — numbered switcher on `ResultsPage`, `PortsPage`, `TopologyPage`; driven by `useGroupView(rackId)` (`client/src/hooks/useGroupView.js`), preserves the current sub-page across racks.
- **Combined 3D** (`client/src/pages/MultiRackTopologyPage.jsx`) — all members in one `<Canvas>` (`@react-three/fiber` + drei), laid out at `RACK_SPACING` on a shared floor, per-rack selection keyed on `rackId`.
- **Quick-jump strip** — chips (`#position`, label, rack id) that `navigate` to `/results/<rackId>/ports`.
- **Inter-rack connections panel** — rows from `/api/rack-group/:groupId/links`; fiber drawn amber (`#f2c94c`), DAC cyan/blue (`#3b82f6`).
- **`MultiRackRedirect.jsx`** — backwards-compat shim: old `/multi-rack/:groupId` → first member's `/results/<rackId>`.

## 7. The logic behind it

- **Additive parent, untouched pipeline.** Each member is a standalone `RK-` scan; `multi_rack_split.py`'s header is explicit that the single-rack pipeline is not modified. The group is metadata only.
- **Three split signals.** A new segment starts on a device-X-centroid shift (`TRANSITION_X_SHIFT_RATIO=0.25`), an HSV-histogram scene change (`VISUAL_CHANGE_THRESHOLD=0.35`, i.e. `1 − correlation`), or a run of detection-less frames. The visual signal catches two head-on racks whose mean-X never shifts.
- **Best-frame score.** `0.45·(device_count/max) + 0.35·mean_conf + 0.20·(sharpness/max)`; only the winner per segment is re-read at full res.
- **Shake rejection, with a floor.** Segments shorter than `MIN_FRAMES_PER_RACK=3` samples are dropped (and now logged); if that removes everything, the whole clip collapses to one rack.
- **Tenant-scoped, most-recent group wins.** `findGroupForRack` orders by `created_at DESC`; `isMember` lets a caller pin the exact group it just created via `?group=`.

## 8. Detailed technical explanation

**Video split.** `POST /api/analyze-video` (`server/app.js:4036`) requires `tenantId` (401 otherwise), then calls the worker `split_video_racks` (`config_path: CONFIG_PATH`) → `pipeline/multi_rack_split.py:split_video_into_racks`. It samples up to `MAX_SAMPLED_FRAMES=30` evenly-spaced frames, downscales to `MAX_ANALYSIS_WIDTH=1920`, and runs the device detector (`load_model` on `config.json`'s `models.devices_seg` = `Models/devices_seg.pt`, at `detection.devices_conf` ≈ 0.20). Each frame gets a signature (area-weighted mean device-X normalised to `[0,1]`) and an HSV-histogram fingerprint. Segmentation walks samples in order, cutting on `big_x_shift` (`>0.25`), `big_visual_jump` (`_visual_distance > 0.35`), or a detection gap. Segments below `MIN_FRAMES_PER_RACK=3` are dropped (logged to stderr); if all are dropped, the whole video is treated as one rack. Best-frame score is `0.45·(n_devices/max) + 0.35·mean_conf + 0.20·(sharpness/max_sharp)`; winners are re-read at full res and written to `outputs/multi/<video_hash>/rack_N.jpg`. Only the winning frame per segment is kept in memory at a time (the header notes 30 retained 4K frames was ~750 MB and OOM-killed the singleton worker).

**Per-rack analysis + grouping.** Back in the handler, `videoHash = SHA-256(videoBytes)[:16]` and `groupId = rackGroups.create({ tenantId, userId, videoHash })`. For each detected rack, in series: `normalizeImage(best_frame_path)` → `computeRackId(normalizedPath, rackScope(authPayload))` → `tenant.claimRack`. On a cache miss it `mkdir`s `outputs/<rackId>/`, copies the frame in as `original_image.jpg`, runs `runPipelineAnalyze`, `ensurePortCounts`, and `writeMeta`; on a hit it just records membership. `rackGroups.addMember({ groupId, rackId, position, label, deviceCount, score })` then persists the member row, and `scheduleCanonicalRefresh(rackId)` rebuilds `scan_result.json`. A member that throws is logged (`multi_rack.member_failed`) and skipped, not fatal. Response: `{ ok, groupId, count, racks }`.

**Persistence.** `server/lib/rack_groups.js` (better-sqlite3, WAL, `server/data/auth.db`) with schema created in `server/auth.js` (`app.js`/migration lines ~184–205):
`rack_groups(id PK, video_hash, tenant_id INTEGER FK tenants, created_by FK users, created_at)` and `rack_group_members(group_id FK ON DELETE CASCADE, rack_id, position, label, device_count, score, PK(group_id, rack_id))`, plus `idx_rack_group_members_rack` and `idx_rack_groups_tenant_created`. Public API: `create`, `addMember`, `get`, `listForTenant`, `findGroupForRack`, `isMember`. `GET /api/rack-group/:groupId` is tenant-scoped and returns 404 (not 403) cross-tenant.

**Two-photo path.** `MultiRackNewPage.jsx` `buildFromImages()` posts each photo to `POST /api/analyze`, guards `id1 === id2` (same rack), then `POST /api/rack-groups` with `{ rackIds: [id1, id2] }` and navigates to `/results/<id1>?group=<groupId>`. `buildFromVideo()` posts `video` to `/api/analyze-video`, requires `data.count >= 2`, and navigates to `/results/<firstRack>?group=<groupId>` (falling back to `/multi-rack/<groupId>/topology`).

**Combined 3D.** `client/src/pages/MultiRackTopologyPage.jsx` fetches `/api/rack-group/:groupId` then `/api/topology/:rackId` for each member (in parallel), computes per-rack X offsets at `RACK_SPACING` centred on origin, and renders every member inside one `<Canvas>` via a lazily-imported `RackContent` from `TopologyScene3D.jsx` (`showNeighbors={false}`). Selection state is keyed per `rackId`. Cross-rack cables come from `/api/rack-group/:groupId/links`; `_portWorldPos` resolves each endpoint to a real port on a device face (falling back to an uplink/edge port), drawn as sagging Bézier tubes — fiber `#f2c94c`, DAC `#3b82f6`.

## 9. Real data vs. synthetic

| Thing on screen | Real or synthetic |
|---|---|
| Each rack's best frame | **REAL** — chosen from your video/photos by `multi_rack_split.py`. |
| Each rack's analysis | **REAL** — identical single-rack pipeline output. |
| Group membership & "Rack N" labels | **GENERATED** — pan-order `position` + `label` in `rack_group_members`. |
| Intra-rack cabling in the combined view | **SYNTHETIC** — inferred topology, same as single-rack. |
| Inter-rack uplinks | **GENERATED** — `/api/rack-group/:groupId/links`, a realistic handful, not a mesh. |

## 10. Use cases

- **Aisle survey from one pan.** `/api/analyze-video` → `split_video_racks` → a group with a member rack per bay, each fully analysed.
- **Whole-row review in 3D.** `MultiRackTopologyPage` renders the row in a single shared scene with inter-rack links.
- **Ad-hoc two-rack pairing.** Two `/api/analyze` calls + `/api/rack-groups` link a switch stack to its uplink rack for a side-by-side view.
- **Deep-link resilience.** Old group URLs resolve through `MultiRackRedirect.jsx`; `?group=` + `isMember` pin the freshly-created group rather than an older one for the same rack.

---

— Multi-Rack Scans —
