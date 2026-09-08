# Finding a rack's switches

*Design note, 8 September 2026. Rewritten after checking the real hardware.*

## The problem

A customer has five hundred switches. An engineer photographs one rack and needs
to know which switches are in it.

Today they must type in every switch by hand, address by address. And once
typed, we work out which box is which mostly by counting ports, because the
camera can rarely read a model off a faceplate. With sixty identical
forty-eight port switches that tells us nothing, and we still show an answer.

## What the switches actually publish

I asked the three switches in our own rack, over SNMP, on 8 September.

| | D-Link .100 | TP-Link .11 | TP-Link .12 |
|---|---|---|---|
| Name it calls itself | empty | `SG2428P` | `SG2428P` |
| Standard serial | not available | not available | not available |
| Maker's own serial | none published | `222B0K4000121` | `222B0K4000217` |
| Chassis address | `C8:78:7D:3D:E5:30` | `30:DE:4B:23:70:AC` | `30:DE:4B:23:71:0C` |

I also checked every other field a person could have written an identity into.
The location field, the contact field and the port descriptions are all empty on
all three. Nobody has ever configured these switches with a name or a place.

Three things follow, and they decide the whole design.

**A switch's name is not a name.** One returns nothing. The other two return
their model number, and the same one. Matching a rack label against a switch
name cannot be the answer, because half our own kit has no usable name.

**The standard serial field is empty everywhere.** Only the maker's own private
field carries it, and only some makers publish one. TP-Link does. D-Link does
not.

**The chassis address is the one thing every switch has.** It is unique, it is
always present, and it never changes.

## So the photo alone can never name a switch

A chassis address is not written on the front of a box. Neither is a name that
does not exist. Whatever the camera sees, it cannot by itself say which of five
hundred switches it is looking at.

The link has to come from somewhere else. There are three honest ways.

## One: let NetBox hold the map

If the estate is modelled in NetBox, the rack and the shelf position are the
key. The photograph tells us which rack this is and which shelves are occupied.
NetBox tells us which device sits at each shelf and the address to reach it on.

Nothing needs to match by name. This is the strongest route and the product
already talks to NetBox.

## Two: learn it once, remember it forever

The first time a person places a switch in a rack by hand, remember it against
its chassis address.

From then on, any rack holding that switch is recognised without being told.
The estate gets learned as engineers walk it, rather than typed up in advance.

## Three: read the sticker

Where a serial or address is printed on the box, a close-up photograph can read
it and match exactly. That works today for TP-Link, which publishes its serial.
It does not work for D-Link, which publishes none, so only the chassis address
would serve there.

## Four: write it back

The name and location fields are not read-only. They are empty because nobody
filled them in.

So when an engineer places a switch at a shelf, we could write it: the rack and
the position, into the switch itself. Every future scan then reads its own
answer straight off the box, and the estate documents itself as it is walked.

This needs write access over SNMP, which is a bigger ask than reading and which
many customers will refuse. Worth offering, never worth assuming.

## What still helps

Switches in one rack are almost always cabled to each other. Once one switch in
a photograph is certain, its neighbours are very likely the rest.

Port counts stay useful only as a tie-break, never on their own.

And when we are unsure, say so, and say why. With five hundred candidates a
confident wrong answer is worse than no answer.

## What to do first

Start remembering switches by their chassis address rather than by which rack
they were typed into. That single change is what makes every other route
possible, including learning the estate as it is walked.

## Honesty

None of this is built. The measurements above are real and were taken from our
own rack. The name-matching idea in the first version of this note was wrong,
and our own hardware is what disproved it.
