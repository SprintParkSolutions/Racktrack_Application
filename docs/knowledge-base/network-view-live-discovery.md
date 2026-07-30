# Network View & Live Discovery

*The one rack view that stops guessing from a photo and reads the network's own truth — real ports, VLANs, and learned MACs, joined to the rack you scanned.*

Feature · Operators/admins · Last verified: 26 July 2026 against the live code.

---

## 1. In simple terms

Most of RackTrack works out what is in a rack by looking at a photo. It sees a cable in a port and concludes "that port is used". That is a very good guess, but it is still a guess made from a picture.

**Network View is the exception.** Instead of reading a photo, it asks the network itself. It talks to a live network-discovery system (Netdisco) that is actually watching the switches on the wire, and it lines that live information up against the rack you scanned. So instead of "the photo shows something plugged into port 12", you get "port 12 is genuinely up right now, and this many MAC addresses have been learned behind it".

Put simply, there are two pictures of the same rack:

- **The scanned rack** — what RackTrack read from your photo (which devices are in which units, how many ports look connected).
- **What is live on the network right now** — the real, operational state that the discovery system polls from the equipment.

Network View's whole job is to place those two side by side, device by device, and let you drill into the live one. You open it on a scanned rack, it tells you how many of that rack's devices it actually found live on the network, and you can expand any device to see its real port table. This is the view you trust when you need to *know*, not infer.

A short note on wording. The screens and messages say **"Network View"**, and the friendly banners talk about the network being "prepared" — a normal operator never has to know the word "Netdisco". Under the hood, Netdisco is the discovery engine doing the work, and this document uses that name in the technical sections.

## 2. At a glance

| | |
|---|---|
| **What it is** | A live view that joins your scanned rack to a real network-discovery system and shows genuine port state per device. |
| **Who it is for** | Operators and admins verifying that a rack's switches are really up and really on the network. |
| **Where you find it** | The **Network** view for a rack — route `/results/:rackId/netdisco`. Standalone it has its own header; for a two-rack group it appears under a rack toggle. |
| **What you give it** | Nothing extra. It runs off the scan you already have. |
| **What it shows** | A list of the rack's network devices, each expandable into a live port table grouped by VLAN, with up/down state and a per-port count of learned MAC addresses. |
| **Where the truth comes from** | The discovery system's own datastore — not the photo, and not made-up wiring. |
| **How fresh it is** | Live. A device's ports are fetched the moment you expand it. |
| **When it is empty** | If discovery is not reachable yet, you see a calm "being prepared" message; if it is reachable but the rack has no switches, you see "No switches detected". |

## 3. How it works — step by step

Here is the whole journey, in order, the way the page actually runs.

1. **You open Network View on a scanned rack.** On the standalone page there is a header reading "Network View" with the rack id and a small **health pill** that says whether discovery is online, offline, or still "checking…".

2. **The page checks in with discovery.** As soon as it loads, it quietly probes whether the discovery system is reachable. This probe does not require you to be signed in, so even if discovery is completely down, the page can still render and tell you so rather than showing a broken screen.

3. **The page asks for the match.** It makes one request that says, in effect, "here is this rack — which of its devices can you find live on the network?" The answer is a list: each of the rack's network devices, paired with its live counterpart if one was found, or marked as not found.

4. **You read the summary.** At the top of the **Devices** list, a count such as "6 live" tells you how many of the rack's devices were matched to a live device.

5. **You see one row per device.** Each network device in the rack becomes a full-width row showing its name, its type, its model/vendor, and its management IP. Matched devices also show a small "ports up" bar and a count of active links. Devices that were *not* found live are dimmed and labelled "not in Network View".

6. **You expand a device.** Tapping a matched device opens its port table. The first time you open a given device, its ports are fetched on demand; after that they are remembered, so re-opening is instant.

7. **You read the ports.** Ports are grouped by VLAN (with an "Untagged" group for ports that have no VLAN), and you can filter them by **Live / Up / Down / All**. Each port shows its name, an up/down state, and — where the network has learned MAC addresses behind it — a small count chip.

