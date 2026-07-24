# Available Ports

**Feature Reference** · *How many switch ports are free right now — copper and fiber, read live over SSH from the real switch.*

**Category:** Live switch data — reads the real device, not the photo · **Audience:** The team (assumes you know the product) · **Document date:** 24 July 2026 · Part of the RackTrack documentation set.

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

Every other view renders what the photo showed. This one SSHes into the actual switch and reads its interface table live, then tells you how many ports are free — split into copper (Ethernet) and fiber (SFP) — plus a utilisation bar and a full per-port inventory. The live read is cached in `localStorage` so the view re-opens instantly and re-probes in the background.

It is served by `client/src/pages/PortsPage.jsx` on top of a singleton probe (`client/src/utils/portsProbe.js`), which drives the switch through the same SSH console plumbing in `server/app.js` that every other switch feature uses. A companion single-port drill-in (`POST /api/select`) re-reads one port against the cached photo and produces the `5_`/`6_` port artifacts.

## 2. At a glance

| | |
|---|---|
| **Category** | Live switch data — reads the real device over SSH, not the photo. |
| **Who uses it** | Any technician planning a patch or checking a switch's spare capacity. |
| **Where input comes from** | A live SSH session to the switch's management host (`show interface status`, plus a full audit pass). |
| **What it outputs** | Availability summary, ETH/SFP split, utilisation bar, faceplate, per-port inventory, cables + ping. |
| **Data source** | REAL / LIVE — SSH-read from the switch; cached in `localStorage` (`racktrack:portsProbe`). |

## 3. How it works — step by step

```
PortsPage mounts → triggerBackgroundProbe({force:true})   (portsProbe.js)
        ↓
resolve host: state.host → GET /api/switch/default-host (last_host) → 192.168.1.33
        ↓
POST /api/switch/console/run  { command:'show interface status', vendor:'tplink' }
        ↓
parseInterfaceStatusTable() → [{ iface, status, medium, description }]
        ↓
POST /api/switch/audit → { identity, ifstatus, ifconfig, poe, vlans, neighbors, macs }
        ↓
classifyPorts() → { rj45, sfp } ; logicalVerdict() per row → available/used/reserved
        ↓
render: IdentityCard · stats · FaceplateMap · filter pills · PortGroup list · Cables · Ping
```

**Walkthrough**

1. `PortsPage` / `PortsContent` mount and call `subscribeProbe(setProbe)` + `triggerBackgroundProbe({ force: true })`. The probe state machine is `idle → running → ok | error`.
2. `triggerBackgroundProbe` builds an ordered host candidate list — the session's last-good `state.host`, then `GET /api/switch/default-host`'s `last_host`, then the in-office fallback `192.168.1.33` (never the gateway) — and tries each with a 10 s per-attempt timeout under a 38 s watchdog.
3. For each candidate it `POST`s `/api/switch/console/run` with `{ host, command: 'show interface status', vendor: 'tplink', timeoutMs }`; `parseInterfaceStatusTable` turns the reply into `{ iface, status, medium, description }` rows and the first non-empty result wins and is cached.
4. `LogicalView` then `POST`s `/api/switch/audit` (up to 4 retries, since the switch allows ~1 SSH session) for identity, per-port status, PoE, VLANs, LLDP/CDP neighbours and the MAC table, and joins them onto the port rows by port-number key.
5. `classifyPorts` splits ETH vs SFP; `logicalVerdict` assigns each row `available` / `used` / `reserved`; the summary, faceplate, filters and grouped list render.
6. On failure, `friendlyProbeError` maps the raw ssh2 error to an actionable message and a **Retry** re-runs `triggerBackgroundProbe({ force: true })`.

## 4. Where the input comes from

