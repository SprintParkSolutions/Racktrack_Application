"""Load RACK-02 into NetBox. Additive — RACK-01 is never touched."""

import csv
import os

from dcim.models import (
    Cable,
    Device,
    DeviceRole,
    DeviceType,
    FrontPort,
    Interface,
    Location,
    Manufacturer,
    Platform,
    PortMapping,
    PowerOutlet,
    PowerPort,
    Rack,
    RackRole,
    RearPort,
    Region,
    Site,
    SiteGroup,
)
from django.contrib.contenttypes.models import ContentType
from ipam.models import VLAN, IPAddress, Prefix
from tenancy.models import Tenant, TenantGroup

CSV = "/tmp/rack02"  # noqa: S108 — path inside the NetBox container


def rows(name):
    with open(os.path.join(CSV, name), newline="", encoding="utf-8") as fh:
        return list(csv.DictReader(fh))


def num(v, cast=int):
    return cast(v) if str(v).strip() else None


print(
    f"=== BEFORE ===  racks {Rack.objects.count()}"
    f"  devices {Device.objects.count()}  cables {Cable.objects.count()}"
)

# ── places and ownership ────────────────────────────────────────────────────
r = rows("01-regions.csv")[0]
region, _ = Region.objects.get_or_create(
    name=r["name"], defaults={"slug": r["slug"], "description": r["description"]}
)

g = rows("02-site-groups.csv")[0]
sgroup, _ = SiteGroup.objects.get_or_create(
    name=g["name"], defaults={"slug": g["slug"], "description": g["description"]}
)

tg = rows("03-tenant-groups.csv")[0]
tgroup, _ = TenantGroup.objects.get_or_create(
    name=tg["name"], defaults={"slug": tg["slug"], "description": tg["description"]}
)

t = rows("04-tenants.csv")[0]
tenant, _ = Tenant.objects.get_or_create(
    name=t["name"],
    defaults={
        "slug": t["slug"],
        "group": tgroup,
        "description": t["description"],
        "comments": t["comments"],
    },
)

lo = rows("05-locations.csv")[0]
site = Site.objects.get(name=lo["site"])
site.region, site.group, site.tenant = region, sgroup, tenant
site.status = "active"
site.description = site.description or "Head office"
site.save()

location, _ = Location.objects.get_or_create(
    site=site,
    name=lo["name"],
    defaults={
        "slug": lo["slug"],
        "status": "active",
        "tenant": tenant,
        "description": lo["description"],
    },
)

rr = rows("06-rack-roles.csv")[0]
rrole, _ = RackRole.objects.get_or_create(
    name=rr["name"],
    defaults={"slug": rr["slug"], "color": rr["color"], "description": rr["description"]},
)

rk = rows("07-racks.csv")[0]
rack, made = Rack.objects.get_or_create(
    site=site,
    name=rk["name"],
    defaults={
        "location": location,
        "facility_id": rk["facility_id"],
        "tenant": tenant,
        "status": rk["status"],
        "role": rrole,
        "rack_type": None,
        "form_factor": rk["type"],
        "serial": rk["serial"],
        "asset_tag": rk["asset_tag"],
        "width": int(rk["width"]),
        "u_height": int(rk["u_height"]),
        "starting_unit": int(rk["starting_unit"]),
        "desc_units": False,
        "outer_width": int(rk["outer_width"]),
        "outer_depth": int(rk["outer_depth"]),
        "outer_unit": rk["outer_unit"],
        "mounting_depth": int(rk["mounting_depth"]),
        "weight": float(rk["weight"]),
        "max_weight": int(rk["max_weight"]),
        "weight_unit": rk["weight_unit"],
        "airflow": rk["airflow"],
        "description": rk["description"],
        "comments": rk["comments"],
    },
)
print(f"  rack {rack.name} {'created' if made else 'already there'}")

# ── catalogue ───────────────────────────────────────────────────────────────
for m in rows("08-manufacturers.csv"):
    Manufacturer.objects.get_or_create(
        name=m["name"], defaults={"slug": m["slug"], "description": m["description"]}
    )

