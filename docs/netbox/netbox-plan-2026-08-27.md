# RackTrack → NetBox: the complete plan

**Internal only. Do not send this document to the client.**
Written 27 Aug 2026. Covers: the Slovakia university enquiry, the honest state of RackTrack today,
the answer to the network-admin question, the office rack build, and the phased plan.

---

# PART 0 — Read this first

Before anything else, one finding from your own codebase that changes how you should answer the client.

**The cable connections RackTrack produces today are not real. They are generated.**

In `outputs/<rack>/topology.json` every device carries `"synthetic": true`, and the sibling file
`cmdb_synthesis.json` says so out loud:

```
"marker": "synthetic_data=true",
"synthetic": [
  { "name": "SW-U14", "kind": "switch",
    "fields": ["model_number","serial_number","mgmt_ip","mac","os","port_prefix"] },
  ...
]
```

That file is an honest label your own pipeline writes. It means: the model number
("Catalyst 9300-48P"), the serial number, the management IP, the MAC, and **all 83 cable edges**
in that topology were invented to make the demo look complete. They were not read off the rack.

Meanwhile the *real* OCR output for the same rack (`ocr_devices.json`) looks like this:

```
{ "position": "U16", "class_name": "Unidentified",
  "make": null, "model": null, "raw_text": "NET CABLE redus combe",
  "ocr_conf": 0.903, "match_conf": 0.0, "source": "ocr_failed" }
```

So on a real photo the pipeline currently reads garbled text and returns make = null, model = null.

**Why this matters more than anything else in this document:** the single thing the Slovakia client
says they care most about — "the combination of computer vision with LLDP/CDP telemetry to determine
and verify physical cable-to-port relationships" — is precisely the part that is synthetic today.

If you demo `topology.json` as-is, it will look perfect. If they then run a PoC on their own rack
and the cables don't match reality, you lose the deal *and* the reference. A university in the EU
will talk to other universities. Don't do it.

The good news, in the same breath: **the LLDP half is genuinely real.** You have Netdisco wired in
(`server/netdisco_proxy.js`, `netdisco-docker/`), a real SSH port poller pulling live LLDP neighbours
(`server/lib/port_poller.js`), verified per-vendor parsers for TP-Link and Cisco
(`server/lib/tplink_parser.js`, `cisco_parser.js`), and a 52-vendor command matrix. And the CV half
genuinely detects racks, U positions, device classes, individual ports, port occupancy and cable
colour (`Models/ports_9.pt`, `pipeline/port.py`, `pipeline/cable.py`).

What is missing is **the join between them.** That is the product. That is what this plan builds.

---

# PART 1 — What the client is actually asking for, in plain language

Strip out the jargon and they are asking six questions.

### 1. "Do you plug into NetBox already?"
NetBox is the software they already use to record their network. They don't want a second system to
maintain. They want RackTrack to *feed* NetBox. So the real question is: **is RackTrack a source of
data for NetBox, or is it a competing place to store data?** Answer must be: a source. RackTrack
scans, NetBox stores. Never position RackTrack as a NetBox replacement — you'll lose immediately.

### 2. "If not, how do I get the data out?"
They want to know they aren't locked in. REST API, JSON, CSV, webhooks. Easy to answer well.

### 3. "Can you produce these specific objects?"
Sites, Racks, Devices, Device Types, Interfaces, Patch-panel ports, Cables, Serial numbers, Asset
tags. That list is not random — those are **the exact table names inside NetBox.** They are telling
you they've read the NetBox data model and they want a 1:1 mapping. This is a technically literate
buyer. Treat them as one.

### 4. "Can a cable come out with BOTH ends?"
This is the sharpest question in the letter. In NetBox a cable is useless unless you say what's on
*both* ends — "Switch-A port 12" **and** "Patch-panel-3 front port 7". A cable with one end is not a
cable, it's a note. They are checking whether you actually have connection data or just an inventory
list with photos.

### 5. "What does it cost for 20–100 racks across several data centres?"
They're sizing a budget for a tender. Universities buy on published, defensible pricing.

### 6. "Will you scan one of our real racks and show us?"
This is the actual decision point. Everything else is preamble. The PoC is where you win or lose.

**And the line that matters most, quoted verbatim:**

> "The key capability we are particularly interested in is the combination of computer vision with
> LLDP/CDP/network telemetry to determine and verify physical cable-to-port relationships."

They have understood the value proposition better than most prospects. They know CV alone can't
reliably trace a cable through a rat's nest at the back of a rack, and they know LLDP alone can't
see patch panels, PDUs or which rack unit anything sits in. They want the *fusion*. That is the
right instinct and it is exactly the right thing to build.

---

# PART 2 — Honest audit: what RackTrack has today

Three columns — real, partly real, invented. Nothing here is a criticism; you need the map before
you can plan a route.

## 2.1 The physical side (camera / CV)

| Capability | Status | Where it lives |
|---|---|---|
| Detect the rack outline in a photo | **Real** | `pipeline/rack_classifier.py`, `rack_stitch.py` |
| Split the rack into U positions (U01, U02 …) | **Real** | `device_unit_map.json` → `units_detected` |
| Classify each device visually | **Real, but coarse** | 4 classes: Switch, Patch Panel, Server, Closed Unit (+ Unidentified) |
| Detect individual ports on a device | **Real** | `Models/ports_9.pt`, `pipeline/port.py` |
| Say whether a port is occupied or empty | **Real** | `infer_port_status`, confidence floor 0.35 |
| Count main / SFP / console ports | **Real** | `scan_result.json` → `port_count`, `sfp_ports`, `console_ports` |
| Classify the colour + type of a cable in a port | **Real** | `pipeline/cable.py`, 14 classes (RJ45 × 11 colours, LC/SC fibre) |
| Read text off the device front | **Real but weak** | `switch_ocr/` — on real photos frequently `source: "ocr_failed"` |
| Identify make + model from that text | **Weak** | `switch_ocr/identify.py` → `DeviceID(brand, model, confidence)`; nulls on real photos |
| Read a **serial number** | **Not built** | No serial extraction anywhere in the CV path |
| Read an **asset tag** | **Not built** | `pipeline/ocr_labels.py` reads labels, but there is no asset-tag field in the output schema |
| Trace a cable from port A to port B visually | **Not built** | Cable model classifies *colour of the cable in one port*. It does not follow the cable |
| Cable connections / topology edges | **INVENTED** | `topology.json` edges, `synthetic: true` |