8. **Behind the scenes, the rack keeps itself in sync.** After every successful scan (and again after RackTrack reads the real make/model from the photos), the server automatically pushes the rack into discovery, so a freshly scanned rack turns up in Network View without anyone doing anything.

## 4. What you see on screen

This section describes exactly what renders, so support can match a user's screenshot to reality.

**The header (standalone page only).** A back arrow, the title "Network View", the line "`<rackId>` · live network view", and a **health pill** on the right. The pill reads "Network View online" (green) or "Network View offline" (red), or "checking…" while it is still probing. Note: when Network View is shown inside a two-rack group toggle, it renders without this header, so the health pill is not shown there.

**The Devices section.** A heading "Devices" with a live count beside it — for example "6 live" — which is the number of the rack's devices that were matched to a live device.

**Each device row shows:**
- A small switch icon.
- The device's RackTrack/CMDB name (for example `SW-U06`), or a dash if it has none.
- The device type (its class, such as "Switch").
- For matched devices: the model text (vendor + model, de-duplicated) and the management IP.
- For matched devices: a "ports up" summary — bold **up count** / total, then the number of "links" (ports that see something on the other end) — and a thin bar filled to the up-percentage.
- A chevron (▸ / ▾) showing it can be expanded.
- Devices with no live match are **dimmed** and read "not in Network View", and cannot be expanded.

**The port table (after you expand a device):**
- **Filter buttons** across the top — **Live**, **Up**, **Down**, **All** — each with a live count in brackets. "Live" is the default and means ports that are up, or have a neighbour, or have learned at least one MAC.
- Ports are then **grouped by VLAN**. Each group has a heading ("VLAN 20", "VLAN 30", …, or "Untagged" for ports with no VLAN) and a count. Numbered VLANs come first in numeric order; the "Untagged" group is always last.
- Each **port row** shows the port name, an optional **"N MAC"** count chip (only on ports that actually have active learned MACs, and only when at least one port on the device does), and an **up / down** chip on the right. Hovering the up/down chip shows a fuller label such as "up" or "up (admin down)".

**The quiet states:**
- If discovery is not reachable: **"Network view is being prepared."** with "This updates automatically from your scan — check back in a moment." No scary error text is shown.
- If discovery is reachable but nothing matched (or everything found was a patch panel): **"No switches detected"** with "No network switches were found for this rack yet. When one is discovered it will appear here."
- If a matched device reports no ports: **"No ports reported by Network View for this device."**
- If a filter hides everything: **"No ports match this filter."**

**What is *not* on screen (worth knowing for support).** The current Network View page shows the device list and per-device port tables and nothing else. There is **no free-text MAC-lookup box, no MAC-history panel, and no "Sync to Netdisco" button** rendered on the page today. The "N MAC" chip is clickable and does fire a network-wide MAC lookup in the background, but the current page does not display the result anywhere, so tapping it has no visible effect. Older documentation described a visible MAC report and a manual sync button; those are not part of the current screen.

## 5. The logic behind it

**Two pictures, honestly separated.** Everywhere else, RackTrack infers connectivity from the photo. Here, port state, VLANs and MAC counts come from the network's own discovery. That is the point of the feature: it is the one rack view whose connectivity is genuinely verified rather than guessed.

**Matching device to device.** For each of the rack's network devices, the page needs to find the same device in discovery. It tries, in order of confidence:
1. **A known management IP** for that device (from an override file) — the strongest match.
2. **The device's RackTrack name** (like `SW-U06`) — because when RackTrack pushes a rack into discovery it writes that name into the discovered device's hostname fields, a name match is high-confidence.
3. **A fuzzy model match** — the model text read from the faceplate against the discovered device's model, as a last resort.

If none of those land, the device is shown but marked "not in Network View", and it cannot be expanded.

**Passive gear is left out.** Patch panels are dropped from the device list. A patch panel is passive copper — it has no MAC address and runs no agent, so it never appears as a live neighbour on the network. Listing it here would imply an adjacency the network cannot actually see, so it is filtered out to keep the view honest.

