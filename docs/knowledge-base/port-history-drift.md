# Port History & Drift

*A living change-log for a monitored switch — it watches every port, remembers what it saw, and tells you exactly what changed and when.*

Feature · Operators/admins · Last verified: 26 July 2026 against the live code.

---

## 1. In simple terms

Picture a switch that RackTrack keeps an eye on. On a schedule, a background job quietly logs into that switch over SSH, reads the state of every port, and writes it all down. The next time it logs in, it reads everything again and compares the new reading with the last one. If nothing moved, it stays quiet. But if something genuinely changed — a link came up or dropped, the speed renegotiated, a cable got moved so the neighbour on the other end is now a different device, or someone edited a port's description — it records exactly *what* changed and *when*.

That is what "drift" means here: **a port is different now than it was the last time we looked.** Not a fault, not an alarm — just a recorded difference. Over time these differences add up to a story. Instead of staring at thousands of identical readings, you see only the moments that mattered: "Link came up at 14:02", "Speed changed 1 Gbps to 10 Gbps at 09:15", "LLDP neighbour changed from CoreSW to EdgeSW at 22:40". That last one is how you catch a re-cable — the switch noticed its neighbour changed, so the history flags it.

This feature exists for the annoying, intermittent problems: a link that flaps on and off, a port that keeps renegotiating its speed, a cable somebody quietly moved. You do not have to be watching at the exact second it happens. The switch's own observations, kept over time, tell you the story after the fact.

One important thing to set expectations up front: **RackTrack records drift, it does not shout about it.** When a change is detected it is written to the history and noted in the server log — but nothing is pushed to you. There is no email, no popup, no alert. You go and look, and the history is there waiting. (See Section 7.)

## 2. At a glance

| | |
|---|---|
| **What it is** | A continuous, per-port change history for a switch RackTrack polls over SSH. |
| **Who it is for** | Operators and admins chasing flapping links, speed renegotiation, and re-cabling. |
| **Where you find it** | The **Drift** tab on a rack's Results page, and the standalone **Port history & drift** page (`/port-history`). Both show the same live view. |
| **Where the data comes from** | A server-side poller that SSHes into each monitored switch on a timer, reads every interface, and diffs it against the last reading. |
| **What it produces** | A live port grid, a per-port timeline, a "value at" table, and a plain-English change log. |
| **How fresh** | REAL / LIVE SSH data. Default poll cadence is **once per hour**; you can force an immediate read with **Poll now**. |
| **Notifications** | None. Drift is stored and logged, never pushed. |
| **Vendors** | TP-Link JetStream and Cisco IOS have exact parsers; ~50 other vendors from the CLI matrix get a generic recipe (identity only, no per-port rows). |

## 3. How it works — step by step

Here is the whole journey, from the switch to your screen, in plain language.

```
A switch is monitored     →  it lives in the monitored_devices list, enabled
        ↓
The poller logs in        →  on a timer (hourly by default), over SSH
        ↓
It reads every port       →  runs the vendor's commands, parses the output
        ↓
It compares to last time  →  field by field, against the most recent stored reading
        ↓
It records ONLY changes   →  a new snapshot + one event row per changed field
        ↓
You open Drift            →  the grid, timeline and change log are drawn from what was stored
```

**Walkthrough**

1. **A switch becomes monitored.** It sits in the server's `monitored_devices` list with its address, login and vendor — all held server-side. As long as it is enabled and not in a "back off and retry later" window, the poller will visit it.
2. **The poller visits on a schedule.** By default every hour, it logs into the switch over SSH, runs a short list of read-only commands, and parses the replies into one tidy row of facts per port.
3. **It compares the new reading to the last one.** For each port, it checks a fixed set of fields against the most recent stored reading.
4. **It writes down only what changed.** If nothing differs, nothing is stored. If something differs (or this is the very first time the switch has ever been read), it saves a fresh full snapshot of that port *and* one small event row for each field that moved — "oper went from down to up", "speed went from 100 to 1000", and so on.
5. **You look.** Open the **Drift** tab (or the standalone page). The screen loads the stored history: the current state of every port, a timeline you can scrub back over a chosen window, a "what was this port an hour / day / week ago" table, and a human-readable change log. None of this re-reads the switch — it is all drawn from what was already stored.
6. **Need it fresh right now?** Press **Poll now** and the server does an immediate SSH pass for that switch, then the view refreshes.

## 4. What you see on screen

