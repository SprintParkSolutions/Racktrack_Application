# Read everything the switch will tell us

**SPRTMS-1633** · Sprintpark Rack Track Management System

## What this is

One read now collects everything a switch is willing to publish about itself.

## Why we did it

We were using a small fraction of what these switches make available.
A port could say it was in use, but not what was plugged into it.

## What we built

- Every port: its name, whether it is up, the speed and duplex it agreed with the far end, and its VLAN.
- The neighbouring devices the switch can see.
- The switch's MAC forwarding table and its ARP table. Together these let a port name the device behind it by its address, instead of only saying it is busy.
- Serial number, hardware revision and firmware version, read from the manufacturer's own private data. TP-Link and D-Link are covered.
- A written record of every value we ask a switch for and why, so nobody has to work it out from the code.

## The rule we hold to

We only show what the switch actually answered. Where a switch publishes nothing for a field, the screen says it returned nothing. It never shows a blank or a guess.

## How to check it

1. Read a switch on the Network page and open Read more.
2. A port that is in use should name what is behind it where the switch knows.

## What is not done

The manufacturer-specific reads cover TP-Link and D-Link only. Other makes fall back to the standard values.