**Plain reading:** the camera can currently tell you *"there is a switch at U14, it has 48 ports,
31 of them have blue Cat6 cables in them."* It cannot yet tell you *"it is a D-Link DGS-1210-52,
serial R4B71C8000123, asset tag SP-0442, and port 12 goes to patch panel 3 port 7."*

That first sentence is already genuinely useful and genuinely hard. Don't undersell it. But it is
not what the client asked for.

## 2.2 The logical side (network telemetry)

| Capability | Status | Where it lives |
|---|---|---|
| SSH into a switch and run commands | **Real** | `server/lib/port_poller.js` |
| Encrypted per-user credential storage | **Real** | `server/lib/ssh-creds.js`, AES-256-GCM |
| Parse TP-Link port status / config / LLDP | **Real, exact** | `server/lib/tplink_parser.js` |
| Parse Cisco IOS | **Real, exact** | `server/lib/cisco_parser.js` |
| Parse ~50 other vendors | **Identity only** | `server/lib/generic_recipe.js` — returns `rows: []` on purpose |
| **Parse D-Link** | **NOT BUILT** | D-Link is in `switch_cli_matrix.json` but only as a *generic* recipe |
| Track port changes over time (drift) | **Real** | `server/lib/port_history_db.js`, hourly poll |
| SNMP discovery, MAC tables, LLDP topology | **Real** | Netdisco stack, `server/netdisco_proxy.js` |
| Join a scan to discovered devices | **Started** | `GET /api/netdisco/scan/:rackId/match` |

**The D-Link gap is directly relevant to you**, because your office rack is D-Link-heavy. Read
`generic_recipe.js`'s own comment — it's the right call and it explains itself:

> "We do NOT have a verified parser for the other ~50 vendors, and inventing one would emit
> confident-but-wrong port/PoE/VLAN data. … returns NO port rows (rows: []) — the port table stays
> empty for a generic vendor rather than showing guessed data."

So today, if you SSH into your managed D-Link DGS-1210, RackTrack gets the hostname and version and
**zero port rows.** Which means zero LLDP, which means zero cable verification, on the very switch
you were planning to prove the concept with.

**There are two ways out, and one is much better:**

- **Option A — write a D-Link CLI parser.** Follow the shape of `tplink_parser.js`. Works, but it's
  one vendor's worth of effort, and brittle: D-Link changes its output format between firmware
  revisions, and you'd repeat the work for every future vendor.
- **Option B — go SNMP instead of SSH. ← recommended.** SNMP uses *standard MIBs* that are the same
  across every vendor. Four standard tables give you nearly everything:
  - `IF-MIB` → the port list, names, descriptions, speeds, up/down
  - `LLDP-MIB` (`lldpRemTable`) → "my port 12 is connected to device X port 24" — **this is the
    verified cable data**
  - `BRIDGE-MIB` / `Q-BRIDGE-MIB` → the MAC address table: which MACs are seen on which port
  - `ENTITY-MIB` → **model and serial number, read from the device itself**

  One code path covers D-Link, TP-Link, Sophos, Cisco, and the university's kit in Slovakia. And you
  already have the SNMP engine: **Netdisco does exactly this and it's already in your repo.**

That `ENTITY-MIB` point deserves its own line, because it solves a problem you thought was a CV
problem: **you do not need OCR to read a serial number off a managed device.** Ask the device. It
will tell you, exactly, every time. Save OCR for the things that can't answer — patch panels,
passive PDUs, blanking plates, and unmanaged switches.

## 2.3 The export / integration side

| Capability | Status |
|---|---|
| Store NetBox credentials (`base_url` + `token`) | **Real** — `connection_profiles.js`, type `netbox` already in `SUPPORTED_TYPES` |
| Anything that actually *uses* those NetBox credentials | **Does not exist** — only a mock in `server/mock_routes.js` returning `netbox_version: "3.7.0-mock"` |
| Full ServiceNow CMDB integration | **Real** — `servicenow/` has `cmdb_apply.py`, `reconciler.py`, `diff_cmdb.py`, `cmdb_interrack_link.py` |

**This is the most encouraging finding in the whole audit.** You have already built, end to end,
the exact thing the client is asking for — just pointed at ServiceNow instead of NetBox. The
credential slot for NetBox is already cut. The reconciler pattern already exists. You are not
starting from zero; you are re-targeting a working integration at a second system of record.

**Honest answer to give the client on Q1:** "Not yet — NetBox is the next integration we are
building, and it's already scaffolded in the product. We have a shipping CMDB integration
(ServiceNow) that proves the pattern." That is credible, it's true, and it's much better than
"yes" followed by a failed PoC.

---

# PART 3 — Your network admin's answer: is he right?

**Yes. He is right, and it is not him being difficult — it is a hardware fact.**

## 3.1 Managed vs unmanaged, in plain language

A **managed** switch is a small computer. It has its own IP address, you can log into it, it can be
asked questions, and it announces itself to its neighbours.

An **unmanaged** switch is a piece of wire with sockets. It has no IP address, no login, no
software you can talk to. You cannot ask it anything, because there is nothing there to ask.
It's a power lead and a plastic box that copies electrical signals between ports.

