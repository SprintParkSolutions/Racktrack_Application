# Port History & Drift

**Feature Reference** · *A live change-log for a monitored switch — SSH-polled snapshots diffed into per-port drift events.*

**Category:** Live network data — continuous telemetry · **Audience:** The team (assumes you know the product) · **Document date:** 24 July 2026 · Part of the RackTrack documentation set.

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

A server-side poller SSHes into every enabled `monitored_devices` switch on an interval, parses each interface, and feeds it to `writePoll`, which diffs against the last snapshot and stores a new snapshot **plus one `port_events` row per changed field** — but only when something changed. The client (`client/src/pages/PortHistoryPage.jsx`, embedded as the "Drift" tab on `ResultsPage` via `PortHistoryContent`) renders the current grid, a stacked-bar timeline, a "value at" offset table, and a humanised change log.

Server pieces: `server/lib/port_poller.js` (the scheduler + SSH + parse), `server/lib/port_history_db.js` (the SQLite store in `auth.db`), and `server/port_history.js` (the `/api/ports/*` router). Parsers are `server/lib/cisco_parser.js` and `server/lib/tplink_parser.js`.

## 2. At a glance

| | |
|---|---|
| **Category** | Live network data — continuous telemetry. |
| **Who uses it** | Engineers investigating drift, flaps and re-cabling. |
| **Where input comes from** | `port_poller.js` SSH-polling `monitored_devices` on `PORT_POLL_INTERVAL_MS`. |
| **What it outputs** | `port_snapshots` (event-sourced), `port_events` (drift), served over `/api/ports/*`. |
| **Data source** | REAL / LIVE — continuous SSH telemetry stored in `server/data/auth.db`. |

## 3. How it works — step by step

```
port_poller.start({ intervalMs, sshRunner })    (app.js:9408, hourly default)
        ↓
pollAll() → dueDevices() (enabled, not in backoff) → runWithConcurrency(4)
        ↓
pollDevice → SSH via runSwitchCommandsSequential → recipe.parse(outputs)
        ↓
writePoll(deviceId, row, ts)  →  diff vs latestSnapshot  →  snapshot + events (on change only)
        ↓
client: GET /api/ports/devices → /overview → /:port/history + /:port/timeline
```

**Walkthrough**

1. `app.js` boots the poller: `portPoller.start({ intervalMs: PORT_POLL_INTERVAL_MS || 3_600_000, sshRunner: runSwitchCommandsSequential })` (`app.js:9401`). An immediate `pollAll()` fires so the first snapshot doesn't wait a full interval.
2. `pollAll` reads `dueDevices()` (enabled, `backoff_until` clear) and runs them through a bounded pool (`PORT_POLL_CONCURRENCY`, default 4). Each `pollDevice` skips if `_busy` or if a manual probe holds the host (`isManualProbeActive`).
3. `_pollDeviceInner` resolves the vendor recipe (`VENDOR_RECIPES` → `tplink` / `cisco-ios`, else `generic_recipe`), pulls creds (`ssh-creds.js`, per-host over per-vendor), runs the recipe commands over `runSwitchCommandsSequential`, and calls `recipe.parse(outputs)` → `{ rows, meta }`.
4. `updateDeviceMetadata` writes identity (`show system-info` / `show version`); each row goes through `writePoll`, which diffs and persists.
5. The client loads `GET /api/ports/devices`, auto-selects the device, polls `GET /api/ports/:id/overview` every 15 s, and on port select polls `/:id/:port/history` (15 s) and `/:id/:port/timeline?window=` (20 s).
6. **Poll now** posts `/api/ports/:id/poll` (owner/org_admin only, rate-limited).

## 4. Where the input comes from

- **Per-vendor SSH recipes** (`port_poller.js` `VENDOR_RECIPES`):
  - `tplink`: `show system-info`, `show interface status`, `show interface configuration`, `show lldp neighbor-information`.
  - `cisco-ios`: `show version`, `show interfaces status`, `show running-config | section interface`, `show lldp neighbors detail`.
  - Parsed by `tplink_parser.js` / `cisco_parser.js` (`parseInterfaceStatus`, `parseInterfaceConfiguration`, `parseLldpNeighbors`, `parseSystemInfo`, `mergePortRows`).
