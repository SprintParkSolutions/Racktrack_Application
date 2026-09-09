# Our rack in NetBox

The foundation of the RackTrack NetBox instance: one site, one rack, three
managed switches, every value measured rather than guessed.

Loaded 9 September 2026. Everything that was in NetBox before was removed first
— 2 racks and 14 devices of photo-detected `Unidentified Switch (n-port)`
placeholders, with no serials, no addresses and no cables. A backup of that
state is at `_local/netbox-backup/netbox-before-reset-2026-09-09.json`.

## What is in there now

| Shelf | Name | Role | Model | Ports | Serial | Address |
|---|---|---|---|---|---|---|
| U15 | SW2 | Access Switch | TP-Link SG2428P | 28 | 222B0K4000217 | 192.168.1.12 |
| U12 | Sw1 | Access Switch | TP-Link SG2428P | 28 | 222B0K4000121 | 192.168.1.11 |
| U10 | Core switch | Core Switch | D-Link DGS-1210-52 | 52 | none published | 192.168.1.100 |

Site **Sprintpark HQ**, rack **RACK-01**, 24U, 19 inches wide.

## Where each value came from

| Value | Source |
|---|---|
| Model, port count, port names, MACs, description | SNMP, read from the switch itself |
| Serial | The maker's own SNMP tree. TP-Link publishes one; D-Link does not |
| Shelf position | A person accepted it in scan 4 of rack RK-A31AE2E7 |
| Device name, management address | Typed by a person when the switch was added |
| Site name, rack name, rack height | Stated by a person. Nothing in a photo or a switch can supply these |

## Rebuilding

    python3 build-csvs.py

Reads `server/data/netbox/` and rewrites the eight CSVs. The site name, rack
name and rack height are constants at the top of the script — the only three
values a person has to set.

## What is deliberately absent

No cables: the switches publish no LLDP neighbours we can pair at both ends, and
a cable with one end is not a cable. No patch panels: the photograph sees them
but nothing confirms what is in them. No VLANs or prefixes: none were read.

Empty is the correct state for all of these. They arrive when something observes
them.
