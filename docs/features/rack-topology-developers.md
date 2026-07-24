# Rack Topology

**Feature Reference** · *One rack's devices and cabling in 2D and interactive 3D — real detections plus a deterministic, synthesized wiring layer.*

**Category:** Visualization — physical layout and (inferred) wiring · **Audience:** The team (assumes you know the product) · **Document date:** 24 July 2026 · Part of the RackTrack documentation set.

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

The Topology view renders a single rack from its scan: every detected device at its true U-position with its ports, and cables running between the connected ports. It offers a flat **2D elevation** and an orbitable **3D scene**, with cable-type filtering, a free-capacity heatmap, and a two-device trace.

The devices, U-positions and port state are **real** (from detection). The **cabling is synthesized** — deterministically derived from which ports the scan saw as connected — unless a curated per-rack override supplies real values. Everything renders from one JSON snapshot, `outputs/<rackId>/topology.json`, built in the background after every scan.

## 2. At a glance

| | |
|---|---|
| **Category** | Visualization — physical layout and (inferred) wiring. |
| **Who uses it** | Anyone planning, auditing or understanding a rack's layout. |
| **Where input comes from** | `scan_result.json` + `device_unit_map.json` (real) plus a synthesized inventory and cabling layer. |
| **What it outputs** | `outputs/<rackId>/topology.json` (`schema: topology.v1`), rendered as a 2D elevation and a 3D scene. |
| **Data source** | MIXED — devices/positions/ports REAL; cabling/IDs/types/lengths/AGG-CORE SYNTHETIC; curated overrides REAL. |

## 3. How it works — step by step

```
scan_result.json + device_unit_map.json   →  real devices, U-positions, connected port indices, port pixel-x
        ↓
synth.build_inventory (servicenow/synth.py)→  one inventory: real from overrides/<rackId>.json, else deterministic synth
        ↓
derive_wiring (topology_generate.py)       →  pair connected ports into cable runs (uplinks → sw↔panel → overflow)
        ↓
write_topology_snapshot                    →  outputs/<rackId>/topology.json  (schema topology.v1)
        ↓
GET /api/topology/:rackId                  →  served to the client (404 "pending" + background regen if missing)
        ↓
TopologyPage.jsx  /  TopologyScene3D.jsx   →  2D RackElevation + lazy three.js 3D scene; filter · capacity · trace
```

**Walkthrough**

1. Open Topology for a rack. `TopologyPage.jsx` fetches `GET /api/topology/:rackId`. If the snapshot doesn't exist yet the endpoint returns `404 { error: 'pending' }` and fires a background regen; the page shows a "Topology is being prepared" state with a **Retry**.
2. Toggle **2D / 3D**. The choice is persisted via `safeStorage` (`getItem`/`setItem`) so it survives reloads; the 3D scene is a `lazy()` import so three.js isn't pulled into the initial bundle.
3. Filter cables with the **All / Cat / Fiber / DAC** pills (`matchesCableType`). Filtering happens at the topology level (`filteredTopo`) so the 2D view, 3D scene and detail panel stay in agreement.
4. Toggle **Capacity** — `freePctByDevice` recolours devices green→amber→red by free-port fraction.
5. Toggle **Trace**, tap two devices — a BFS over the aggregated edge list (`aggEdges`) produces `tracePath` + hop count.
6. Select a device or a cable to populate the bottom detail panel.

## 4. Where the input comes from

- **Detected devices** — `scan_result.json` (`devices[]` with `position` like `U12`, `class`, `connected_ports`) — device class, U-position and size.
- **Per-port detection** — `outputs/<rackId>/device_unit_map.json`, loaded by `synth.load_port_detail` / `merge_port_detail` into each host's `_port_detail` (`connected_indices`, `sfp_connected_indices`, `port_global_x`).
- **Port pixel positions** — `_port_detail.port_global_x`, used by `derive_wiring`'s `port_x()` to pair by horizontal alignment.
- **Curated override (optional)** — `servicenow/overrides/<rackId>.json`, loaded by `synth.load_override`; its real values win field-by-field over synthesized ones.

## 5. What it produces (output)

