# Rack Topology (3D)

*A picture of one rack — every device on its real shelf, its ports, and the cabling between them — in a flat 2D elevation and a spinnable, zoomable 3D scene.*

Feature · All users · Last verified: 26 July 2026 against the live code.

---

## 1. In simple terms

After you scan a rack, RackTrack already knows what is inside it: which shelf each device sits on, what kind of device it is (a switch, a patch panel, a server, and so on), how many ports it has, and which of those ports look plugged in. **Rack Topology** takes all of that and draws it as a picture you can actually look at and poke around in.

You get the same rack in **two views**, and a small **2D / 3D** button switches between them:

- The **2D view** is a flat, front-on drawing of the rack — the kind of "rack elevation" sketch an engineer would draw on paper. Shelves are numbered from the bottom up, every device is drawn at its true height, empty shelves are labelled "empty", and each device shows a little coloured square for every one of its ports.
- The **3D view** is the same rack built as a small 3D model inside a data-centre floor. You can spin it, tilt it, and zoom right in on a device's front panel. The cables are drawn as tubes that run between the ports, routed down cable-management channels on the sides of the rack the way real patch cords do.

You explore it by **tapping things**. Tap a device and a panel at the bottom tells you everything about it — its class, its shelf position, its model, and a full table of its ports (which are connected, what they connect to, the cable ID, the cable type and length). In 3D you can also tap a single cable to see exactly which two ends it joins, and even click the rack's glass side doors to swing them open.

One honest note up front, and it matters: **the devices and where they sit are real** — read straight from your photo. The **cabling is a best guess.** RackTrack knows which ports the photo saw as plugged in, but not for certain which port connects to which. So treat the wiring as a sensible, plausible starting point, not as a verified, network-confirmed wiring diagram — unless your team has supplied a hand-checked override for that rack.

## 2. At a glance

| | |
|---|---|
| **What it is** | A visual map of one rack: devices at their real shelf positions, their ports, and the (inferred) cables between them. |
| **Who it's for** | Everyone. No networking background needed to read it. |
| **Where you find it** | The **Topology** tab inside a rack's results, and the `…/topology` page for a rack. Two-rack scans can also open a combined view of both racks. |
| **The two views** | A flat **2D elevation** and an orbitable **3D scene**, switched with a 2D / 3D toggle. Your choice is remembered. |
| **Main things you can do** | Switch 2D/3D · orbit, zoom and pan the 3D scene · tap a device to see its ports · tap a cable (in 3D) to see its two ends · swing the rack's glass doors open. |
| **What's real** | Devices, their classes, shelf positions and sizes, port counts, and connected-vs-free port state. |
| **What's a best guess** | Which port connects to which, plus cable IDs, cable types and lengths. |
| **Built from** | One topology snapshot per rack that RackTrack prepares in the background right after a scan. |

## 3. How it works — step by step

Here is the whole journey, from a finished scan to a picture you can explore:

```
You scan a rack
      ↓
RackTrack works out the rack's contents  →  which devices, on which shelves, with which ports connected
      ↓
It prepares a "topology snapshot"         →  built quietly in the background straight after the scan
      ↓
You open Topology                          →  the app fetches that snapshot
      ↓
It draws the rack                          →  a flat 2D elevation, or a 3D scene you can orbit
      ↓
You explore                                →  tap a device for its ports, tap a cable for its two ends
```

**Walkthrough**

1. **Open Topology for a rack.** You will usually get there from the **Topology** tab on a rack's results screen. If the picture is not ready yet, you will see a short **"Topology is being prepared"** message — the snapshot builds in the background after a scan and normally appears on its own. There is a **Retry** button if you want to nudge it, and the app also keeps quietly re-checking for about a minute.
2. **Pick a view.** Use the **2D / 3D** toggle (top-right). The app remembers which one you last used and opens there next time.
3. **Read the 2D elevation,** or **explore the 3D scene** — orbit, tilt, zoom, and hover devices for a quick card.
4. **Tap a device** to open its detail panel at the bottom: its class, shelf, model, its connected neighbours, and a full ports table.
5. **In 3D, tap a single cable** to see exactly which two ports it joins, its type and its length.

