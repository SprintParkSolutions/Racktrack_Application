# Glossary & Terminology

*Plain-English definitions of the rack, networking, and RackTrack-specific words you meet across the app — one clear meaning per term, plus a quick-lookup Q&A.*

Reference · All users · Last verified: 26 July 2026.

---

## 1. In simple terms

RackTrack sits at the meeting point of two worlds: **data-centre hardware** (racks, switches, patch panels, cables) and **RackTrack's own features** (Ground Truth, Drift, Reconciliation, the AI models). If you are new to either, the words fly thick and fast. This glossary is the single place to look one up.

Each entry gives you **one clear definition in two to four sentences**. For standard industry terms (RJ45, VLAN, PoE) you get the plain meaning plus a note on where RackTrack shows it. For terms that mean something specific *inside RackTrack* — Ground Truth, Drift, the occlusion gate, the models — the definition is checked against how the code actually behaves, so it is the real thing, not a generic guess. Where a word has a RackTrack-specific twist, the entry says so.

Use Section 2 to read down the groups, or jump to the **Common questions** in Section 3 for atomic "what is X?" answers.

---

## 2. The glossary

### Hardware & rack terms

**Rack** — A tall metal frame that holds network and computer equipment in a standard 19-inch-wide column, stacked vertically. RackTrack's whole job starts here: you photograph the front of one rack and it maps out what is inside. A photo that contains no rack equipment is rejected before analysis with a "this doesn't look like a server rack" message.

**Rack Unit (U / RU)** — The standard height measurement for rack equipment: **one U is 1.75 inches (44.45 mm)** of vertical space. Gear is described by how many U it takes up — a thin switch is 1U, a bigger server might be 2U or 4U. RackTrack measures one U from the median height of the switches (or patch panels) it detects, then lays an invisible ruler up the rack so each device gets a slot.

**U-position** — Where a device sits on that rack ruler, written as a U number or a range. RackTrack numbers slots **from the bottom up (u01 at the bottom)**, the standard rack convention, so a 2U server correctly reads as "U05–U06" rather than a vague midpoint. The U-position is how RackTrack matches a scanned device to a CMDB record — by *position and type*, since the camera never reads a device's name.

**Device** — Any single piece of equipment RackTrack detects and boxes in a rack photo. Its detection model recognises exactly **12 kinds**: Closed Unit, Empty, Firewall, Gateway, Load Balancer, PDU, Patch Panel, Router, Server, Storage Unit, Switch, and UPS. Only some of these have ports you can inspect (see *Port-bearing*).

**Switch** — A network device that connects many wired devices together and forwards traffic between them, usually a 1U or 2U box with a row of ports across the front. Switches are the most important class to RackTrack: it uses their standard 1U height to build the rack ruler, and they are the only class Switch Information, Network View, and the live Ports tab work on.

**Router** — A device that moves traffic *between* separate networks (for example between your office network and the internet). It looks similar to a switch but does a different job. In RackTrack a Router is its own device class, kept out of Switch Information on purpose so a router is never mislabelled as a switch.

**Firewall** — A security device that inspects traffic and blocks or allows it by rules, guarding the boundary between networks. RackTrack detects it as one of its port-bearing classes, so you can locate ports on it.

**Gateway** — A device that acts as the entry/exit point between one network and another, often translating between different systems or protocols. RackTrack treats it as a distinct, port-bearing device class.

**Load Balancer** — A device that spreads incoming traffic across several servers so no single one is overwhelmed. RackTrack detects it as its own class, but it is not port-bearing in the app, so you cannot locate individual ports on it.

**Server** — A computer that runs applications, stores data, or serves other machines; in a rack it is usually a flat chassis one or more U tall. RackTrack detects servers but does **not** try to find ports on them — its port detection runs only on switches, patch panels, firewalls, gateways and routers, to avoid inventing ports that aren't really there.

**Storage Unit** — A rack device dedicated to holding data — a disk array or storage chassis. It is one of RackTrack's 12 device classes (the model stores it internally as "Storage unit"). Like servers, it is detected and placed in the rack but is not treated as port-bearing.

**Patch Panel** — A passive panel of many identical jacks (usually 24 or 48 RJ45 sockets) used to organise and terminate cabling; it has no power and no intelligence of its own. RackTrack detects patch panels and counts their jacks, snapping the count to the nearest standard size (**24 or 48**). Because a patch panel is passive copper with no MAC address, it never appears in Network View's live device list.

