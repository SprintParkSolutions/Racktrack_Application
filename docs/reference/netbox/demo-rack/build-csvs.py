"""Build NetBox import CSVs for RACK-02 — a full 42U rack, every shelf filled,
every field a person would ever fill in actually filled in.

Unlike RACK-01, none of this was measured. It is invented, and it says so on
every rack and device, so it can never be mistaken for observed equipment. Its
purpose is to exercise the whole model end to end: regions and sites, tenants
and contacts, platforms, locations, rack roles, patch panels threaded front to
rear, cables with both ends, dual power feeds, VLANs, prefixes and addresses.

    python3 build-csvs.py
"""

import csv
import pathlib

HERE = pathlib.Path(__file__).resolve().parent
DEMO = "Example data for demonstration. Not observed equipment."

REGION = "United Kingdom"
SITE_GROUP = "Corporate"
SITE = "Sprintpark HQ"
LOCATION = "Ground Floor Comms Room"
TENANT_GROUP = "Internal"
TENANT = "Sprintpark IT"
RACK = "RACK-02"
RACK_U = 42

# ── catalogue ───────────────────────────────────────────────────────────────
# model, manufacturer, part number, u_height, data ports, uplinks, psus,
# platform, airflow, weight kg
TYPES = [
    ("FortiGate 100F", "Fortinet", "FG-100F", 1, 10, 0, 1, "FortiOS 7.4", "front-to-rear", 4.0),
    ("ISR 4331", "Cisco", "ISR4331/K9", 1, 4, 0, 1, "Cisco IOS-XE 17", "front-to-rear", 5.4),
    (
        "Catalyst 9300-48P",
        "Cisco",
        "C9300-48P",
        1,
        48,
        4,
        2,
        "Cisco IOS-XE 17",
        "front-to-rear",
        7.6,
    ),
    (
        "Catalyst 9200-48P",
        "Cisco",
        "C9200-48P",
        1,
        48,
        4,
        2,
        "Cisco IOS-XE 17",
        "front-to-rear",
        6.4,
    ),
    ("PowerEdge R650", "Dell", "R650", 1, 4, 0, 2, "Ubuntu 24.04", "front-to-rear", 19.5),
    ("AP8853 Rack PDU", "APC", "AP8853", 1, 0, 0, 0, "", "passive", 6.8),
    ("24-Port Patch Panel", "Generic", "PP-24-C6", 1, 0, 0, 0, "", "passive", 1.9),
    ("OpenGear CM8148", "Opengear", "CM8148", 1, 48, 0, 2, "Opengear 23.03", "front-to-rear", 4.5),
]
TYPE = {t[0]: t for t in TYPES}
MANUFACTURERS = sorted({t[1] for t in TYPES})
PLATFORMS = [(p, m) for m, p in sorted({(t[1], t[7]) for t in TYPES if t[7]})]

ROLES = [
    ("Firewall", "f44336", "Perimeter and internal firewalls"),
    ("Router", "ff9800", "WAN edge routers"),
    ("Core Switch", "2196f3", "Distribution and core layer"),
    ("Access Switch", "4caf50", "Edge ports for desks and handsets"),
    ("Patch Panel", "9e9e9e", "Passive copper termination"),
    ("Server", "673ab7", "Physical compute"),
    ("Console Server", "00897b", "Out-of-band management"),
    ("Power Distribution", "795548", "Rack power strips"),
]

# ── the 42 shelves, top down ────────────────────────────────────────────────
LAYOUT = []


def fill(prefix, role, model, count, start_u):
    for i in range(count):
        LAYOUT.append((start_u - i, f"{prefix}-{i + 1:02d}", role, model))


fill("FW", "Firewall", "FortiGate 100F", 2, 42)
fill("RTR", "Router", "ISR 4331", 2, 40)
fill("CORE", "Core Switch", "Catalyst 9300-48P", 2, 38)
fill("PP", "Patch Panel", "24-Port Patch Panel", 4, 36)
fill("ACC", "Access Switch", "Catalyst 9200-48P", 20, 32)
fill("SRV", "Server", "PowerEdge R650", 8, 12)
fill("OOB", "Console Server", "OpenGear CM8148", 2, 4)
fill("PDU", "Power Distribution", "AP8853 Rack PDU", 2, 2)
LAYOUT.sort(key=lambda d: -d[0])

