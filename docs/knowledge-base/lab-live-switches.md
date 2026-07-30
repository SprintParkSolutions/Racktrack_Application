# Lab — Live Switches

*The owner-only console that reads real network switches over SSH — live, port by port — and never writes a single thing back to them.*

Feature · Admins/operators · Last verified: 26 July 2026 against the live code.

---

## 1. In simple terms

Everywhere else in RackTrack, a "device" is something the model recognised in a **photo** of a rack. The Lab is different. The Lab talks to a handful of **real switches** — over the network, using SSH, the same way an engineer would log in to one from a terminal — and shows you what those switches say about themselves, right now.

Open the Lab and you get two things side by side: a **list of switches** on the left, and, when you pick one, a **detailed report** on the right. The heart of that report is a **per-port table** — one row for every physical port on the switch — telling you, for each port, whether the link is up, whether the port is switched on, how fast it's running, and what's plugged in on the other end. It's the closest thing RackTrack has to plugging a laptop into the switch and typing `show` commands yourself, except it does the typing, reads the answers, and lays them out for you.

There is an important distinction to hold onto, because it explains almost everything about how the page behaves:

- **"Scanned" devices** (the rest of RackTrack) come from a picture. They are as fresh as the last photo you took.
- **"Live" switches** (the Lab) come from an actual conversation with the equipment. They are as fresh as the last time RackTrack managed to log in — which can be seconds ago, or, if the switch went dark, minutes ago.

Because logging in takes a few seconds, the Lab is built to feel instant anyway. The moment you open a switch, it shows you **the last report it saw**, stamped with how old that is, and then quietly logs in again in the background to freshen it. You are never left staring at a blank screen waiting for a switch to answer.

And one promise runs through the whole feature: **RackTrack only ever reads.** It runs `show`-style commands to look at the switch. It never changes a setting, never reboots anything, never touches a port. The Lab is a window, not a control panel.

## 2. At a glance