**PDU (Power Distribution Unit)** — A rack power strip: a bar of electrical outlets that feeds power to the other devices in the rack. RackTrack detects PDUs with a dedicated model that counts the **power outlets** and reports how many have a plug in them and whether the unit is powered — its "ports" are outlets, not network ports.

**UPS (Uninterruptible Power Supply)** — A battery-backed power unit that keeps equipment running for a while during a power cut and smooths out spikes. RackTrack detects it as one of its 12 device classes; it is placed in the rack inventory but has no user-inspectable network ports.

**Closed Unit** — A placeholder row RackTrack's model emits for a rack slot that is covered by a blank filler panel or otherwise closed off, with no visible equipment. It is not a real device, so RackTrack hides it from the device picker, the port overlay, and the Ground Truth list — there is nothing to inspect.

**Empty** — A placeholder for a rack slot the model judged to be an open, unused gap. Like Closed Unit, it is kept in the raw map so no row silently vanishes, but it is hidden from the pickers. Note the pipeline is cautious about claiming "Empty": an unclaimed grid row is usually labelled *Unidentified* instead, because a rack slot almost always holds *something*.

**Unidentified** — A row the model detected as occupied but could not confidently classify, or a port-bearing device that was demoted because no ports were found on it. It is deliberately kept visible (not thrown away) because it is the single most valuable thing for a human to name — which is exactly what Ground Truth exists to fix. Unlike Empty and Closed Unit, an Unidentified device *is* shown in Ground Truth so an owner can give it a real type.

### Ports & cabling

**Port** — A single socket on a device's front face where a cable plugs in. RackTrack finds ports with its computer-vision models and sorts every one into four buckets — **RJ45, SFP, Console, USB** — each with its own count. A device's headline "port count" specifically means its RJ45 (main) count.

**RJ45** — The most common copper network connector: the 8-pin clip-in plug on the end of an ordinary Ethernet cable, and the square jack it goes into. RackTrack's port-type model detects the RJ45 shape and files it under the **RJ45 (main)** category; a device's `port_count` is its RJ45 count.

**SFP / SFP+** — A small slot (a "cage") on a switch that accepts a plug-in transceiver module, most often for a **fibre-optic** or high-speed direct-attach cable. SFP runs at 1 Gbps and SFP+ at 10 Gbps, but they use the same physical cage. RackTrack's model detects the SFP cage shape and shows it under the **SFP** category; it reads the connector shape from the photo, not the exact speed grade.

**QSFP** — A larger transceiver cage than SFP, carrying four channels in one module for higher speeds (typically 40/100 Gbps uplinks). RackTrack detects QSFP as its own port type but **folds it into the same SFP category button** as SFP, since both are fibre/transceiver cages.

**Console port** — A management socket used to connect directly to a device to configure it, separate from the normal data ports. RackTrack groups three detector types — CONSOLE, AUX, and MANAGEMENT_PORT — into a single **Console** category.

**USB port** — A standard USB socket on a device, used for management, storage, or peripherals rather than network traffic. RackTrack detects USB-A, USB-B, and USB-C shapes and folds them into one **USB** category (internally the "other" bucket).

**PoE (Power over Ethernet)** — A feature where a switch sends electrical power down the same Ethernet cable that carries data, so a device like a camera, phone, or access point needs only one cable. RackTrack shows a switch's PoE budget on the live Ports/Lab view when the switch reports it (a "PoE (W)" column and a "PoE budget … used …" line); it reads this from the real switch over SSH, not from the photo.

**Uplink** — The connection that carries traffic *out* of a switch or rack up to a higher point — a core/aggregation switch, or another rack. In RackTrack's topology views, switch uplinks fan up to a shared external "UPLINK / CORE" point drawn just outside the rack, and in a two-rack scan the **inter-rack uplinks** are the handful of cables drawn crossing between the two racks (fibre in amber, direct-attach copper in cyan/blue).

### Networking

**MAC address** — The unique hardware identifier burned into every network interface, written as six pairs of hex digits (for example `00:1A:2B:3C:4D:5E`). A switch "learns" the MAC addresses of the devices reachable behind each port. In Network View, RackTrack shows a per-port count of learned MACs, which tells you how many devices are actually live behind that port.