PANELS = [d[1] for d in LAYOUT if d[2] == "Patch Panel"]
PDUS = [d[1] for d in LAYOUT if d[2] == "Power Distribution"]
ACCESS = [d[1] for d in LAYOUT if d[2] == "Access Switch"]
SERVERS = [d[1] for d in LAYOUT if d[2] == "Server"]
PANEL_PORTS, PDU_OUTLETS = 24, 42

VLANS = [
    (10, "Data", "User workstations"),
    (20, "Voice", "Handsets"),
    (30, "Management", "Switch and firewall management"),
    (40, "Servers", "Physical compute"),
    (99, "Native", "Untagged, unused"),
]
PREFIXES = [
    ("10.20.10.0/24", 10),
    ("10.20.20.0/24", 20),
    ("10.20.30.0/24", 30),
    ("10.20.40.0/24", 40),
]


def slug(text):
    return "".join(c if c.isalnum() else "-" for c in text.lower()).strip("-")


def write(name, header, rows):
    with open(HERE / name, "w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=header, lineterminator="\n")
        w.writeheader()
        w.writerows(rows)
    print(f"  {name:<26} {len(rows):>5} rows")


print(f"{RACK}: {RACK_U}U, every shelf filled")

# ── places and ownership ────────────────────────────────────────────────────
write(
    "01-regions.csv",
    ["name", "slug", "description"],
    [{"name": REGION, "slug": slug(REGION), "description": DEMO}],
)

write(
    "02-site-groups.csv",
    ["name", "slug", "description"],
    [{"name": SITE_GROUP, "slug": slug(SITE_GROUP), "description": DEMO}],
)

write(
    "03-tenant-groups.csv",
    ["name", "slug", "description"],
    [{"name": TENANT_GROUP, "slug": slug(TENANT_GROUP), "description": DEMO}],
)

write(
    "04-tenants.csv",
    ["name", "slug", "group", "description", "comments"],
    [
        {
            "name": TENANT,
            "slug": slug(TENANT),
            "group": TENANT_GROUP,
            "description": "Owns the corporate network",
            "comments": DEMO,
        }
    ],
)

write(
    "05-locations.csv",
    ["site", "name", "slug", "status", "tenant", "description"],
    [
        {
            "site": SITE,
            "name": LOCATION,
            "slug": slug(LOCATION),
            "status": "active",
            "tenant": TENANT,
            "description": "Comms room behind reception",
        }
    ],
)

write(
    "06-rack-roles.csv",
    ["name", "slug", "color", "description"],
    [
        {
            "name": "Network",
            "slug": "network",
            "color": "2196f3",
            "description": "Racks holding network equipment",
        }
    ],
)

write(
    "07-racks.csv",
    [
        "site",
        "location",
        "name",
        "facility_id",
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
        "outer_width",
        "outer_depth",
        "outer_unit",
        "mounting_depth",
        "weight",
        "max_weight",
        "weight_unit",
        "airflow",
        "description",
        "comments",
    ],
    [
        {
            "site": SITE,
            "location": LOCATION,
            "name": RACK,
            "facility_id": "GF-R02",
            "tenant": TENANT,
            "status": "active",
            "role": "Network",
            "type": "4-post-cabinet",
            "serial": "DEMO-RACK-0002",
            "asset_tag": "SPK-RACK-0002",
            "width": 19,
            "u_height": RACK_U,
            "starting_unit": 1,
            "desc_units": "false",
            "outer_width": 600,
            "outer_depth": 1000,
            "outer_unit": "mm",
            "mounting_depth": 800,
            "weight": 120,
            "max_weight": 1000,
            "weight_unit": "kg",
            "airflow": "front-to-rear",
            "description": "Full-height cabinet, every shelf occupied",
            "comments": DEMO,
        }
    ],
)

# ── the catalogue ───────────────────────────────────────────────────────────
write(
    "08-manufacturers.csv",
    ["name", "slug", "description"],
    [{"name": m, "slug": slug(m), "description": DEMO} for m in MANUFACTURERS],
)

write(
    "09-platforms.csv",
    ["name", "slug", "manufacturer", "description"],
    [{"name": p, "slug": slug(p), "manufacturer": m, "description": DEMO} for p, m in PLATFORMS],
)

write(
    "10-device-roles.csv",
    ["name", "slug", "color", "vm_role", "description"],
    [
        {"name": n, "slug": slug(n), "color": c, "vm_role": "false", "description": d}
        for n, c, d in ROLES
    ],
)

write(
    "11-device-types.csv",
    [
        "manufacturer",
        "model",
        "slug",
        "part_number",
        "u_height",
        "is_full_depth",
        "airflow",
        "weight",
        "weight_unit",
        "default_platform",
        "exclude_from_utilization",
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
            "is_full_depth": "true",
            "airflow": air,
            "weight": kg,
            "weight_unit": "kg",
            "default_platform": plat,
            "exclude_from_utilization": "false",
            "description": f"{ports + up} ports" if ports + up else "Passive",
            "comments": DEMO,
        }
        for model, mfr, part, u, ports, up, _psu, plat, air, kg in TYPES
    ],
)

