# Port History & Drift

**Feature Reference** · *A live change-log for a monitored switch — what changed on each port, and exactly when.*

**Category:** Live network data — continuous telemetry · **Audience:** Engineers investigating drift, flaps and re-cabling · **Document date:** 24 July 2026 · Part of the RackTrack documentation set.

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

For a switch RackTrack watches continuously, this view keeps a running history of every port. On a regular schedule it logs in, reads the state of every interface, and remembers it. The next time it reads, it compares the two — and if anything actually changed (a link came up or went down, the speed renegotiated, the neighbour on the other end changed, the description was edited), it writes down *what* changed and *when*.

The result is a timeline and a plain-English change log. Instead of a wall of identical readings, you see the moments that mattered: "Link came up at 14:02", "Speed changed 1 → 10 Gbps at 09:15", "LLDP neighbour changed from CoreSW to EdgeSW at 22:40". That last one is how you catch a re-cable — someone moved a cable and the switch's neighbour changed, so the history flags it.

It's built for chasing the annoying, intermittent problems: a link that flaps, a port that keeps renegotiating, a cable that quietly got moved. The switch's own observations, kept over time, tell you the story.

## 2. At a glance

| | |
|---|---|
| **Category** | Live network data — continuous telemetry. |
| **Who uses it** | Engineers investigating drift, flapping links and re-cabling. |
| **Where input comes from** | A background poller that logs into the switch on a schedule and records every port. |
| **What it outputs** | Current state, a per-port timeline, and a change log of every event. |
| **Data source** | REAL / LIVE — continuous telemetry, stored on the server. |

## 3. How it works — step by step

```
Poll the switch          →  a background job logs in on a schedule
        ↓
Store a snapshot         →  every port's fields captured
        ↓
Compare to the last one  →  write down ONLY what actually changed
        ↓
Show grid + timeline     →  state now, and how it moved over your chosen window
        ↓
Plain-English change log  →  "Link came up", "Speed 1 → 10 Gbps", "Neighbour changed"
```

**Walkthrough**

1. Open **Drift** for a monitored switch. A hero panel shows the switch, a **Streaming / Paused** status, and its model, serial and firmware.
2. Read the interface grid — one cell per port, coloured by its live state; disabled ports are dimmed.
3. Tap a port to open its detail sheet.
4. Use the **Specs** tab for the port's current values (operational, admin, speed, duplex, flow control, medium, description).
5. Use the **Timeline** tab and pick a window — 1 hour, 3 hours, 12 hours, 1 day, or 1 week — to see each value drawn as coloured segments over time.
6. Use the **History** tab for a "what was the value this long ago" table and the plain-English change log.
7. Need a reading now? Press **Poll now** to trigger an immediate check.

## 4. Where the input comes from

- **Regular snapshots of the switch** — on each pass the poller captures, for every interface: operational and admin state, speed, duplex, flow control, medium, MAC, description, and the neighbour the port advertises.
- **The time window you pick** — 1 hour, 3 hours, 12 hours, a day, or a week — which decides how far back the timeline and the "value at" table reach.

The switch's address and login stay on the server — you never enter them. The view works entirely from the switch's friendly name, model and serial.

## 5. What it produces (output)

- **An interface grid** — every port coloured by its current operational state.
- **A per-port timeline** — coloured segments showing each period a value held steady, so a change is a visible seam.
- **A change log** — human-readable events, each with the from→to values and an exact timestamp.
- **A "value at" table** — what the port's state was 1 hour, 3 hours, 12 hours, a day and a week ago.

## 6. What you see on screen

- **Switch hero** — a Streaming (or Paused) status with a live dot, the switch's model, serial and firmware chips, and a **Poll now** button.
- **Interface grid** — ports coloured by state (up / down / unknown); admin-disabled ports dimmed; the port you're looking at is highlighted.
- **Timeline** — one bar per tracked field: Administrative State, Flow Control, Operational Status, Speed, and LLDP Neighbour, each split into coloured segments across your window.
- **Change log** — entries like "Link came up", "Speed changed 1 → 10 Gbps", "LLDP neighbour changed: CoreSW → EdgeSW", each showing how long ago it happened.
- **Empty / sparse note** — a clear explanation that the poller runs on a schedule and history builds up over time, so a just-added switch looks sparse at first rather than looking broken.

## 7. The logic behind it

- **Only real changes are logged.** A reading is stored only when a value actually changed since the last one. So the log is the moments a link flapped, renegotiated speed, or changed neighbour — never a wall of identical snapshots.
- **Neighbour changes get their own colour.** Each neighbour name is turned into a consistent colour, so a re-cable shows up instantly as a colour change on the timeline — you can spot it without reading a word.
- **Built by observation.** A first-seen switch looks sparse until several poll cycles have passed. The view says so plainly, rather than implying nothing ever happens on the switch.
- **Speed and state spoken plainly.** The raw fields are translated into sentences — "Speed negotiated at 10 Gbps", "Port administratively disabled", "LLDP neighbour lost" — so you don't have to decode vendor output.

## 8. Detailed technical explanation

**Polling.** A server-side poller logs into each monitored switch on a set interval and records a full snapshot of every interface. It runs on a regular cadence in the background; the current default is a periodic pass rather than a constant stream, tuned so the poller doesn't monopolise the switch's single login — these small managed switches typically allow only one session at a time, so the schedule leaves room for a technician's own live checks. You can also force an immediate pass with **Poll now**.

**Change detection.** Each snapshot is compared field-by-field against the previous one for the same port. A change event is written only where a field genuinely differs. Because snapshots are stored only on change, the history is compact — yet the view can still answer "what was this port's state an hour ago" by looking up the most recent snapshot at or before that time.

**Queries without touching the switch.** The timeline and the "value at" table are drawn entirely from stored history, so moving the window or reopening a port never re-reads the device. The switch is only contacted by the scheduled poller and by an explicit **Poll now**.

**What's tracked.** Operational state, admin state, speed, duplex, flow control, medium, description, and the LLDP neighbour (its chassis, port and system name). A change in any of these is what "drift" means here.

## 9. Real data vs. synthetic

| Thing on screen | Real or synthetic |
|---|---|
| Port state over time | **REAL / LIVE** — continuous telemetry from the switch. |
| Change events | **REAL** — recorded only when a value actually changed. |
| Neighbour changes | **REAL** — the LLDP neighbour is tracked; a colour change flags a re-cable. |
| Sparse early history | Expected — history accrues only as the poller runs. |

## 10. Use cases

- **Chasing a flapping link.** The change log pinpoints exactly when a port went down and came back — as many times as it happened.
- **Detecting re-cabling.** A neighbour colour change on the timeline reveals that someone moved a cable, and when.
- **Confirming a speed problem.** A "Speed changed 1 → 10 Gbps" (or the reverse) event tells you a link renegotiated, and at what moment.
- **Auditing a change window.** Pick the day or week window and read every event that landed inside it.

---

— Port History & Drift —
