# Rack binding standard

Draft 2 — 8 September 2026. Supersedes draft 1.

The rules for deciding which device on the network is which box in a rack
photograph, written for an estate of thousands rather than for the three
switches on our own wall.

> The physical layer and the logical layer are maintained by different people at
> different times, and neither is authoritative about the other. The binding
> between them is the thing nobody owns. This standard makes that binding a
> record in its own right — dated, sourced, rated for confidence, and allowed to
> be absent.

## The problem: the binding is the part nobody maintains

Whoever racks the hardware owns the physical layer. Whoever configures it owns
the logical layer. Both records are kept honestly, and both drift, because no
single person is accountable for the line between them.

A photograph is a fresh observation of one layer. A scan is a fresh observation
of the other. The join is inferred at the moment we need it, from whatever the
hardware happens to publish — and what it publishes varies enormously between
estates.

1. We treat position as a property of a device, so a device belongs to whichever
   rack somebody typed it into. Moves, swaps and renumbering silently invalidate
   it.
2. We infer the join from shape — port counts and sizes. In a room of identical
   top-of-rack switches, shape distinguishes nothing.
3. Every result is presented with the same certainty, so a customer cannot tell
   which rows to act on and which to check.
4. The matcher considers the whole estate. At five hundred devices that is a
   filtering problem we have not solved, not a matching problem.

## The solution: make the binding a first-class record, and rate what it rests on

Identity comes from the hardware and never from configuration. Position becomes a
separate observation with a source, a date and a confidence, which can be
created, contradicted and retired without touching the device.

Then match what the estate can actually support. A well-run estate needs almost
no inference; a poorly-run one gets a smaller, honest answer rather than a
confident wrong one.

1. Identity is what the factory set — chassis address, or a serial from the
   hardware inventory. Never a name, never a management address.
2. Every binding records which of eight sources produced it, and carries one of
   four confidence levels.
3. Narrow before matching: the system of record, then memory, then the topology
   graph, then physical constraints. Never the full estate.
4. Grade the estate itself. Tell the customer what their instrumentation can
   support, and what it would take to do better.

**Why this draft exists.** Draft 1 was written from measurements of three
low-cost switches in our own office, which publish almost nothing. That is the
floor of the range, not the middle of it. Enterprise hardware publishes a full
physical inventory, a real hostname and a complete neighbour table, and a
standard designed only for the floor throws all of that away. This draft is
graded instead.

---

## 1. Scope

How RackTrack establishes the identity of a device, and how it binds that
identity to a physical position in a rack. Applies to every scan, every report
shown to a user, and every write into an external system of record.

Written for estates from a single comms cupboard to a multi-site campus of
thousands, and for hardware from unmanaged desk switches to modular chassis.
Where behaviour depends on what the hardware publishes, section 3 governs.

MUST, MUST NOT and SHOULD carry their usual meaning in a specification.

## 2. Terms

- **Box** — one physical object visible in a rack photograph, occupying one or
  more shelves.
- **Shelf** — a numbered mounting position, counted from the bottom. U1, U2, …
- **Device** — one manageable network element, identified under section 4.
- **Chassis address** — the hardware address a device publishes as its own
  identifier. Set at manufacture, not changed by configuration.
- **Site** — the boundary inside which management addresses are unique.
- **System of record** — the external database the customer treats as
  authoritative for what is racked where. Usually NetBox or another DCIM.
- **Binding** — a dated, sourced statement that a device occupies a shelf range
  in a rack, carrying a confidence.
- **Physical inventory** — the tree of components a device publishes about
  itself: chassis, modules, ports, and how they contain one another.

## 3. Grade the estate before matching anything

| Tier | What it means | What matching becomes |
|---|---|---|
| **A · Modelled** | A DCIM holds rack, shelf and face for every device. | A check, not a search. The photo verifies and reports drift. |
| **B · Instrumented** | The hardware publishes a serial per component, a containment tree, a real hostname, a full neighbour table. | Identity certain without a DCIM; position inferred well from stack order, the neighbour graph and the photo. |
| **C · Bare** | No inventory, no serial, no usable name, no location. Our office rack, and most small-business gear. | Identity still works from the chassis address. Position learned once from a person, then remembered. |

