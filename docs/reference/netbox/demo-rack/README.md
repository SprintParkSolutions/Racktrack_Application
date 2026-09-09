# RACK-02 — the demonstration rack

A full 42U cabinet with every shelf occupied, every field a person would fill in
actually filled in, and every object type the exporter writes exercised end to
end.

**None of this was measured.** It is invented, and it says so on the rack, on
every device and on every device type: *"Example data for demonstration. Not
observed equipment."* RACK-01 next to it is the opposite — three real switches,
every value read from the hardware.

## What is in it

| Shelves | What | Count |
|---|---|---|
| U42–U41 | Firewalls, an HA pair | 2 |
| U40–U39 | Routers | 2 |
| U38–U37 | Core switches | 2 |
| U36–U33 | 24-port patch panels | 4 |
| U32–U13 | Access switches | 20 |
| U12–U05 | Servers | 8 |
| U04–U03 | Console servers | 2 |
| U02–U01 | Rack PDUs | 2 |

1,300 interfaces · 96 front and rear port pairs · 68 power ports · 84 outlets
226 cables · 5 VLANs · 4 prefixes · 36 addresses

## The topology it describes

Every access switch is dual-homed, one uplink to each core, so either core can
fail. The cores hold the interlink on their SFP+ pair. Each core reaches its own
firewall, and each firewall its own router, with an HA heartbeat between the
firewalls.

Four floors of desks land on the patch panels and are patched through to the
first four access switches — front port to switch port, front port mapped to
rear port, so NetBox can trace the whole path through the panel.

Every server is dual-homed to two different access switches. Every power supply
is fed from a PDU, with PSU 1 on the A strip and PSU 2 on the B strip, so either
strip can be taken out without dropping a device.

## No cable has one end

226 cables, none dangling. The loader checks each cable after saving and deletes
any that came back with a missing end, because a cable with one end is not a
cable, it is a note.

An earlier draft of this rack got that wrong: the cores have four SFP+ ports and
twenty access switches were pointed at them, so sixteen pairs of uplinks were
created with a live end and no far end. The uplinks now land on core data ports,
which there are enough of.

## Rebuilding it

    python3 build-csvs.py          # writes the 21 CSVs from the layout above

The CSVs are then loaded on the server with `load-into-netbox.py`, run inside
the NetBox container. It is additive and re-runnable: it skips anything already
present, and never touches RACK-01. `reload-cables.py` rebuilds just the cabling.

## Two NetBox 4.x traps this hit

`Prefix.site` became a generic `scope` in 4.2, and assigning `site=` raises
*"Direct assignment to the reverse side of a related set is prohibited."*

A front port's link to its rear port moved out of `FrontPort` and into a
`PortMapping` row in 4.6. Passing `rear_port=` now raises outright, which is
kinder than the API's behaviour of accepting it silently and leaving the panel
untraceable.
