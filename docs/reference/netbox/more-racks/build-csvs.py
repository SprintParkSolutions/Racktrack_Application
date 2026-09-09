"""Build NetBox import CSVs for six more racks, each one a different case.

    RACK-03  sparse and growing      most shelves free, so utilisation is real
    RACK-04  stacked and modular     a four-member stack, a 4U chassis, 2U servers
    RACK-05  mixed lifecycle         every device status NetBox has
    RACK-06  front and rear          devices on both faces, some half depth
    RACK-07  twenty identical        nothing tells the switches apart but position
    RACK-08  branch wall cabinet     a second site, 12U, numbered from the top

None of it was measured. Every rack and device says so, so it can never be
mistaken for observed equipment.

    python3 build-csvs.py
"""

import csv
import pathlib

HERE = pathlib.Path(__file__).resolve().parent
DEMO = "Example data for demonstration. Not observed equipment."

HQ = "Sprintpark HQ"
BRANCH = "Sprintpark Manchester"
TENANT = "Sprintpark IT"
LOCATION = "Ground Floor Comms Room"
BRANCH_LOC = "Reception Cupboard"

# model, manufacturer, part, u_height, ports, uplinks, psus, platform, full_depth
TYPES = [
    ("Catalyst 9300-48P", "Cisco", "C9300-48P", 1, 48, 4, 2, "Cisco IOS-XE 17", True),
    ("Catalyst 9200-48P", "Cisco", "C9200-48P", 1, 48, 4, 2, "Cisco IOS-XE 17", True),
    ("Catalyst 9200-24P", "Cisco", "C9200-24P", 1, 24, 4, 1, "Cisco IOS-XE 17", True),
    ("Catalyst 9407R", "Cisco", "C9407R", 4, 96, 8, 2, "Cisco IOS-XE 17", True),
    ("PowerEdge R750", "Dell", "R750", 2, 4, 0, 2, "Ubuntu 24.04", True),
    ("FortiGate 100F", "Fortinet", "FG-100F", 1, 10, 0, 1, "FortiOS 7.4", True),
    ("ISR 4331", "Cisco", "ISR4331/K9", 1, 4, 0, 1, "Cisco IOS-XE 17", True),
    ("24-Port Patch Panel", "Generic", "PP-24-C6", 1, 0, 0, 0, "", False),
    ("AP8853 Rack PDU", "APC", "AP8853", 1, 0, 0, 0, "", False),
    ("OpenGear CM8148", "Opengear", "CM8148", 1, 48, 0, 2, "Opengear 23.03", True),
]
TYPE = {t[0]: t for t in TYPES}

# rack -> (site, location, u_height, desc_units, description)
RACKS = {
    "RACK-03": (HQ, LOCATION, 42, False, "Growing. Provisioned for expansion, mostly free"),
    "RACK-04": (
        HQ,
        LOCATION,
        42,
        False,
        "A stack and a modular chassis, so one box is not one device",
    ),
    "RACK-05": (HQ, LOCATION, 42, False, "Mixed lifecycle. Every status NetBox models"),
    "RACK-06": (HQ, LOCATION, 42, False, "Equipment on both faces, some of it half depth"),
    "RACK-07": (
        HQ,
        LOCATION,
        42,
        False,
        "Twenty identical switches. Nothing but position tells them apart",
    ),
    "RACK-08": (BRANCH, BRANCH_LOC, 12, True, "Branch wall cabinet, numbered from the top"),
}

# name, rack, role, model, position, face, status, serial, asset, note
D = []


def add(
    name, rack, role, model, u, face="front", status="active", serial=None, asset=True, note=""
):
    # An asset tag is unique across the whole NetBox install, not per rack, and
    # a rack can hold a device at the same shelf on each face. The face has to
    # be part of the tag or the two collide.
    D.append(
        {
            "name": name,
            "rack": rack,
            "role": role,
            "model": model,
            "position": u,
            "face": face,
            "status": status,
            "serial": serial if serial is not None else f"DEMO-{name}",
            "asset_tag": f"SPK-{rack}-U{u:02d}{face[0].upper()}" if asset else "",
            "note": note,
        }
    )