- **`outputs/<rackId>/topology.json`** (`schema: topology.v1`) — `rackId`, `rackName`, `u_size`, `image`, a `devices[]` array (each with `name`, `class`, `u_position`, `u_size`, `model`, `mgmt_ip`, `in_rack`, `synthetic`, `ports[]`, `summary`), an `edges[]` array (each with `src`/`dst` `{device, port}`, `cable_id`, `cable_type`, `length`), and a `stats` block (`device_count_in_rack`, `edge_count`, `synthetic_device_count`).
- **`outputs/<rackId>/cmdb_synthesis.json`** — a sidecar log (`write_synthesis_log`) listing every device whose data was auto-generated and exactly which `_synthetic_fields` were synthesized, marked with `SYNTH_TAG = "synthetic_data=true"`.
- **In the client** — a 2D `RackElevation`, a 3D scene, a `BottomPanel` (ports/endpoints table), and a `TraceBanner` (path + hop count).

## 6. What you see on screen

- **`RackBanner`** — rack name/id, size in U, and counts of switches, patch panels, servers and cables (`topo.stats.edge_count`).
- **`RackElevation` (2D)** — numbered U slots including empties, devices coloured by `class`, per-port squares reflecting each port's `connected` flag; a port colour legend (connected RJ45, free RJ45, SFP, console, uplink/other).
- **`TopologyScene3D` (3D)** — `@react-three/fiber` `Canvas` with `@react-three/drei` (`OrbitControls`, `Text`, `QuadraticBezierLine`, `Grid`, `Environment`) and `three`; orbit/zoom, device hover cards (`HoverInfoCard`), colour-coded cable tubes. Scene palette is theme-driven (`SCENE_PALETTES`).
- **`BottomPanel`** — a ports table with cable ID, connector, type, length and the far-end device for the selected device/cable.
- **`TraceBanner`** — the traced path, hop count, and full device chain.

## 7. The logic behind it

- **Real endpoints only.** `derive_wiring` places cables only on ports whose index is in `_port_detail.connected_indices` (falling back to the integer `connected_ports` count from `scan_result.json` when specific indices are absent). No cable is ever drawn on an empty port.
- **Vertical-cord heuristic.** For each connected switch port, the chosen panel port is the one whose `port_global_x` is closest (`abs(Δx)` minimised) — cables typically run vertically, so smallest horizontal offset ≈ the straightest real run. Highest-numbered ports are treated as uplinks (`is_uplink`).
- **Deterministic fallback.** When bbox/pixel data is missing, `derive_wiring` falls back to first-N-connected order and U-distance pairing — a fixed ordering so the same scan always yields the same diagram.
- **Idempotent.** Synthesized values (`synth_mac`, `synth_ip`, `synth_serial`, model picks) come from hashing stable identifiers (`rack_id`, device name), so regeneration is byte-stable and stays consistent with the CMDB and network views, which share `synth.build_inventory`.
- **Overrides win.** `servicenow/overrides/<rackId>.json` replaces synthesized fields one-by-one; overridden devices drop the corresponding entries from `_synthetic_fields`.

## 8. Detailed technical explanation

**One inventory, three consumers.** `servicenow/synth.py`'s `build_inventory(rack_id, scan, override)` produces the single inventory dict (`switches`, `panels`, `server`, `agg_core`) that Topology, the CMDB build (`bootstrap_cmdb_full.py`) and the network view all read from, so they never diverge. Real values — device names, U-heights, port counts, connected/empty indices — come from the scan. Everything a photo can't show (`model_number` when unread, `serial_number`, `mgmt_ip`, `mac`, `os`, `port_prefix`, and all cable attributes) is synthesized deterministically and each generated device dict carries `_synthetic: True` plus a `_synthetic_fields` list. The synth marker string is `SYNTH_TAG = "synthetic_data=true"`.

