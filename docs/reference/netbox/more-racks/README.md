# Six more racks, each a different case

Not more of the same. Each one demonstrates something the matcher or the report
has to cope with, and each is deliberately awkward in one specific way.

| Rack | Site | Size | What it demonstrates |
|---|---|---|---|
| RACK-03 | Sprintpark HQ | 42U | **Sparse.** 8 devices, 34 shelves free, so utilisation is a real number |
| RACK-04 | Sprintpark HQ | 42U | **One box is not one device.** A four-member stack, a 4U chassis, two 2U servers |
| RACK-05 | Sprintpark HQ | 42U | **Lifecycle.** Every status NetBox models, on one rack |
| RACK-06 | Sprintpark HQ | 42U | **Both faces.** Six switches on the front, four panels and two PDUs on the rear |
| RACK-07 | Sprintpark HQ | 42U | **Twenty identical.** Same model, same ports, no serial, no asset tag |
| RACK-08 | Sprintpark Manchester | 12U | **A second site**, a wall cabinet, numbered from the top |

68 devices · 2,156 interfaces · 87 power ports · 99 cables · nothing dangling.

## Why each one matters

**RACK-03** is mostly empty on purpose. A rack that reports 8 of 42 shelves used
is the only way to see whether free-space reporting is telling the truth.

**RACK-04** breaks the assumption that a box is a device. Four stack members sit
at four shelves and behave as one switch. A 4U chassis occupies U30 to U33 but
records U30 as its position — so the three shelves above it must not be reported
as free. Two 2U servers do the same on a smaller scale.

**RACK-05** carries a device in every status: active, offline, planned, staged,
failed, inventory and decommissioning. A report that shows them all the same way
is not usable by anyone doing the work.

**RACK-06** puts equipment on both faces at the same shelf numbers. This is where
asset tags collide if you build them from the rack and shelf alone — they are
unique across the entire install, not per rack, so the face has to be part of
the tag. That bug was hit and fixed while building this.

**RACK-07** is the case the binding standard says cannot be solved from a
photograph: twenty switches of the same model, the same port count, no serial
published and no asset tag. Nothing but a person's word separates them.

**RACK-08** is a different site entirely, a 12U wall cabinet, with `desc_units`
set so shelf 1 is at the top. Anything that assumes bottom-up numbering gets this
rack wrong.

## Rebuilding

    python3 build-csvs.py

Writes 9 CSVs. `load-into-netbox.py` runs inside the NetBox container; it is
additive, skips anything already present, and refuses to leave a cable with one
end — it re-reads each cable after saving and deletes any that came back
one-ended.

The generator also self-checks before writing: no termination is used twice, no
two devices overlap on the same face and shelf, and nothing sits past the top of
its rack.