# ── the 42 devices ──────────────────────────────────────────────────────────
MGMT = {}
n = 10
for u, name, role, model in LAYOUT:
    if TYPE[model][4]:
        MGMT[name] = f"10.20.30.{n}"
        n += 1

write(
    "12-devices.csv",
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
        "airflow",
        "tenant",
        "serial",
        "asset_tag",
        "description",
        "comments",
    ],
    [
        {
            "name": name,
            "role": role,
            "manufacturer": TYPE[model][1],
            "device_type": model,
            "platform": TYPE[model][7],
            "site": SITE,
            "location": LOCATION,
            "rack": RACK,
            "position": u,
            "face": "front",
            "status": "active",
            "airflow": TYPE[model][8],
            "tenant": TENANT,
            "serial": f"DEMO{u:02d}{TYPE[model][2][:4].upper()}",
            "asset_tag": f"SPK-{RACK}-U{u:02d}",
            "description": f"{role} at shelf {u}",
            "comments": DEMO,
        }
        for u, name, role, model in LAYOUT
    ],
)

# ── ports ───────────────────────────────────────────────────────────────────
ifaces = []
for u, name, role, model in LAYOUT:
    _m, _mf, _p, _u, ports, ups, _psu, _pl, _air, _kg = TYPE[model]
    for i in range(1, ports + 1):
        ifaces.append(
            {
                "device": name,
                "name": f"GigabitEthernet1/0/{i}",
                "label": f"Port {i}",
                "type": "1000base-t",
                "speed": 1000000,
                "duplex": "full",
                "enabled": "true",
                "mgmt_only": "false",
                "mtu": 1500,
                "mode": "access",
                "untagged_vlan": 10,
                "poe_mode": "pse" if role == "Access Switch" else "",
                "poe_type": "type2-ieee802.3at" if role == "Access Switch" else "",
                "description": f"Edge port {i}" if role == "Access Switch" else "",
            }
        )
    for i in range(1, ups + 1):
        ifaces.append(
            {
                "device": name,
                "name": f"TenGigabitEthernet1/1/{i}",
                "label": f"Uplink {i}",
                "type": "10gbase-x-sfpp",
                "speed": 10000000,
                "duplex": "full",
                "enabled": "true",
                "mgmt_only": "false",
                "mtu": 9216,
                "mode": "tagged",
                "untagged_vlan": 99,
                "poe_mode": "",
                "poe_type": "",
                "description": "Uplink",
            }
        )
write(
    "13-interfaces.csv",
    [
        "device",
        "name",
        "label",
        "type",
        "speed",
        "duplex",
        "enabled",
        "mgmt_only",
        "mtu",
        "mode",
        "untagged_vlan",
        "poe_mode",
        "poe_type",
        "description",
    ],
    ifaces,
)

