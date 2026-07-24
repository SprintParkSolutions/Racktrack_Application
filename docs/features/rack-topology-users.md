# Rack Topology

**Feature Reference** · *See one rack drawn out — every device at its real shelf position, its ports, and the cabling between them — in a flat 2D picture and an orbitable 3D scene.*

**Category:** Visualization — physical layout and (inferred) wiring · **Audience:** Everyone — no technical background needed · **Document date:** 24 July 2026 · Part of the RackTrack documentation set.

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

After you scan a rack, RackTrack knows what is in it — which shelf each device sits on, what type it is, and how many ports it has. **Rack Topology** takes that and turns it into a picture you can read at a glance.

You get two views of the same rack. A **2D elevation** is the flat, front-on drawing an engineer would sketch on paper: numbered shelves from bottom to top, each device drawn at its true height, with a little square for every port. A **3D scene** is the same rack you can spin, tilt and zoom, with the cables drawn as coloured tubes running between devices.

On top of the picture you get three tools. **Filter** hides or shows cables by type (copper, fibre, or direct-attach). **Capacity** re-colours every device by how full it is, so you can see at a glance which switches still have room. **Trace** lets you tap two devices and have RackTrack draw the path of cabling that links them.

One honest note up front: the **devices and their positions are real** — read from your photo — but the **cabling is a best guess**. RackTrack knows which ports are plugged in, but not exactly which port connects to which. So treat the wiring as a sensible, plausible starting point for planning, not as verified, network-confirmed connections — unless your team has supplied a hand-checked override for that rack.

## 2. At a glance

| | |
|---|---|
| **Category** | Visualization — physical layout and (inferred) wiring. |
| **Who uses it** | Anyone planning, auditing, or trying to understand a rack's layout. |
| **Where input comes from** | The scan (real devices, positions and ports) plus a generated cabling layer. |
| **What it outputs** | A 2D elevation and a 3D scene with selectable devices, ports and cables, plus filter, capacity and trace tools. |
| **Data source** | MIXED — devices, positions and ports are REAL; the cabling is SYNTHETIC (unless a curated override exists). |

## 3. How it works — step by step

```
Scan result            →  real devices, their shelf positions, and which ports are connected
        ↓
Build the layout       →  one shared inventory of the rack (used here, in your records view, and the network view)
        ↓
Work out the cabling   →  pair up connected ports into cable runs (a best guess)
        ↓
Apply overrides        →  if your team has supplied real values, those replace the guesses
        ↓
Draw it                →  a flat 2D elevation and an orbitable 3D scene
        ↓
Explore it             →  filter cables, gauge free capacity, trace a path
```

**Walkthrough**

1. Open **Topology** for a rack. If the picture isn't ready yet you'll see a short "being prepared" message — it builds in the background right after a scan and appears on its own; a **Retry** button is there if you want to nudge it.
2. Switch between the **2D** elevation and the **3D** scene with the toggle. Your choice is remembered for next time.
3. Use the **cable filter** pills — **All / Cat / Fiber / DAC** — to show only the cable types you care about. This applies to the 2D view, the 3D view and the detail panel all at once.
4. Turn on **Capacity** to re-colour every device by how full it is: green means plenty of free ports, amber is filling up, red is nearly full.
5. Turn on **Trace**, then tap one device and then a second. RackTrack finds and highlights the cabling path between them and tells you how many hops it takes.
6. Tap any **device** to see its ports and its neighbours, or tap a **cable** to see exactly which two ends it joins.

## 4. Where the input comes from

- **The detected devices** — each device's type, its position on the rack, and how many shelves it fills, all read from the scan.
- **The per-port detection** — how many ports each switch or panel has, and which of those ports the photo saw as plugged in versus empty.
- **Where the ports sit in the photo** — the pixel positions of the ports, which the cable-guessing step uses to pair likely partners.
- **A curated override (optional)** — a per-rack file your team can supply with the real, known values (real model names, real cable IDs, and so on). When it exists, those real values replace the guesses.

## 5. What it produces (output)

- **A 2D rack elevation** — every device drawn at its true shelf position, with a small square for each port, empty shelves included.
- **A 3D scene** — an orbitable model of the same rack, with cables drawn as colour-coded tubes and hover cards on each device.
- **A detail panel** — for a selected device, a table of its ports and its neighbours; for a selected cable, its two endpoints, connector, type and length.
- **A trace result** — a device-to-device path with the number of hops and the full chain of devices along the way.

## 6. What you see on screen