- **`monitored_devices`** (in `auth.db`): `host`, `ssh_port`, `vendor`, `enabled`, identity columns (`system_name`, `model`, `serial`, `sw_version`, `mac`, …), robustness columns (`consecutive_failures`, `backoff_until`, `last_error`, `last_polled_at`), and `tenant_id`.
- **The window** — `?window=<sec>` on `/timeline` (clamped 60 s … 7 days), and the fixed offset set `1h/3h/12h/1d/1w` in `/history`.
- **The SSH runner** — injected as `runSwitchCommandsSequential` (`app.js:5878`), the same host-locked, reconnecting console path the live Ports view uses.

## 5. What it produces (output)

- **`port_snapshots`** (event-sourced: written only on change) — `device_id, port, ts, oper, admin, speed_mbps, duplex, flowctrl, medium, descr, lldp_chassis, lldp_port, lldp_system`.
- **`port_events`** — `device_id, port, field, from_val, to_val, at`, one row per changed `TRACKED_FIELDS` value.
- **API shapes:**
  - `GET /api/ports/devices` → `{ devices: [toClientView] }` (host/ssh_port stripped; `display_name`, `enabled`, identity, `last_polled_at`, `backoff_until`).
  - `GET /api/ports/:id/overview` → `{ device, ports: latestSnapshotsForDevice(id) }`.
  - `GET /api/ports/:id/:port/history` → `{ current, offsets:{1h,3h,12h,1d,1w}, events }` — offsets use `MAX(ts) WHERE ts <= now-N`.
  - `GET /api/ports/:id/:port/timeline?window=` → `{ start_at, end_at, initial, snapshots }`.
  - `POST /api/ports/:id/poll` → `{ ok, device }` (or 429 / 409).

## 6. What you see on screen

- **Switch hero** — `device.display_name`, Streaming/Paused from `device.enabled`, `model`/`serial`/`sw_version` chips, `Poll now` (`triggerPoll` → `/poll`).
- **Interface grid** — `overview.ports` sorted by trailing port index, coloured by `operClass(p.oper)`, `portDisabled` when `admin === 'disabled'`, active cell highlighted.
- **`InterfaceDetail` bottom sheet** — Specs / Timeline / History tabs:
  - **Specs** — `KV` grid of `current` (oper, admin, speed, duplex, flowctrl, medium, MAC, descr, last change, last poll).
  - **Timeline** — `StackedTimeline`: five `TIMELINE_BARS` (Administrative State, Flow Control, Operational Status, Speed, LLDP Neighbor); `buildSegments` collapses adjacent equal values; LLDP names get a stable `hashColor`.
  - **History** — `dedupedOffsets` "value at" table + `humanizeEvent`-rendered change log with raw `field ∅→∅` and `fmtAgo` timestamps.

## 7. The logic behind it

- **Only real changes.** `writePollTxn` diffs `TRACKED_FIELDS` (`oper, admin, speed_mbps, duplex, flowctrl, medium, descr?, lldp_chassis, lldp_port, lldp_system`) via `normForCompare`; if `prev` exists and nothing differs it returns early — no snapshot, no events. `descr` tracking is on by default (`PORT_DRIFT_TRACK_DESCR=0` mutes it).
- **Event-sourced snapshots.** Snapshots are written only on change, so "state N ago" is answered by `snapshotAt` (`MAX(ts) WHERE ts <= T`) — one stored row can legitimately back all five offset lookups, which is why `dedupedOffsets` collapses identical rows in the UI.
- **Neighbour colour = re-cable signal.** `lldp_system` changes are their own tracked field, and the timeline bar hashes the name to a stable colour so a reroute is a visible seam.
- **Sparse-by-design.** A first-seen switch has no prior snapshot; the UI says the poller runs on a schedule and history accrues, rather than implying a fault.