| | |
|---|---|
| **What it is** | An owner-only console that reads live state from real switches over SSH and shows it as a per-port table. |
| **Who can use it** | Platform owners only. The device list (`/api/lab/devices`) and the audit endpoint are both `requireRole('owner')`. Anyone else sees "Restricted to platform owners." |
| **What it points at** | A small EVE-NG lab of Cisco IOL switches — an L3 core (**CoreSW**, 192.168.1.62) and two L2 switches (**L2SW1** .61, **L2SW2** .60), each with ports Ethernet0/0–Ethernet0/3. |
| **What you see** | A switch list, a status light per switch, an identity strip, and three tabs — **Ports**, **VLANs**, **Neighbours**. The Ports tab holds the live table. |
| **The port table** | Columns: **Port · Link · Admin · Speed · Duplex · Type · PoE (W) · Neighbour**. |
| **Freshness model** | Shows the last saved audit instantly (from the browser's local cache), then refreshes it live in the background. Nothing is ever blanked while a refresh is in flight. |
| **Read-only?** | Yes, absolutely. Every command is a `show`/read command. RackTrack never configures, reboots, or alters a switch. |
| **Data source** | REAL — genuine live SSH sessions to real switches. The switches themselves are virtual Cisco IOL nodes running in an EVE-NG lab, but the data is read live, not faked. |
| **Credentials** | Resolved server-side from an encrypted credential store. The browser only ever sends a device id — never a host, never a password. |

## 3. How it works — step by step

```
You open the Lab (owner only)      →   the browser asks the server for the switch list
        ↓
It lists the lab switches          →   name · IP · a status light (Live / Offline / …)
        ↓
You pick a switch                  →   its last saved report appears INSTANTLY, stamped "audit 4m ago"
        ↓
A fresh audit runs in background    →   the server SSHes in, runs read-only `show` commands, parses them
        ↓
The report updates in place        →   identity fills in, the port table refreshes, "as of just now"
        ↓
Separately, a background poller     →   logs in on its own schedule to record drift + set the status light
```

1. **You open the Lab.** Only a platform owner can. The page immediately asks the server for the list of registered lab switches and shows them as cards.
2. **You pick a switch.** The page shows you the **last report it has** for that switch straight away — pulled from the browser's own saved copy — so the detail is never blank. It's clearly marked with how old that report is.
3. **A fresh read runs quietly.** Once per switch per visit, the page kicks off a live audit in the background. The server logs in over SSH, runs a batch of read-only commands, parses the replies, and hands back the result. The on-screen report updates in place — you don't lose what you were looking at while it works.
4. **You read the report.** Identity facts sit in a strip at the top; the per-port table, VLANs, and neighbours live under three tabs.
5. **You can force a re-read.** The **Refresh audit** button runs the whole thing again on demand.
6. **In the background, on its own clock,** a separate poller logs into every enabled switch on a schedule, records anything that changed since last time (the "what changed when" drift history), and keeps each switch's **Live / Offline** light up to date. That light, and the offline banner, are what tell you at a glance whether a switch is even reachable.

## 4. What you see on screen

### The header and access gate

The page header reads **"Lab"** with the subtitle **"Owner-only · EVE-NG switches."** If you are not a platform owner, that's all you get — the body just says **"Restricted to platform owners."** Everything below only renders for owners.

### The switch list

Down the left (a sticky rail on a wide screen, a stack of cards on a phone) is one card per registered lab switch. Each card shows:

- The switch's **display name** (e.g. `CoreSW`), in monospace.
- Its **IP address / host** (e.g. `192.168.1.62`).
- A **status pill** — a coloured dot and a word. The wording is decided as follows:
  - **Connecting…** — an audit for this switch is running right now.
  - **Disabled** — polling has been turned off for this switch.
  - **Offline** — the last poll failed; the switch isn't answering.
  - **No data** — never successfully reached yet (for example, credentials are missing, so the poller tried and gave up without recording a failure).
  - **Live** — enabled, reached, and returning data.
- A small footer like **"audit 4m ago"** when a saved report exists, so you can see how stale the cached detail is before you even open it.

A thin coloured rail runs down the left edge of each card (green = Live, red = Offline, amber = Connecting) so the health of the whole fleet reads at a glance. The switch list refreshes itself about every 15 seconds; a momentary hiccup fetching it won't empty the page — the last good list stays put and a small "Device list stale" note appears instead.

### The detail panel

Pick a switch and the right-hand panel fills in.

**Title row.** The switch name, its status pill, and two buttons:

- **Disable polling / Enable polling** — turns the background poller on or off for just this switch.
- **Run full audit** (or **Refresh audit** if a report is already shown) — forces a fresh live read now. It's disabled while an audit is already running and while polling is disabled for the switch.

**Key facts strip.** A row of tiles — **IP address, Vendor, Model, Firmware, Serial, MAC, Last polled.** Model, firmware, serial and MAC come from the switch's own `show version`; several of them read "—" on the lab switches, which is expected (see §7). "Last polled" is how long ago the background poller last succeeded.

**Banners.** Depending on state, a plain banner may appear:

- **"Polling disabled."** — the poller is skipping this switch, so its data will go stale and no drift is recorded.
- **"Offline — the switch isn't answering (N failed attempts). It's likely stopped or unreachable; polling recovers on its own once it's back."** — this is the plain offline banner. It's a calm, factual message: the switch went dark, and polling will pick it back up by itself when it returns.
- **"Last audit failed. <reason>"** — shown when a live audit errored but there's still an older report to show; the older data stays on screen and is clearly marked as the previous result.

**The freshness line.** Above the tabbed content sits a small line: **"Audit as of 2m ago · live SSH pass, not polled"** — or **"Refreshing…"** while a live read is in progress. This is the reminder that the table below is a real, on-demand SSH read, not the background poll.

### The three tabs

**Ports** — the centrepiece. First a tiny **faceplate**: a grid of little squares, one per port, each with a green (up), red (down) or grey (unknown) underline, so the whole switch's link state reads in one glance. Below it, the **per-port table**, one row per port, with these columns:

| Column | What it means | Where it comes from (live audit, Cisco) |
|---|---|---|
| **Port** | The interface, e.g. Ethernet0/0–0/3. | The port list itself. |
| **Link** | Is the link up or down? | `show interfaces status` — only a "connected" port is "up". |
| **Admin** | Is the port switched on (enabled) or shut down (disabled)? | The interface configuration (`show interfaces description`). |
| **Speed** | Negotiated line speed, e.g. 100M/1000M. | `show interfaces status`. |
| **Duplex** | Full / Half / Auto. | `show interfaces status`. |
| **Type** | The media — Copper or Fiber. | `show interfaces status` (the "Type" column). |
| **PoE (W)** | Power delivered over the port, in watts. | `show power inline`. |
| **Neighbour** | The device seen on the far end of the cable. | LLDP (`show lldp neighbors detail`) merged with CDP (`show cdp neighbors detail`). |

Any cell RackTrack couldn't fill shows a plain **"—"**. That is deliberate and honest: a dash means "the switch didn't report a value here," not "RackTrack broke." On these lab switches several columns are legitimately blank all the time — see §7. If a port sees more than one neighbour (some lab ports share a single virtual segment), the extra count shows as a muted **"+2"** next to the first device, so a shared link isn't misread as point-to-point. If the switch reports a PoE budget, a line beneath the table sums it up ("PoE budget 370W · used 12W").

**VLANs** — a table of VLAN id, name, status, and member ports. On **CoreSW** this reads "None," and the page explains why in plain words: CoreSW runs the L3 IOL image, where the interfaces are routed and there are no switchports to place in a VLAN.

**Neighbours** — one row per neighbour (not per port): the local port, the device name, its management address, and its port. Because a shared segment can show several neighbours on one local port, they're listed individually rather than collapsed to the first.

## 5. The logic behind it

There are **two independent engines** behind this page, and it helps to keep them apart.

### The on-demand audit (what fills the table you're looking at)

When you open a switch or press **Refresh audit**, the server runs a single, focused read pass against that one switch. For a Cisco switch it runs, in one SSH session: `show version` (identity), `show interfaces status` (link/speed/duplex/type), `show interfaces description` (admin state + descriptions), `show power inline` (PoE), and `show vlan brief` (VLANs). On the same session it also pulls LLDP and CDP neighbours and the MAC table. Every one of these is a **read** command. The result is what you see in the tabs, stamped "live SSH pass, not polled."

Two courtesies keep this from breaking the switch. First, these lab switches allow only **one SSH session at a time**, so before an audit runs, the server tells the background poller to **yield** that switch for a cooldown window — the poller steps aside so your audit gets the switch to itself. Second, a completed audit counts as proof the switch is reachable, so it **clears the Offline state** — a switch you just successfully audited won't keep claiming it's offline.

### The background poller (the Live/Offline light and the drift history)

Separately, a poller wakes on a schedule (by default **once an hour**, tunable via `PORT_POLL_INTERVAL_MS`) and logs into every enabled switch. For a Cisco switch its recipe is: send `enable`, then `terminal length 0` to switch off paging, then run `show version`, `show interfaces status`, `show running-config | section interface`, and `show lldp neighbors detail`. It parses each port's state, compares it to the last snapshot, and records anything that changed — that's the drift timeline. Success or failure here is also what sets each switch's **Live / Offline** light and the "Last polled" time you see on this page.

The poller is careful by design:

- **Hourly, not every minute.** These switches hold their single SSH session open even after the connection drops, so hammering them every 60 seconds would keep that session permanently occupied and starve your manual audits. An hour between passes leaves the session free for the interactive reads that actually need it.
- **Backoff on dead hosts.** If a switch fails to answer, it isn't retried every cycle. The first failure backs it off (about a minute by default), and each further failure **doubles** the wait, capped at roughly 30 minutes — so a switch that's genuinely down is retried on a sane cadence instead of being pounded. Backoff is wiped clean every time the server restarts, so polling always gets a fresh attempt at boot.
- **Bounded concurrency.** It polls a few switches at once (4 by default), never opening dozens of SSH sessions simultaneously.
- **No overlap.** A per-switch guard means a slow poll of one switch never doubles up or drops the others.
- **Manual-probe yield.** If you're actively auditing a switch by hand, the poller leaves that switch alone until you're done.

### Read-only, everywhere

Both engines only ever issue `show`/read commands plus the session setup (`enable`, `terminal length 0`). Neither one enters configuration mode, writes memory, or changes a port. **RackTrack reads switches; it does not configure them.** The one script in the repo that *does* configure the lab switches (`configure-lab.js`) is explicitly separate, run by hand, and is not wired into the app.

## 6. Under the hood

For engineers and support staff who need the exact wiring:

**Client — `client/src/pages/LabPage.jsx` (+ `LabPage.module.css`).** Owner-gated master–detail console. It calls `GET /api/lab/devices` (owner-only) every 15s for the list, and `POST /api/lab/devices/:id/audit` for a live read — sending only a device **id**, never a host or credentials. Audits are cached per device in an in-memory `Map` **and** in `localStorage` under the key `rt_lab_audit_<id>`, so reopening the page shows the last result instantly. A device is audited automatically **once per session** the first time it's opened (skipped if it's disabled or already known-offline, so the page doesn't hang on a dead host); after that, only the **Refresh audit** button re-reads. On error, the previous audit is preserved and annotated — never erased.

**Poller — `server/lib/port_poller.js`.** Holds the per-vendor recipes. The `cisco-ios` recipe: `enable` → `terminal length 0` → `show version`, `show interfaces status`, `show running-config | section interface`, `show lldp neighbors detail`. It resolves per-host credentials over per-vendor ones, injects them into an SSH runner, parses the output, and writes each port row to the drift store. Includes the SQLite-backed exponential backoff, the bounded-concurrency worker pool, the manual-probe yield, and a retention sweep that prunes old drift events (default 30 days) and snapshots (default 90 days).

**Parser — `server/lib/cisco_parser.js`.** Turns raw Cisco IOS output into structured rows, and this is where the column-to-command mapping lives for the poller:
- `parseInterfaceStatus` reads `show interfaces status` → **link (up/down), speed, duplex, and type (Copper/Fiber)**.
- `parseInterfaceConfiguration` reads `show running-config | section interface` → **admin enabled/disabled** (a port is "disabled" only if it carries an explicit `shutdown`).
- `parseLldpNeighbors` reads `show lldp neighbors detail` → **the neighbour** (system name, chassis id, port).
- `parseSystemInfo` reads `show version` → identity (model, firmware, serial, MAC — several are null on IOL).
- It deliberately skips virtual interfaces (SVIs like `Vlan99`, loopbacks, tunnels) so they don't render as phantom ports.

**Audit commands — `server/app.js` `AUDIT_CMDS` + `auditSwitchHost()`.** The on-demand audit's `cisco-ios` command set is: `show version` / `show interfaces status` / `show interfaces description` / `show power inline` / `show vlan brief`, plus `show lldp neighbors detail`, `show cdp neighbors detail`, and `show mac address-table`. `auditSwitchHost` runs the short commands in one SSH session, merges LLDP with CDP (CDP fills in where LLDP is empty — the usual case on IOL), records success (clearing the Offline/backoff state), and returns the identity, ports, PoE, VLANs and neighbours the page renders. (The audit reads admin state from `show interfaces description` rather than running-config; both report the same intent, so the live table and the poller agree on which ports are shut down.)

**Lab topology — `server/scripts/configure-lab.js`.** A one-off, hand-run helper (not part of the app) that documents exactly how the lab was built. It configures three EVE-NG Cisco IOL switches:
- **L2SW1 — 192.168.1.61** (L2): e0/0–e0/1 = user PCs on VLAN 10, e0/2 = uplink to CoreSW e0/1, e0/3 = RackTrack management.
- **L2SW2 — 192.168.1.60** (L2): e0/0–e0/1 = user PCs on VLAN 20, e0/2 = uplink to CoreSW e0/0, e0/3 = RackTrack management.
- **CoreSW — 192.168.1.62** (L3 core): e0/0 and e0/1 are **routed** interfaces (each with an IP address, `no shutdown`) downlinking to the two L2 switches; e0/2 links to a router; e0/3 = RackTrack management.

Ethernet0/3 on every switch is the **RackTrack management link on VLAN 99** — the path RackTrack polls over. The setup script never touches e0/3, precisely because changing it would lock RackTrack out mid-run. The script only ever sets descriptions, access VLANs (10/20), and `lldp run`; it is the sole component that writes to the switches, and it is deliberately kept out of the running app.

**Credentials.** Both the poller and the audit resolve credentials **server-side** from an encrypted store (`server/.env` + `.env.key`, keyed by vendor `cisco-ios`, with optional per-host overrides). **No passwords live in code.** The browser never sees or sends a host or a credential — it sends a device id, and the server does the rest. This is why the whole feature is owner-only: the audit response reveals the switch's real host, and the device table has no tenant scoping.

## 7. Edge cases & limits

**Blank columns are normal on these switches — and they're the truth, not a bug.**

- **PoE is always blank.** These are virtual Cisco IOL nodes. They have **no PoE hardware**, so `show power inline` has nothing to report and the PoE (W) column shows "—" on every port, always. On real switches with PoE this column fills in.
- **On the L3 core (CoreSW), Link / Speed / Duplex / Type are blank.** CoreSW's uplink interfaces are **routed** (they have IP addresses, not switchports). `show interfaces status` only lists Layer-2 switchports, so routed interfaces simply don't appear in it — and every column that comes from that command reads "—". This is why CoreSW's port rows look sparse.
- **But Admin and Neighbour still fill in on those routed ports.** Admin comes from the interface configuration/description, and the neighbour comes from LLDP/CDP — neither depends on `show interfaces status` — so a routed port still shows whether it's enabled and what's on the far end.
- **VLANs read "None" on CoreSW.** Same reason: an L3 switch has no switchports to place in a VLAN. The page says so in plain words.
- **Speed and Duplex are often blank even on the L2 switches.** Virtual IOL never negotiates a physical link, so there's frequently nothing to report there either.
- **LLDP may be empty; CDP usually saves it.** IOS doesn't run LLDP unless `lldp run` is set, and the IOL image may not support LLDP at all (Cisco's native protocol is CDP). The audit asks for CDP too and merges it in, which is why neighbours still appear even when LLDP returns nothing.