## 4. What you see on screen

### The rack banner (top)

Above the picture sits a banner with the rack's **name** and **ID**, a **RACK** badge, and a row of counts: the rack's **size in U**, and how many **switches**, **patch panels**, **servers** and **cables** were found. The **2D / 3D** toggle lives here (or in the page header on the full-page view).

### The 2D elevation

This is the flat, front-on drawing:

- **Numbered shelves** from the bottom up (`U01`, `U02`, …), with **empty shelves labelled "empty"** so the whole height of the rack is accounted for.
- **Every device drawn at its true shelf position and height,** coloured by what kind of device it is (switches, patch panels and servers each have their own colour).
- **A small square for every port** on a device, packed into a little grid. The square's colour tells you the port's state — for example, a connected copper (RJ45) port, a free one, an SFP/fibre port, a console port, or an uplink.
- **Cables drawn as thin curved lines** running between devices, colour-coded by type (Cat, Fibre, DAC).
- **An "UPLINK · EXTERNAL" column** on the right for anything that lives just outside the rack — such as the shared uplink/aggregation point the switches feed up to.
- **A legend along the bottom** spelling out the port colours (connected, free RJ45, SFP, console, uplink) and the cable colours (Cat, Fibre, DAC).

Tap any device in the 2D view to select it and open its detail panel. The cables in 2D show a small tooltip if you hover them.

### The 3D scene

Switch to 3D and the same rack is rebuilt as a model standing on a data-centre floor:

- **A proper rack chassis** — corner posts, top and bottom plates, a vent grille on top, a tinted glass back panel, a name badge above the rack, and **cable-management channels** running down the sides.
- **Glass side doors you can click to swing open** — a nice touch that lets you "look inside".
- **Each device rendered as its own dark chassis** with a raised front faceplate, a small status light, its name, its model (or a `CORE / UPLINK` badge for the external uplink), and a port count. The devices have a subtle "breathing" glow so the rack feels alive rather than static.
- **Real ports laid out on each faceplate** — two rows for switches, a single row of jacks for patch panels, and a small cluster for a server's network cards. Connected, empty, uplink and highlighted ports are shaded differently.
- **Cables as tubes** that leave a port, run forward, drop into the side channel, travel up or down, and re-enter the far port — the way patch cords really route. The tube itself is a neutral cable-jacket colour (off-white in the dark theme, dark slate in the light theme); the **cable type's colour appears on the connector "boot" at each end**, so you can still read the type where the cable plugs in.
- **An "UPLINK" shelf** above the rack when there are external uplink devices, marked with an amber separator line.

**Getting around in 3D:** a hint pinned to the corner reminds you — **right-click and drag to orbit, scroll to zoom, and once you zoom in past a point the drag switches to a hand-pan** (the cursor becomes a grab hand) so you can slide across a device's face. Hover any device and a **card in the top-left corner** shows its name, class, shelf, model and how many of its ports are connected versus free. Tapping empty space clears your selection.

### The detail panel (bottom)

The panel under the picture reacts to what you tap:

- **Nothing selected** — a legend (core / uplink, switches, patch panels, end hosts) and a hint telling you how many cables were found and how they group into links, or "No cables detected on this rack yet."
- **A device selected** — its name, class, shelf position, model and management IP; a strip of **connected neighbours** (each with how many cables run to it); and a full **ports table**. The table lists every port with its status (connected/free), the cable ID, the connector it uses (RJ45, LC, SFP+…), the cable type and length, and the device on the **other end**. A running tally shows total / connected / free ports.
- **A single cable selected (from the 3D scene)** — its cable ID, type, length and colour, and the two exact ends it joins (`device : port ↔ device : port`).

## 5. The logic behind it