for p in rows("09-platforms.csv"):
    Platform.objects.get_or_create(
        name=p["name"],
        defaults={
            "slug": p["slug"],
            "description": p["description"],
            "manufacturer": Manufacturer.objects.get(name=p["manufacturer"]),
        },
    )

for r in rows("10-device-roles.csv"):
    DeviceRole.objects.get_or_create(
        name=r["name"],
        defaults={"slug": r["slug"], "color": r["color"], "description": r["description"]},
    )

for d in rows("11-device-types.csv"):
    if DeviceType.objects.filter(model=d["model"]).exists():
        continue
    DeviceType.objects.create(
        manufacturer=Manufacturer.objects.get(name=d["manufacturer"]),
        model=d["model"],
        slug=d["slug"],
        part_number=d["part_number"],
        u_height=int(d["u_height"]),
        is_full_depth=True,
        airflow=d["airflow"],
        weight=float(d["weight"]),
        weight_unit=d["weight_unit"],
        default_platform=Platform.objects.filter(name=d["default_platform"]).first(),
        exclude_from_utilization=False,
        description=d["description"],
        comments=d["comments"],
    )

# ── addressing first, so interfaces can carry a VLAN ────────────────────────
for v in rows("18-vlans.csv"):
    VLAN.objects.get_or_create(
        vid=int(v["vid"]),
        defaults={
            "site": site,
            "name": v["name"],
            "status": "active",
            "tenant": tenant,
            "description": v["description"],
        },
    )
VL = {v.vid: v for v in VLAN.objects.all()}

for p in rows("19-prefixes.csv"):
    if not Prefix.objects.filter(prefix=p["prefix"]).exists():
        # NetBox 4.2 replaced Prefix.site with a generic scope.
        pfx = Prefix(
            prefix=p["prefix"],
            status="active",
            tenant=tenant,
            vlan=VL[int(p["vlan"])],
            is_pool=False,
            description=p["description"],
        )
        if hasattr(pfx, "scope_type"):
            pfx.scope_type = ContentType.objects.get_for_model(Site)
            pfx.scope_id = site.id
        else:
            pfx.site = site
        pfx.save()

# ── the 42 devices ──────────────────────────────────────────────────────────
for d in rows("12-devices.csv"):
    if Device.objects.filter(name=d["name"]).exists():
        continue
    Device.objects.create(
        name=d["name"],
        role=DeviceRole.objects.get(name=d["role"]),
        device_type=DeviceType.objects.get(model=d["device_type"]),
        platform=Platform.objects.filter(name=d["platform"]).first(),
        site=site,
        location=location,
        rack=rack,
        position=float(d["position"]),
        face="front",
        status="active",
        airflow=d["airflow"],
        tenant=tenant,
        serial=d["serial"],
        asset_tag=d["asset_tag"],
        description=d["description"],
        comments=d["comments"],
    )

DEV = {d.name: d for d in Device.objects.filter(rack=rack)}
print(f"  devices in {rack.name}: {len(DEV)}")

# ── ports ───────────────────────────────────────────────────────────────────
if not Interface.objects.filter(device__rack=rack).exists():
    Interface.objects.bulk_create(
        [
            Interface(
                device=DEV[i["device"]],
                name=i["name"],
                label=i["label"],
                type=i["type"],
                speed=num(i["speed"]),
                duplex=i["duplex"] or None,
                enabled=True,
                mgmt_only=False,
                mtu=num(i["mtu"]),
                mode=i["mode"],
                poe_mode=i["poe_mode"],
                poe_type=i["poe_type"],
                description=i["description"],
            )
            for i in rows("13-interfaces.csv")
        ],
        batch_size=500,
    )

for i in rows("13-interfaces.csv"):
    if i["untagged_vlan"]:
        Interface.objects.filter(device=DEV[i["device"]], name=i["name"]).update(
            untagged_vlan=VL[int(i["untagged_vlan"])]
        )

if not RearPort.objects.filter(device__rack=rack).exists():
    RearPort.objects.bulk_create(
        [
            RearPort(
                device=DEV[p["device"]],
                name=p["name"],
                label=p["label"],
                type=p["type"],
                positions=int(p["positions"]),
                description=p["description"],
            )
            for p in rows("14-rear-ports.csv")
        ]
    )