From your own network document, here is what the office actually has:

| # | Switch | Ports | Type | Can it be "given" to RackTrack? |
|---|---|---|---|---|
| 1 | D-Link **DGS-1024C** | 24 | **Unmanaged** | **No — impossible** |
| 2 | D-Link **DGS-1016D** | 16 | **Unmanaged** | **No — impossible** |
| 3 | D-Link **DGS-1210**-52 | 52 | **Managed** | Yes |
| 4 | TP-Link **TL-SG2428P** #1 | 24 | **Managed (PoE)** | Yes |
| 5 | TP-Link **TL-SG2428P** #2 | 24 | **Managed (PoE)** | Yes |

Three managed. **That is exactly the three he said he can give you.** He is not withholding two
switches. There is nothing in those two boxes to hand over — no IP, no SSH, no SNMP, no LLDP. Asking
him for management access to a DGS-1024C is like asking for the login to an extension cord.

So: **he is correct, and you should tell him so.** It'll do the relationship good.

## 3.2 About "2 D-Link and 1 uplink"

I think there's a mix-up in the naming, and it's worth clearing up because it changes the plan.

"Uplink" is **not a type of switch.** An uplink is a *port* — specifically, the port that carries
traffic from one switch up to the next switch or the firewall. Every one of your switches has one.
In your network doc, port 24 of each D-Link and TP-Link is the uplink to the Sophos firewall, and
it's cabled in blue precisely so it's identifiable.

So "2 D-Link and 1 uplink" is most likely one of these two situations:

- **(a)** Your target rack holds 2 D-Links + 1 TP-Link, and someone called the TP-Link "the uplink
  switch" because it's the one that feeds the others.
- **(b)** Your target rack holds 3 switches, and the admin's "3" refers to *all three managed
  switches across the whole office* (DGS-1210 + both TP-Links), which may not all live in that
  one rack.

**The difference matters a lot.** If the 2 D-Links in your rack are the *unmanaged* 1024C and 1016D,
then in that rack you have exactly **one** manageable switch, not three — and one switch cannot
demonstrate LLDP, because **LLDP is a conversation between two devices.** A single switch talking to
nobody produces no neighbour table and therefore no verified cables. Your whole demo would be dead
on arrival.

**This is a five-minute job that unblocks everything else — do it before you plan any further.**
Walk to the rack with your phone and photograph the front bezel of every box. The model number is
printed on it. Then fill this in:

```
Rack: ____________________   Site: ____________________
U__  ____________________________  model: ______________  managed? Y/N
U__  ____________________________  model: ______________  managed? Y/N
U__  ____________________________  model: ______________  managed? Y/N
U__  ____________________________  model: ______________  managed? Y/N   (router)
U__  ____________________________  model: ______________  managed? Y/N   (firewall)
U__  patch panel                   ports: ______
U__  patch panel                   ports: ______
```

Quick way to tell managed from unmanaged without a manual: **an unmanaged switch has no console
port and no reset/management button, and it never appears in the firewall's DHCP client list.**
If it has an IP address, it's managed.

## 3.3 The important nuance — unmanaged does NOT mean invisible

Here is the part that makes the product interesting, and it's worth understanding properly because
it's also the answer you'll give Slovakia.

You cannot log into an unmanaged switch. But you are **not** blind to what's behind it:

1. **The managed switch upstream tells you something is there.** Its uplink port will show *many*
   MAC addresses on one single port. A normal PC port shows one MAC. Fifteen MACs on one port means
   "there is a dumb switch downstream with roughly fifteen things plugged into it." You have
   detected the unmanaged switch without touching it.
2. **The firewall knows every device.** The Sophos ARP table and DHCP leases give you
   MAC → IP → hostname for *every* device on the network, including everything behind the dumb
   switches.
3. **So you know exactly which devices exist. You just don't know which physical port each one is
   plugged into.**

And *that* — which physical socket, on a switch that cannot be asked — is **precisely what the
camera can see and telemetry cannot.**

This is your product thesis, stated cleanly:

> **Telemetry knows what is connected. The camera knows where it is plugged in.
> Neither is complete. Together they are.**