# ── RACK-03 — sparse, so free space means something ─────────────────────────
add("R03-CORE-01", "RACK-03", "Core Switch", "Catalyst 9300-48P", 12)
add("R03-ACC-01", "RACK-03", "Access Switch", "Catalyst 9200-48P", 9)
add("R03-ACC-02", "RACK-03", "Access Switch", "Catalyst 9200-48P", 8)
add("R03-PP-01", "RACK-03", "Patch Panel", "24-Port Patch Panel", 6)
add("R03-PP-02", "RACK-03", "Patch Panel", "24-Port Patch Panel", 5)
add("R03-OOB-01", "RACK-03", "Console Server", "OpenGear CM8148", 3)
add("R03-PDU-A", "RACK-03", "Power Distribution", "AP8853 Rack PDU", 2)
add("R03-PDU-B", "RACK-03", "Power Distribution", "AP8853 Rack PDU", 1)

# ── RACK-04 — a stack, and a chassis that fills four shelves ────────────────
for i in range(4):
    add(
        f"R04-STACK-01-SW{i + 1}",
        "RACK-04",
        "Access Switch",
        "Catalyst 9300-48P",
        40 - i,
        note=f"Member {i + 1} of stack R04-STACK-01. Four boxes, one logical switch",
    )
add(
    "R04-CHASSIS-01",
    "RACK-04",
    "Core Switch",
    "Catalyst 9407R",
    30,
    note="Four shelves, U30 to U33. Its lowest shelf is the position",
)
add("R04-SRV-01", "RACK-04", "Server", "PowerEdge R750", 26, note="Two shelves, U26 and U27")
add("R04-SRV-02", "RACK-04", "Server", "PowerEdge R750", 24, note="Two shelves, U24 and U25")
add("R04-PDU-A", "RACK-04", "Power Distribution", "AP8853 Rack PDU", 2)
add("R04-PDU-B", "RACK-04", "Power Distribution", "AP8853 Rack PDU", 1)

# ── RACK-05 — every lifecycle status ────────────────────────────────────────
LIFECYCLE = [
    ("active", "In service"),
    ("offline", "Powered down, still racked"),
    ("planned", "Ordered, not yet delivered"),
    ("staged", "Racked and cabled, not yet in service"),
    ("failed", "Faulty, awaiting replacement"),
    ("inventory", "Spare, held in the rack"),
    ("decommissioning", "Being removed this quarter"),
]
for i, (status, why) in enumerate(LIFECYCLE):
    add(
        f"R05-SW-{i + 1:02d}",
        "RACK-05",
        "Access Switch",
        "Catalyst 9200-24P",
        40 - i * 2,
        status=status,
        note=why,
    )
add("R05-FW-01", "RACK-05", "Firewall", "FortiGate 100F", 24, status="active")
add(
    "R05-RTR-01",
    "RACK-05",
    "Router",
    "ISR 4331",
    23,
    status="decommissioning",
    note="Replaced by SD-WAN, removal booked",
)
add("R05-PDU-A", "RACK-05", "Power Distribution", "AP8853 Rack PDU", 2)
add("R05-PDU-B", "RACK-05", "Power Distribution", "AP8853 Rack PDU", 1)

# ── RACK-06 — both faces, and some half-depth kit ───────────────────────────
for i in range(6):
    add(f"R06-ACC-{i + 1:02d}", "RACK-06", "Access Switch", "Catalyst 9200-48P", 40 - i)
for i in range(4):
    add(
        f"R06-PP-{i + 1:02d}",
        "RACK-06",
        "Patch Panel",
        "24-Port Patch Panel",
        40 - i,
        face="rear",
        note="Rear-mounted, half depth, back to back with a switch",
    )
add("R06-PDU-A", "RACK-06", "Power Distribution", "AP8853 Rack PDU", 2, face="rear")
add("R06-PDU-B", "RACK-06", "Power Distribution", "AP8853 Rack PDU", 1, face="rear")

# ── RACK-07 — twenty identical, nothing to tell them apart ──────────────────
for i in range(20):
    add(
        f"R07-SW-{i + 1:02d}",
        "RACK-07",
        "Access Switch",
        "Catalyst 9200-48P",
        40 - i,
        serial="",
        asset=False,
        note="Same model, same port count, no serial published, no asset tag. "
        "Only its shelf separates it from the other nineteen",
    )
add("R07-PDU-A", "RACK-07", "Power Distribution", "AP8853 Rack PDU", 2)
add("R07-PDU-B", "RACK-07", "Power Distribution", "AP8853 Rack PDU", 1)

