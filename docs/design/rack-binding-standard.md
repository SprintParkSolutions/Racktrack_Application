# Rack binding standard

Draft 1 — 8 September 2026

The rules for deciding which switch on the network is which box in a rack
photograph. Every rule here exists because of a real situation that breaks
without it.

> A device is known by the address burned into its hardware, never by the name
> it publishes or the address it answers on. A position is a separate fact from
> an identity, it is recorded with a source and a confidence, and when we cannot
> establish it we say so.

## The problem

**Nothing in the photograph refers to anything on the network.** A rack
photograph gives us boxes and the shelf each one sits on. The network gives us
switches and the addresses that reach them. Neither one mentions the other, and
no field they share can be relied on.

So today we bridge the gap by counting ports. In an estate of sixty identical
forty-eight port switches, counting ports separates nothing at all, and we still
show an answer.

1. We asked our own three switches who they are. Two answered with their model
   number, the same one. The third answered with nothing. None gave a location.
   (Appendix A.)
2. A switch belongs to whichever rack somebody typed it into. The moment it is
   moved or replaced, the record is wrong and nothing notices.
3. Every guess is presented with the same certainty as a fact, so nobody can tell
   which parts of a report to trust.
4. Matching twenty boxes against five hundred candidates makes all of the above
   far more likely to go wrong, and far harder to spot.

## The solution

**Identify the hardware, then record where it is as a separate fact.** Every
switch we tested publishes one value that is unique to it and set at the factory:
its chassis address. It survives a rename, a renumber and a move between racks.

Build on that instead of on names, and position stops being part of a device's
identity and becomes a claim we can date, source and revise.

1. Know a device by its chassis address and its site. Never by the name it
   publishes or the address it answers on.
2. Record every position with where it came from — a person, NetBox, memory, the
   photograph, or a guess — and how sure we are.
3. Narrow the candidates before matching. Ask the rack, not the whole estate.
4. Say when we do not know. A blank box is a correct answer; a confident wrong
   one is not.

The rest of this document turns those four into rules the product can be checked
against.

---

## 1. Scope

This standard covers how RackTrack establishes the identity of a network device,
and how it binds that identity to a physical position in a rack. It applies to
every scan, every report shown to a user, and every write into an external system
of record.

MUST, MUST NOT and SHOULD carry their usual meaning in a specification. A MUST is
a rule the product is wrong to break. A SHOULD is a rule we follow unless there is
a stated reason not to.

## 2. Terms

- **Box** — one physical object visible in a rack photograph, occupying one or
  more shelves.
- **Shelf** — a numbered mounting position in a rack, counted from the bottom.
  Written U1, U2 and so on.
- **Device** — one manageable network element, identified under section 3.
- **Chassis address** — the hardware address a device publishes as its own
  identifier. Set at manufacture and never changed by configuration.
- **Site** — the boundary inside which management addresses are unique. Usually
  one building.
- **Binding** — a recorded statement that a device occupies a shelf range in a
  rack, carrying a source and a confidence.

## 3. Identity

**3.1** A device's identity MUST be the pair of its site and its chassis address.
*The chassis address was the only field unique on all three of our switches.*

**3.2** Where no chassis address can be read, identity MUST fall back to the first
of these that is available: (a) the site and the manufacturer's serial number;
(b) the site and the hardware address of the management interface; (c) the site
and the management address, marked provisional.
*TP-Link publishes a serial. D-Link publishes none.*

**3.3** A management address MUST NOT be treated as an identity, except
provisionally under 3.2c.
*192.168.1.11 answers in forty buildings. An address says how to reach something,
not what it is.*

**3.4** The name a device publishes MUST NOT be used as an identity, in any
circumstance.
*One of our switches publishes no name at all. The other two publish the same one.*

**3.5** A published name equal to the device's model string MUST be treated as
absent.
*Both TP-Links answer SG2428P, which is what they are, not who they are.*

**3.6** A published name occurring on more than one device within a site MUST be
treated as absent on all of them.
*Configurations get copied. One repeat makes that name useless everywhere.*

## 4. What counts as one device

**4.1** The number of boxes in a photograph and the number of devices on the
network are independent. Equal counts MUST NOT be treated as evidence of a
one-to-one pairing.

**4.2** A stack MUST be recorded as one device per member, each at its own shelf,
wherever the member list can be read.

**4.3** A modular chassis MUST be recorded as one device over its shelf range,
with its cards recorded as parts of it and not as devices of their own.

**4.4** A device occupying more than one shelf MUST record the whole range and its
lowest shelf.

**4.5** Two devices the network presents as a single logical unit MUST be recorded
as two devices.

**4.6** Port count MUST NOT be read from a box whose ports are not facing the
camera.

## 5. Evidence and its order

Every binding rests on something. This is the whole list, strongest first.

| Rank | Source | What it means | Shown as |
|---|---|---|---|
| 1 | Confirmed | A person placed this device at this shelf. | A fact |
| 2 | Modelled | NetBox, or another system of record, says this device is in this rack. | A fact |
| 3 | Remembered | This identity was bound to this rack before, by rank 1 or 2. | Qualified |
| 4 | Read | A serial or hardware address was read off the box in the photograph. | Qualified |
| 5 | Adjacent | It is a direct cabled neighbour of a device already bound in this rack. | Qualified |
| 6 | Inferred | Port count, size or model agreement, and nothing else. | Qualified |