**When a switch goes offline.** The lab switches are EVE-NG nodes whose running configuration — including their management IP and SSH host key — is **volatile**: it can evaporate when the node is stopped or the EVE-NG host reboots. So "was Live, now dark on port 22" almost always means the node is stopped or came back unconfigured, not a RackTrack fault. The page shows the plain Offline banner, the poller backs off, and everything recovers on its own once the node is back and reconfigured. A successful manual **Refresh audit** clears the Offline state immediately.

**One session at a time.** Because these switches allow a single SSH session, the design goes out of its way to avoid two reads colliding — the audit tells the poller to yield, the poller backs off, and a device is auto-audited only once per visit. This is why the page doesn't re-read on every tab click.

## 8. Real data vs synthetic

**This is real, live data — not mock data, not a demo fixture.** Every value in the port table is read from an actual switch over an actual SSH session, by running actual Cisco IOS `show` commands and parsing the genuine CLI output. When the table says a port is up at 100M, that's because the switch said so moments ago.

The one nuance worth stating plainly: the **switches themselves are virtual.** They are Cisco IOL images running inside an EVE-NG lab, not physical boxes in a rack. That's why some columns (PoE especially) are permanently blank — the virtual hardware genuinely has nothing there to report. But "virtual switch" is not the same as "fake data." The conversation with the switch is completely real; RackTrack is reading a real device that happens to be virtualised, exactly as it would read a physical one.

