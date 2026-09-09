# Read everything the switch will tell us

**SPRTMS-1633** · Sprintpark Rack Track Management System

_One pass now collects every fact a switch is willing to publish about itself._

## How it was before

We were reading a small fraction of what these switches make available. The port table told us a port was up, and that was the end of it.

So a report could say twenty ports are in use and still leave the obvious question unanswered: in use by what?

The information was there. A managed switch keeps a forwarding table listing which hardware addresses it has seen on which port, and often an address table mapping those to network addresses. It also publishes its own serial number, hardware revision and firmware version, though each manufacturer puts those in its own private section.

## What we decided, and why

Read all of it in a single pass, and never invent anything.

The second half of that sentence matters as much as the first. Once a screen starts filling gaps with plausible guesses, an engineer cannot tell which lines are measurements and which are decoration, and the whole report stops being usable as evidence.

So the rule is: show what the switch answered. Where it answered nothing, say it returned nothing. Never a blank, never a guess, and never the phrase 'not supported', because we cannot know whether a switch supports something or merely declined to answer us.

## What we built

**Every port, in full**

Name, whether the link is up, the speed and duplex it agreed with the far end, and its VLAN. Virtual interfaces are filtered out, so a 28-port switch shows 28 ports rather than 29 with a management interface pretending to be a socket.

**What is on the other end**

The neighbours the switch can see through the standard discovery protocol, its forwarding table of hardware addresses, and its address table. Read together, a port can name the device behind it, by name where the neighbour announces one and by hardware address otherwise.

**The switch's own identity**

Serial number, hardware revision and firmware version, taken from each manufacturer's private section. TP-Link and D-Link are covered, which is every switch in the office rack.

**Traffic counters and a timestamp**

The high-capacity byte counters for each port, and the moment the reading was taken, so two readings can be compared later to show what changed.

**A written record of what we ask and why**

Every value we request is documented with the reason we want it and what we do when it is missing.

## How it works

SNMP organises everything into numbered addresses, and a group of related addresses is called a MIB.

The port list comes from the standard interface MIB, which every switch implements. The forwarding table comes from the bridge MIBs. Network addresses come from the address translation table.

Manufacturer facts are different. There is a standard place for a serial number, but in practice most switches leave it empty, so each maker keeps its own copy in a private section reserved for that company. We read TP-Link's and D-Link's directly.

Where the standard place is empty and we have no private reading for that make, the screen says the switch did not return the value.

## What we found on the office rack

- The 52-port D-Link reports 52 ports with 20 cables attached.
- The two TP-Links report 28 ports each once the management interface is filtered out, and both publish a serial number in their private section.
- One TP-Link sees three neighbours. None of them announce a name, so they are listed by hardware address against the correctly named local port.

## How to check it yourself

1. Read a switch on the Network page, then open Read more.
2. A port carrying traffic should name what is behind it, where the switch knows.
3. Look for the serial number and firmware version. On a TP-Link or D-Link they should be filled in.
4. Find something the switch does not publish. It should say it returned nothing, not sit blank.

## Where it lives

- The read: client/src/utils/snmpClient.js
- The written record of every value we ask for: docs/snmp-what-we-ask.md

## What is not done

The manufacturer-specific reads cover TP-Link and D-Link. Other makes still get everything standard, and their serial and firmware simply come back as not returned. Adding a make is a small, self-contained piece of work.