- **`show interface status`** — the live interface table, run via `POST /api/switch/console/run` (`server/app.js:6742`). Parsed client-side by `parseInterfaceStatusTable` (`portsProbe.js`), which strips paging prompts (`Press any key to continue`, `--More--`) and reads `iface`, `status`, `medium` and `description`.
- **The audit pass** — `POST /api/switch/audit` (`server/app.js:7519`) runs `auditSwitchHost` (`app.js:7352`): short reads (`sysinfo`, `ifstatus`, `ifconfig`, `poe`, `vlan`) batched on one shell, plus `lldp`, `mac`, and `cdp`. Returns `{ identity, ifstatus, ifconfig, poe, vlans, neighbors, macs }`.
- **Host resolution** — `GET /api/switch/default-host` (`app.js:6590`) returns `{ suggested, last_host, gateway }`; `last_host` is the caller's most recent successful SSH host, persisted per user under `server/data/last-hosts/<userId>.txt` by `writeLastHost` after any successful console run.
- **The scan** — `GET /api/scan/:rackId/result` supplies `scan.devices[].port_count` / `sfp_ports`, used only as the last-resort ETH/SFP split hint in `classifyPorts`.
- **MAC vendor lookup** — `POST /api/oui/lookup` (`app.js:6577`) resolves OUI prefixes to vendor names from `server/data/oui-vendors.json` for the downstream-device list in the Cables view.

## 5. What it produces (output)

- **Availability summary** — `availableCount` of `totalPorts`, split into `availEth` / `availSfp`, with `utilizationPct = used ÷ total`.
- **Faceplate map** — one cell per port, state `up` / `uplink` (MAC count > 1) / `down`, ETH and SFP in separate rows.
- **Per-port inventory** — `PortGroup` → `PortCard` rows: zero-padded number, full iface, resolved endpoint (LLDP name / MAC / uplink), VLAN, medium, Up/Down, and verdict.
- **Cables view** — `deriveCables` builds one row per live port with an LLDP neighbour or a known MAC; `CableTrace` expands to a switch → endpoint hop, with the full downstream MAC list (OUI-labelled) for uplinks.
- **Ping tool** — `ReachabilityTool` runs `POST /api/switch/trace` (`app.js:7574`, ping only for the read-only TP-Link account).
- **Cached probe** — `state` persisted to `localStorage` key `racktrack:portsProbe` when `status === 'ok'`.

## 6. What you see on screen

- **`IdentityCard`** — model, firmware, uptime, mgmt IP, MAC, and live PoE draw (`used / budget W`), with a "live" dot.
- **Stats strip** — In use (`used / all`), Available, Identified (`neighbor.found` count).
- **`FaceplateMap`** — coloured front panel; ETH zone + SFP zone.
- **`FilterPill` row** — All / In Use / Available / Linked / Errors (Errors rendered only when `counts.reserved > 0`), each with a live count.
- **View tabs** — Ports / Cables / Ping (`ReachabilityTool`).
- **`PoeVlanAside`** — powered PoE ports (W per port) and VLAN membership beside the port list.
- **`OrbitalLoader`** — elapsed-seconds spinner while `status` is `running`/`idle`; `errorBox` + Retry on `error`.

## 7. The logic behind it

`logicalVerdict(row)` in `portsProbe.js` is the single source of truth:

- **used** — `status` matches `/(linkup|connected|^up$)/i`.
- **reserved** — `status` matches `/(err|disable|shutdown|admin)/i`, **or** the link is down but `description` is non-empty (intentionally held).
- **available** — down and no description.

- **Reserved never counts as capacity** — the availability badge counts only `available`.
- **Medium classification, best-signal-first** (`classifyPorts`): the switch's `medium` column (`fiber`/`copper`) wins; else Cisco iface prefix (`Te`/`Fo`/`Hu` → SFP); else the scan's CV `port_count` / `sfp_ports` picks a split point.
- **Query the reachable host, not the "suggested" one** — the audit uses `probe.host` (known-reachable), never `default-host`'s gateway suggestion, which would aim at the wrong box.

## 8. Detailed technical explanation