## 9. Use cases

- **Confirm a switch is reachable and healthy.** One look at the status light and the port faceplate tells you whether RackTrack can talk to the switch and which ports are up.
- **See what's actually plugged in.** The Neighbour column (LLDP/CDP) shows the device on the far end of each cable — handy for confirming an uplink lands where you think it does.
- **Check admin state vs. link state.** A port that's administratively enabled but showing link down (or vice-versa) is visible at a glance across the whole switch.
- **Verify VLAN membership** on the L2 switches without logging in yourself.
- **Sanity-check the read-only integration end to end** — prove RackTrack's SSH path, credential store, and parsers all work against real gear, safely, because nothing it does can change a switch.
- **Demonstrate the live-vs-scanned distinction** to a new operator: the Lab is the live half of the product, standing next to the photo-based scanning half.

## 10. Common questions

**Why are the Link, Speed, Duplex or PoE columns blank?**
Because the switch genuinely reported nothing for them, and RackTrack shows the truth rather than guessing. PoE is always blank on the lab switches (virtual IOL has no PoE hardware). Link/Speed/Duplex/Type are blank on the L3 core's routed interfaces, because `show interfaces status` only lists Layer-2 switchports. Speed/Duplex can also be blank on the L2 switches because virtual IOL never negotiates a real physical link. A blank cell is "—" and means "nothing to report here."