**VLAN (Virtual LAN)** — A way to split one physical switch into several separate logical networks, so ports on the same box behave as if they were on different, isolated networks — each VLAN identified by a number. In Network View, RackTrack groups a switch's live ports by their VLAN (with an "Untagged" group for ports on no VLAN). Note that VLAN is **not** one of the fields the Drift poller tracks, so a VLAN change never produces a drift event.

**LLDP (Link Layer Discovery Protocol)** — A vendor-neutral protocol switches use to announce themselves to their directly-connected neighbours, so each end can learn what is on the other side of a cable. RackTrack polls LLDP over SSH (`show lldp neighbors detail`) to read each port's neighbour — its chassis ID, remote port, and system name — and a change in that neighbour is how RackTrack detects a re-cabling.

**CDP (Cisco Discovery Protocol)** — Cisco's own equivalent of LLDP, and the default on Cisco IOS devices (which don't run LLDP unless it's explicitly turned on). RackTrack's on-demand switch audit asks for **both** LLDP and CDP and merges them, so the Neighbour column still fills in even when LLDP comes back empty — which is the usual case on the lab's Cisco IOL switches.

**Neighbour** — The device seen on the far end of a cable, discovered via LLDP or CDP. RackTrack shows neighbours in a per-port column and a dedicated Neighbours tab (local port, device name, its address, its port). If a port sees more than one neighbour (a shared segment), the extras show as a muted "+2" so a shared link isn't mistaken for a point-to-point one.

**Firmware** — The built-in software that runs a piece of hardware; keeping it current is how you get bug fixes and security patches. RackTrack reads a switch's firmware **version** off its faceplate text (OCR) during a scan, then Switch Information checks that version against the latest the vendor ships and tells you "Up to date" or "Upgrade available." It never fabricates a version — if it can't read one, it asks you to type it in.

### RackTrack features & AI terms

**Scan** — One capture-and-analysis run on a rack: you give RackTrack a photo (or a video frame), and it produces the full device-and-port inventory for that rack. A scan is the unit everything else hangs off — Results, Ports, Ground Truth, Drift, and Reconciliation all operate on a scan. Each scan has a rack ID (of the form `RK-…`) and its outputs live in `outputs/<rackId>/`.

**Ground Truth** — An **owner-only** screen for verifying, device by device, what the model detected in a *single* scan. For each detected device the owner taps **Correct** (the model was right) or **Not this** and picks the real type. A confirmation nudges the measured accuracy up; a correction fixes the label everywhere in the scan and becomes a labelled training example, so the model learns. The name comes from machine learning, where "ground truth" means the known-correct answer you measure a model against.

**Drift** — In its main sense (the **Drift tab**), a recorded difference in a monitored switch's port state since the last time RackTrack polled it — a link came up or dropped, a speed renegotiated, a description changed, or an LLDP neighbour changed (a re-cable). It is a change log, **not an alarm**: drift is stored and logged, never pushed as a notification. A second, separate sense is *physical/CMDB drift* — a device found at a different rack-U than the records expect (see *Reconciliation*).

**Reconciliation** — Lining up what your CMDB *expects* in a rack against what the camera *actually saw*, one U-position at a time, and flagging every disagreement. For each CMDB record RackTrack works out the class and U it should be, checks what the scan detected there, and returns one of four verdicts: **✓ match**, **⚠ low-confidence match**, **✗ mismatch (physical drift)**, or **? unknown** (no position on the record). It matches by *position and type*, never by name, because the scan doesn't read device names. The result is written as a work note on the ServiceNow incident.

**CMDB (Configuration Management Database)** — Your system of record for what equipment exists and where — the database your organisation trusts to say what's in every rack. In practice this almost always means **ServiceNow**. RackTrack connects to it so it can register scanned racks into it (behind an approval) and reconcile it against what the camera sees.

**ServiceNow** — The IT-service-management and CMDB platform RackTrack integrates with most deeply. It is the one connection type where the **live** registration, reconciliation, and incident-refresh flows actually run — other types (NetBox, SolarWinds Orion, Spectrum, generic SQL/REST) can be saved but are backed only by mock routes today. Registrations are gated behind a ServiceNow Service Request that must be approved before anything is written.

**Ask DOT** — RackTrack's in-app support assistant (also branded **"Assist"** on the floating help button). Its defining rule is that it **never makes things up**: it answers only from a verified knowledge base, either word-for-word ("Verified answer") or by having a language model rephrase matched entries ("Composed from documentation"), and if nothing matches it honestly refuses and hands you to a human at support@racktrack.ai. Every answer carries a badge saying how it was produced, so a guess can never be mistaken for a fact.

