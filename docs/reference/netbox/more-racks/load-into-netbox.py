"""Load RACK-03 to RACK-08. Additive and re-runnable; earlier racks untouched."""

import csv
import os

from dcim.models import (
    Cable,
    Device,
    DeviceRole,
    DeviceType,
    Interface,
    Location,
    Manufacturer,
    Platform,
    PowerOutlet,
    PowerPort,
    Rack,
    RackRole,
    Site,
)
from tenancy.models import Tenant

CSV = "/tmp/morerack"  # noqa: S108 — path inside the NetBox container


def rows(name):
    with open(os.path.join(CSV, name), newline="", encoding="utf-8") as fh:
        return list(csv.DictReader(fh))


tenant = Tenant.objects.get(name="Sprintpark IT")
rrole = RackRole.objects.get(name="Network")

print(
    f"before: racks {Rack.objects.count()}  devices {Device.objects.count()}  "
    f"cables {Cable.objects.count()}"
)

for s in rows("01-sites.csv"):
    Site.objects.get_or_create(
        name=s["name"],
        defaults={
            "slug": s["slug"],
            "status": "active",
            "tenant": tenant,
            "description": s["description"],
        },
    )

for lo in rows("02-locations.csv"):
    Location.objects.get_or_create(
        site=Site.objects.get(name=lo["site"]),
        name=lo["name"],
        defaults={
            "slug": lo["slug"],
            "status": "active",
            "tenant": tenant,
            "description": lo["description"],
        },
    )

for t in rows("03-device-types.csv"):
    if DeviceType.objects.filter(model=t["model"]).exists():
        continue
    DeviceType.objects.create(
        manufacturer=Manufacturer.objects.get(name=t["manufacturer"]),
        model=t["model"],
        slug=t["slug"],
        part_number=t["part_number"],
        u_height=int(t["u_height"]),
        is_full_depth=t["is_full_depth"] == "true",
        description=t["description"],
        comments=t["comments"],
    )

for r in rows("04-racks.csv"):
    site = Site.objects.get(name=r["site"])
    Rack.objects.get_or_create(
        site=site,
        name=r["name"],
        defaults={
            "location": Location.objects.get(site=site, name=r["location"]),
            "tenant": tenant,
            "status": "active",
            "role": rrole,
            "form_factor": r["type"],
            "serial": r["serial"],
            "asset_tag": r["asset_tag"],
            "width": 19,
            "u_height": int(r["u_height"]),
            "starting_unit": 1,
            "desc_units": r["desc_units"] == "true",
            "airflow": r["airflow"],
            "description": r["description"],
            "comments": r["comments"],
        },
    )

for d in rows("05-devices.csv"):
    if Device.objects.filter(name=d["name"]).exists():
        continue
    site = Site.objects.get(name=d["site"])
    Device.objects.create(
        name=d["name"],
        role=DeviceRole.objects.get(name=d["role"]),
        device_type=DeviceType.objects.get(model=d["device_type"]),
        platform=Platform.objects.filter(name=d["platform"]).first(),
        site=site,
        location=Location.objects.get(site=site, name=d["location"]),
        rack=Rack.objects.get(site=site, name=d["rack"]),
        position=float(d["position"]),
        face=d["face"],
        status=d["status"],
        tenant=tenant,
        serial=d["serial"],
        asset_tag=d["asset_tag"] or None,
        description=d["description"][:200],
        comments=d["comments"],
    )

NEW = {
    d.name: d
    for d in Device.objects.filter(rack__name__in=[r["name"] for r in rows("04-racks.csv")])
}
print(f"  devices across the six racks: {len(NEW)}")

if not Interface.objects.filter(device__in=NEW.values()).exists():
    Interface.objects.bulk_create(
        [
            Interface(
                device=NEW[i["device"]],
                name=i["name"],
                label=i["label"],
                type=i["type"],
                enabled=True,
                description=i["description"],
            )
            for i in rows("06-interfaces.csv")
        ],
        batch_size=500,
    )

if not PowerPort.objects.filter(device__in=NEW.values()).exists():
    PowerPort.objects.bulk_create(
        [
            PowerPort(device=NEW[p["device"]], name=p["name"], label=p["label"], type=p["type"])
            for p in rows("07-power-ports.csv")
        ]
    )

if not PowerOutlet.objects.filter(device__in=NEW.values()).exists():
    PowerOutlet.objects.bulk_create(
        [
            PowerOutlet(device=NEW[p["device"]], name=p["name"], label=p["label"], type=p["type"])
            for p in rows("08-power-outlets.csv")
        ]
    )

MODEL = {"interface": Interface, "powerport": PowerPort, "poweroutlet": PowerOutlet}
made, failed = 0, []
for c in rows("09-cables.csv"):
    try:
        a = MODEL[c["a_type"]].objects.get(device=NEW[c["a_device"]], name=c["a_name"])
        b = MODEL[c["b_type"]].objects.get(device=NEW[c["b_device"]], name=c["b_name"])
        if a.cable_id or b.cable_id:
            continue
        cable = Cable(type=c["type"], status="connected", label=c["label"], tenant=tenant)
        cable.a_terminations = [a]
        cable.b_terminations = [b]
        cable.save()
        cable.refresh_from_db()
        if len(cable.a_terminations) != 1 or len(cable.b_terminations) != 1:
            cable.delete()
            failed.append(f"{c['label']}: came back with a missing end, removed")
        else:
            made += 1
    except Exception as exc:
        failed.append(f"{c['label']}: {str(exc)[:90]}")

print(f"  cables created {made}, failed {len(failed)}")
for f in failed[:10]:
    print("    ", f)

dangling = [
    c for c in Cable.objects.all() if len(c.a_terminations) < 1 or len(c.b_terminations) < 1
]
print(
    f"\nafter: racks {Rack.objects.count()}  devices {Device.objects.count()}  "
    f"interfaces {Interface.objects.count()}  cables {Cable.objects.count()}  "
    f"dangling {len(dangling)}"
)