- **Cables only ever touch real ports.** A cable is only drawn on a port the scan actually saw as connected — so even though the *pairing* is a guess, both *ends* are real. RackTrack never draws a plug into an empty socket.
- **One layout drives both views.** The 2D elevation and the 3D scene are built from the very same snapshot, so they always tell the same story — the same devices on the same shelves with the same ports.
- **Devices are placed by their real shelf position.** Each device is drawn at its detected `U` position and takes up its real height in `U`. Empty shelves are shown as gaps so the rack reads true to life.
- **The rack's own colour code.** In the 2D view, devices are coloured by their **class** (switch, patch panel, server, and so on), and ports are coloured by **state and kind** (connected, free, SFP, console, uplink). In 3D, the device tier shows up as a small coloured accent — an LED dot, a base trim line and a brand stripe — rather than painting the whole box, so equipment still looks like real dark metal.
- **The external uplink is drawn outside the rack.** Switch uplinks fan up to a shared aggregation/"core" point that sits above the rack (a 3D "UPLINK" shelf) or to the right of it (the 2D "UPLINK · EXTERNAL" column).
- **The same picture every time.** For a given scan the snapshot is generated the same way each time, so re-opening or regenerating Topology gives you an identical result, and it stays consistent with the rack's other views.

## 6. Under the hood

*(Technical section — accurate to the current client code.)*

**Where the data comes from.** The client fetches `GET /api/topology/:rackId`. The single-rack page (`client/src/pages/TopologyPage.jsx`) first tries a prefetch cache (`getCached(cacheKey.topology(rackId))`) so a freshly-analyzed rack renders instantly; otherwise it fetches. A `404` means the snapshot is still being generated: the page polls every 4 seconds, up to 15 attempts (~60 s), before showing a hard error; other transient failures retry the same way. The view choice (`'2d'` / `'3d'`) is persisted with `safeStorage` under the key `topology.view`.

**The snapshot shape.** The response is one JSON object with `rackName`, `rackId`, `u_size`, a `devices[]` array and an `edges[]` array, plus a `stats` block (`device_count_in_rack`, `edge_count`). Each **device** carries `name`, `class`, `u_position`, `u_size`, `in_rack`, `model`, `mgmt_ip`, an optional `summary`, and a `ports[]` list; each **port** has `name`, `label`, `kind` (main / sfp / console / usb / nic / other), a `connected` flag and an `is_uplink` flag. Each **edge** (cable) has `src` and `dst` `{ device, port }`, plus `cable_id`, `cable_type`, `length`, and sometimes `color`/`kind`. Device classes the code recognises include `switch`, `patch_panel`, `server`, and also `pdu`, `router`, `firewall`, `gateway`, `ups`, `psu` and `unidentified`.

**The 2D elevation** (`RackElevation`, an inline SVG) lays out `u_size` numbered rows, marks unoccupied ones "empty", and draws every in-rack device at `yTopUnit(u_position)` with a wrapped grid of port squares (`RackPortStrip`). Off-rack devices (`in_rack: false`) go in a right-hand "UPLINK · EXTERNAL" column. Cables are cubic-bezier paths anchored to each device's right-edge midpoint and coloured by `cable_type`. Clicking a device selects it (`{ kind: 'node', id }`); cables carry an SVG `<title>` tooltip but are not themselves clickable in 2D.

**The 3D scene** (`client/src/pages/TopologyScene3D.jsx`) is built with `@react-three/fiber` and `@react-three/drei` (`OrbitControls`, `Text`, `Grid`, `Environment`) over `three`. It is loaded through a `lazy()` / `Suspense` boundary, so three.js is only pulled into the bundle when you actually open a 3D view. `computeRackLayout` turns the snapshot into per-device positions and a chassis height (adding a shelf above the rack for out-of-rack "core" devices); `computePortPositions` places each real port on the faceplate (switches: two rows; patch panels: one row; servers: a two-column NIC cluster). `RackContent` renders the chassis (`RackChassis`, including the click-to-swing `SwingPanel` glass doors), a `DeviceBox` per device (with an animated emissive "breathing" pulse and a blinking status LED), and `PortCables`. `PortCables` draws a `tubeGeometry` per edge, routed jack → forward exit → side channel → vertical run → far jack with a `CatmullRomCurve3`, jittered by a stable per-cable hash so a dense trunk fans out instead of overlapping. Camera framing is sized to the chassis; `AutoPanCursor` swaps the left-drag between orbit and pan once the camera is closer than a threshold. The scene palette (background, fog, floor, cable-jacket colour, IBL environment preset) is theme-driven via `SCENE_PALETTES` and swaps live when the app's `data-theme` attribute changes.