**Console plumbing.** `runSwitchCommandsSequential` (`server/app.js:5878`) serialises commands on a per-host lock (`withHostLock`) with reconnect-on-drop, and calls `poller.noteManualProbe(host)` so the background `port_poller` yields the switch's single SSH session to the interactive request for a cooldown window. `runSwitchCommand` (single command) auto-advances the pager, which is why `auditSwitchHost` routes the long `lldp`/`mac`/`cdp` reads through it rather than the batched shell (the sequential shell truncates paginated output). Vendor behaviour comes from `VENDORS` / `AUDIT_CMDS` / `LLDP_ALL_CMD` / `MAC_TABLE_CMD` / `CDP_ALL_CMD` tables in `app.js`; `parseInterfaceStatusFor` / `parseIdentityFor` delegate to `server/lib/cisco_parser.js` for `cisco-ios` and TP-Link parsing lives in `server/lib/tplink_parser.js` (`parseInterfaceStatus`, `parseInterfaceConfiguration`, `parseSystemInfo`, `parseLldpNeighbors`, `mergePortRows`).

**Credentials.** `resolveSwitchCreds(req.body)` fills username/password/enablePassword from the request or the encrypted store (`server/lib/ssh-creds.js`); the read-only account is why the Ping tool exposes `ping` but not `tracert` (which needs a higher privilege on TP-Link).

**The single-port dashboard — `POST /api/select`** (`server/app.js:3538`). Body `{ scanId, device_index, port, port_category }`. `port_category ∈ {main, sfp, console, other}` (default `main`). The route is body-scoped, so it shape-validates `scanId` against `/^RK-[A-Za-z0-9]{4,32}$/` and calls `canAccessRack` manually (the `app.param('rackId')` guard only fires on path params). It resolves the cached image (`scan_meta.json` `imagePath`, else `outputs/<rackId>/original_image.{jpg,jpeg,png}`), applies any stored port-number shift (`_latestPortShift`) so a user's corrected numbering maps to the raw pipeline port, then runs `runPipelineSelect(imagePath, rackDir, device_index, rawPort, portCategory, orgId, targetCount, appliedShift)`.

**Port artifacts (`5_`/`6_`).** The pipeline writes `outputs/<rackId>/selected_port_info.json` and two renders — `5_selected_device_with_port.png` (device close-up, port marked) and `6_full_rack_selected_port.png` (full rack, port highlighted), resolved via `rackImagePath` under `images/`. `/api/select` copies them into `outputs/<rackId>/ports/` as `d<idx>_p<port>_device.png` / `_full.png`, appends a row to `port_identifications.jsonl`, and returns `{ resultImageUrl: 5_…, rackImageUrl: 6_…, portInfo, portClassification, timings }`. An unmeasured status is displayed as `empty` (conservative), with the honest value preserved on `portInfo.occupancy_source` / `status_measured`. Stored cable-colour corrections for that port location are re-applied, and `scheduleCanonicalRefresh(rackId)` regenerates `scan_result.json`.

## 9. Real data vs. synthetic

| Thing on screen | Real or synthetic |
|---|---|
| Port up/down / in-use state | **REAL / LIVE** — from `show interface status`. |
| ETH vs SFP classification | **REAL** — from the switch `medium` / iface naming, else the scan's CV port count. |
| Identity, PoE, VLANs, neighbours, MACs | **REAL / LIVE** — from the `/api/switch/audit` pass. |
| Cached last-known state | **REAL** — the previous live probe (`localStorage:racktrack:portsProbe`). |
| Fallback host `192.168.1.33` | Used only when no `last_host` is remembered for the caller. |
| Single-port cable colour/type (`/api/select`) | **REAL** — CV-read from the photo, overridable by stored feedback. |

## 10. Use cases

- **Planning a patch.** Confirm a free copper port and its exact iface name before running a cable.
- **Capacity check.** The utilisation bar surfaces a nearly-full switch before a port is promised.
- **Spotting reserved ports.** The Errors filter reveals down-on-purpose ports so they aren't counted as spare.
- **Tracing connectivity.** The Cables view resolves each live port to its LLDP neighbour / downstream MACs, OUI-labelled, straight from the switch.

---

— Available Ports —