**5.1** Every binding MUST record which of the six sources it came from.

**5.2** A binding MUST NOT be made on rank 6 alone where more than one device fits.

**5.3** Where two sources disagree, the higher rank wins and the disagreement MUST
be reported.

**5.4** The candidate set for a rack MUST be narrowed before matching: modelled
devices for the rack, then identities remembered in it, then neighbours of devices
already bound. The site's full device list MUST NOT be used as a candidate set.

## 6. Confidence, and saying nothing

| Confidence | Requires | How it is presented |
|---|---|---|
| Confirmed | Rank 1 or 2 | Stated plainly, with no qualifier. |
| Probable | Rank 3, 4 or 5 | Stated with the reason attached, and easy to correct. |
| Possible | Rank 6, one candidate only | Put as a question the engineer answers. |
| Unidentified | Everything else | Left blank, and listed as unidentified. |

**6.1** Every binding MUST carry exactly one of those four levels.

**6.2** A box with no binding at any level MUST appear in the report as
unidentified. Leaving a box blank is a correct result, not a failure.

**6.3** Devices that answer but bind to no box in this rack MUST be listed as not
in this rack, rather than fitted into it.

## 7. Labels and printed text

**7.1** Text read from a photograph is evidence about a position, not about an
identity, unless it contains a serial number.

**7.2** The shelf part of a label MUST have known confusable characters repaired
before use, so that `UIS` is read as `U15`. *Built and tested already.*

**7.3** A label naming no known device MUST be kept verbatim and shown as unknown.
It MUST NOT be matched to the nearest similar name.

**7.4** Where a label and the identity from section 3 disagree, section 3 wins and
the label MUST be flagged as stale.

## 8. Change between one scan and the next

**8.1** Positions MUST be read fresh from each scan. A position from an earlier
scan MUST NOT be carried forward as though still true.

**8.2** Same identity at a new position means the device moved. Update the
binding; do not create a second device, and do not leave one behind.

**8.3** A new identity at the same position and management address means the
hardware was replaced, and MUST be reported as a replacement.

**8.4** A known identity at a new management address means the address changed.
Update the address and keep the device.

## 9. Presence and reachability

**9.1** Presence and reachability MUST be recorded separately, and never inferred
from one another.

**9.2** A device MUST NOT be bound to a rack on the strength of answering.
Answering proves it exists, not where it is.

**9.3** A box with no reachable device MUST be recorded as present and
unreachable, with the reason where it can be told apart: monitoring off, wrong
credentials, blocked, or no power.

**9.4** Where the phone cannot reach a management network, the server SHOULD
attempt it, and the box MUST be marked pending rather than absent until one of
them has tried.

## 10. Conformance

A scan conforms when all five hold, and a test can assert every one of them.

**10.1** Every binding carries a source from section 5 and a confidence from
section 6.

**10.2** No binding anywhere rests on a published device name.

**10.3** No box is bound on rank 6 evidence where more than one device fitted.

**10.4** Every box without a binding appears in the report as unidentified, and
every device without a box appears as not in this rack.

**10.5** Every stored identity is a chassis address or a serial, with a site, and
no stored identity is a management address that is not marked provisional.

## 11. What it takes to get there

The standard above is not what the product does today. Three changes, in this
order. Nothing else can be satisfied before the first is done.

1. **Key a device on its chassis address.** Today a switch belongs to the rack
   somebody typed it into. It should instead be a device with an identity, which
   racks refer to. Sections 3, 8 and 10.5 depend on this and on nothing else.
2. **Record a source and a confidence on every binding.** The matcher already
   produces a score, but it does not say which of the six sources produced it, and
   the report shows every result the same way. Sections 5 and 6.
3. **Narrow the candidates before matching.** Ask NetBox for the rack, then the
   identities remembered in it, then the neighbours of anything already bound.
   Section 5.4. Until this exists, nothing survives an estate of five hundred
   switches.

## Appendix A — what the hardware actually publishes

Sections 3 and 7 rest on this. Nothing here is estimated.

| Field | D-Link .100 | TP-Link .11 | TP-Link .12 |
|---|---|---|---|
| The name it calls itself | empty | SG2428P | SG2428P |
| Its location | empty | empty | empty |
| Its port descriptions | empty | empty | empty |
| Serial, the standard way | not available | not available | not available |
| Serial, the maker's own way | none published | 222B0K4000121 | 222B0K4000217 |
| Chassis address | C8:78:7D:3D:E5:30 | 30:DE:4B:23:70:AC | 30:DE:4B:23:71:0C |

Read over SNMP from the office rack, 8 September 2026.

---

The only clause the product satisfies today is 7.2. An earlier draft proposed
matching printed rack labels against the names devices publish; the measurements
disproved it, and clause 3.4 is what replaced it. The situations behind each
clause are written out in full in
[finding-a-racks-switches.md](finding-a-racks-switches.md).