# ── RACK-08 — a branch, small, numbered from the top ────────────────────────
add("R08-RTR-01", "RACK-08", "Router", "ISR 4331", 1, note="Shelf 1 is the top of this cabinet")
add("R08-FW-01", "RACK-08", "Firewall", "FortiGate 100F", 2)
add("R08-SW-01", "RACK-08", "Access Switch", "Catalyst 9200-24P", 3)
add("R08-SW-02", "RACK-08", "Access Switch", "Catalyst 9200-24P", 4)
add("R08-PP-01", "RACK-08", "Patch Panel", "24-Port Patch Panel", 6)
add("R08-PDU-A", "RACK-08", "Power Distribution", "AP8853 Rack PDU", 12)


def slug(text):
    return "".join(c if c.isalnum() else "-" for c in text.lower()).strip("-")


def write(name, header, rows):
    with open(HERE / name, "w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=header, lineterminator="\n")
        w.writeheader()
        w.writerows(rows)
    print(f"  {name:<24} {len(rows):>5} rows")


write(
    "01-sites.csv",
    ["name", "slug", "status", "description"],
    [{"name": BRANCH, "slug": slug(BRANCH), "status": "active", "description": "Branch office"}],
)

write(
    "02-locations.csv",
    ["site", "name", "slug", "status", "description"],
    [
        {
            "site": BRANCH,
            "name": BRANCH_LOC,
            "slug": slug(BRANCH_LOC),
            "status": "active",
            "description": "Wall cabinet behind reception",
        }
    ],
)

write(
    "03-device-types.csv",
    [
        "manufacturer",
        "model",
        "slug",
        "part_number",
        "u_height",
        "is_full_depth",
        "description",
        "comments",
    ],
    [
        {
            "manufacturer": mfr,
            "model": model,
            "slug": slug(model),
            "part_number": part,
            "u_height": u,
            "is_full_depth": str(full).lower(),
            "description": f"{ports + up} ports" if ports + up else "Passive",
            "comments": DEMO,
        }
        for model, mfr, part, u, ports, up, _psu, _pl, full in TYPES
    ],
)

write(
    "04-racks.csv",
    [
        "site",
        "location",
        "name",
        "tenant",
        "status",
        "role",
        "type",
        "serial",
        "asset_tag",
        "width",
        "u_height",
        "starting_unit",
        "desc_units",
        "airflow",
        "description",
        "comments",
    ],
    [
        {
            "site": s,
            "location": loc,
            "name": name,
            "tenant": TENANT,
            "status": "active",
            "role": "Network",
            "type": "4-post-cabinet" if u > 12 else "wall-cabinet",
            "serial": f"DEMO-{name}",
            "asset_tag": f"SPK-{name}",
            "width": 19,
            "u_height": u,
            "starting_unit": 1,
            "desc_units": str(desc).lower(),
            "airflow": "front-to-rear",
            "description": note,
            "comments": DEMO,
        }
        for name, (s, loc, u, desc, note) in RACKS.items()
    ],
)

write(
    "05-devices.csv",
    [
        "name",
        "role",
        "manufacturer",
        "device_type",
        "platform",
        "site",
        "location",
        "rack",
        "position",
        "face",
        "status",
        "tenant",
        "serial",
        "asset_tag",
        "description",
        "comments",
    ],
    [
        {
            "name": d["name"],
            "role": d["role"],
            "manufacturer": TYPE[d["model"]][1],
            "device_type": d["model"],
            "platform": TYPE[d["model"]][7],
            "site": RACKS[d["rack"]][0],
            "location": RACKS[d["rack"]][1],
            "rack": d["rack"],
            "position": d["position"],
            "face": d["face"],
            "status": d["status"],
            "tenant": TENANT,
            "serial": d["serial"],
            "asset_tag": d["asset_tag"],
            "description": d["note"],
            "comments": DEMO,
        }
        for d in D
    ],
)

ifaces = []
for d in D:
    _m, _mf, _p, _u, ports, ups, _psu, _pl, _fd = TYPE[d["model"]]
    for i in range(1, ports + 1):
        ifaces.append(
            {
                "device": d["name"],
                "name": f"GigabitEthernet1/0/{i}",
                "label": f"Port {i}",
                "type": "1000base-t",
                "enabled": "true",
                "description": "",
            }
        )
    for i in range(1, ups + 1):
        ifaces.append(
            {
                "device": d["name"],
                "name": f"TenGigabitEthernet1/1/{i}",
                "label": f"Uplink {i}",
                "type": "10gbase-x-sfpp",
                "enabled": "true",
                "description": "Uplink",
            }
        )
write("06-interfaces.csv", ["device", "name", "label", "type", "enabled", "description"], ifaces)

write(
    "07-power-ports.csv",
    ["device", "name", "label", "type"],
    [
        {"device": d["name"], "name": f"PSU{i}", "label": f"PSU {i}", "type": "iec-60320-c14"}
        for d in D
        for i in range(1, TYPE[d["model"]][6] + 1)
    ],
)

write(
    "08-power-outlets.csv",
    ["device", "name", "label", "type"],
    [
        {"device": d["name"], "name": f"Outlet{i}", "label": f"C13-{i}", "type": "iec-60320-c13"}
        for d in D
        if d["role"] == "Power Distribution"
        for i in range(1, 25)
    ],
)

# ── cables: uplinks and power, both ends, no collisions ─────────────────────
cables = []


def cable(kind, a, at, an, b, bt, bn, label):
    cables.append(
        {
            "type": kind,
            "status": "connected",
            "label": label,
            "a_device": a,
            "a_type": at,
            "a_name": an,
            "b_device": b,
            "b_type": bt,
            "b_name": bn,
        }
    )


IF, PP, PO = "interface", "powerport", "poweroutlet"

# RACK-03: both access switches uplink to the core
for i, acc in enumerate(["R03-ACC-01", "R03-ACC-02"], start=1):
    cable(
        "smf-os2",
        acc,
        IF,
        "TenGigabitEthernet1/1/1",
        "R03-CORE-01",
        IF,
        f"GigabitEthernet1/0/{i}",
        f"{acc} uplink",
    )

# RACK-04: every stack member up to the chassis
for i in range(1, 5):
    cable(
        "smf-os2",
        f"R04-STACK-01-SW{i}",
        IF,
        "TenGigabitEthernet1/1/1",
        "R04-CHASSIS-01",
        IF,
        f"GigabitEthernet1/0/{i}",
        f"Stack member {i} uplink",
    )
for i, srv in enumerate(["R04-SRV-01", "R04-SRV-02"], start=1):
    cable(
        "cat6",
        srv,
        IF,
        "GigabitEthernet1/0/1",
        "R04-STACK-01-SW1",
        IF,
        f"GigabitEthernet1/0/{40 + i}",
        f"{srv} NIC 1",
    )

# RACK-06: front switches uplink to each other in a ring of two
cable(
    "smf-os2",
    "R06-ACC-01",
    IF,
    "TenGigabitEthernet1/1/1",
    "R06-ACC-02",
    IF,
    "TenGigabitEthernet1/1/1",
    "R06 switch interlink",
)

# RACK-08: the branch, end to end
cable(
    "cat6",
    "R08-RTR-01",
    IF,
    "GigabitEthernet1/0/1",
    "R08-FW-01",
    IF,
    "GigabitEthernet1/0/1",
    "Branch router to firewall",
)
cable(
    "cat6",
    "R08-FW-01",
    IF,
    "GigabitEthernet1/0/2",
    "R08-SW-01",
    IF,
    "GigabitEthernet1/0/24",
    "Branch firewall to switch 1",
)
cable(
    "smf-os2",
    "R08-SW-01",
    IF,
    "TenGigabitEthernet1/1/1",
    "R08-SW-02",
    IF,
    "TenGigabitEthernet1/1/1",
    "Branch switch interlink",
)

# power: PSU1 on the A strip, PSU2 on the B strip, per rack
for rack in RACKS:
    strips = [d["name"] for d in D if d["rack"] == rack and d["role"] == "Power Distribution"]
    if not strips:
        continue
    used = {s: 0 for s in strips}
    for d in D:
        if d["rack"] != rack or d["role"] == "Power Distribution":
            continue
        for i in range(1, TYPE[d["model"]][6] + 1):
            strip = strips[(i - 1) % len(strips)]
            used[strip] += 1
            if used[strip] > 24:
                continue
            cable(
                "power",
                d["name"],
                PP,
                f"PSU{i}",
                strip,
                PO,
                f"Outlet{used[strip]}",
                f"{d['name']} PSU{i}",
            )

write(
    "09-cables.csv",
    ["type", "status", "label", "a_device", "a_type", "a_name", "b_device", "b_type", "b_name"],
    cables,
)

print(f"\n  {len(RACKS)} racks, {len(D)} devices, {len(ifaces)} interfaces, {len(cables)} cables")
for name, (s, _loc, u, desc, note) in RACKS.items():
    n = sum(1 for d in D if d["rack"] == name)
    print(
        f"    {name}  {s:<22} {u:>2}U  {n:>2} devices  "
        f"{'top-down' if desc else 'bottom-up':<9} {note}"
    )