**3.1** Every scan MUST determine the tier of each device before binding it, from
what that device actually answered, not from an assumption about the customer.
*One rack routinely holds all three tiers.*

**3.2** Tier MUST be recorded per device, not per estate, and reported alongside
the scan.

**3.3** A device MUST NOT be denied a stronger source because other devices in the
rack are at a weaker tier.
*Grading down to the weakest device is the mistake draft 1 made across the whole
product.*

## 4. Identity

**4.1** A device's identity MUST be its site paired with the first of these that
the hardware provides:

1. the chassis serial number from its physical inventory;
2. the serial published in the manufacturer's own private tree;
3. the chassis address it publishes over LLDP;
4. the bridge address it publishes as a switch;
5. the hardware address of its management interface;
6. its management address, marked provisional.

*Rungs 1 and 2 are exact and printed on the box, so they can also be read from a
photograph. Rungs 3 to 5 are exact but invisible. Rung 6 is not an identity.*

**4.2** An identity, once established, MUST be stable across a rename, a
renumber, a configuration reset and a move between racks. *This is the test for
whether something is an identity at all.*

**4.3** A management address MUST NOT be treated as an identity, except
provisionally under 4.1 rung 6, and a provisional identity MUST NOT be written
into a system of record.

**4.4** A name the device publishes MUST NOT be used as an identity, at any tier,
including where it looks like a good one. *A disciplined Tier A estate has
excellent hostnames — and they are still configuration.*

**4.5** A published name MUST be treated as absent where it equals the device's
model string, or where it occurs on more than one device within the site.

**4.6** Model MUST be taken from the device's published object identifier or its
inventory, and MUST NOT be parsed out of its description string where either is
available.

## 5. What counts as one device

**5.1** Where a device publishes a physical inventory, that inventory MUST decide
what is a device, what is a component, and what contains what.

**5.2** A stack MUST be recorded as one device per member. Where the inventory
gives each member's position within the stack, that order MUST be aligned to the
vertical order of the corresponding boxes in the photograph. *The strongest
bridge we have below a system of record: stack order is physical order, published
by the hardware itself.*

**5.3** A modular chassis MUST be one device over its full shelf range, with cards
as components. Card slot order SHOULD be aligned to the visible slot layout.

**5.4** A device occupying more than one shelf MUST record its whole range and its
lowest shelf. Shelves within an occupied range MUST NOT be reported as free.

**5.5** Two devices the network presents as one logical unit MUST be recorded as
two devices, each with its own identity and binding.

**5.6** The count of boxes and the count of devices are independent. Equal counts
MUST NOT be treated as evidence of a one-to-one pairing, and port count MUST NOT
be read from a box whose ports do not face the camera.

## 6. Evidence, ranked

| Rank | Source | Where it comes from | Tier | Shown as |
|---|---|---|---|---|
| 1 | Confirmed | A person on site placed this device at this shelf. | Any | A fact |
| 2 | Reported | The hardware states its own rack and shelf. | A, B | A fact |
| 3 | Modelled | The system of record says so. | A | A fact |
| 4 | Remembered | Bound here before by rank 1–3, uncontradicted. | Any | Qualified |
| 5 | Read | A serial or asset tag read off the box matches an identity. | A, B | Qualified |
| 6 | Ordered | Stack or slot position aligned to the visual order of boxes. | B | Qualified |
| 7 | Adjacent | A direct neighbour or stack peer of a device already bound here. | A, B | Qualified |
| 8 | Inferred | Port count, size or model agreement, nothing else. | Any | Qualified |

**6.1** Every binding MUST record its source, the date it was observed, and the
identity it binds. *Without a date, a binding cannot be aged out.*

**6.2** A binding MUST NOT be made on rank 8 alone where more than one device fits.