**Does RackTrack change my switches when I open the Lab?**
No. Never. Both the on-demand audit and the background poller run only read (`show`) commands plus session setup. RackTrack reads switches; it does not configure them, reboot them, or touch a port. The only script that writes to the lab switches (`configure-lab.js`) is a separate, hand-run setup tool that is not part of the app.

**Who can see the Lab?**
Platform owners only. Both the device list and the audit endpoint are owner-restricted. Everyone else sees "Restricted to platform owners."

**Why did it show me old data first, then change?**
By design. Logging into a switch takes a few seconds, so the page shows the last saved report instantly (stamped with its age) and then refreshes it live in the background. The report updates in place when the fresh read returns. You're never left waiting on a blank screen.

**How fresh is the report?**
The line above the tabs tells you — "Audit as of 2m ago," or "Refreshing…" while a live read is running. The audit is a live SSH pass, not the background poll. Press **Refresh audit** any time to force a fresh read now.

**What's the difference between "Live," "Offline," "No data" and "Disabled" on a switch?**
Live = reached and returning data. Offline = the last poll failed; the switch isn't answering. No data = never successfully reached yet (often missing credentials). Disabled = polling is turned off for that switch, so its data goes stale on purpose.

**A switch says Offline — what do I do?**
Usually nothing on RackTrack's side. These are EVE-NG nodes whose config is volatile, so Offline almost always means the node is stopped or came back unconfigured. Start/reconfigure it in EVE-NG and polling recovers by itself. If you want to confirm the moment it's back, press **Refresh audit** — a successful read clears the Offline state immediately.