# NetBox 4.6 moved the front-to-rear link out of FrontPort and into PortMapping,
# one row per front position. The old flat rear_port field is gone.
for p in rows("15-front-ports.csv"):
    dev = DEV[p["device"]]
    if FrontPort.objects.filter(device=dev, name=p["name"]).exists():
        continue
    fp = FrontPort.objects.create(
        device=dev,
        name=p["name"],
        label=p["label"],
        type=p["type"],
        positions=1,
        description=p["description"],
    )
    PortMapping.objects.create(
        device=dev,
        front_port=fp,
        front_port_position=1,
        rear_port=RearPort.objects.get(device=dev, name=p["rear_port"]),
        rear_port_position=int(p["rear_port_position"]),
    )

if not PowerPort.objects.filter(device__rack=rack).exists():
    PowerPort.objects.bulk_create(
        [
            PowerPort(
                device=DEV[p["device"]],
                name=p["name"],
                label=p["label"],
                type=p["type"],
                maximum_draw=int(p["maximum_draw"]),
                allocated_draw=int(p["allocated_draw"]),
                description=p["description"],
            )
            for p in rows("16-power-ports.csv")
        ]
    )

if not PowerOutlet.objects.filter(device__rack=rack).exists():
    PowerOutlet.objects.bulk_create(
        [
            PowerOutlet(
                device=DEV[p["device"]],
                name=p["name"],
                label=p["label"],
                type=p["type"],
                feed_leg=p["feed_leg"],
                description=p["description"],
            )
            for p in rows("17-power-outlets.csv")
        ]
    )

ct = ContentType.objects.get_for_model(Interface)
for a in rows("20-ip-addresses.csv"):
    dev = DEV[a["device"]]
    if dev.primary_ip4_id:
        continue
    iface = Interface.objects.get(device=dev, name=a["interface"])
    ip = IPAddress.objects.create(
        address=a["address"],
        status="active",
        tenant=tenant,
        dns_name=a["dns_name"],
        description=a["description"],
        assigned_object_type=ct,
        assigned_object_id=iface.id,
    )
    dev.primary_ip4 = ip
    dev.save()

# ── cables ──────────────────────────────────────────────────────────────────
MODEL = {
    "interface": Interface,
    "frontport": FrontPort,
    "rearport": RearPort,
    "powerport": PowerPort,
    "poweroutlet": PowerOutlet,
}
skipped = []
existing_labels = set(Cable.objects.values_list("label", flat=True))
for c in rows("21-cables.csv"):
    if c["label"] in existing_labels:
        continue
    try:
        a = MODEL[c["a_type"]].objects.get(device=DEV[c["a_device"]], name=c["a_name"])
        b = MODEL[c["b_type"]].objects.get(device=DEV[c["b_device"]], name=c["b_name"])
    except Exception as exc:
        skipped.append(f"{c['label']}: {exc}")
        continue
    cable = Cable(
        type=c["type"],
        status="connected",
        label=c["label"],
        color=c["color"],
        length=float(c["length"]),
        length_unit=c["length_unit"],
        tenant=tenant,
        description=c["description"],
    )
    cable.a_terminations = [a]
    cable.b_terminations = [b]
    try:
        cable.save()
    except Exception as exc:
        skipped.append(f"{c['label']}: {exc}")

if skipped:
    print(f"\n  {len(skipped)} cables skipped:")
    for s in skipped[:10]:
        print("    ", s[:120])

print("\n=== AFTER ===")
for m in (
    Region,
    SiteGroup,
    Site,
    Location,
    Tenant,
    RackRole,
    Rack,
    Platform,
    Manufacturer,
    DeviceType,
    DeviceRole,
    Device,
    Interface,
    FrontPort,
    RearPort,
    PowerPort,
    PowerOutlet,
    Cable,
    VLAN,
    Prefix,
    IPAddress,
):
    print(f"  {m.__name__:<14} {m.objects.count()}")
