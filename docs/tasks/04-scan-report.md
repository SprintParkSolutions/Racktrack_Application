# The scan report, as a summary

**SPRTMS-1635** · Sprintpark Rack Track Management System

_The document a person reads after scanning a rack, rewritten to show only what we can prove._

## How it was before

The report printed a fixed set of fields for every device, whether or not we had a value for each.

The result was that roughly half of it read 'not stated'. That is worse than it sounds. A reader skimming a page of empty fields learns to skim past the filled ones too, so the facts we did have were being lost inside the ones we did not.

It also opened with the least useful thing, a list, rather than with the figures people actually ask for.

## What we decided, and why

Lead with the numbers, then go device by device, and print nothing we cannot support.

Where a list is long we shorten it, but we always say how long it really is and offer to show the rest, so no figure on the page has to be taken on trust.

## What we built

**The rack's figures first**

Ports in use against the total, with a bar. Then devices found, switches read, cables identified, addresses seen. These are the five things people ask for before anything else.

**Then each device, with what we hold**

Position in the rack, name, make and model, serial, address, firmware, port count and how many are in use, and what is plugged into them.

**Empty fields are absent, not blank**

If we have no serial number for a device, the report has no serial line for that device. Nothing reads 'not stated'.

**View all on anything shortened**

A trimmed list carries a control naming the true count, for example 284 ports, which opens the full list.

## How it works

The report is assembled on the server from the scan record and from any switch readings filed against that rack, so a rack whose switches have been read is richer than one that has only been photographed.

Every figure is derived rather than stored, which is why the numbers agree with the device list underneath them.

## How to check it yourself

1. Open a report on a rack whose switches have been read.
2. The top should carry the five figures, and the bar should match the in-use count beside it.
3. Search the page for 'not stated'. There should be none.
4. Find a trimmed list and press its control. The full list should open and its length should match the number on the control.

## Where it lives

- The screen: client/src/pages/ReportPage.jsx
- What the server assembles: server/lib/netbox/report.js

## What is not done

Nothing outstanding.