The Drift tab and the standalone page render the same content. From top to bottom:

**Switch hero (identity panel).** A card naming the switch (its friendly name, or model, or "Switch"), with a small status pill:
- **Streaming** (with a live dot) when the switch is enabled for polling, or **Paused** when it is not.
- Identity chips underneath: model, serial number (**SN**), and firmware (**FW**), plus the system description when the switch reports one.
- A circular **Poll now** button that triggers an immediate SSH read.

If no reading has landed yet, this area simply says **"Waiting for first poll…"** rather than looking broken.

**Interface inventory (the port grid).** One tappable cell per port, laid out in roughly two rows. Each cell is coloured by the port's live operational state:
- **green** = link up, **red** = link down, **grey** = unknown.
- Admin-disabled ports are dimmed.
- The port you are currently inspecting is highlighted.
- A small legend spells out the colours. Ports are sorted by their trailing number, so you get 1, 2, 3 … 28 rather than 1, 10, 11, 2.

If there is no port data yet, the grid shows an explanatory note (see the caveat about that note's wording in Section 7).

**Per-port detail sheet.** Tap any port cell and a detail panel opens with three inner tabs:

- **Specs** — the port's current values, as a labelled grid: Operational, Admin State, Speed, Duplex, Flow Control, Active Medium, MAC, Description, "Last change" (how long ago this port last changed), and "Last poll" (how long ago the switch was last read).
- **Timeline** — a window selector (**Last 1 Hour, 3 Hours, 12 Hours, 1 Day, 1 Week**) above a stacked set of horizontal bars. There is **one bar per tracked field**: Administrative State, Flow Control, Operational Status, Speed, and LLDP Neighbor. Each bar is split into coloured segments — one segment for each stretch of time the value held steady — so a change becomes a visible seam where the colour switches. The operational bar uses green/red so up/down jumps out; each distinct LLDP neighbour name is turned into its own stable colour, so a re-cable shows as an obvious colour change without reading a word. A time axis with five ticks runs along the top. If there are no readings in the chosen window yet, the timeline says so and invites you to let the poller run a few more cycles.
- **History** — two parts. First a **"Value at"** table: what the port's operational state, admin state and speed were 1h / 3h / 12h / 1d / 1w ago, each with the exact timestamp of the reading that answer came from. (Rows that resolve to the same underlying reading are collapsed into one, so you do not see five identical lines.) Below it, the **Change log**: every recorded event for this port, newest first, each shown as a plain-English sentence ("Link came up", "Speed changed 1 Gbps → 10 Gbps", "LLDP neighbour changed: CoreSW → EdgeSW"), the raw `field  from → to` underneath it (an empty value shows as the symbol ∅), and how long ago it happened.

## 5. The logic behind it

**Drift = a real difference since last time.** Every poll produces a full reading for each port, but a reading is only *stored* when at least one tracked field is genuinely different from the previous stored reading. Identical readings are thrown away. So the history is never a wall of repeated snapshots — it is exactly the list of moments something moved.

**The tracked fields.** These are the fields the diff watches, and therefore the only things that can count as drift:
- **oper** — operational state (up / down / unknown)
- **admin** — administrative state (enabled / disabled / unknown)
- **speed_mbps** — negotiated link speed in Mbps
- **duplex** — Full / Half / Auto
- **flowctrl** — flow control (Enable / Disable; TP-Link only — Cisco does not report it)
- **medium** — Copper / Fiber
- **descr** — the port description (tracked by default; can be muted — see Section 6)
- **lldp_chassis**, **lldp_port**, **lldp_system** — the neighbour the port sees over LLDP (its chassis ID, remote port ID, and system name)

If any one of those differs from last time, that field's change is recorded. Anything not in this list — for example VLAN — is **not** tracked and cannot produce a drift event (see Section 7).

**Neighbour change = re-cable signal.** The LLDP neighbour fields are first-class tracked fields. When the system name a port sees changes, that is usually a cable being moved to a different device. On the timeline the neighbour bar gives each distinct name its own colour, so the moment of the reroute is a visible seam.

**Storing only on change still answers "what was it back then".** Because a snapshot is written only when something changes, a port that has been stable for a week might have just one stored reading. To answer "what was this port an hour ago", the system finds the most recent stored reading *at or before* that time. That single stored reading can legitimately be the answer for all five "value at" windows at once — which is why the History tab collapses identical rows.

**Plain-English translation.** The raw fields are turned into sentences so you do not have to decode vendor output — "Speed negotiated at 10 Gbps", "Port administratively disabled", "LLDP neighbour lost", and so on. Fields the translator has not been taught still get a generic "<field> changed" line, so nothing is ever silently dropped.

**Sparse by design.** A switch that was just added has no prior reading to compare against, so its first successful poll simply becomes the baseline — no events, just a starting point. History builds up from there as the poller keeps running. The UI states this rather than implying the switch is faulty.

## 6. Under the hood

This section is the accurate technical picture, verified against the current code.

**The poller — `server/lib/port_poller.js`.** On `start({ intervalMs, sshRunner })` it kicks off an immediate pass and then repeats on a timer.
- **Cadence.** `DEFAULT_INTERVAL_MS = 3_600_000` (one hour), overridable with `PORT_POLL_INTERVAL_MS`. The code comment is explicit that the old 60-second default was harmful: these small managed switches (TP-Link JetStream, Cisco IOL) allow only **one** SSH session and do not release it promptly when a TCP connection drops, so minute-by-minute polling starved the interactive paths (a technician's manual probe, an audit) of the switch's single session. Hourly leaves that session free between passes.
- **Which devices.** `pollAll()` reads `dueDevices()` — every switch that is `enabled = 1` and not currently inside a backoff window. Note this deliberately sweeps **all** tenants' switches regardless of who is signed in; it is the background job, not a user request.
- **Concurrency.** A bounded worker pool (`DEFAULT_CONCURRENCY = 4`, override `PORT_POLL_CONCURRENCY`) so scaling to many devices never opens many simultaneous SSH sessions. A per-process `_busy` set stops two polls of the same device overlapping.
- **Manual-probe yield.** If a user is actively probing a host by hand, `noteManualProbe(host)` marks it, and the poller skips that host for a 60-second cooldown (`MANUAL_PROBE_YIELD_MS`) so it does not fight for the single session.
- **Per-vendor recipe.** `VENDOR_RECIPES` holds the exact recipes. Each recipe lists an enable command, a paging-off command, and the read commands:
  - **tplink**: `show system-info`, `show interface status`, `show interface configuration`, `show lldp neighbor-information`.
  - **cisco-ios**: `show version`, `show interfaces status`, `show running-config | section interface`, `show lldp neighbors detail`.
  - Vendor spellings are folded to a canonical key (`cisco_ios`, `cisco-systems` → `cisco-ios`; `tp-link` → `tplink`). Any of ~50 other matrix vendors falls back to a **generic recipe** (`generic_recipe.js`) that runs the real commands and parses identity, but does **not** guess per-port rows.
- **What a poll does.** For each due device it resolves the recipe, merges per-host over per-vendor SSH creds (`ssh-creds.js`), runs the commands over the injected `runSwitchCommandsSequential` runner (15 s per command), parses the outputs, updates device identity metadata, then writes each port row through the history store. A drift is only ever surfaced as a **log line** (`logger.info(... drift event(s))`) plus the DB write — there is no notification path of any kind.

**The parsers — `server/lib/cisco_parser.js` and `server/lib/tplink_parser.js`.** Both expose the same contract so the poller can swap between them: `parseInterfaceStatus`, `parseInterfaceConfiguration`, `parseLldpNeighbors`, `parseSystemInfo`, and `mergePortRows`. Each normalises raw CLI output into the tidy per-port shape the store expects (oper up/down/unknown, admin enabled/disabled/unknown, speed as an integer Mbps, duplex Full/Half/Auto, etc.).
- **Cisco `flowctrl` is always null** — `show interfaces status` does not carry it and the parser does not pay for a second command to fill the column. So on a Cisco switch the Flow Control timeline bar is effectively empty.
- **LLDP may be absent on Cisco.** IOS does not run LLDP unless `lldp run` is configured (CDP is the default), and the IOL lab image may not support it at all. The parser returns an empty map rather than throwing, so the switch still polls fine — it just never emits `lldp_*` events.
- Virtual interfaces (SVIs, loopbacks, tunnels, null) are filtered out so they do not appear as phantom greyed-out ports.

**The store — `server/lib/port_history_db.js`.** A `better-sqlite3` database (`server/data/auth.db`, WAL mode; override with `RACKTRACK_AUTH_DB`) owning three tables:
- `monitored_devices` — host, ssh_port, vendor, enabled, identity columns (system_name, model, serial, sw_version, mac, …), robustness columns (consecutive_failures, backoff_until, last_error, last_polled_at), and `tenant_id` for ownership scoping.
- `port_snapshots` — a full per-port reading, written **only on change**: device_id, port, ts, oper, admin, speed_mbps, duplex, flowctrl, medium, descr, lldp_chassis, lldp_port, lldp_system.
- `port_events` — one row per changed field: device_id, port, field, from_val, to_val, at.
- **The diff.** `writePoll` runs in a single transaction. It fetches the latest snapshot for that port; if one exists, it walks `TRACKED_FIELDS` and, for each field where `normForCompare(prev) !== normForCompare(new)`, does `changes.push({ field, from, to })`. If a previous snapshot existed and nothing changed, it returns early — no snapshot, no events. Otherwise (first-ever reading, or a real change) it inserts a fresh snapshot and one event row per change, atomically.
- **`descr` toggle.** Description drift is tracked by default (so "someone edited a port description" stays visible), but it gets noisy when descriptions are managed by IaC; set `PORT_DRIFT_TRACK_DESCR=0` to drop `descr` from the tracked set.
- **Tenancy.** Reads are scoped by Site (`tenant_id`); a NULL-tenant row is visible only to the platform owner, never leaked sideways. The client only ever sees `id` + a display name — `toClientView` strips host and ssh_port.

**The client — `client/src/pages/PortHistoryPage.jsx`.** The routable page (`/port-history`) and the embeddable `PortHistoryContent` (used by the Drift tab) share one inner component. It loads the device list, auto-selects the switch, polls `/overview` every 15 s for the live grid, and — when a port is open — polls that port's `/history` every 15 s and `/timeline?window=` every 20 s. **Poll now** posts to the device's `/poll` endpoint.

**A note on the two "drifts".** The **Drift tab** renders this feature (`<PortHistoryContent />`). It is unrelated to the separate ticket-mode alert on the Overview tab driven by `result.drift` / `result.driftDetected`, which is CMDB *physical* drift — a device found at a different rack-U than expected. Same word, different feature; this document is only about the port-history Drift tab.

## 7. Edge cases & limits

- **No notifications — drift is stored, not pushed.** This is the single most important limit to understand. When the poller detects a change it writes it to the history and logs one line on the server. It does **not** email, alert, or notify anyone. You find drift by opening the view and looking. There is no push path in the code today.
- **Offline or unreachable switch → exponential backoff.** If an SSH pass fails, the device's failure counter increments and it is put in a backoff window: first failure ~60 seconds (`PORT_POLL_BACKOFF_BASE_MS`), doubling each subsequent failure up to a 30-minute cap (`PORT_POLL_BACKOFF_MAX_MS`). `dueDevices()` skips a device until its backoff expires, so a permanently dead host retries on a sane cadence instead of hammering every interval. A successful poll clears the counter. On every server boot, backoff is wiped clean so polling always restarts immediately, and an operator can force an immediate retry (`forceReset`) without rebooting anything.
- **"Runs once per minute" empty-state text is stale.** When the grid has no data yet it currently reads *"The poller runs once per minute…"*. That copy has not caught up with the code: the server default is **hourly** (`PORT_POLL_INTERVAL_MS`). Trust the hourly cadence, not that sentence.
- **VLAN is not tracked.** Despite the Drift tab's subtitle mentioning "VLAN … tracking", VLAN is not one of the tracked fields, is not stored in `port_snapshots`, and the parsers never extract it into a port row. A VLAN change will not produce a drift event today. (The subtitle overstates; the tracked set in Section 5 is the truth.)
- **The timeline says "four bars" in the code comments, but there are five.** Administrative State, Flow Control, Operational Status, Speed, and LLDP Neighbor. The stale comment is a leftover from an earlier version.
- **Sparse at first is normal.** A newly added switch, or one just after a retention prune, may have only its baseline reading. The timeline and change log look thin until the poller has run for several cycles. That is expected, not a fault.
- **Retention prunes old history.** A sweep (hourly) deletes events older than `PORT_DRIFT_EVENT_DAYS` (default 30 days) and superseded snapshots older than `PORT_DRIFT_SNAPSHOT_DAYS` (default 90 days) — but it always keeps the latest snapshot per port as a diff baseline, so the "current state" is never lost.
- **One switch, one SSH session.** Because these switches allow a single session, a running audit or manual probe and the poller can contend for it. The manual-probe yield and hourly cadence are the mitigations; if a switch looks "stuck", it is usually a session-contention or backoff situation, not lost data.
- **Generic-vendor switches show identity but no ports.** For vendors without an exact parser, you will see the switch's identity but no per-port grid or drift — the generic recipe intentionally does not guess port rows.

## 8. Real vs synthetic

Everything in this feature is **REAL, live SSH data**. Nothing here is mocked or generated.

| Thing on screen | Real or synthetic |
|---|---|
| Port state over time | **REAL / LIVE** — SSH-polled readings stored in `port_snapshots`. |
| Change events | **REAL** — `port_events`, written only on a genuine field difference. |
| Neighbour (LLDP) changes | **REAL** — the neighbour's chassis, port and system name are polled; a colour change flags a re-cable. |
| Device identity (model, serial, firmware) | **REAL** — parsed from `show system-info` / `show version`. |
| Sparse early history | Expected behaviour — history accrues only as the poller runs; not synthetic, just not filled in yet. |

## 9. Use cases

- **Chasing a flapping link.** The change log pinpoints every down→up transition on a port, with exact timestamps — however many times it flapped. You do not have to be watching when it happens.
- **Detecting a re-cable.** A neighbour colour change on the timeline (an `lldp_system` event in the log) tells you a cable was moved to a different device, and exactly when.
- **Confirming a speed problem.** A "Speed changed 1 Gbps → 10 Gbps" (or the reverse) event dates a renegotiation to the moment it happened.
- **Auditing a change window.** Pick the day or week timeline window and read every event that landed inside it — drawn entirely from stored history, with no live re-read of the switch.
- **Answering "what was this port yesterday?"** The "Value at" table gives the port's state 1h / 3h / 12h / 1d / 1w ago at a glance.
- **Confirming an admin action.** A "Port administratively disabled/enabled" event confirms whether (and when) a shutdown actually took effect on the device.

## 10. Common questions

**Q1. What exactly does "drift" mean here?**
A port is in a different state now than the last time the poller read it. It is a recorded difference — not an alarm, not necessarily a problem. The change log is simply the list of those differences over time.

**Q2. How often does it check the switch?**
By default once an hour. It used to be once a minute, but that starved the switch's single SSH session, so the default was moved to hourly. You can always press **Poll now** for an immediate read.

**Q3. Will it alert me when something changes?**
No. This is the key limitation: drift is **stored and logged, never pushed**. There is no email, popup, or notification. You have to open the Drift view to see it.

**Q4. Which fields count as a change?**
Operational state, admin state, speed, duplex, flow control, medium, description, and the three LLDP neighbour fields (chassis, remote port, system name). A difference in any of those is recorded. Description tracking can be turned off with an env setting.

**Q5. Does it track VLAN changes?**
No. Despite the tab's subtitle mentioning VLAN, VLAN is not a tracked field and is not stored — a VLAN change produces no drift event today.

**Q6. Why is my brand-new switch's history empty?**
Because there is nothing to compare against yet. The first successful poll just sets the baseline. History fills in as the poller keeps running over the following hours; give it a few cycles.

**Q7. The screen says "runs once per minute" — is that right?**
That empty-state text is stale. The real default is hourly. Trust the hourly cadence.

**Q8. What happens if the switch is offline or unreachable?**
The poll fails, the device is backed off (starting around a minute and doubling up to 30 minutes), and it is retried later instead of every interval. Once it answers again, the backoff clears. Server restart also clears backoff so polling resumes immediately.

**Q9. Does opening the timeline or changing the window re-read the switch?**
No. The grid, timeline, "value at" table and change log are all drawn from stored history. The switch is only contacted by the scheduled poller and by an explicit **Poll now**.

**Q10. Why do I see five identical rows collapsed into one in the "Value at" table?**
Because snapshots are stored only on change, one stored reading can be the correct answer for several time windows at once. The UI collapses identical answers so you are not shown the same row five times.

**Q11. How does it catch someone moving a cable?**
The port advertises its neighbour over LLDP. When that neighbour's system name changes, it is recorded as an `lldp_system` event, and the timeline draws the new neighbour in a different colour — a visible seam at the moment of the reroute.

**Q12. Which switches does this work fully on?**
TP-Link JetStream and Cisco IOS have exact parsers with full per-port detail. About fifty other vendors from the CLI matrix get a generic recipe that reads identity but does not produce a per-port grid or drift.

---

— Port History & Drift —