write(
    "14-rear-ports.csv",
    ["device", "name", "label", "type", "positions", "description"],
    [
        {
            "device": p,
            "name": f"Rear{i}",
            "label": f"R{i}",
            "type": "8p8c",
            "positions": 1,
            "description": f"Riser to floor outlet {i}",
        }
        for p in PANELS
        for i in range(1, PANEL_PORTS + 1)
    ],
)

write(
    "15-front-ports.csv",
    ["device", "name", "label", "type", "rear_port", "rear_port_position", "description"],
    [
        {
            "device": p,
            "name": f"Front{i}",
            "label": f"F{i}",
            "type": "8p8c",
            "rear_port": f"Rear{i}",
            "rear_port_position": 1,
            "description": f"Patch to switch, position {i}",
        }
        for p in PANELS
        for i in range(1, PANEL_PORTS + 1)
    ],
)

write(
    "16-power-ports.csv",
    ["device", "name", "label", "type", "maximum_draw", "allocated_draw", "description"],
    [
        {
            "device": name,
            "name": f"PSU{i}",
            "label": f"PSU {i}",
            "type": "iec-60320-c14",
            "maximum_draw": 350,
            "allocated_draw": 180,
            "description": f"Power supply {i}",
        }
        for _u, name, _r, model in LAYOUT
        for i in range(1, TYPE[model][6] + 1)
    ],
)

write(
    "17-power-outlets.csv",
    ["device", "name", "label", "type", "feed_leg", "description"],
    [
        {
            "device": p,
            "name": f"Outlet{i}",
            "label": f"C13-{i}",
            "type": "iec-60320-c13",
            "feed_leg": ["A", "B", "C"][i % 3],
            "description": f"Switched outlet {i}",
        }
        for p in PDUS
        for i in range(1, PDU_OUTLETS + 1)
    ],
)

# ── addressing ──────────────────────────────────────────────────────────────
write(
    "18-vlans.csv",
    ["site", "vid", "name", "status", "tenant", "description"],
    [
        {"site": SITE, "vid": v, "name": nm, "status": "active", "tenant": TENANT, "description": d}
        for v, nm, d in VLANS
    ],
)

write(
    "19-prefixes.csv",
    ["prefix", "vlan", "site", "status", "tenant", "is_pool", "description"],
    [
        {
            "prefix": p,
            "vlan": v,
            "site": SITE,
            "status": "active",
            "tenant": TENANT,
            "is_pool": "false",
            "description": dict((a, b) for a, b, _ in [(x, y, z) for x, y, z in VLANS])[v],
        }
        for p, v in PREFIXES
    ],
)

write(
    "20-ip-addresses.csv",
    ["address", "status", "role", "tenant", "device", "interface", "dns_name", "description"],
    [
        {
            "address": f"{ip}/24",
            "status": "active",
            "role": "",
            "tenant": TENANT,
            "device": name,
            "interface": "GigabitEthernet1/0/1",
            "dns_name": f"{name.lower()}.hq.sprintpark.local",
            "description": "Management address",
        }
        for name, ip in MGMT.items()
    ],
)

# ── cables, both ends, always ───────────────────────────────────────────────
cables = []
IF, FP, PP, PO = "interface", "frontport", "powerport", "poweroutlet"


def cable(kind, colour, length, a, at, an, b, bt, bn, label):
    cables.append(
        {
            "type": kind,
            "status": "connected",
            "color": colour,
            "length": length,
            "length_unit": "m",
            "label": label,
            "tenant": TENANT,
            "description": label,
            "a_device": a,
            "a_type": at,
            "a_name": an,
            "b_device": b,
            "b_type": bt,
            "b_name": bn,
        }
    )


# Every access switch is dual-homed. A core has only four SFP+ ports, so the
# uplinks land on core data ports and the SFP+ pair carries the interlink.
for i, acc in enumerate(ACCESS, start=1):
    cable(
        "smf-os2",
        "0091ff",
        3,
        acc,
        IF,
        "TenGigabitEthernet1/1/1",
        "CORE-01",
        IF,
        f"GigabitEthernet1/0/{i}",
        f"{acc} uplink A",
    )
    cable(
        "smf-os2",
        "ffc107",
        3,
        acc,
        IF,
        "TenGigabitEthernet1/1/2",
        "CORE-02",
        IF,
        f"GigabitEthernet1/0/{i}",
        f"{acc} uplink B",
    )

