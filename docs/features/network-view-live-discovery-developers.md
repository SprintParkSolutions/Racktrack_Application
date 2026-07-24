# Network View (Live Discovery)

**Feature Reference** · *The one rack view backed by genuine live network telemetry — a proxy over a local Netdisco stack, joined to the scan.*

**Category:** Live network data — authoritative connectivity · **Audience:** The team (assumes you know the product) · **Document date:** 24 July 2026 · Part of the RackTrack documentation set.

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

Network View joins a RackTrack scan to a live **Netdisco** deployment and shows real port up/down, VLANs, LLDP/CDP neighbours, and learned-MAC counts per port — plus a network-wide MAC lookup. It is the only rack view whose connectivity is read from network discovery rather than inferred from the photo.

The client is `client/src/pages/NetdiscoPage.jsx` (`NetdiscoContent` embeds it as the "Network" tab on `ResultsPage`). The server is `server/netdisco_proxy.js`, mounted at `/api/netdisco/*`, sitting in front of the Docker stack in `netdisco-docker/`. All device/port data flows through the proxy so the UI never touches Netdisco's api-key login or legacy endpoint shapes directly.

## 2. At a glance

| | |
|---|---|
| **Category** | Live network data — authoritative connectivity via Netdisco. |
| **Who uses it** | Engineers verifying live connectivity and hunting endpoints. |
| **Where input comes from** | Netdisco discovery (`NETDISCO_URL`, default `http://localhost:5000`), joined to `device_unit_map.json`. |
| **What it outputs** | Per-device cards, per-port tables grouped by VLAN, and a network-wide MAC report. |
| **Data source** | REAL / LIVE — from Netdisco's datastore, not the scan or synthesised wiring. |

## 3. How it works — step by step

```
GET /api/netdisco/health          →  HealthPill: online / offline / checking
        ↓
GET /api/netdisco/scan/:rackId/match  →  join scan devices ↔ Netdisco devices (+ port stats)
        ↓
expand a card → GET /api/netdisco/devices/:ip/ports   (lazy, cached per IP)
        ↓
PortTable groups by VLAN (Untagged bucket last); filter Live/Up/Down/All
        ↓
click a learned-MAC count → GET /api/netdisco/mac/:mac  →  sightings + IP history
```

**Walkthrough**

1. `NetdiscoInner` fires `GET /api/netdisco/health` (unauthenticated, so the page can render a "down" state) → `HealthPill`.
2. `fetchMatch` calls `GET /api/netdisco/scan/:rackId/match`. It parses defensively (Netdisco can return an empty body on cold start) and routes protocol noise (`ECONNREFUSED`, tracebacks, `JSONDecodeError`, bare status codes) through `looksLikeNetdiscoNoise` into the friendly offline banner rather than the UI.
3. The match list renders one `DeviceItem` per scan device, with `Patch Panel` classes filtered out client-side (`isPatchPanelLabel` / `m.scan.class_name !== 'Patch Panel'`).
4. `togglePorts(ip)` lazy-loads `GET /api/netdisco/devices/:ip/ports` on first expand and caches it in `portsByIp`.
5. `PortTable` groups ports by VLAN (numeric order, `__none__` → "Untagged" last) and filters by Live / Up / Down / All. `isUp` accepts `true`/`1`/`t`/`up`.
6. A port's `active_mac_count` chip calls `onMacClick(mac)` → `runMacLookup` → `GET /api/netdisco/mac/:mac`.

## 4. Where the input comes from

- **The scan map** — `outputs/<rackId>/device_unit_map.json`. The match route filters `devices` to `['Switch','Patch Panel','Firewall','Gateway','Router']`.
- **Netdisco inventory** — `ndGet('/api/v1/search/device?q=%25')` in `netdisco_proxy.js`, indexed by IP, model, and name (`dns`/`name`).
- **Override IPs** — `servicenow/overrides/<rackId>.json` (`switches[name].mgmt_ip`) give the highest-confidence match.
- **Netdisco config (env, `server/.env`)** — `NETDISCO_URL` (default `http://localhost:5000`), `NETDISCO_USER` / `NETDISCO_PASSWORD` (default `admin`/`admin`; a production warning fires if left at defaults). The proxy caches the `api_key` from `/login` in memory and refreshes on 401 (`getApiKey` / `ndGet`).
- **The Docker stack** — `netdisco-docker/` (`compose.yaml`, services `netdisco-web` / `netdisco-backend` / `netdisco-postgresql`), with Python helpers `netdisco.py`, `info_ip.py`, `port_info_mac.py`, `seed_netdisco.py`, `push_rack_to_netdisco.py`.

## 5. What it produces (output)

- **`/scan/:rackId/match`** — `{ rackId, netdisco_reachable, netdisco_device_count, scan_device_count, matched_count, matches[] }`. Each match carries `scan` (`index`, `class_name`, `units`, `cmdb_name`, `port_count`, `connected_count`) and `netdisco` (`ip`, `name`, `model`, `vendor`, `os`, `stats:{ total, up, down, connected }`) or `null`.
- **`/devices/:ip/ports`** — `{ count, ports[] }`, each port `{ port, name, descr, type, speed, duplex, vlan, up_admin, up, mac, neighbor:{ remote_device, remote_port, remote_ip, remote_type, protocol }|null, active_mac_count, learned_macs[] }`. `neighbor` is present when any of `remote_id`/`remote_ip`/`remote_port` is set; `remote_device` is resolved via `dns`/`name` → chassis-id map → IP map.
- **`/mac/:mac`** — `{ mac, sighting_count, ip_count, current:{ switch, port, vlan, time_last, active }, sightings[], ips[] }`.
- **`/health`** — `{ ok, url, authenticated, status }`.