**Two racks together** (`MultiRackTopologyPage.jsx`). A two-rack scan can render **all member racks in one shared `<Canvas>`**, side-by-side at a fixed spacing on one floor, one camera. It fetches each rack's topology plus `GET /api/rack-group/:groupId/links` for the handful of **inter-rack uplinks**, which it draws as real cables that leave an actual switch port in one rack, sag across the gap, and land on an actual port in the other. Selection is scoped per-rack. The route `/results/:rackId/topology` is handled by `RackTopologyRoute.jsx`: a standalone rack falls through to the normal single-rack page, while a group shows its own 2D / 3D toggle — 2D renders each rack's elevation side-by-side with a connector rail, 3D embeds the combined scene. The combined scene also has its own page at `/multi-rack/:groupId/topology`, reachable from the rack switcher's **3D** button.

**A note on controls not currently surfaced.** The code also contains a **cable-type filter** (All / Cat / Fibre / DAC), a **capacity heat-map** (recolour devices green→amber→red by free-port fraction) and a **two-device trace** (a breadth-first path search over the aggregated links). Their logic is fully wired into the data layer — `filteredTopo`, `freePctByDevice`, `aggEdges`, `tracePath` — and passed into the 3D scene, but the toolbar that would expose those on/off buttons (`Toolbar`) is **not rendered in the current build**, so there is no on-screen filter, capacity or trace control today. Likewise, an older node-and-edge tiered graph (`Graph2D`) still exists in the file but is not used — the live 2D view is the rack elevation.

## 7. Edge cases & limits

- **Snapshot not ready.** Open Topology too soon after a scan and you get the "being prepared" state. It regenerates in the background and the page keeps re-checking for about a minute; **Retry** forces another attempt, and rescanning the rack regenerates it.
- **A rack with no cables.** Everything still draws — the devices, shelves and ports are all there — and the detail panel simply says "No cables detected on this rack yet." You can still tap devices to inspect their ports.
- **Cables to unusual device types.** In the 3D scene, ports are only positioned for switches, patch panels and servers. A cable whose end lands on some other class of device (a PDU, say) has no port position to attach to and is quietly skipped in 3D — the 2D elevation, which anchors cables to a device's edge rather than an exact port, can still show it.
- **Missing port data.** If a cable references a port the device doesn't actually expose, that one cable is skipped rather than drawn to the wrong place. Devices with no detected ports simply show no port grid.
- **Performance.** The 3D scene draws **every** cable as its own lit tube by default, so a very densely-cabled rack (or several racks in the combined scene) means a lot of geometry. It runs well on modern phones and laptops, but an older device may feel it. Because 3D is lazy-loaded, staying in the 2D view keeps the page lighter.
- **The wiring is inferred.** As above — real endpoints, best-guess pairing. Don't treat the drawn cable runs as a verified wiring record unless a curated override exists for the rack.

## 8. Real vs synthetic

| Thing on screen | Real or a best guess |
|---|---|
| Devices, their classes, shelf positions and sizes | **REAL** — from the scan. |
| Port counts, and which ports are connected vs free | **REAL** — from the per-port detection. |
| Which port connects to which (the pairing) | **BEST GUESS** — inferred, not network-verified. |
| Cable IDs, cable types (e.g. Cat6a) and lengths (e.g. 5m) | **BEST GUESS** — generated by a stable, repeatable recipe. |
| The external aggregation / "core / uplink" device | **GENERATED** — a stand-in place for the switch uplinks to terminate. |
| Model / management IP where the photo couldn't read them | **GENERATED** — plausible placeholders, flagged as generated. |
| Values from a curated per-rack override, when one exists | **REAL** — these replace the guesses. |

**The important line:** cables are only ever drawn on ports the scan actually detected as connected, so the two ends of every cable are real even though the specific pairing, cable ID, type and length are best guesses. Treat the wiring as plausible placeholder cabling for planning — not as verified physical or network-discovered connections — unless your team has supplied a curated override for that rack.

## 9. Use cases