**Why doesn't it just poll every few seconds so it's always fresh?**
Because these switches allow only one SSH session and hold it open even after the connection drops. Polling constantly would keep that single session permanently busy and starve your manual audits — and a burst of retries can wedge the switch. Hourly polling leaves the session free for the interactive reads that need it.

**Why can't I run two audits at once, or why does it feel like it "waits"?**
The switch permits a single SSH session, so RackTrack serialises access: an audit tells the background poller to step aside, and the page auto-audits a switch only once per visit. This is intentional, to protect the switch from session exhaustion.

**Why is the Neighbour column populated by CDP sometimes?**
The lab's IOL images often don't support LLDP, so `show lldp neighbors detail` comes back empty even though the ports are cabled. The audit also asks for CDP (Cisco's native neighbour protocol) and merges it in, which is why neighbours still appear.

**What does the "+2" next to a neighbour mean?**
That local port saw more than one device (some lab ports share a single virtual segment). The first device is named and the muted "+2" tells you two more were seen — so a shared link isn't mistaken for a point-to-point one. The Neighbours tab lists them all individually.

**Where do the switch passwords live? Does my browser send them?**
Neither the passwords nor even the switch's IP are ever sent by your browser — it sends only a device id. The server resolves the host and credentials from an encrypted store (keyed by vendor, with optional per-host overrides). No passwords are stored in the code.