**Only load what you open.** A device's port detail is fetched the first time you expand that device, and then cached. A rack full of switches therefore stays fast, because the page never pulls every device's ports up front.

**Fail soft, always.** If discovery is slow, cold, or down, the page is written to catch that and show the calm "being prepared" banner instead of leaking raw connection errors, tracebacks, or bare HTTP status codes into the screen.

## 6. Under the hood

*(Technical section — accurate to the current code.)*

**Client.** `client/src/pages/NetdiscoPage.jsx`. The default export `NetdiscoPage` renders the full standalone page (with header and health pill). The named export `NetdiscoContent` renders the same body without the header and is used by `client/src/pages/SideBySideRacks.jsx` (`RackNetworkRoute` → `RackToggle`) so a two-rack group can toggle between racks. The route `"/results/:rackId/netdisco"` is defined in `client/src/App.jsx` and points at `RackNetworkRoute`. For a standalone rack the toggle falls through to the full `NetdiscoPage`; for a group it renders `NetdiscoContent` per rack.

**Server proxy.** `server/netdisco_proxy.js`, mounted in `server/app.js` (`app.use(require('./netdisco_proxy'))`) under `/api/netdisco/*`. It sits in front of the local Netdisco Docker stack in `netdisco-docker/` and hides Netdisco's api-key login and legacy endpoint shapes from the UI. It logs in to Netdisco, caches the `api_key` in memory, and refreshes it once on a 401.

**Endpoints the page uses:**