Write that sentence down. It's the one-liner for the Slovakia proposal, and it's also why the
two unmanaged D-Links are an *asset* for your demo rather than a problem — they are the live proof
that a telemetry-only tool (including NetBox's own discovery plugins) cannot do this job alone.

---

# PART 4 — The office rack: what to build and what to tell the admin

Your instinct is right: configure it properly first, get it into NetBox, *then* scan it. A messy,
half-configured rack will produce a messy scan and you'll spend weeks unable to tell whether a
mismatch is a CV bug or a cabling mistake. Get the ground truth solid first.

## 4.1 What "2-tier" means here

Two tiers = two layers of switching.

- **Tier 1 — Core / Distribution.** One switch (plus the firewall) that everything else plugs into.
  This is where traffic between departments crosses, and where the VLANs are routed.
- **Tier 2 — Access.** The switches that end users, phones and biometric readers actually plug into.
  Each access switch has one uplink cable going up to Tier 1.

In your office: the **Sophos XGS 116 is the router/gateway**, the **D-Link DGS-1210-52 is the core**
(your doc already calls it "the core managed switch"), and the **TP-Links + unmanaged D-Links are
access.** That's a textbook 2-tier design. Nothing needs redesigning — it needs *configuring and
documenting*.

## 4.2 The configuration brief for your network admin

Hand him this section. Every item has a reason attached so he knows why he's being asked.

### A. Identity and reachability — do this on all 3 managed switches

| Setting | Why |
|---|---|
| Static management IP on a dedicated management VLAN | So RackTrack can reach it reliably and it never changes |
| Hostname matching the physical label (e.g. `SW-CORE-01`) | This is the key that joins the photo to the telemetry. If the sticker says one thing and the hostname says another, nothing matches |
| SNMP **v3** read-only user, locked to the RackTrack server's IP | The main data path. v2c only if the hardware won't do v3 |
| SSH enabled, one dedicated read-only account for RackTrack | Backup path + the `port_poller` route |
| NTP configured, same server on every device | So "port 12 went down at 14:02" means the same thing everywhere |
| `write memory` / save config | Otherwise it's all gone on the next power cut |

### B. LLDP — this is the one that makes the demo work

| Setting | Why |
|---|---|
| **LLDP enabled globally, transmit + receive, on every port** | Without this there is no neighbour data and no verified cables. This is the single most important line in this table |
| **LLDP-MED enabled** on ports with VoIP phones | Your 20 phones will then announce themselves — 20 extra verified links for free |
| LLDP on the firewall too, if the XGS supports it | Gives you the switch↔firewall links |

### C. Port descriptions — cheap, and worth more than you'd think

Ask him to set a description on **every** patched port:

```
interface gi1/0/12
 description PP1-P07 :: Accounts-Desk-4
```

It costs an afternoon. In return, every port RackTrack reads comes back already carrying its own
documentation, and it lands straight in the NetBox interface description field. It also gives you a
free accuracy check: if the camera reads a label saying "PP1-P07" and the switch's own description
says "PP1-P07", that's an independent confirmation from two separate sources.

### D. VLANs — the "logical layer" you asked about

Your network doc already flags VLAN segmentation as an improvement. Here is a starting layout —
treat it as a proposal for the admin to adjust, not gospel:

| VLAN | Name | Subnet | What's on it |
|---|---|---|---|
| 10 | MGMT | 10.10.10.0/24 | Switch + firewall + AP management addresses |
| 20 | STAFF | 10.10.20.0/24 | Employee desktops and laptops |
| 30 | VOICE | 10.10.30.0/24 | The 20 VoIP phones (LLDP-MED assigns this automatically) |
| 40 | SECURITY | 10.10.40.0/24 | The 4 biometric terminals |
| 50 | SERVERS | 10.10.50.0/24 | Internal servers |
| 60 | WIFI-MGMT | 10.10.60.0/24 | The Ubiquiti AP's management SSID |
| 99 | QUARANTINE | 10.10.99.0/24 | Unknown / unrecognised devices |

Rules: switch-to-switch links are **trunks** carrying all VLANs; end-device ports are **access**
ports in exactly one VLAN; the **Sophos is the gateway** for every VLAN and enforces what may talk
to what.

**One honest limitation to plan around:** the two unmanaged D-Links cannot do VLANs at all.
Everything behind them lands in whatever single VLAN their uplink port is set to. So they can serve
one department, on one VLAN, and nothing more. That's not a workaround — it's the actual reason your
network document lists "replace unmanaged switches with managed" as improvement #3. Budget for it.

### E. Physical preparation — do this before you point a camera at anything

This is your job more than the admin's, and it is the difference between a scan that works and a
scan that doesn't.

1. **Label every device on the front**, same text as the hostname. Printed label, not handwriting.
2. **Label both ends of every cable.** Scheme: `SW-CORE-01:Gi1/0/12 → PP1:P07`.
3. **Label every patch panel port** clearly enough to photograph — this is how the camera identifies
   ports on a passive panel that can't be asked anything.
4. **Give every device an asset tag** — `SP-0001`, `SP-0002` … This is what the client means by
   "asset labels", and it's what ties the rack to your finance/asset register.
5. **Dress the cables.** Velcro, horizontal managers, no spaghetti. A tidy rear is photographable;
   a bird's nest is not, by any software, ever.
6. **Stick a U-position marker.** Put a small printed marker (an ArUco/AprilTag sticker) at a known
   rack unit — say U01 and U20. It gives the CV an absolute reference so U-numbering can't drift.
   This is a genuinely large accuracy win for a 20p sticker, and it's the standard trick.
7. **Light it.** A cheap LED work light in the rack. Most OCR failures are actually lighting
   failures, and your `ocr_failed` results above are very likely partly this.

### F. Record the ground truth by hand — the most valuable hour in this project

Before the first scan, fill in a spreadsheet **by hand**, walking the rack:

| Rack | U | Device | Model | Serial | Asset tag | Port | Connects to | Cable colour |
|---|---|---|---|---|---|---|---|---|

This is your **answer key**. Without it you cannot measure whether the scan is right — you'll be
guessing. With it, every accuracy number you quote to the client is defensible, and every model
improvement is measurable. Do not skip this because it's boring. It is the single highest-value hour
in the entire project.

---

# PART 5 — NetBox: what it is and how the export works

## 5.1 What NetBox is, plainly

NetBox is an open-source database for recording a network: the buildings, the racks, the boxes in
the racks, the ports on the boxes, and the cables between the ports. It is the industry default for
this, and it is very widely used in universities and research networks — which is exactly why your
Slovak prospect has one.

Crucially: **NetBox is a system of record, not a discovery tool.** It does not go and find things.
Somebody has to put data in. Today that somebody is a human with a spreadsheet.

**That is the entire business case for RackTrack, in one sentence:** *NetBox is the filing cabinet;
RackTrack is the thing that fills it in without a human walking the rack with a clipboard.*

Never fight NetBox. Feed it.

## 5.2 The NetBox object model, in the order it must be built

NetBox is strict about order. You cannot put a device in a rack that doesn't exist, and you cannot
cable two ports that haven't been created. Your exporter must follow this sequence exactly:

```
1.  Manufacturer        "D-Link", "TP-Link", "Sophos"
2.  Device Type         the MODEL — "DGS-1210-52". Carries height in U, and the
                        port templates (how many ports, what type)
3.  Device Role         "access switch", "core switch", "firewall", "patch panel", "UPS", "PDU"
4.  Site                the campus / building
5.  Location            the room, inside the site        (optional)
6.  Rack                the cabinet — height in U, width
7.  Device              THE ACTUAL PHYSICAL BOX. name, serial, asset_tag,
                        which rack, which U position, front or rear face
8.  Interfaces          the network ports          ─┐ usually created automatically
    Front/Rear Ports    patch-panel ports           ├─ from the Device Type templates
    Power ports/outlets PDU + UPS                  ─┘ in step 2
9.  VLANs / Prefixes / IP addresses    ← the "logical layer"
10. Cables              connects two terminations. LAST, because both ends must exist first
```

Steps 1–8 are RackTrack's **physical** scan output. Step 9 is the **logical** layer from telemetry.
Step 10 is the fusion of both. That maps precisely onto your three-part plan.

## 5.3 How NetBox models a patch panel — the client asked specifically

This trips people up, so get it right. A patch panel in NetBox has **Rear Ports** and **Front
Ports**, and each front port points at a rear port. Then:

- Cable 1: `Switch:Gi1/0/12` → `PatchPanel-1:FrontPort-7`
- Cable 2: `PatchPanel-1:RearPort-7` → `WallOutlet-402` (or the panel in another rack)

You record two ordinary cables. **NetBox then works out the full end-to-end path itself** and can
show you "the switch port ultimately reaches desk 402," even though no single cable says that.

This is a strong demo moment. Show them a cable trace running *through* a patch panel, and you've
demonstrated that you understand their data model rather than just dumping rows at it.

## 5.4 The Cable object — the client's sharpest question

This is what a NetBox cable looks like over the API. Note `a_terminations` and `b_terminations` —
both ends, which is exactly what they asked about:

```json
POST /api/dcim/cables/
{
  "a_terminations": [ { "object_type": "dcim.interface", "object_id": 4412 } ],
  "b_terminations": [ { "object_type": "dcim.frontport", "object_id": 9871 } ],
  "status": "connected",
  "type":   "cat6",
  "color":  "0000ff",
  "label":  "SW-CORE-01:Gi1/0/12 -> PP1:P07",
  "length": 3,
  "length_unit": "m"
}
```

**The elegant bit — use `status` to carry your confidence.** NetBox already has
`status: "connected"` vs `status: "planned"`. So:

- LLDP confirmed it from **both** ends → `status: "connected"` (this cable is proven)
- Camera saw it but telemetry couldn't confirm → `status: "planned"` (this cable is a proposal)

The client's engineers can then filter for "planned" and review just those. You are being honest
about uncertainty *inside their own tooling, using their own field*, without inventing anything.
Put the numeric confidence score in a custom field alongside.

Do this and you turn "our CV isn't perfect yet" from a weakness into a feature. Engineers trust
tools that show their working. They do not trust tools that are always confident.

## 5.5 API mechanics you'll need

- **Auth:** `Authorization: Token <40-char-token>` on every request. Nothing else.
- **Base URL:** `https://netbox.example.edu/api/`
- **Python client:** `pynetbox` — well maintained, saves a lot of code.
- **GraphQL** also available at `/graphql/` for complex reads.
- **Bulk create:** POST a JSON *list* to the endpoint. Much faster than one-at-a-time.
- **No upsert.** NetBox has no "create-or-update". You must GET first, then POST or PATCH.
  → **Solution:** add a custom field `racktrack_uid` to every object type, write your own ID into
  it, and look up by that. This makes re-scanning the same rack safe and repeatable, which matters
  enormously — a rack gets scanned many times over its life.
- **Webhooks go OUT of NetBox, not in.** Be careful answering this one: NetBox webhooks fire when
  something changes *in NetBox*. So the two directions are:
  - RackTrack → NetBox = **you call their REST API** (this is the main flow)
  - NetBox → RackTrack = **their webhooks / event rules call you** (useful later: "someone renamed
    a rack in NetBox, update RackTrack")

## 5.6 Export formats to offer

Offer all four. Different buyers want different things, and a university procurement process will
want the auditable one.

1. **Live REST push** — RackTrack writes straight into NetBox. The headline feature.
2. **JSON bundle** — the complete scan, full fidelity, RackTrack's own schema. For their developers.
3. **NetBox bulk-import CSV** — NetBox has a built-in CSV importer with a defined column format per
   object type. Emit one file per type. **Universities love this** because a human reviews the file
   before anything is written. It is also your safety net if the API path hits a permissions wall.
4. **Device-type YAML** — the `netbox-community/devicetype-library` format. Contributing device
   definitions back is a nice trust signal in this community.

Plus **dry-run mode**: "here is what I *would* change" as a diff, before touching anything. For a
first-time buyer this is often what closes the deal — you are demonstrating that you will not
scribble over their production system of record.

**And one rule, absolute: never delete anything from NetBox automatically.** If a device vanishes
from a scan, mark it `offline` and raise it for review. A tool that deletes production records
loses all trust the first time it's wrong, and it will be wrong at some point.

---

# PART 6 — The build plan

Six phases. Roughly four months to a defensible PoC. The order matters — each phase makes the next
one possible.

## Phase 1 — Ground truth (Weeks 1–2)
**Goal: a rack you trust completely.**

- Confirm the exact model of every box in the rack (Part 3.2 checklist)
- Admin completes the config brief (Part 4.2 A–D): IPs, hostnames, SNMPv3, **LLDP**, port descriptions, VLANs
- You complete the physical prep (Part 4.2 E): labels, asset tags, cable dressing, U markers, lighting
- **Fill in the hand-written answer key** (Part 4.2 F)

**Done when:** you can point at any cable in that rack and say what's on both ends, from paper.

## Phase 2 — The logical layer, for real (Weeks 2–4)
**Goal: pull true connection data off the live kit.**

- Stand up the Netdisco stack against the real rack (already in the repo)
- **Switch the collection path to SNMP** — `IF-MIB`, `LLDP-MIB`, `BRIDGE-MIB`, `ENTITY-MIB`
- Confirm you can read **model and serial straight out of `ENTITY-MIB`** — this removes your
  dependence on OCR for every managed device, which is a large win
- Pull the Sophos ARP table + DHCP leases → MAC ↔ IP ↔ hostname for everything, including the
  devices behind the unmanaged switches
- **Decision point on D-Link:** if SNMP covers the DGS-1210 fully, you never need a D-Link CLI
  parser. Check this early — it could save weeks

**Done when:** you can print a verified list of switch-to-switch links that matches your answer key.

## Phase 3 — The physical layer, for real (Weeks 3–6)
**Goal: stop generating data.**

- **Delete the synthetic path, or hard-gate it behind an explicit `--demo` flag that stamps every
  record.** It cannot be reachable by accident. This is the highest-priority item in the plan
- Extend the scan schema with the fields the client asked for and you don't currently emit:
  `serial_number`, `asset_tag`, `manufacturer`, per-port `port_label`
- Improve OCR on the things that *can't* be asked over SNMP — patch panels, PDUs, blanking plates,
  unmanaged switches. That's now a much smaller problem than "OCR everything"
- Add serial-number and asset-tag OCR (close-up capture mode: let the user tap a device and take
  one focused photo, rather than expecting it out of a wide rack shot)
- Map detected port boxes → port *numbers* using the port grid geometry you already compute

**Done when:** a real scan of your rack, with zero synthetic data, matches the answer key on device
class, U position, port count and port occupancy.

## Phase 4 — The reconciler (Weeks 5–8)
**Goal: the actual product. Join the two halves.**

Match a photographed device to a discovered device using, in priority order:

1. **Serial number** — from `ENTITY-MIB` vs OCR. Exact match, highest confidence
2. **Hostname** — SNMP `sysName` vs the OCR'd front label
3. **Model + U position** — weaker, but works for unmanaged kit
4. **Port count** — a 52-port box at U10 is probably the DGS-1210

Then match ports: LLDP `lldpRemTable` gives you *"my port 12 ↔ their port 24"*. The camera gives
you *"port 12 has a blue cable in it, port 24 has a blue cable in it."* Agreement on both = a
proven cable.

Assign every cable a confidence and a source:

| Evidence | Confidence | NetBox status |
|---|---|---|
| LLDP agrees from **both** ends | 1.0 | `connected` |
| LLDP from one end only | 0.9 | `connected` |
| MAC table + ARP (end device, no LLDP) | 0.75 | `connected` |
| Camera only — colour + occupancy match | 0.5 | `planned` |
| **Camera and telemetry disagree** | — | **not exported — human review queue** |

That last row is the most important row in this document. A tool that says *"these two sources
disagree, please look"* is worth far more than one that quietly picks a winner. Conflicts are
signal: they usually mean somebody patched a cable and didn't update the documentation, which is
**exactly the problem the customer is buying you to solve.**

**Done when:** the reconciler's output matches your hand-written answer key, and you can quote a
percentage.

## Phase 5 — The NetBox exporter (Weeks 7–10)
**Goal: write into NetBox, safely and repeatably.**

- Follow the ServiceNow integration's shape — it's a working template. New module: `netbox/`
- Wire it to the existing `netbox` connection profile type (`base_url` + `token` — already there)
- Build in the strict order from 5.2
- Idempotency via the `racktrack_uid` custom field
- Dry-run diff mode first, live push second
- Emit the CSV bundle and the JSON bundle from the same internal model
- Never delete; mark `offline` and queue for review

**Done when:** you can scan your rack twice, push twice, and NetBox shows one clean set of records
with no duplicates.

## Phase 6 — The demo (Weeks 9–12)
**Goal: the exact chain the client asked for, on real hardware.**

Their words: *Camera/video scan → device/port recognition → cable mapping → LLDP/CDP reconciliation
→ structured export/API → NetBox.*

Build that as a single scripted run against your office rack. Record it. That video is your sales
asset for every prospect after this one.

---

# PART 7 — Pricing

You asked for a structure, not a number. Decide the numbers yourself — here is the shape that fits
this buyer.

**Recommended model: annual subscription = platform fee + per-rack fee, with an academic discount.**

Why per-rack: it's the unit the customer already counts in, it scales with their value, and it's
easy to defend in a tender. Per-device punishes them for having dense racks. Per-user is unrelated
to the work being done.

| Band | Racks | Positioning |
|---|---|---|
| Starter | 1–25 | Single data centre |
| Standard | 26–50 | Multi-room |
| Campus | 51–100 | **← their band** |
| Enterprise | 100+ | Negotiated |

Sizing note: they said 20–100 racks. Price the Campus band as the expected landing point, but make
sure Starter is affordable — universities very often start with one building and expand after a
successful year. Make the upgrade path painless and un-punitive.

Include in the base: the mobile scanning app, unlimited scans, the NetBox integration, JSON/CSV
export, support.

Charge separately for: on-site onboarding, custom integrations beyond NetBox, on-premise/air-gapped
deployment (**likely relevant — universities frequently cannot send infrastructure data to a
cloud service; be ready with a self-hosted answer**), and training.

**Academic discount:** offer one explicitly, name it, and put a number on it. It matters
disproportionately in this sector and it costs you little on a first reference customer.

**On the PoC:** fixed fee, credited in full against year one if they proceed. Free PoCs get treated
as free; a credited fee gets treated as a commitment on both sides, and it filters out tyre-kickers.

---

# PART 8 — What to send the client now

Don't wait until the product is finished. Reply this week — a four-week silence loses deals. But
reply honestly, in three tiers. Suggested structure:

**Available today**
- Smartphone/video rack scanning; rack, U-position and device detection
- Port detection, port occupancy, cable type/colour classification
- Live network discovery via SNMP/SSH — LLDP neighbours, MAC tables, port state, drift over time
- A shipping CMDB integration (ServiceNow) that demonstrates the export pattern
- Structured JSON export; encrypted credential management for external systems

**In active development, targeted at your requirements**
- Native NetBox connector — REST push, CSV bulk-import bundle, dry-run diff
- Serial number and asset tag capture
- CV + LLDP reconciliation with per-cable confidence scoring

**What we would prove in a proof of concept, on your rack**
- The full chain: scan → recognition → cable mapping → LLDP reconciliation → NetBox
- Measured accuracy against your own documentation, published honestly

Then propose the PoC with real success criteria. Numbers you can actually defend — set these after
Phase 4 tells you where you really are, and do not promise them before:

| Metric | Target |
|---|---|
| Devices detected and correctly placed by U | ≥ 95% |
| Make/model correct (managed devices, via SNMP) | ≥ 98% |
| Make/model correct (unmanaged/passive, via OCR) | ≥ 80% |
| Serial captured (managed devices) | ≥ 98% |
| Cables verified by LLDP | 100% of LLDP-visible links |
| Cables proposed by CV alone | reported with confidence, flagged for review |

Note how those are split by *method*, not lumped together. It's more honest, it's more informative,
and it protects you: nobody can accuse you of missing a target you never claimed.

**Two things to be careful about:**

1. **GDPR / data residency.** EU university, infrastructure data, photographs of a data centre.
   They will ask where the data is processed and stored. Have an answer ready, and have a
   self-hosted option ready. This can be a deal-breaker if you improvise it on a call.
2. **Do not demo `topology.json` as-is.** See Part 0. If you need something visual for the first
   call, demo the *real* capabilities — rack detection, U mapping, port occupancy, live LLDP from
   your own switches. Those are real, they're genuinely impressive, and nothing there can blow up
   under scrutiny.

---

# PART 9 — Immediate next steps

Ordered. The first two are today.

1. **Confirm the rack contents.** Photograph every front bezel, fill in the Part 3.2 table. This
   determines whether your demo rack can demonstrate LLDP at all.
2. **Tell your admin he was right**, and hand him the Part 4.2 config brief.
3. **Reply to the client this week** using the Part 8 structure. Ask for their NetBox version and
   whether they can offer a sandbox instance for testing.
4. **Gate or delete the synthetic topology path** so it cannot be shown by accident.
5. **Test SNMP against the D-Link DGS-1210** — confirm `ENTITY-MIB` returns model + serial. This is
   a one-hour test that could remove weeks of parser work from the plan.
6. **Build the answer-key spreadsheet** once the rack is configured and labelled.

---

# Open questions I couldn't resolve from here

These need your answer before the plan can be finalised:

- **Exactly which boxes are in the target rack?** The network document describes 5 switches across
  the office; you described a rack with 3 switches, a router, a firewall and patch panels. Are
  these the same rack, or is the target a separate lab/demo rack?
- **"Router and firewall" — separate boxes?** Your document lists the Sophos XGS 116 doing both.
  If there's a separate router, what is it?
- **Is the Slovak university's NetBox self-hosted, and which version?** The cable termination API
  shape changed in NetBox 3.3 (single termination → `a_terminations`/`b_terminations` arrays).
  Under 3.3 needs a different code path.
- **Can they give a sandbox NetBox to test against?** Worth asking early — it removes all risk from
  the PoC and it's an easy yes for them.
- **Cloud or on-premise?** Decide before they ask.

---

# PART 10 — Replacing the unmanaged switches: what actually changes

Short answer: **good for the network, and worth doing — but it does not unblock this project, and it
quietly removes your cheapest demo. Do it, with timing and story adjusted.**

## 10.1 What you gain

| Gain | Why it matters |
|---|---|
| Every end device's **physical port** becomes visible from telemetry | Right now ~38 devices behind the two dumb switches are known to *exist* (firewall ARP + DHCP) but you cannot tell which socket they're in |
| **VLANs work everywhere** | Today everything behind a dumb switch is stuck in whatever single VLAN its uplink is set to. The Part 4.2 VLAN plan cannot be fully applied until this is fixed |
| **LLDP on all 5 switches** | Complete, verified switch-to-switch topology instead of a partial one |
| Port descriptions on every port | Free documentation + an independent cross-check against OCR |
| Drift detection covers 100% of ports | Currently only the managed ~60% |

Your own network document already lists this as improvement #3. It is the right call on its merits.

## 10.2 The counterintuitive cost

The two unmanaged switches are your **live proof that telemetry alone is insufficient.** Make all
five managed, and a sceptical engineer reasonably asks:

> "If every switch is managed, why do I need a camera? Netdisco or LibreNMS already tells me which
> MAC is on which port, for free."

That is a fair question and you need a better answer than the unmanaged switches.

## 10.3 The better answer, which was always the stronger one: **patch panels**

A patch panel is **passive**. No electronics, no CPU, no IP address — not because it's cheap, but
because there is nothing in it to power. You cannot make a patch panel manageable at any price.

LLDP passes straight through it as if it were not there. The switch sees the device at the far end;
it has no idea a panel sits in between, or which panel port the cable actually lands on. **No amount
of network telemetry will ever see a patch panel.** A camera sees it immediately.

And note what the Slovak client's requirement list says — they mention patch panels **twice**,
as separate line items:

> "patch panels" … "patch-panel ports" … "Can RackTrack export structured objects corresponding to:
> … Patch-panel ports"

Universities have enormous numbers of these. **This is the durable moat.** Unmanaged switches are a
temporary gap that money closes; patch panels are a permanent one. Build the story on patch panels
and the switch replacement costs you nothing narratively.

## 10.4 What stays camera-only no matter how much they spend

Worth having this list to hand, because it's the answer to "why not just use LibreNMS":

- **U position, which rack, which room** — no switch knows where it physically is
- **Asset tags** — a printed sticker; only an eye or a camera reads it
- **Powered-off, faulty, or racked-but-not-yet-patched kit** — invisible to SNMP, obvious to a camera
- **Blanking plates, cable managers, rails, non-networked PDUs and UPS**
- **Devices that don't speak LLDP** — most servers, printers, many cameras
- **Cable colour and physical routing**
- **Ground truth vs claimed state** — telemetry reports what the config *says*; the camera reports
  what is *there*. Detecting drift requires both, by definition

## 10.5 What to actually buy

- **No PoE needed.** Your document says both unmanaged switches serve desktops and laptops on grey
  Cat6; PoE lives on the TP-Links for phones and APs. Non-PoE managed switches are substantially
  cheaper — don't let anyone spec PoE by reflex.
- **Port count:** 23 + 15 = 38 end devices. So a 24-port plus a 16- or 24-port.
- **Keep two boxes, not one 48-port.** Consolidating is cheaper and simpler, but your own document
  lists switch-level redundancy as improvement #1, and one box doubles the blast radius.
- **Vendor:** TP-Link JetStream is the pragmatic pick for v1 — `tplink_parser.js` is one of only
  **two** exact parsers RackTrack has (the other is Cisco). Buying D-Link means falling through to
  `generic_recipe.js`, which returns `rows: []` deliberately rather than guess.
- **But if v2 goes SNMP as recommended, vendor matters much less** — standard MIBs are
  vendor-neutral. Then buy on price and warranty, not parser coverage.
- **One caveat straight from the code:** TP-Link JetStream allows exactly **one SSH session** and
  does not release it when the TCP connection drops. That is why `port_poller.js` runs hourly rather
  than every 60s. SNMP has no such limit — another reason v2 collects over SNMP.

## 10.6 Timing — the actual recommendation

1. **Do not block the project on it.** Three managed switches is enough to build and prove the whole
   chain. Procurement plus a maintenance window would push the Slovakia reply out by weeks, and that
   reply should go this week.
2. **Take a baseline scan BEFORE the swap.**
3. **Swap the switches.**
4. **Scan again after.**

Step 4 is the payoff. `port_history_db.js` already tracks `lldp_chassis`, `lldp_port` and
`lldp_system` in `TRACKED_FIELDS`, so replacing a switch generates drift events **automatically,
with no new code**. You get a real before/after showing RackTrack detecting a physical change on its
own — which turns a procurement chore into the single best demo asset you'll own.

---

# PART 11 — v2: a separate build, so v1 is never at risk

**Decision: build the NetBox track as a separate repo. Do not modify the shipping product.**

`dark_mobile` has testers on it and runs demo.racktrack.ai. Everything in this plan — a new data
model, a new collector, a reconciler, a new exporter — is exactly the kind of work that breaks
things sideways. Keeping it out of the shipping tree costs almost nothing and removes all of that risk.

**Location:** `/Volumes/Racktrack/racktrack_v2`, a sibling of `dark_mobile`, following the pattern
already set by `rack_vlm_lab`.

## 11.1 The principle

**v2 is a new consumer of v1's output, not a fork of v1.**

```
   dark_mobile (v1, untouched)              racktrack_v2
   ───────────────────────────              ────────────────────────
   camera → CV pipeline                     reads outputs/  (READ-ONLY)
   → outputs/<rackId>/*.json  ────────────► + SNMP telemetry
                                            + reconciler (CV ⋈ telemetry)
                                            → NetBox
```

Do **not** rewrite the CV pipeline. The YOLO models, port detection, cable classification and rack
stitching took months, they work, and forking them means maintaining two copies. v2 calls them.

| Reused (called, never copied) | Genuinely new in v2 |
|---|---|
| `pipeline/` + `Models/*.pt` | `v2/model/` — NetBox-shaped domain objects |
| `switch_ocr/` | `v2/collect/` — SNMP (vendor-neutral, covers D-Link) |
| `netdisco-docker/` | `v2/reconcile/` — the fusion. **This is the product** |
| | `v2/export/` — NetBox REST + CSV + JSON |

## 11.2 Boundary contract

- `v2/ingest/` opens files under `dark_mobile/outputs/` **read-only**
- No imports from `dark_mobile/server/`
- No writes anywhere inside `dark_mobile/`
- `topology.json` and `cmdb_synthesis.json`'s named fields are **ignored on principle** — generated,
  not observed. v2 builds cables from evidence only.

This also neatly solves the Part 0 problem without touching v1: rather than ripping the synthetic
path out of the shipping product (risky, and it's load-bearing for the current demo), v2 simply
never reads it.

## 11.3 Built so far

- **`v2/model/`** — every class maps 1:1 to a NetBox object type. Carries `uid` (for idempotent
  upsert via a NetBox custom field, since NetBox has no upsert) and `evidence`. `Evidence` encodes
  confidence as a property of the *method*, and maps onto NetBox's own `connected`/`planned`
  vocabulary. `Conflict` is a first-class output, not an error.
- **`v2/ingest/`** — reads v1 scans read-only, and honours v1's own `cmdb_synthesis.json` declaration
  by quarantining every field v1 admits it fabricated.

## 11.4 The honest baseline, measured

Running the gap report against real scan `RK-0022F952`:

```
devices                    17
classified_pct             47      ← 53% come back "Unidentified"
with_model_pct              6
total_ports_detected      191      ← port detection genuinely works
with_serial                 0      ← not extracted at all
with_asset_tag              0      ← not extracted at all
cables_observed             0      ← v1's only cable data is synthetic
quarantined_devices         6
```

That is the real starting line. Every number in it is a target to move, and now it is measurable
rather than asserted — which is what will make the accuracy claims in Part 8 defensible.