**6.3** Where two sources disagree, the higher rank wins, the lower is retained,
and the disagreement MUST be reported as a finding in its own right. *In a Tier A
estate this is the most valuable output of the product.*

**6.4** Where the customer operates a system of record as authoritative, rank 3
SHOULD be promoted above rank 2 by configuration, and the promotion MUST be
visible in the report.

## 7. Confidence, and saying nothing

| Confidence | Requires | Presented as | Written back |
|---|---|---|---|
| Confirmed | Rank 1, 2 or 3 | Plainly, no qualifier. | Yes |
| Probable | Rank 4, 5, 6 or 7 | With its reason attached, correctable in one tap. | Yes, marked |
| Possible | Rank 8, exactly one candidate | A question the engineer answers. | No |
| Unidentified | Everything else | Blank, listed with the reason. | No |

**7.1** Every binding MUST carry exactly one level, visible wherever the binding
is shown.

**7.2** Only confirmed and probable bindings MUST be eligible to write into a
system of record, and probable ones MUST be marked as such at the destination.
*Writing a guess into the customer's DCIM converts our uncertainty into their
fact.*

**7.3** A box with no binding MUST appear as unidentified, and a device bound to
no box in this rack MUST appear as not in this rack. Neither is a failure.

## 8. Narrowing at estate scale

**8.1** The candidate set for a rack MUST be built in this order, stopping as soon
as it is small enough to match:

1. devices the system of record places in this rack;
2. identities previously bound to this rack;
3. stack peers of any device already bound here;
4. direct neighbours of any device already bound here;
5. devices whose uplinks terminate on a device already bound here;
6. devices drawing power from a manageable strip in this rack.

*Filters 3 to 6 come from the logical layer but describe physical constraints. A
stack cable is under three metres.*

**8.2** The site's full device list MUST NOT be used as a candidate set, at any
tier or estate size. *It is what we do today.*

**8.3** The size of the candidate set MUST be recorded and reported. Where
narrowing leaves a set too large to match honestly, the correct output is
unidentified plus a statement of why.

**8.4** Narrowing MUST begin from any device already bound at rank 1, 2 or 3, and
one such device SHOULD be enough to resolve most of the rest through 8.1 filters
3 to 5.

## 9. Labels and printed text

**9.1** Text read from a photograph is evidence about a position, not an identity,
unless it contains a serial or asset tag that matches one.

**9.2** The shelf part of a label MUST have known confusable characters repaired
before use, so `UIS` reads as `U15`. *Built and tested.*

**9.3** A label naming no known device MUST be kept verbatim and shown as unknown.
It MUST NOT be matched to the nearest similar name.

**9.4** Where a label disagrees with the identity from section 4, section 4 wins
and the label MUST be reported as stale.

## 10. Change over time

**10.1** Positions MUST be observed fresh in each scan. An earlier position MUST
NOT be presented as current, though it MUST be retained as a rank 4 source.

**10.2** Same identity, new position: the device moved. Update the binding, retire
the old one with its date, create no second device.

**10.3** New identity, same position and management address: the hardware was
replaced, and this MUST be reported as a replacement.

**10.4** Known identity, new management address: update the address and keep the
device, its bindings and its history.

## 11. Presence and reachability

**11.1** Presence and reachability MUST be recorded separately and never inferred
from one another.

**11.2** A device MUST NOT be bound to a rack on the strength of answering.

**11.3** A box with no reachable device MUST be recorded as present and
unreachable, with the reason distinguished where possible: no management
configured, wrong credentials, blocked by policy, or no power.

**11.4** Where the phone cannot reach a management network, the server SHOULD
attempt it, and the box MUST be marked pending rather than absent.

## 12. What a well-run estate provides

RackTrack SHOULD measure each of these and report where the estate stands.

- **Model the racks in a system of record.** Rack, shelf and face for every
  device. Moves an estate to Tier A on its own.
- **Enable neighbour discovery everywhere.** The entire basis of section 8.
- **Fill in the location and asset fields.** They are writable and almost always
  empty. A device carrying its own rack and shelf is a rank 2 source.
