# Finding a rack's switches, when there are five hundred of them

*A design note. Written 8 September 2026, from the code as it stands.*

## The situation

A customer has five hundred switches spread across many racks and several
sites. An engineer walks up to one rack, photographs it, and needs the app to
tell them which of those five hundred are in front of them, and then read them.

That is the whole job. Everything below is about how to do it honestly.

## Why the way we do it today will not survive

Today the engineer adds each switch by hand on the Network page: a label, an
address, a port, a community string. The app reads it, files the reading
against the rack, and then matches it to a box in the photograph.

Two things break at scale.

The first is obvious. Typing five hundred addresses is data entry, not a
product. Worse, it assumes the engineer already knows which addresses are in
front of them, which is the exact question they opened the app to answer.

The second is quieter and more dangerous. Once the switches are added, the app
pairs them to the boxes in the photo by comparing three things: the model, the
make, and the port count. The camera can almost never read a model off a
faceplate, and it reads a make only sometimes, so in practice the port count
carries the whole match. In a three-switch lab that is fine. In an estate with
sixty identical forty-eight port switches it means nothing at all, and the app
will still present its guess with a confident face.

## The reframe

Two different problems have been fused into one, and they need separating.

**What exists.** What switches are in this estate, and what is each one?
This is an estate-wide question, answered occasionally, in the background.

**What is here.** Which of them are in the rack I am looking at?
This is a per-scan question, answered in seconds, in front of the rack.

Once they are separated, the second stops being a search across the network and
becomes a lookup against something we already hold.

## Where the inventory comes from

Three routes. They are not exclusive and a real deployment will use more than
one.

**From NetBox, where the estate is already modelled.** This is the best case and
the one the product already speaks to. NetBox holds racks, devices, positions
and serial numbers. If it is populated, we do not need to discover anything: we
already know what should be in the rack, and the scan becomes a check rather
than a search. The interesting output is then the disagreement, which is
precisely the thing an engineer walks to a rack to find.

**By walking the neighbour graph.** Give the app one address. Read that switch,
read the neighbours it reports, read their neighbours, and keep going. This
reaches everything that is switched together, needs nothing but SNMP read
access, and does not require sweeping addresses that may not answer.

**By sweeping the management network.** Ask every address on the management
range whether it is a switch. Crude, thorough, easy to write, and safe to run
out of hours.

Whichever route, the inventory holds the same things for each switch: its own
name, its serial, model and vendor, its hardware and firmware revision, its
chassis address and the addresses of its ports, the neighbours it can see, the
address we reach it on, and when we last saw it.

## Identifying the rack: the ladder of evidence

Strongest first. The point of ordering it is that a weak signal should never be
allowed to overrule a strong one, and today there is only one signal.

### 1. The label on the rack, against the switch's own name

Racks are labelled, and the labels are the most direct evidence in the building.
The labels in our own office rack read `SP-RI-U15-SW04`. Every managed switch
reports a name for itself. Comparing the two is a string join.

Where a site labels consistently, this one signal identifies the rack outright.
It also gives the unit position free of charge, because the position is written
into the label.

Both halves already exist. The label is read off the photograph and carried on
the device as its name. The switch's own name is read over SNMP and sits in the
reading. They are both present in the same view, and the matcher looks at
neither.

In practice it needs care rather than cleverness: ignore case and punctuation,
allow one string to contain the other rather than demanding they be identical,
and use the label's position on the photograph to tie it to the box beside it.

### 2. The serial number

Where NetBox holds serials, or where a close-up photograph catches the asset
sticker, the match is exact and nothing else is needed.

It is cheap to check and worth checking, but it is a bonus rather than a
foundation: a wide shot of a rack will rarely resolve a serial sticker.

### 3. Which switches can see each other

Switches in one rack are nearly always cabled to each other, or to the same
switch at the top of it. So once a single switch in the photograph is anchored,
by its label or its serial, its neighbours become strong candidates for the
other boxes in the same photograph, and anything that is not adjacent to it
becomes unlikely.

This is what turns one confident match into a whole rack, and it is the signal
that makes an estate of five hundred tractable rather than terrifying.

### 4. What the uplink can see

The switch above a rack knows which hardware addresses sit behind each of its
ports. That constrains which switches can be downstream of it, and we already
read those tables.

### 5. Model and port count

Where everything above leaves a genuine tie, this breaks it.

It should never be the whole answer. Today it is.

## Choose the best set of pairings, not the best pairing

There is a second, separate flaw worth fixing at the same time.

Today every possible switch-and-box pairing is scored, the list is sorted, and
pairs are taken from the top down. That is greedy, and greedy is wrong here:
when two switches are equally good matches for two boxes, whichever pair happens
to sort first wins, and the second switch is left with whatever remains.

The right approach is to choose the best overall set of pairings rather than the
best individual pairing. For a rack of at most a few dozen boxes this is
instant, and it removes the identical-switch swap on its own.

## Say what you believe, and why

With five hundred candidates, a wrong confident answer is worse than no answer.

Every proposal should carry the evidence that produced it, in words the engineer
can check against the rack in front of them: *the label reads SP-RI-U15-SW04 and
a switch answers to that name*, or *this is the only neighbour of SW01 with
forty-eight ports*. Anything resting on port count alone should be shown as a
guess that wants confirming, not as a result.

## What the engineer would experience

They photograph the rack. Within a second or two the app names the switches it
believes are in it, says why it believes that, and marks anything it is unsure
of. The engineer confirms or corrects. Reading them then happens without anyone
typing an address, because the addresses came from the inventory.

That is the difference between a tool for a lab and a tool for an estate.

## What we already have

A useful amount of this is joining data we already collect.

- The rack label is already read off the photograph and carried on the device.
- The switch's own name is already read and stored with the reading.
- Neighbours are already read and stored per switch.
- The forwarding and address tables are already read.
- NetBox can already be read from and written to.

## What needs building

- **An inventory that is not owned by a rack.** Today a switch record belongs to
  a rack and is keyed by address and port, so the same physical switch read for
  two racks becomes two records. That was a deliberate choice for filing
  readings, and it is the wrong shape for an estate. A switch should belong to
  the estate, and a rack scan should reference it.
- **Discovery as a background job**, by neighbour walk and by sweep, running on
  the server rather than from a phone in someone's hand.
- **Best-set pairing** in place of taking the best pair first.
- **Evidence and confidence** carried through to the screen.

## A staged way there

**Stage one, days rather than weeks.** Join the rack label to the switch's own
name, and choose the best overall set of pairings. No schema change, no new
service, and it makes every labelled rack identify itself correctly. This is the
largest accuracy gain available for the least work.

**Stage two.** Make the inventory a first-class thing, owned by the estate
rather than by a rack, and import it from NetBox wherever NetBox is populated.

**Stage three.** Discovery by neighbour walk from a seed address, and by sweep
of the management range, run as a server job.

**Stage four.** Use adjacency to constrain identification, and show the evidence
and the confidence for every proposal.

## What this note does not claim

Nothing above has been built. Stage one is small and well understood; stages two
and three change how switches are stored and add a service that has to be run
and monitored. The estimate that stage one takes days is a judgement, not a
measurement.
