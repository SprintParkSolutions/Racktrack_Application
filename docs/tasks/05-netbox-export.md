# Export a rack into NetBox

**SPRTMS-1636** · Sprintpark Rack Track Management System

_Sending a scanned rack into the system of record, with the comparison already done before you ask for it._

## How it was before

The export worked but felt broken. Pressing Preview started a comparison against NetBox that took about five seconds with nothing on screen, so people pressed it twice or assumed it had failed.

After pressing Push you were told a number of objects had been written, with no way to see which ones, and no route to the result.

It also lived on a separate screen, so finishing a report meant walking to a second page to press two buttons.

## What we decided, and why

Do the waiting before the engineer asks, show every object by name, and end with something unmistakable.

Comparing costs nothing and writes nothing, so there is no reason not to start it the moment the report opens. By the time anybody opens Export, the answer is already there.

## What we built

**The comparison runs while you read**

Opening a report starts the comparison in the background and keeps the result. Export then opens with the counts already on screen. It can still be run again on demand.

**Counts, then every object by name**

How many objects are new, changed, unchanged and held back, and a control that lists all of them: each rack, device, interface and cable, with what would happen to it.

**An unmistakable end**

After the write, a green panel says it was exported, how many objects were written and how many were already there, with a link that opens the rack in NetBox.

**Safe to run twice**

Every object we create carries a stable identifier of our own. A second run finds what it made last time and updates it rather than creating a duplicate. Nothing is ever deleted.

## How it works

The comparison is a dry run of the write. It walks the same objects in the same order and records what it would do, without sending a single change.

Objects are matched by an identifier we store on the NetBox record itself, so matching does not depend on names, which people rename.

Speed came from fetching in bulk. The comparison used to look up each object one at a time; it now loads all the objects for a rack in a small number of requests and matches them in memory.

## Measured

| | |
|---|---|
| Comparison on the demo server | 3 to 5 seconds, now spent while you read the report |
| A typical office rack | 37 objects new, 241 already correct |

## How to check it yourself

1. Open a report, wait a moment, then open Export. The counts should already be there.
2. Press View all. Every object should be named, with what would happen to it.
3. Push. The panel should say exported, with a count and a link.
4. Follow the link and find the rack in NetBox.
5. Run the whole thing again. The second run should report almost everything as unchanged, and should not create duplicates.

## Where it lives

- The sheet: client/src/components/ExportSheet.jsx
- The comparison and the write: server/lib/netbox/writer.js
- The route the app calls: server/routes/netbox/netbox.js

## What is not done

Nothing outstanding.