cable(
    "smf-os2",
    "f44336",
    1,
    "CORE-01",
    IF,
    "TenGigabitEthernet1/1/1",
    "CORE-02",
    IF,
    "TenGigabitEthernet1/1/1",
    "Core interlink",
)
cable(
    "cat6",
    "4caf50",
    2,
    "CORE-01",
    IF,
    "GigabitEthernet1/0/47",
    "FW-01",
    IF,
    "GigabitEthernet1/0/1",
    "Core 1 to firewall 1",
)
cable(
    "cat6",
    "4caf50",
    2,
    "CORE-02",
    IF,
    "GigabitEthernet1/0/47",
    "FW-02",
    IF,
    "GigabitEthernet1/0/1",
    "Core 2 to firewall 2",
)
cable(
    "cat6",
    "9e9e9e",
    1,
    "FW-01",
    IF,
    "GigabitEthernet1/0/10",
    "FW-02",
    IF,
    "GigabitEthernet1/0/10",
    "Firewall HA heartbeat",
)
cable(
    "cat6",
    "ff9800",
    2,
    "FW-01",
    IF,
    "GigabitEthernet1/0/2",
    "RTR-01",
    IF,
    "GigabitEthernet1/0/1",
    "Firewall 1 to router 1",
)
cable(
    "cat6",
    "ff9800",
    2,
    "FW-02",
    IF,
    "GigabitEthernet1/0/2",
    "RTR-02",
    IF,
    "GigabitEthernet1/0/1",
    "Firewall 2 to router 2",
)

# four floors of desks, patched through the panels into the first four switches
for pi, panel in enumerate(PANELS):
    target = ACCESS[pi]
    for i in range(1, PANEL_PORTS + 1):
        cable(
            "cat6",
            "2196f3",
            1,
            panel,
            FP,
            f"Front{i}",
            target,
            IF,
            f"GigabitEthernet1/0/{i}",
            f"{panel} port {i} to {target}",
        )

# every server dual-homed to two different switches
for i, srv in enumerate(SERVERS):
    a, b = ACCESS[(i * 2) % len(ACCESS)], ACCESS[(i * 2 + 1) % len(ACCESS)]
    cable(
        "cat6",
        "673ab7",
        2,
        srv,
        IF,
        "GigabitEthernet1/0/1",
        a,
        IF,
        f"GigabitEthernet1/0/{45 + (i % 2)}",
        f"{srv} NIC 1",
    )
    cable(
        "cat6",
        "673ab7",
        2,
        srv,
        IF,
        "GigabitEthernet1/0/2",
        b,
        IF,
        f"GigabitEthernet1/0/{45 + (i % 2)}",
        f"{srv} NIC 2",
    )

# power: PSU1 on the A strip, PSU2 on the B strip, so either can fail
used = {PDUS[0]: 0, PDUS[1]: 0}
for _u, name, _r, model in LAYOUT:
    for i in range(1, TYPE[model][6] + 1):
        pdu = PDUS[0] if i % 2 else PDUS[1]
        used[pdu] += 1
        cable(
            "power",
            "795548",
            1,
            name,
            PP,
            f"PSU{i}",
            pdu,
            PO,
            f"Outlet{used[pdu]}",
            f"{name} PSU{i}",
        )

write(
    "21-cables.csv",
    [
        "type",
        "status",
        "color",
        "length",
        "length_unit",
        "label",
        "tenant",
        "description",
        "a_device",
        "a_type",
        "a_name",
        "b_device",
        "b_type",
        "b_name",
    ],
    cables,
)

print(f"\n  {len(LAYOUT)} devices on {RACK_U} shelves")
print(f"  {len(ifaces)} interfaces, {PANEL_PORTS * len(PANELS)} front and rear pairs")
print(f"  {PDU_OUTLETS * len(PDUS)} outlets, {len(cables)} cables, {len(MGMT)} addresses")