- **Give every device a unique hostname.** We will not use it as an identity, but
  it makes every report readable by the people who act on it.

## 13. Conformance

**13.1** Every binding carries a source from section 6, a confidence from section
7, an observation date and an identity from section 4.

**13.2** No binding rests on a published name, and no stored identity is a
management address that is not marked provisional.

**13.3** No box is bound on rank 8 evidence where more than one device fitted.

**13.4** Nothing below probable was written into a system of record, and
everything probable that was written is marked at the destination.

**13.5** Every box without a binding appears as unidentified with a reason, and
every device without a box appears as not in this rack.

**13.6** The candidate set was narrowed under section 8, and its size is recorded.

## 14. What it takes to get there

1. **Make identity a hardware fact.** Today a switch belongs to the rack somebody
   typed it into. It becomes a device with an identity from section 4, which racks
   and bindings refer to. Sections 4, 10 and most of 13 rest on this alone.
2. **Make the binding a record.** Source, confidence, date, identity. The matcher
   already computes a score; it does not say what produced it. This is what lets a
   Tier A customer see where their DCIM has drifted.
3. **Narrow before matching.** System of record, then memory, then the topology
   graph, then power. Report the candidate count and refuse to guess when it stays
   large.

## Appendix A — the floor of the range

Three switches on our own wall. They are Tier C, and this is what Tier C looks
like — not what a customer estate looks like. Draft 1 mistook one for the other.

| Field | D-Link .100 | TP-Link .11 | TP-Link .12 |
|---|---|---|---|
| The name it calls itself | empty | SG2428P | SG2428P |
| Its location | empty | empty | empty |
| Its port descriptions | empty | empty | empty |
| Physical inventory | not available | not available | not available |
| Serial, maker's own tree | none published | 222B0K4000121 | 222B0K4000217 |
| Chassis address | C8:78:7D:3D:E5:30 | 30:DE:4B:23:70:AC | 30:DE:4B:23:71:0C |

Read over SNMP, 8 September 2026. Even here identity works: rung 2 of the ladder
for the TP-Links, rung 3 for the D-Link. What Tier C loses is not identity but
position.

## Appendix B — where each source is read from

The right-hand column is honest about what we have actually seen work. Our office
rack is the only hardware measured so far, so everything above Tier C is
standards-based and must be verified against real equipment before it is relied
on.

| What we need | Where it comes from | Identifier | Confirmed here |
|---|---|---|---|
| Chassis serial | Physical inventory, chassis entry | 1.3.6.1.2.1.47.1.1.1.1.11 | Absent on our gear |
| Containment tree | Physical inventory, parent of each entry | …47.1.1.1.1.4 | Absent on our gear |
| Stack and slot order | Physical inventory, position within parent | …47.1.1.1.1.6 | Absent on our gear |
| Asset tag (writable) | Physical inventory, asset field | …47.1.1.1.1.15 | Absent on our gear |
| Chassis address | LLDP, local chassis identifier | 1.0.8802.1.1.2.1.3.2 | Yes, all three |
| Neighbours | LLDP remote table, with management addresses | 1.0.8802.1.1.2.1.4 | Yes |
| Neighbours, Cisco estates | Vendor discovery cache, adds platform | 1.3.6.1.4.1.9.9.23 | No Cisco here |
| Bridge address | Bridge base address | 1.3.6.1.2.1.17.1.1 | Yes |
| Exact model | System object identifier | 1.3.6.1.2.1.1.2 | Yes |
| Serial, TP-Link | Vendor private tree | 1.3.6.1.4.1.11863 | Yes, both |
| Rack and shelf, servers | Redfish chassis location | /redfish/v1/Chassis | Not tested |
| Rack and shelf, modelled | System of record, device by rack | /api/dcim/devices | In use today |
| Outlet occupancy | Manageable power strip, per-outlet draw | vendor | Not tested |

---

The only clause the product satisfies today is 9.2. The situations behind each
clause are written out in full in
[finding-a-racks-switches.md](finding-a-racks-switches.md).