**Two-rack / rack group** — A capture of **two racks together** as one linked pair, either as two photos or one video that pans across both. Each rack is analysed as a completely normal single-rack scan; the "group" is a thin layer on top that remembers the two belong together and adds a combined view showing the **uplink cables that cross between them**. A group ID has the form `GRP-…`, and the paired view only appears when you arrive with the group signal from the scan.

**Overlay** — The annotated rack image RackTrack draws so you can see what the machine saw: the rack photo with boxes and labels drawn on top. The main ones are the **device overlay** (`2_devices_only.png`, device boxes with type and U labels) and the **all-ports overlay** (`7_rack_all_ports.png`, every device plus every detected port, colour-coded). Placeholder classes (Empty, Closed Unit, Unidentified) are skipped on the port overlay so they don't clutter it.

**Bounding box** — The rectangle a detection model draws around a thing it found — one box per device, and one per port. RackTrack keys everything off these rectangles: the device boxes drive the U-grid and the port crops, and the port boxes drive port counting and location. (The device model can also produce pixel-level masks, but the pipeline uses only the boxes.)

**Segmentation model** — The single AI model that finds the equipment in a rack photo: `devices_seg.pt`, a **YOLOv8m-seg** model trained on the **12 device classes**. "Segmentation" means it can outline each object's exact pixels, though RackTrack currently consumes only its bounding boxes. It is the first and most important model in the pipeline; without a Switch or Patch Panel in its output, no U-grid can be built.

**OCR (Optical Character Recognition)** — Reading printed text out of an image. RackTrack runs OCR on each detected switch's faceplate crop to pull out the **maker, model, and firmware version**, which feed Switch Information's spec, firmware, and optics lookups. OCR also grounds the port count: if it recognises a known model whose datasheet port count differs from the visual count, it trusts the datasheet.

**Occlusion** — When the rack (or its ports) is hidden behind clutter — usually a dense bundle of cables — so equipment can't be clearly seen. On upload, RackTrack runs an **occlusion gate**: a MobileNetV2 model (`rack_classifier.pth`) judges the whole photo clear-vs-occluded. At probability **≥ 0.55** it hard-stops and offers side-angle re-capture; **0.50–0.55** is a soft warning; below that it proceeds. The point is honesty — a heavily cabled rack can hide devices, so RackTrack warns you rather than quietly missing them.

**Confidence** — How sure a model is about a single answer, shown as a percentage. RackTrack surfaces it as a coloured chip — **green when fairly sure (75%+), amber in the middle (50–74%), red when unsure (below 50%)** — for example on each device row in Ground Truth. Reconciliation uses a 0.5 confidence threshold to decide between a clean match and a "low-confidence" one. A confidence score is also how you tell a real detection from a synthesised placeholder, which has none.

---

## 3. Common questions

**What is a U?**
"U" is the standard unit of rack height — one U equals **1.75 inches (44.45 mm)** of vertical space. Equipment is measured in U (a thin switch is 1U, a big server might be 2U or 4U), and RackTrack maps each device to the U slot(s) it occupies.

**What is a rack unit?**
It's the same thing as a "U" (sometimes written "RU") — one 1.75-inch slot of vertical space in a rack. RackTrack builds an invisible ruler of these slots up the rack, numbered from the bottom (u01) upward, and assigns each device its slot.

**What is a U-position?**
It's where a device sits on the rack ruler, given as a U number or range like "U05–U06." RackTrack numbers from the bottom up (u01 at the bottom) and uses the U-position to match scanned devices to CMDB records by position and type.

**What is a rack?**
A standard 19-inch-wide metal frame that holds network and computer gear stacked vertically. RackTrack works one rack at a time: you photograph the front of a rack and it maps out what's inside.

**What is RJ45?**
RJ45 is the common 8-pin copper connector on the end of an ordinary Ethernet cable, and the square jack it plugs into. In RackTrack, RJ45 ports are the "main" category, and a device's headline port count is its RJ45 count.

**What is SFP?**
SFP is a small slot ("cage") on a switch that takes a plug-in transceiver module, usually for a fibre-optic or high-speed direct-attach cable. SFP+ is the same cage running at 10 Gbps. RackTrack detects the SFP cage from the photo and shows it under the SFP category.