- **Get your bearings on a rack you didn't build.** The elevation shows what is where at a glance — which shelf holds which switch, how full each device is, and roughly how it's wired.
- **Brief someone visually.** The 3D scene is a shareable, self-explanatory picture of a rack — far easier to talk over than a spreadsheet of positions and ports.
- **Check a device's ports before a change.** Tap a switch or panel to see its full ports table — which are connected, what they connect to, and the far end — before you move or add hardware.
- **See how two racks relate.** For a two-rack scan, the combined view puts both racks in one space and draws the uplinks that actually cross between them, so the relationship is obvious.
- **A shared reference.** Because the topology is built from the same rack inventory the other views use, it's a common picture the whole team can point at.

## 10. Common questions

**Q: Where do I find Rack Topology?**
Open a rack's results and choose the **Topology** tab, or go to the rack's `…/topology` page. For a two-rack scan you'll also see a **3D** button in the rack switcher that opens both racks together in one scene.

**Q: What's the difference between the 2D and 3D views?**
They're the same rack, drawn two ways. **2D** is a flat, front-on elevation — fast to read, good for scanning shelf positions and port states. **3D** is an interactive model you can orbit, tilt and zoom, with the cabling drawn as tubes. Use the **2D / 3D** toggle to switch; your choice is remembered for next time.

**Q: How do I move around in the 3D scene?**
Right-click and drag to **orbit**, scroll to **zoom**. Once you zoom in past a point, dragging switches to a **hand-pan** (the cursor turns into a grab hand) so you can slide across a device's front panel. Tapping empty space clears whatever you had selected.

**Q: Why can I open the rack's side doors?**
The 3D rack has clickable glass side panels that **swing open** when you tap them — a way to "look inside" the rack. It's purely visual; it doesn't change any data.

**Q: How do I see what a device connects to?**
**Tap the device** (in either view). The panel at the bottom shows its class, shelf and model, a strip of its connected neighbours, and a full **ports table** listing each port's status, the cable, the connector, the type and length, and the device on the other end.

**Q: What do the port colours mean?**
In the 2D view a legend spells them out: connected copper (RJ45), free RJ45, SFP/fibre, console, and uplink each have their own colour. In 3D the jacks are shaded more simply — connected, empty, uplink and highlighted ports look different — and hovering a device gives you a card with the exact connected-vs-free count.

**Q: Are the cables real?**
The **ends** are real — a cable is only ever drawn on a port the scan actually saw as plugged in. But **which port pairs with which**, along with the cable IDs, types and lengths, is a best guess unless your team supplied a curated override. Use it as a plausible starting point, not a verified wiring record.

**Q: It says "Topology is being prepared" — what should I do?**
Nothing, usually. The snapshot builds in the background after a scan and the page keeps re-checking for about a minute, so it normally appears on its own. If it doesn't, tap **Retry**, or rescan the rack to regenerate it.

**Q: Can I filter cables by type, see a capacity heat-map, or trace a path between two devices?**
Not from a button in the current app. Those capabilities exist in the code's data layer, but the toolbar that would switch them on isn't shown in this build — so today there's no on-screen filter, capacity or trace control. What you can do is tap a device to see its ports and neighbours, and tap a single cable (in 3D) to see its two ends.

**Q: What's the "UPLINK / EXTERNAL" or "CORE" device I see outside the rack?**
That's a stand-in aggregation point where the switch uplinks terminate. It's generated (it lives outside the rack), and it's drawn on a shelf above the rack in 3D or in the right-hand "UPLINK · EXTERNAL" column in 2D so you can see where the uplinks go.

**Q: Can I see two racks at once?**
Yes — a two-rack scan can render both racks in one shared 3D space, side by side on the same floor, with the handful of **inter-rack uplink cables** drawn between them and a panel listing those cross-rack connections. The `…/topology` page also offers a 2D version that puts the two elevations next to each other.

**Q: Why does the scene look different in light and dark theme, and does my view choice stick?**
The 3D scene reads the app's theme and swaps its background, floor and cable-jacket colours to match, live, when you toggle themes. And yes — whether you last used 2D or 3D is remembered, so Topology reopens the way you left it.
