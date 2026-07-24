# Network View (Live Discovery)

**Feature Reference** · *The one rack view backed by genuine live network telemetry — real port state, VLANs, neighbours and learned MACs.*

**Category:** Live network data — authoritative connectivity · **Audience:** Engineers verifying live connectivity and hunting endpoints · **Document date:** 24 July 2026 · Part of the RackTrack documentation set.

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

Most of RackTrack reasons about a rack from a photo. Network View is different: it joins your scanned rack to a live **network-discovery** system that watches the real devices on the wire. So instead of "the photo shows a cable in port 12", you get "port 12 is really up, it's on VLAN 20, it sees this neighbour, and three MAC addresses are learned behind it".

You open it on a scanned rack and it lines up each scanned device with its live counterpart in discovery. Expand a device and you get its full port table — up or down, grouped by VLAN, with the neighbours it can see and a count of how many MAC addresses each port has learned. Click that count and you can look up exactly where a MAC address ended up — not just on this rack, but anywhere the discovery system can see it.

This is the view to trust when you need to *know*, not infer. It reports the network's own operational truth, independent of what any photo showed.

## 2. At a glance

| | |
|---|---|
| **Category** | Live network data — authoritative connectivity. |
| **Who uses it** | Engineers verifying live connectivity and hunting down endpoints. |
| **Where input comes from** | Live network discovery of the real devices, matched to your scan. |
| **What it outputs** | Per-device cards with live port tables grouped by VLAN, plus a network-wide MAC lookup. |
| **Data source** | REAL / LIVE — from network discovery, not the scan and not synthesised wiring. |

## 3. How it works — step by step

```
Match devices          →  each scanned device is joined to its discovered twin
        ↓
Expand a device        →  its live port table loads on demand
        ↓
Group by VLAN          →  ports sorted into their VLANs, with an Untagged bucket
        ↓
Show state + neighbours + MACs  →  up/down, admin state, learned-MAC counts
        ↓
MAC lookup             →  trace any address across the whole network
```

**Walkthrough**

1. Open **Network View** on a scanned rack. A health pill at the top shows whether discovery is online.
2. Read the match summary — for example "10 live" — telling you how many of the rack's devices were found in discovery.
3. Tap a device card to expand it; its port table loads the first time you open it.
4. Filter the ports by **Live / Up / Down / All**.
5. Where a port has learned MAC addresses, a small count appears — click it to look up where that address lives across the network.

## 4. Where the input comes from

- **Live discovery data** — the real, operational port state, VLAN memberships, neighbour relationships and MAC-to-port bindings for the actual devices, collected by the network-discovery system.
- **The scan's device list** — your scanned rack's devices, matched to their discovered counterparts so the view is scoped to just this rack.

After a scan, RackTrack also quietly pushes the rack into discovery, so a freshly scanned rack shows up there without you doing anything.

## 5. What it produces (output)

- **Health & match summary** — whether discovery is reachable, and how many of the rack's devices matched a live device.
- **Device cards** — each device's name and type, its model and vendor, its management IP, a ports-up bar and a count of active links.
- **Port tables** — every port grouped by VLAN, with up/down and admin state.
- **MAC lookup result** — which switch and port an address is currently learned behind, plus its recent history.

## 6. What you see on screen

- **Health pill** — "Network View online" or "offline" (or "checking…" while it probes).
- **Match summary** — "N live" for how many scanned devices matched a discovered device.
- **Device cards** — name, class, model/vendor and IP; a card is dimmed and marked "not in Network View" if it wasn't discovered.
- **Port table** — port name, description, an up/down state with an admin-state tooltip, grouped under each VLAN with an Untagged bucket for the rest.
- **Learned-MAC chips** — a clickable count of active MAC addresses behind a port; clicking runs the lookup.
- **Friendly offline banner** — a calm "Network view is being prepared, check back in a moment" instead of raw error text, and a clear "No switches detected" when a reachable rack simply has nothing to show.

## 7. The logic behind it

- **Authoritative state.** Port state here comes from the network itself, not the photo — this is the one rack view whose connectivity is genuinely verified.
- **Passive gear is hidden.** Patch panels are left out, because they have no network presence — no MAC, no agent — and so never appear as neighbours. Showing them would imply an adjacency the network can't actually see.
- **It complements topology, not replaces it.** The 3D topology view shows the *physical* layout with inferred cabling; Network View shows the *logical*, discovered connectivity. Read together they answer "how is it wired" and "what's really connected".
- **Load only what you open.** A device's port table is fetched the moment you expand it, so the page stays fast even for a rack full of switches.

## 8. Detailed technical explanation

**Join and read.** Each scanned device is matched to a discovered device using, in order of confidence: a known management IP for that device; its RackTrack name (like SW-U06); and, failing those, a fuzzy match of the model text read from the faceplate against the discovered device's model. Once matched, the device's ports, VLAN memberships, neighbour relationships and MAC-to-port bindings are read from the discovery datastore.

**Seeding.** RackTrack can push a scanned rack into discovery so a freshly scanned rack appears there. When it does, each port's up/down mirrors the scan's connected/empty detection as a starting point, until the discovery system's own polling refreshes it with real telemetry. Links are recorded in both directions so a connection shows consistently from either end.

**Honesty about what's showing.** In this deployment the discovery database can also be populated with a seeded demonstration fabric, so the view has something rich to show in a demo. When a real discovery system is connected, the same screen shows genuine live telemetry. Either way, the screen always reflects whatever is actually in the discovery source — it never makes connectivity up.

## 9. Real data vs. synthetic

| Thing on screen | Real or synthetic |
|---|---|
| Port up/down state | **REAL / LIVE** — from discovery. |
| VLANs, neighbours | **REAL / LIVE** — from discovery. |
| Learned-MAC counts & lookup | **REAL / LIVE** — from discovery's MAC bindings. |
| Device match to the rack | **REAL** — a scanned device joined to its discovered counterpart. |
| Seeded demo fabric (if used) | Clearly a demonstration dataset; real discovery replaces it when connected. |

**Note.** When a rack is first pushed into discovery, a port's initial up/down comes from the scan's own detection and is replaced by real polling shortly after.

## 10. Use cases

- **Confirming a link is really up.** Discovery shows the true operational state, independent of what the photo showed.
- **Finding an endpoint.** A MAC lookup reveals which switch and port a device is learned behind, across the whole network.
- **Verifying a VLAN.** The per-VLAN grouping confirms a port really landed on the VLAN you intended.
- **Sanity-checking a fresh scan.** Right after scanning, Network View shows whether the rack's switches actually appear on the network the way the scan expects.

---

— Network View (Live Discovery) —
