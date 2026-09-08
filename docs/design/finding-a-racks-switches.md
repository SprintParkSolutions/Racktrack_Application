# Rack and network, case by case

A photograph of a rack and a list of switches on the network are two different
pictures of the same room. This is every way they fail to line up, and what we
do about each one.

Measured on the office rack, 8 September 2026. Nothing here is built yet, apart
from the label repair in case 16.

## The two sides

**What a photograph knows.** A picture of a rack gives us boxes and the shelf
each one sits on. Sometimes a printed label. Usually a port count. Rarely a
readable model name. It never gives us a serial number, an address, or anything
the network would recognise.

**What the network knows.** A switch on the network gives us an address that
reaches it, a port table, its neighbours, and a chassis address burned in at the
factory. It has no idea which rack it is in, or which shelf. Nobody ever told it.

## A — When the counts do not match

**01. More boxes than switches.** Twelve boxes on the shelves, eight switches
answer. Leave four boxes unnamed. Most of them will be unmanaged switches, patch
panels or power strips. We never stretch eight names across twelve boxes.

**02. More switches than boxes.** Eight boxes, twelve switches answer. Four of
them live somewhere else. We list those as not in this rack, rather than finding
a home for them here.

**03. The counts match and the pairing is still wrong.** Eight boxes, eight
switches. Treat equal counts as no evidence at all. We pair only the boxes we can
actually identify and leave the others blank.

**04. The photograph cut the rack off.** The top shelves are out of frame, and
switches answer that belong to those shelves. Notice that the rack frame runs
past the edge of the picture, say so, and ask for a second photograph before
matching anything.

## B — When the device will not say who it is

This is not a guess. I asked the three switches in our own rack what they know
about themselves, and most of the answers were blank.

| Field | D-Link .100 | TP-Link .11 | TP-Link .12 |
|---|---|---|---|
| The name it calls itself | empty | SG2428P | SG2428P |
| Its location | empty | empty | empty |
| Its port descriptions | empty | empty | empty |
| Serial, the standard way | not available | not available | not available |
| Serial, the maker's own way | none published | 222B0K4000121 | 222B0K4000217 |
| Chassis address | C8:78:7D:3D:E5:30 | 30:DE:4B:23:70:AC | 30:DE:4B:23:71:0C |

**05. It has no name.** A box at U18; the name field comes back empty, as it does
on our D-Link. Fall back to the chassis address. It is the one value that is
always there and never repeats.

**06. Its name is its model number.** Two identical boxes; both answer with the
same word, SG2428P, which is what they are, not who they are. Treat a name that
equals the model as no name at all. Sixty switches of that model would all answer
the same.

**07. Two devices share one name.** Boxes in two different racks both call
themselves the same thing, because someone copied a configuration. Never pair on
a name that appears more than once anywhere in the estate. One repeat makes that
name useless everywhere.

**08. It publishes no serial.** The D-Link gave no serial by any method we tried.
The TP-Links gave theirs. Use the serial where a maker publishes one, and the
chassis address everywhere else. Both are unique, so either will do.

## C — When one box is not one switch

**09. A stack.** Four boxes cabled together, one address answering for all four.
Read the list of stack members and give each one its own shelf, instead of
showing one switch and three blanks.

**10. A chassis with cards in it.** One large box, one device reporting many
modules and hundreds of ports. Place the chassis at its shelf and hang the
modules underneath it. The ports belong to the cards, not to the shelf.

**11. A tall device.** One box filling four shelves, U10 up to U13, and one
switch. Record the range and its bottom shelf, not a single number, so the
shelves above it are not reported as empty.

**12. A pair that behaves as one.** Two boxes, two addresses that the rest of the
network treats as a single switch. Place both. They are two pieces of hardware
whatever the network chooses to believe, and someone has to service them
separately.

**13. The device faces the other way.** A box showing no ports, because its ports
are at the back, and a switch reporting twenty-four ports. Do not count ports on
that box at all. Fall back to its position and its cabled neighbours.