**What is QSFP?**
QSFP is a larger, four-channel transceiver cage used for high-speed uplinks (typically 40/100 Gbps). RackTrack detects it as its own port type but groups it under the same SFP category button as SFP.

**What is a console port?**
A management socket used to connect directly to a device to configure it, separate from its data ports. RackTrack folds CONSOLE, AUX, and MANAGEMENT_PORT detections into one "Console" category.

**What is a patch panel?**
A passive panel of many identical jacks (usually 24 or 48 RJ45 sockets) used to organise and terminate cabling — no power, no intelligence. RackTrack counts its jacks and snaps the total to the nearest standard size (24 or 48); because it's passive with no MAC address, it never appears in the live Network View.

**What is PoE?**
Power over Ethernet — a switch sending electrical power down the same Ethernet cable that carries data, so a camera, phone, or access point needs only one cable. RackTrack shows a switch's PoE budget (in watts) on the live Ports/Lab view when the switch reports it over SSH.

**What is a PDU?**
A Power Distribution Unit — a rack power strip that feeds electricity to the other devices. RackTrack detects PDUs with a dedicated model that counts the power outlets, says how many are in use, and reports whether the unit is powered; a PDU's "ports" are outlets, not network ports.

**What is a UPS?**
An Uninterruptible Power Supply — a battery-backed unit that keeps equipment running through a power cut and smooths out spikes. RackTrack detects it as one of its 12 device classes; it's placed in the rack inventory but has no network ports to inspect.

**What is a switch?**
A network device that connects many wired devices and forwards traffic between them, usually a flat 1U/2U box with a row of ports. It's central to RackTrack: their standard 1U height sets the rack ruler, and Switch Information, Network View, and the live Ports tab all work on switches.

**What is a router?**
A device that moves traffic between separate networks (for example your office and the internet). RackTrack keeps Router as its own class, distinct from Switch, so it's never mislabelled as one.

**What is a firewall?**
A security device that inspects traffic and allows or blocks it by rules, guarding the boundary between networks. RackTrack detects it as one of its port-bearing device classes.

**What is a gateway?**
A device that serves as the entry/exit point between one network and another, often translating between systems. RackTrack treats it as its own port-bearing device class.

**What is a server?**
A computer that runs applications, stores data, or serves other machines; in a rack it's a flat chassis one or more U tall. RackTrack detects servers but deliberately doesn't look for ports on them, to avoid inventing ports that aren't there.

**What is an uplink?**
The connection that carries traffic out of a switch or rack up to a higher point — a core/aggregation switch or another rack. RackTrack draws switch uplinks fanning up to an external "UPLINK / CORE" point outside the rack, and in a two-rack scan it draws the inter-rack uplink cables crossing between the racks.

**What is a MAC address?**
The unique hardware ID burned into every network interface, written as six hex pairs like `00:1A:2B:3C:4D:5E`. Switches learn which MACs are reachable behind each port; RackTrack's Network View shows a per-port count of learned MACs so you can see how many devices are live behind a port.

**What is a VLAN?**
A Virtual LAN — a way to split one physical switch into several separate logical networks, each with its own number, so ports on the same box act as if isolated. RackTrack groups a switch's live ports by VLAN in Network View. (It does not track VLAN changes as drift.)

**What is LLDP?**
Link Layer Discovery Protocol — a vendor-neutral way for switches to announce themselves to directly-connected neighbours, so each end learns what's across a cable. RackTrack polls LLDP over SSH to read each port's neighbour, and a change of neighbour is how it flags a re-cabling.

**What is CDP?**
Cisco Discovery Protocol — Cisco's own version of LLDP, and the default on Cisco IOS gear (which doesn't run LLDP unless told to). RackTrack asks for both LLDP and CDP and merges them, so the Neighbour column still fills in when LLDP is empty.

**What is a neighbour?**
The device on the far end of a cable, discovered via LLDP or CDP. RackTrack shows it per port and in a Neighbours tab; if a port sees several neighbours (a shared segment), the extras show as a muted "+2".

**What is firmware?**
The built-in software that runs a piece of hardware; keeping it current brings fixes and security patches. RackTrack reads a switch's firmware version from its faceplate (OCR), then Switch Information checks it against the vendor's latest and says "Up to date" or "Upgrade available" — it never invents a version.

**What is CMDB?**
A Configuration Management Database — your system of record for what equipment exists and where, which in practice almost always means ServiceNow. RackTrack connects to it to register scanned racks into it and to reconcile it against what the camera actually sees.

