"""Rebuild RACK-02's cables. Any cable that ends up with fewer than two ends is
deleted rather than kept — a cable with one end is not a cable.
"""

import csv
import os

from dcim.models import (
    Cable,
    Device,
    FrontPort,
    Interface,
    PowerOutlet,
    PowerPort,
    Rack,
    RearPort,
)
from tenancy.models import Tenant

CSV = "/tmp/rack02"  # noqa: S108 — path inside the NetBox container
rack = Rack.objects.get(name="RACK-02")
tenant = Tenant.objects.filter(name="Sprintpark IT").first()
DEV = {d.name: d for d in Device.objects.filter(rack=rack)}

# clear every cable touching this rack, dangling ones included
ids = set()
for model in (Interface, FrontPort, RearPort, PowerPort, PowerOutlet):
    ids |= set(
        model.objects.filter(device__rack=rack)
        .exclude(cable=None)
        .values_list("cable_id", flat=True)
    )
print(f"removing {len(ids)} cables attached to {rack.name}")
Cable.objects.filter(id__in=ids).delete()

stray = [c for c in Cable.objects.all() if len(c.a_terminations) < 1 or len(c.b_terminations) < 1]
if stray:
    print(f"removing {len(stray)} cables that had a missing end")
    Cable.objects.filter(id__in=[c.id for c in stray]).delete()

MODEL = {
    "interface": Interface,
    "frontport": FrontPort,
    "rearport": RearPort,
    "powerport": PowerPort,
    "poweroutlet": PowerOutlet,
}

with open(os.path.join(CSV, "21-cables.csv"), newline="", encoding="utf-8") as fh:
    rows = list(csv.DictReader(fh))

made, failed = 0, []
for c in rows:
    try:
        a = MODEL[c["a_type"]].objects.get(device=DEV[c["a_device"]], name=c["a_name"])
        b = MODEL[c["b_type"]].objects.get(device=DEV[c["b_device"]], name=c["b_name"])
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
        cable.save()
        cable.refresh_from_db()
        if len(cable.a_terminations) != 1 or len(cable.b_terminations) != 1:
            cable.delete()
            failed.append(f"{c['label']}: saved with a missing end, removed")
        else:
            made += 1
    except Exception as exc:
        failed.append(f"{c['label']}: {str(exc)[:90]}")

print(f"\ncreated {made} of {len(rows)}")
if failed:
    print(f"failed {len(failed)}:")
    for f in failed[:12]:
        print("   ", f)

dangling = [
    c for c in Cable.objects.all() if len(c.a_terminations) < 1 or len(c.b_terminations) < 1
]
print(f"\ncables in NetBox: {Cable.objects.count()}   with a missing end: {len(dangling)}")
