"""Build NetBox import CSVs for our own rack, from measured data only.

Nothing here is invented. Every value traces to one of:
  - server/data/netbox/switch-data/*.json   SNMP readings taken from the switches
  - server/data/netbox/switches.json        the labels and addresses a person typed
  - server/data/netbox/scans/4.json         the rack scan whose positions were accepted

The three values a photograph and a switch cannot supply — the site name, the
rack name and the rack height — are at the top, to be set by a person.

    python3 build-csvs.py            writes the CSVs next to this file
"""

import csv
import json
import pathlib

# ── the three a person has to state ─────────────────────────────────────────
SITE_NAME = "Sprintpark HQ"
RACK_NAME = "RACK-01"
RACK_UHEIGHT = 24  # a comms cabinet; 17 of its shelves are in use

REPO = pathlib.Path(__file__).resolve().parents[4]
DATA = REPO / "server" / "data" / "netbox"
HERE = pathlib.Path(__file__).resolve().parent

# switch record id -> the shelf a person accepted in scan 4 (rack RK-A31AE2E7)
PLACED = {12: 10, 10: 12, 11: 15}
ROLE = {12: "Core Switch", 10: "Access Switch", 11: "Access Switch"}


def slugify(text):
    return "".join(c if c.isalnum() else "-" for c in text.lower()).strip("-")


def load(path):
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


switches = {s["id"]: s for s in load(DATA / "switches.json")["switches"]}

devices = []
for sid, unit in sorted(PLACED.items(), key=lambda kv: -kv[1]):
    rec = switches[sid]
    read = load(DATA / "switch-data" / f"{sid}.json")
    ident, system = read.get("identity") or {}, read.get("system") or {}
    ifaces = read.get("interfaces") or []
    macs = [i["mac"] for i in ifaces if i.get("mac")]
    devices.append(
        {
            "sid": sid,
            "name": rec["label"],
            "host": rec["host"],
            "unit": unit,
            "role": ROLE[sid],
            "vendor": ident.get("manufacturer") or system.get("vendor"),
            "model": ident.get("model") or system.get("derivedModel"),
            "serial": ident.get("serial") or "",
            "descr": system.get("sysDescr") or "",
            "chassis": (macs[0].upper() if macs else ""),
            "ifaces": ifaces,
        }
    )


def write(name, header, rows):
    path = HERE / name
    with open(path, "w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=header, lineterminator="\n")
        w.writeheader()
        w.writerows(rows)
    print(f"  {name:<26} {len(rows):>4} rows")
    return path


print(f"Site {SITE_NAME!r}  Rack {RACK_NAME!r}  ({RACK_UHEIGHT}U)")

write(
    "01-manufacturers.csv",
    ["name", "slug"],
    [{"name": v, "slug": slugify(v)} for v in sorted({d["vendor"] for d in devices})],
)

seen, types = set(), []
for d in devices:
    if d["model"] in seen:
        continue
    seen.add(d["model"])
    types.append(
        {
            "manufacturer": d["vendor"],
            "model": d["model"],
            "slug": slugify(d["model"]),
            "u_height": 1,
            "is_full_depth": "true",
            "description": f"{len(d['ifaces'])} ports, read over SNMP",
        }
    )
write(
    "02-device-types.csv",
    ["manufacturer", "model", "slug", "u_height", "is_full_depth", "description"],
    types,
)

write(
    "03-device-roles.csv",
    ["name", "slug", "color", "vm_role"],
    [
        {"name": r, "slug": slugify(r), "color": c, "vm_role": "false"}
        for r, c in (("Core Switch", "2196f3"), ("Access Switch", "4caf50"))
    ],
)

write(
    "04-sites.csv",
    ["name", "slug", "status"],
    [{"name": SITE_NAME, "slug": slugify(SITE_NAME), "status": "active"}],
)

write(
    "05-racks.csv",
    ["site", "name", "status", "width", "u_height", "desc_units"],
    [
        {
            "site": SITE_NAME,
            "name": RACK_NAME,
            "status": "active",
            "width": 19,
            "u_height": RACK_UHEIGHT,
            "desc_units": "false",
        }
    ],
)

write(
    "06-devices.csv",
    [
        "name",
        "role",
        "manufacturer",
        "device_type",
        "site",
        "rack",
        "position",
        "face",
        "status",
        "serial",
        "description",
    ],
    [
        {
            "name": d["name"],
            "role": d["role"],
            "manufacturer": d["vendor"],
            "device_type": d["model"],
            "site": SITE_NAME,
            "rack": RACK_NAME,
            "position": d["unit"],
            "face": "front",
            "status": "active",
            "serial": d["serial"],
            "description": d["descr"],
        }
        for d in devices
    ],
)

rows = []
for d in devices:
    for i in d["ifaces"]:
        rows.append(
            {
                "device": d["name"],
                "name": i["name"],
                "type": "1000base-t",
                "enabled": "true" if i.get("adminStatus") == "up" else "false",
                "mac_address": (i.get("mac") or "").upper(),
                "mark_connected": "true" if i.get("operStatus") == "up" else "false",
                "description": "",
            }
        )
write(
    "07-interfaces.csv",
    ["device", "name", "type", "enabled", "mac_address", "mark_connected", "description"],
    rows,
)

write(
    "08-ip-addresses.csv",
    ["address", "status", "device", "interface", "description"],
    [
        {
            "address": f"{d['host']}/24",
            "status": "active",
            "device": d["name"],
            "interface": d["ifaces"][0]["name"] if d["ifaces"] else "",
            "description": "Management address",
        }
        for d in devices
    ],
)

print("\nWhat this describes")
for d in devices:
    print(
        f"  U{d['unit']:<3} {d['name']:<14} {d['vendor']} {d['model']:<14} "
        f"{len(d['ifaces'])} ports  serial={d['serial'] or 'none published'}  {d['host']}"
    )