## 6. What you see on screen

- **`HealthPill`** — "Network View online / offline / checking…" from `/health`.
- **Match summary** — `match.matched_count` "live".
- **`DeviceItem`** cards — `cmdb_name`, `class_name`, `deviceModelText(netdisco)`, IP; dimmed (`nvItemDim`) with "not in Network View" when `m.netdisco` is null; a ports-up bar (`up/total`) and `connected` link count.
- **`PortTable`** — filter buttons Live/Up/Down/All with counts; per-VLAN groups; each row shows name/port, a clickable `N MAC` button (only when `active_mac_count > 0`), and an up/down chip with a `stateLabel(up, up_admin)` tooltip.
- **Offline / empty states** — `netdisco_reachable === false` → "being prepared" banner; reachable-but-empty → "No switches detected".

## 7. The logic behind it

- **Authoritative state** — port up/down, VLANs and neighbours come from Netdisco, making this the one verified-connectivity rack view.
- **Patch panels omitted** — passive gear has no MAC/agent and never appears as an LLDP/CDP neighbour, so `isPatchPanelLabel` and the `class_name !== 'Patch Panel'` filter keep the neighbour column semantically honest.
- **Neighbours already on the port object** — Netdisco's `/ports` response carries `remote_id`/`remote_ip`/`remote_port`, so no separate `/neighbors` call is made (that endpoint returns a graph-viz blob, not a per-port array).
- **Lazy + cached** — port detail is fetched per IP on expand and memoised in `portsByIp`, so a rack of switches stays fast.
- **Fail-soft** — every proxy handler is wrapped in `safeAsync`; Netdisco-unreachable returns a clean `{ netdisco_reachable: false }` rather than a 5xx into the UI.

## 8. Detailed technical explanation

**Auth & scoping.** `GET /api/netdisco/health` is intentionally unauthenticated. Everything else is gated by `router.use('/api/netdisco', auth.requireAuth)`. Crucially, `router.param('rackId', rackOwnershipParam({ tenant, logger }))` is registered *on this router* — `app.param('rackId')` in `app.js` does **not** propagate to mounted routers, and an audit once found `/scan/:rackId/match` authenticated but unscoped (any signed-in user could name another org's rack id and read its scan directory). The shared guard also shape-validates `rackId` before it reaches `path.join`.

**Matching (`/scan/:rackId/match`).** For each scan device it builds a canonical CMDB name from the unit (`U06`, prefix `SW-`/`PP-`/`SRV-`) and matches in order: (1) `overrideIps[cmdbName]` → `ndByIp`; (2) `ndByName[cmdbName]` (the push script writes CMDB names into Netdisco's `dns`/`name`); (3) fuzzy `d.ocr_model` ↔ `ndByModel`. Port stats for matched devices are fetched in parallel (`/object/device/:ip/ports`) and reduced to `{ total, up, down, connected }`.

**Seeding & push.** `push_rack_to_netdisco.py` writes a scan's devices/ports/edges into Netdisco's Postgres (env `NETDISCO_DB_*`, default db `netdisco`). `runPushScript` spawns it with `--rack-id <id> --json` (60 s timeout); `scheduleNetdiscoSync(rackId, 1500)` debounces a background push and is exposed as `router.scheduleNetdiscoSync` so `server/app.js` fires it after every successful scan (same pattern as topology regen). A manual `POST /api/netdisco/sync/:rackId` backs the "Sync to Netdisco" button. On seed, each port's `up` mirrors the scan's connected/empty detection until real polling refreshes it; edges are written bidirectionally.

**MAC report (`/mac/:mac`).** Queries `/search/node` and `/search/nodeip` (`archive=true&stamps=true`), expands bare-string results via `/object/node`, sorts by `time_last` desc, and reports the active-or-latest sighting as `current`. Mirrors `netdisco.py::report_mac` + `port_info_mac.py`.

**Deployment note.** Netdisco runs as the local Docker stack in `netdisco-docker/`; `netdisco-demo`/`seed_netdisco.py` can populate a demonstration fabric. The proxy is agnostic — it renders whatever the datastore holds, real or seeded.

## 9. Real data vs. synthetic

| Thing on screen | Real or synthetic |
|---|---|
| Port up/down state | **REAL / LIVE** — from Netdisco `/ports`. |
| VLANs, LLDP/CDP neighbours | **REAL / LIVE** — from Netdisco. |
| Learned-MAC counts & lookup | **REAL / LIVE** — from Netdisco `/nodes` + `/search/node`. |
| Device match to the rack | **REAL** — scan device joined by IP / CMDB name / model. |
| Seeded demo fabric (`seed_netdisco.py`) | Demonstration data; real discovery replaces it when connected. |
| Freshly-pushed port up/down | Initially the scan's connected/empty detection, until Netdisco polling refreshes it. |

## 10. Use cases

- **Confirming a link is really up.** `/ports` `up` state is independent of the photo.
- **Finding an endpoint.** `/mac/:mac` returns the switch + port a MAC is learned behind, network-wide.
- **Verifying a VLAN.** The per-VLAN grouping in `PortTable` confirms a port's VLAN membership.
- **Post-scan validation.** The auto `scheduleNetdiscoSync` means a fresh rack appears in discovery and can be checked immediately.

---

— Network View (Live Discovery) —