- **`GET /api/netdisco/health`** — *unauthenticated by design*, so the page can render a "down" state even when nobody is signed in and discovery is unreachable. Returns `{ ok, url, authenticated, status }`. Drives the health pill.
- **`GET /api/netdisco/scan/:rackId/match`** — the main call, made once per rack. Returns `{ rackId, netdisco_reachable, netdisco_device_count, scan_device_count, matched_count, matches[] }`. Each entry in `matches` has a `scan` block (`index`, `class_name`, `units`, `cmdb_name`, `port_count`, `connected_count`) and a `netdisco` block (`ip`, `name`, `model`, `vendor`, `os`, and `stats: { total, up, down, connected }`) or `null` when unmatched. If discovery is unreachable it returns `{ netdisco_reachable: false, matches: [] }` with a cleaned error string, never a 5xx.
- **`GET /api/netdisco/devices/:ip/ports`** — lazy-loaded per device on expand and cached per IP. Returns `{ count, ports[] }`, where each port carries `port`, `name`, `descr`, `type`, `speed`, `duplex`, `vlan`, `up_admin`, `up`, `mac`, `neighbor` (or `null`), `active_mac_count`, and `learned_macs[]`. Neighbour data is present on the port object (Netdisco's `/ports` already returns `remote_id`/`remote_ip`/`remote_port`), and the proxy resolves the far end to a friendly name via hostname → chassis-id map → IP map.
- **`GET /api/netdisco/mac/:mac`** — a network-wide MAC report (`sighting_count`, `ip_count`, `current`, `sightings[]`, `ips[]`). The page *calls* this when a "N MAC" chip is clicked but does **not** render the result in the current build.

**Endpoints that exist but the page does not drive:** `GET /api/netdisco/devices`, `GET /api/netdisco/devices/:ip`, and `POST /api/netdisco/sync/:rackId` (a manual push, which no button on the current page invokes).

**Auth and tenant scoping.** Everything except `/health` sits behind `auth.requireAuth`. Critically, any route carrying `:rackId` is also guarded by `router.param('rackId', rackOwnershipParam(...))` registered **on this router**, because `app.param('rackId')` in `app.js` does not propagate to a mounted router. Without it, a signed-in user of one organisation could name another organisation's rack id and read its scan directory; the guard also shape-validates `rackId` before it is used to build a filesystem path.

**Data sources feeding the match:**
- **The scan map** — `outputs/<rackId>/device_unit_map.json`, filtered to the classes `Switch`, `Patch Panel`, `Firewall`, `Gateway`, `Router` (patch panels are then dropped again on the client).
- **Override IPs** — `servicenow/overrides/<rackId>.json` (`switches[name].mgmt_ip`), giving the highest-confidence match.
- **Netdisco inventory** — pulled once via `/api/v1/search/device?q=%25` and indexed by IP, model, and hostname.
- **Netdisco connection** — env in `server/.env`: `NETDISCO_URL` (default `http://localhost:5000`), `NETDISCO_USER` / `NETDISCO_PASSWORD` (default `admin`/`admin`, with a production warning logged if left at defaults).

**Keeping discovery in sync.** After a successful scan, and again after OCR fills in real make/model, `server/app.js` calls `scheduleNetdiscoSync(rackId)` (exposed by the proxy). That debounces and runs `netdisco-docker/push_rack_to_netdisco.py`, which writes the rack's devices, ports and neighbour edges into Netdisco's Postgres. On that push, each port's initial up/down mirrors the scan's connected/empty detection, and neighbour edges are written in both directions so a link shows from either end — until Netdisco's own polling refreshes it with real telemetry.

## 7. Edge cases and limits

- **Discovery not reachable / still warming up.** You see "Network view is being prepared… check back in a moment." Raw connection errors, Python tracebacks, JSON-decode errors, and bare status codes are deliberately swallowed so they never reach the screen.
- **Reachable but empty.** If no device matched — or everything that matched was a patch panel — you see "No switches detected". This is a normal state for a rack that has no network switches, or one whose switches have not yet been discovered.
- **Cold start returning an empty body.** The match call parses defensively, so a blank response on a cold start does not throw an "Unexpected end of JSON input" error into the UI; it falls back to the offline state.
- **No credentials / default credentials.** If the proxy cannot log in to discovery, the health pill shows `authenticated: false` and device data will not load, landing you on the offline banner. In production, leaving the default `admin`/`admin` credentials logs a warning server-side.
- **Device found but no ports.** A matched device with no reported ports shows "No ports reported by Network View for this device."
- **A filter that hides everything.** Selecting Up/Down/Live when nothing qualifies shows "No ports match this filter." (All ports are still there under "All".)
- **Unmatched devices.** A rack device with no live counterpart is shown dimmed as "not in Network View" and cannot be expanded — there is nothing live to open.
- **The MAC chip result is not surfaced.** Tapping "N MAC" runs a lookup but the current page renders nothing for it, so it appears to do nothing. This is a known limitation of the current screen, not an error.
- **Wrong or unknown rack id.** The match route returns 404 if the rack's scan map does not exist, and the ownership guard blocks any rack id the signed-in user does not own.
- **No neighbour column.** Although neighbour data is computed on the server, the current port table does not show a neighbour column; neighbour presence only influences the "Live" filter.

## 8. Real vs synthetic

| What you see | Where it comes from |
|---|---|
| Port up / down state | **Live** — from the discovery datastore. If the device is being polled by a real Netdisco, this is genuine telemetry. |
| VLANs | **Live** — from the discovery datastore. |
| Learned-MAC counts | **Live** — from the discovery datastore's node sightings. |
| Neighbours (used by the Live filter) | **Live** — from the discovery datastore's per-port remote fields. |
| Device match to the rack | **Real join** — a scanned device paired to its discovered counterpart by IP, then name, then model. |
| Freshly-pushed port up/down (right after a scan) | **Seeded from the scan** — mirrors the scan's connected/empty detection, then replaced by real polling. |
| Neighbour edges right after a push | **Seeded from topology** — written from the rack's topology edges (both directions), then refreshed by polling. |
| Demonstration fabric (`seed_netdisco.py`) | **Synthetic** — a demo dataset used to make the view rich when no real network is connected; real discovery replaces it once connected. |
| Synthetic IPs/MACs when the scan lacks them | **Synthetic** — generated during the push so a device has stable identifiers. |

The honest summary: **the page always shows whatever is actually in the discovery datastore.** If that datastore is fed by a real polling Netdisco, you are looking at live truth. If a rack was just pushed in by RackTrack, the first values are seeded from the scan until polling catches up. The page never invents connectivity on its own.

## 9. Use cases

- **"Is this link really up?"** Expand the device and read the port's up/down state. It comes from the network, not the photo, so it settles the argument.
- **"Did my new scan actually reach the network?"** Open Network View right after scanning; the "N live" count tells you how many of the rack's switches were found live.
- **"Which VLAN did this port land on?"** The per-VLAN grouping puts each port under its VLAN, so you can confirm membership at a glance.
- **"How busy is this switch?"** The device row's "up / total · N links" summary and the up bar give a quick utilisation read without opening the ports.
- **"Is anything actually plugged in here?"** The "links" count and the "N MAC" chips show which ports genuinely see something on the other end.
- **Spotting a mismatch.** If the photo suggested a port was used but Network View shows it down (or vice versa), that gap is exactly what you want to catch.

## 10. Common questions

**Q1. What is the difference between Network View and the rest of RackTrack?**
Everywhere else, RackTrack works out connectivity from a photo. Network View reads it from the live network. It is the one view whose port state is verified, not inferred.

**Q2. It says "Network view is being prepared." Did I do something wrong?**
No. That message means the discovery system is not reachable right now — often it is still warming up, or a scan is still syncing. It updates automatically from your scan; give it a moment and reopen.

**Q3. It says "No switches detected." Is that a bug?**
Not necessarily. It means discovery is reachable but found no matching switches for this rack yet — normal for a rack with no network gear, or one whose switches have not been discovered. When one turns up, it appears here.

**Q4. What does the "N live" count mean?**
It is how many of the rack's network devices were successfully matched to a live device in discovery. If the rack has ten switches but only six are on the network, you would see "6 live".

**Q5. Why is a device greyed out and marked "not in Network View"?**
It means RackTrack could not match that scanned device to any live device — by management IP, by name, or by model. There is nothing live to expand, so the row is dimmed.

**Q6. Why don't I see patch panels?**
Patch panels are passive — no MAC address, no agent — so they never show up as live neighbours on the network. Listing them would suggest a connection discovery cannot actually see, so they are left out.

**Q7. What do "up / total" and "links" mean on a device row?**
"Up / total" is how many of the device's ports are up out of its total ports. "Links" is how many ports see something on the other end (a neighbour or a remote IP). The little bar visualises the up-percentage.

**Q8. The port shows "up (admin down)" on hover — what is that?**
That is the fuller state label. The chip shows the operational state (up or down); the tooltip adds the administrative state when it differs — for example a port that is operationally up but administratively shut.

**Q9. I clicked the "N MAC" chip and nothing happened. Is it broken?**
The chip does trigger a network-wide MAC lookup in the background, but the current page does not display the result, so nothing visibly changes. That is a limitation of the current screen, not a fault with your rack.

**Q10. Is there a button to sync a rack into Network View?**
Not on the page today. Syncing happens automatically: after every scan (and again once the real make/model is read), the server pushes the rack into discovery for you. There is a manual sync endpoint on the server, but no button on the current screen calls it.

**Q11. How fresh is the data, and does the page keep refreshing?**
Each device's ports are fetched the moment you expand it and then cached for that session, so re-opening is instant. It does not poll and auto-refresh on its own; reopening the device (or reloading the view) pulls it again.

**Q12. Is the data real or a demo?**
The page always shows whatever the discovery datastore holds. With a real polling network behind it, that is live truth. Right after a scan, the first values are seeded from the scan itself until polling refreshes them. In a demo without a real network, a seeded demonstration fabric can stand in — and real discovery replaces it once connected.

---

*Sources verified: `client/src/pages/NetdiscoPage.jsx`, `client/src/pages/SideBySideRacks.jsx`, `client/src/App.jsx`, `server/netdisco_proxy.js`, `server/app.js`, `netdisco-docker/push_rack_to_netdisco.py`.*