## 8. Detailed technical explanation

**Cadence.** `DEFAULT_INTERVAL_MS = 3_600_000` (1 hour), overridable via `PORT_POLL_INTERVAL_MS`. The code comment is explicit that the old 60 s default was harmful: TP-Link JetStream / IOL switches allow **one** SSH session and don't release it promptly on TCP drop, so minute-polling starved interactive probes and audits. Note a UI copy lag — `PortHistoryPage.jsx`'s empty-state still reads "The poller runs once per minute"; the server default is hourly. Manual `Poll now` and the live Ports/audit paths cover the need for fresh reads between passes.

**Robustness.** Failures go through `recordPollFailure` → exponential backoff (`BASE_BACKOFF_MS` 60 s doubling to `MAX_BACKOFF_MS` 30 min); `dueDevices()` filters on `backoff_until`. `port_poller.start()` calls `clearAllBackoff()` on every boot to wipe stale dead-state from a crashed prior process. `noteManualProbe(host)` / `isManualProbeActive` let the poller yield the single SSH session to an interactive probe for a 60 s cooldown. A retention sweep (`_retentionTick`, hourly) prunes `port_events` older than `PORT_DRIFT_EVENT_DAYS` (30) and superseded `port_snapshots` older than `PORT_DRIFT_SNAPSHOT_DAYS` (90), never dropping the latest-per-port baseline. `stop()` drains in-flight polls (10 s ceiling) so sessions close cleanly.

**Storage & tenancy.** `port_history_db.js` opens `server/data/auth.db` (override `RACKTRACK_AUTH_DB`), WAL mode, and owns `monitored_devices` / `port_snapshots` / `port_events`. `monitored_devices` gained a `tenant_id` column: previously `router.use('/api/ports', requireAuth)` was the only gate, so any member could enumerate every tenant's switch fleet and force SSH into it. Now every read is scoped — `scopeOf(req)` → `tenant.visibleTenantIds(req.user)` (null = owner sees all; `[]` matches nothing; `tenant_id IS NULL` rows are owner-only). The one-shot backfill assigns existing rows to the single real Site if there is exactly one, else `PORT_DEVICES_TENANT_ID`, else leaves them owner-only. `toClientView` strips `host`/`ssh_port` — the client works off `id` + `display_name`.

**Access split.** Listing / overview / history / timeline are member-facing (`requireAuth` + scope) so Drift works for normal users. `POST /:id/poll` additionally requires `auth.requireRole('owner','org_admin')` (it makes the server SSH on demand), is rate-limited to 5/min per `(userId|ip, deviceId)` (429), and returns 409 if `poller.isBusy(id)`. `POST /api/lab/devices/:id/audit` (owner-only) runs the full one-pass audit addressed by device id, resolving host/creds server-side. Auto-seeding a bench host is opt-in (`RACKTRACK_AUTOSEED=1` + `TPLINK_BENCH_HOST`).

## 9. Real data vs. synthetic

| Thing on screen | Real or synthetic |
|---|---|
| Port state over time | **REAL / LIVE** — SSH-polled snapshots in `port_snapshots`. |
| Change events | **REAL** — `port_events`, written only on a real field diff. |
| Neighbour changes | **REAL** — `lldp_system`/`lldp_chassis`/`lldp_port` tracked; colour flags re-cabling. |
| Sparse early history | Expected — snapshots accrue only as the poller runs. |
| "Once per minute" empty-state copy | Stale UI text — the server default is hourly (`PORT_POLL_INTERVAL_MS`). |

## 10. Use cases

- **Chasing a flapping link.** `port_events` on `oper` pinpoint every down→up transition with timestamps.
- **Detecting re-cabling.** An `lldp_system` change (visible as a timeline colour seam) shows a moved cable and when.
- **Confirming a speed problem.** A `speed_mbps` event (`humanizeEvent` → "Speed changed 1 → 10 Gbps") dates a renegotiation.
- **Auditing a change window.** The `/timeline?window=` day/week views draw entirely from stored history — no live re-read.

---

— Port History & Drift —