- **A rack banner** — the rack's name and size in U, plus counts of switches, panels, servers and cables.
- **The 2D elevation** — numbered shelves from bottom to top (empties shown too), devices coloured by type, and per-port squares that show connected versus free.
- **A port colour legend** — connected copper (RJ45), free copper, fibre (SFP), console, and uplink/other ports each have their own colour.
- **The 3D scene** — orbit, tilt and zoom; hover any device for a quick card; cables are drawn as coloured tubes you can follow by eye.
- **The detail panel** — a ports table showing each cable's ID, connector, type, length and the device on the far end.
- **A trace banner** — when tracing, the path, the hop count, and the full device-by-device chain.

## 7. The logic behind it

- **Cables only ever touch real ports.** A cable is only ever drawn on a port the scan actually saw as connected. So even though the *pairing* is a guess, both *ends* are real — RackTrack never invents a plug where the photo shows an empty socket.
- **A sensible guess for which port meets which.** Cables in a rack usually run straight up and down, so for each connected switch port RackTrack picks the panel port sitting closest to it left-to-right in the photo. The highest-numbered ports are treated as uplinks.
- **The same rack always draws the same way.** When the photo can't tell it exactly where a port is, RackTrack falls back to a fixed, repeatable ordering, and all the invented details (cable IDs, types, lengths) come from a stable recipe. Regenerating the picture gives an identical result every time, and it stays consistent with your records view and your network view.
- **Real values always win.** If your team has supplied a curated override for a rack, those real values replace the guesses field by field — so a rack you've documented keeps its true model names and cable IDs.
- **One layout, three views.** The same underlying inventory of the rack feeds Topology, your records (CMDB) view, and the network view, so all three tell the same story.

## 8. Detailed technical explanation

**One shared inventory.** When a scan finishes, RackTrack builds a single description of the rack — the list of devices, their positions, their port counts, and which ports are connected. This one inventory is what the topology picture, the records view and the network view all read from, which is why they never disagree with each other. Real values (device names, shelf heights, port counts, connected-versus-empty ports) come straight from the scan. Everything that a photo simply can't show — hardware serial numbers, network addresses, exact cable runs — is generated as a plausible placeholder and clearly flagged as generated, right down to a list of exactly which fields were invented.

**Working out the cabling.** RackTrack draws cables in a fixed order so the result is always the same for the same rack. First it fans the top uplink ports of each active switch up to a shared aggregation point (a stand-in "core" device that lives just outside the rack). Then it pairs the remaining connected switch ports with connected patch-panel ports, choosing the partner that lines up most closely in the photo — because a straight vertical run is the most likely real cable. Any leftover connected ports become extra uplinks until the aggregation point is full; anything still left over is honestly left unwired rather than joined to an invented partner. The cable IDs, their types (a copper "Cat" class) and their lengths are all generated placeholders.

**Preparing the picture.** The topology snapshot is built in the background straight after a scan, so you don't have to wait or press anything. If you open Topology before it's ready, the screen shows a short "being prepared" message and quietly tries again. If your team later supplies real values for a rack, rebuilding the snapshot simply lets those real values take over.

**The two views.** The 2D elevation is a straightforward front-on drawing. The 3D scene is a proper interactive model you can orbit and zoom; it's loaded only when you switch to it, so the page stays fast. The cable filter, the capacity heat-map and the trace tool all work on the same data, so the 2D view, the 3D view and the detail panel always agree.

## 9. Real data vs. synthetic

| Thing on screen | Real or synthetic |
|---|---|
| Devices, their types, shelf positions and sizes | **REAL** — from the scan. |
| Port counts and connected/free state | **REAL** — from the per-port detection. |
| Which port connects to which (the pairing) | SYNTHETIC — inferred from the photo, not network-verified. |
| Cable IDs, types (e.g. Cat6a), lengths (e.g. 5m) | SYNTHETIC — generated by a stable, repeatable recipe. |
| The aggregation / core uplink device | SYNTHETIC — invented as a place for uplinks to terminate. |
| Curated override values | **REAL** — they replace the guesses whenever an override file exists. |

**Important.** Cables are only ever drawn on ports the scan actually detected as connected — so the endpoints are real even though the specific pairing, cable ID, type and length are best guesses. Treat the wiring as plausible placeholder cabling for planning, not as verified physical or network-discovered connections, unless your team has supplied a curated override for that rack.

## 10. Use cases

- **Planning a move.** Turn on Capacity to see which switches still have free ports before you relocate a server or add hardware.
- **Understanding a rack you didn't build.** The elevation shows what is where, at a glance, and roughly how it's wired — a fast way to get your bearings.
- **Tracing a run.** Trace mode walks the (inferred) path between two devices, so you have a starting point to chase down a connection instead of following cables by hand.
- **Getting a shared picture.** Because the same layout feeds your records and network views, the topology is a common reference the whole team can point at.

---

— Rack Topology —