**Cable derivation (`derive_wiring`, `servicenow/topology_generate.py`).** The order is fixed: (1) up to `UPLINKS_PER_SW = 4` top ports per active switch fan up to a synthesized out-of-rack aggregation switch, `AGG-CORE` (`synthesize_agg_core`); (2) remaining connected switch ports pair with connected patch-panel ports, panels ordered by U-distance and each port matched by closest `port_global_x`; (3) leftover connected switch ports overflow as extra uplinks to `AGG-CORE` until it's full; (4) anything still left stays unwired. `AGG-CORE` is sized up front to absorb the sum of connected switch ports (rounded up to the next 8, plus margin) so densely-cabled racks don't run out. Cable IDs are `C-NNNN` (counter from 200), type is `Cat6a`, lengths are short synthetic values. Note a preserved demo storyline for `RK-00A187E2` (fixed `C-0142`…`C-0145` chains) when that specific scan's device names line up.

**Snapshot writer (`write_topology_snapshot`).** Emits `topology.v1`: switches (main + SFP ports, `is_uplink` on the top two, per-port `connected`), patch panels, an optional server (with NICs and a `disks` extras block), closed-unit / unidentified placeholders to keep the U-map continuous, and `AGG-CORE` with `in_rack: false`. Edges are the derived cables. A `stats` block counts in-rack devices, edges and synthetic devices.

**Server entry point.** `scheduleTopologyRegen(rackId)` (`server/app.js` ~1966) spawns `python servicenow/topology_generate.py --rack-id <rackId>` — pure file I/O, no ServiceNow API calls, so failure is non-fatal and never blocks the scan flow. It's called after every canonical `scan_result.json` refresh and coalesces concurrent regens per rack (`_topoRegenInflight`). The read route `GET /api/topology/:rackId` (`server/app.js` ~5728) is `auth.requireAuth` + the `:rackId` ownership guard; it sets `Cache-Control: no-store`, returns `404 { error: 'pending' }` and schedules a regen when the snapshot is missing, otherwise streams the file.

**Client.** `client/src/pages/TopologyPage.jsx` fetches the snapshot and renders `RackElevation` (2D) inline and `TopologyScene3D` (`client/src/pages/TopologyScene3D.jsx`) behind a `lazy()`/`Suspense` boundary — deliberately, because eagerly importing three.js/drei would undo code-splitting across the app (see the note in `RackTopologyRoute.jsx`). Rack groups (`/results/:rackId/topology` → `RackTopologyRoute.jsx`) render a combined 3D scene (`MultiRackTopologyPage.jsx`) or side-by-side 2D elevations, plus inter-rack links from `GET /api/rack-group/:groupId/links`.

## 9. Real data vs. synthetic

| Thing on screen | Real or synthetic |
|---|---|
| Devices, classes, U-positions, sizes | **REAL** — from `scan_result.json`. |
| Port counts and connected/free state | **REAL** — from `device_unit_map.json` per-port detection. |
| Cable pairings (which port ↔ which port) | SYNTHETIC — inferred by `derive_wiring`, not network-verified. |
| Cable IDs (`C-0203`), types (`Cat6a`), lengths (`5m`) | SYNTHETIC — deterministically generated. |
| `AGG-CORE` aggregation / core uplink device | SYNTHETIC — invented uplink termination (`in_rack: false`). |
| `serial_number`, `mgmt_ip`, `mac`, `os`, `model` (when unread) | SYNTHETIC — hash-derived (`synth_mac`/`synth_ip`/`synth_serial`), flagged in `_synthetic_fields`. |
| `servicenow/overrides/<rackId>.json` values | **REAL** — replace the synthesized fields when present. |

**Important.** Cables are only ever drawn on ports the scan actually detected as connected — the endpoints are real even though the specific pairing, cable ID, type and length are best guesses. Treat the wiring as plausible placeholder cabling for planning, not verified physical or network-discovered connections, unless a curated override exists for the rack.

## 10. Use cases

- **Planning a move.** Capacity mode (`freePctByDevice`) highlights which switches have free ports before relocating hardware.
- **Understanding a rack you didn't build.** The elevation shows device placement and (inferred) wiring at a glance.
- **Tracing a run.** Trace mode's BFS over `aggEdges` walks the inferred path between two devices with a hop count.
- **Feeding downstream views.** The shared `synth.build_inventory` means Topology, the CMDB build and the network view render the same rack — get the scan right once and all three agree.

---

— Rack Topology —