**What is reconciliation?**
Comparing what your CMDB expects in a rack against what the scan actually detected, one U-position at a time, and flagging every disagreement. RackTrack returns a verdict per record — match, low-confidence match, mismatch (physical drift), or unknown — matching by position and type, and posts the result as a work note on the ServiceNow incident.

**What is drift?**
Its main sense is a recorded difference in a monitored switch's port state since the last poll — a link up/down, a speed change, a description edit, or a changed LLDP neighbour (a re-cable). Drift is a change log, not an alarm: it's stored and logged but never pushed as a notification. (Separately, "physical drift" means a device found at a different U than the CMDB expects.)

**What is ground truth?**
An owner-only screen for verifying, device by device, what the model detected in a single scan — tapping "Correct" or "Not this" and picking the real type. Confirmations measure accuracy; corrections fix the label everywhere and become training examples. The term comes from machine learning, where "ground truth" is the known-correct answer a model is measured against.

**What is a segmentation model?**
The AI model that finds the equipment in a rack photo — RackTrack's `devices_seg.pt`, a YOLOv8m-seg model trained on 12 device classes. "Segmentation" means it can outline each object's exact pixels, though RackTrack uses only its bounding boxes. It's the first and most important model in the pipeline.

**What does occlusion mean?**
Occlusion is when the rack or its ports are hidden behind clutter, usually a dense bundle of cables. On upload, RackTrack's occlusion gate (a MobileNetV2 model) judges the photo clear-vs-occluded and hard-stops at a high score, offering side-angle re-capture — because a buried rack can hide devices, and warning you is more honest than quietly missing them.

**What is a bounding box?**
The rectangle a detection model draws around something it found — one per device, one per port. RackTrack keys everything off these boxes: device boxes build the U-grid and the crops, port boxes drive counting and location.

**What is an overlay?**
The annotated rack image with boxes and labels drawn on the photo, so you can see what RackTrack saw. The main overlays are the device overlay (device boxes with U labels) and the all-ports overlay (every device plus every detected port, colour-coded).

**What is OCR?**
Optical Character Recognition — reading printed text out of an image. RackTrack runs OCR on each switch's faceplate to pull the maker, model, and firmware version, which drive Switch Information's lookups and can correct the port count against a known model's datasheet.

**What is confidence?**
How sure a model is about one answer, shown as a percentage and a coloured chip — green when fairly sure (75%+), amber in the middle (50–74%), red when unsure (below 50%). Reconciliation uses a 0.5 threshold to separate a clean match from a low-confidence one.

**What is a scan?**
One capture-and-analysis run on a rack: you give RackTrack a photo or video frame and it produces the full device-and-port inventory. Everything else — Results, Ports, Ground Truth, Drift, Reconciliation — operates on a scan, and each has a rack ID like `RK-…`.

**What does "Unidentified" mean on my results?**
It's a row the model saw as occupied but couldn't confidently name, or a port-bearing device demoted because no ports were found on it. It's kept visible on purpose — it's the most valuable thing for a person to correct — and it's the one placeholder that does appear in Ground Truth so an owner can give it a real type.

**What's the difference between "Empty" and "Closed Unit"?**
Both are placeholders for rack slots with no real equipment: "Empty" is an open, unused gap, and "Closed Unit" is a slot covered by a blank filler panel. Neither is a real device, so both are hidden from the device picker, the port overlay, and Ground Truth.

**What is Ask DOT?**
RackTrack's in-app support assistant (also called "Assist"). It answers only from a verified knowledge base and never makes things up — either word-for-word, or by rephrasing matched entries — and if nothing matches it honestly refuses and points you to support@racktrack.ai. Each answer carries a badge showing how it was produced.

**What is a two-rack scan (rack group)?**
A capture of two racks together as one linked pair, from two photos or one panning video. Each rack is analysed as a normal single-rack scan; the group adds a combined view that draws the uplink cables crossing between the two racks. A group is identified by an ID like `GRP-…`.

**What is ServiceNow, and why does it matter to RackTrack?**
ServiceNow is the IT-service-management and CMDB platform RackTrack integrates with most deeply — the one connection type where live registration, reconciliation, and incident refresh actually run. Every registration into it is gated behind a Service Request that must be approved before anything is written.

---

*Glossary & Terminology — RackTrack knowledge base.*