**14. Identical twins side by side.** Two boxes of the same model, same size,
same port count, one above the other, alike in every field we can read. Admit
that nothing in the picture separates them. Ask the engineer once, remember the
answer against each chassis address, and never ask again.

## D — When the label is missing, wrong or misread

**15. No label at all.** A blank faceplate and a switch that has to belong to some
box. Position and neighbours only. This is the common case, not the exception.

**16. The label was misread.** The print comes back as `SP-RI-UIS-SW04` for a
switch that sits at shelf 15. Repair the characters that confuse in the shelf
part of a label, so UIS becomes U15. This one is built and tested already.

**17. The label is out of date.** A sticker naming a switch that was replaced last
year, with different hardware answering at that address. When the sticker and the
chassis address disagree, believe the hardware, and tell the engineer the sticker
needs changing.

**18. Two labels on one box.** A rail label giving the position and an asset tag
giving the device. Keep the two apart. A position is not an identity, and a
device that moves takes only one of them with it.

**19. The label names nothing we know.** A clear, well-printed name, and no switch
anywhere by that name. Show it as an unknown device and keep the text. We never
attach it to the nearest similar name.

## E — When things move

**20. The switch moved to another rack.** Its old shelf is now empty, but the same
address still answers with the same chassis address. Move its position. One
device, a new home. We do not create a second entry, and we do not leave a ghost
in the old rack.

**21. The switch was replaced.** A box at the same shelf, the same address, but a
chassis address we have never seen. Call it new hardware at an old position, and
say so in the report. This is the case a name-based match gets silently wrong.

**22. The switch got a new address.** Nothing changed in the rack. The old address
is silent and a new one answers with a chassis address we already know. Update
the address and keep the identity. Renumbering a network should not lose a single
device.

**23. Everything shifted a shelf.** A tidy-up moved every device up by one, with
no change whatsoever on the network. Read positions fresh from the new photograph
every time, and never carry the old ones forward as though they were still true.

## F — When the network cannot answer

Being in the rack and being on the network are separate facts. Either can be true
without the other.

**24. In the rack, but unreachable.** A box plainly there in the picture, and
silence from the network. Monitoring is switched off, or the credentials are
wrong, or a firewall is in the way, or it has no power. Keep it as a real box with
no partner, and name which of those four it is when we can tell them apart.

**25. It answers, but it is not here.** A perfectly healthy switch, and nothing in
the picture that matches it. Remember that answering is not evidence of being in
this rack. Only a remembered position or a cabled neighbour is.

**26. Only reachable from somewhere else.** The phone cannot reach the management
network the switch sits on. Let the server try where the phone cannot, and mark it
pending rather than missing until one of them gets an answer.

## G — When the estate is large

**27. Five hundred switches, twenty boxes.** Narrow the list before matching
anything. Ask NetBox which devices belong to this rack. Then use chassis addresses
we have already seen here. Then follow the cabled neighbours of any switch we have
identified, because switches in one rack are nearly always cabled to each other.

**28. The same address in forty buildings.** `192.168.1.11` answers in every one
of them. Stop treating an address as an identity. Everything we remember is keyed
on the chassis address together with the site.

## What all of this comes down to

1. Remember a switch by its chassis address, not by which rack somebody typed it
   into. Every case above gets easier the moment we do.
2. Ask NetBox first where the rack is modelled there. It already holds the
   answer, and no matching is needed at all.
3. Ask the engineer once, then never again. A position confirmed by a person is
   worth more than any guess, and it keeps working after the device moves.
4. Say when we do not know. With five hundred candidates, a confident wrong
   answer costs more than a blank.

## Honesty

The measurements above are real, taken from the office rack on 8 September 2026.
An earlier version of this note proposed matching printed rack labels against the
names switches publish. The measurements disproved it and it was rewritten.
