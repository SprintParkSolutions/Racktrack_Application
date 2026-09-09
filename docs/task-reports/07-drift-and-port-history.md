# Drift and port history

**SPRTMS-1638** · Sprintpark Rack Track Management System

_What has changed in the rack since the last time anyone looked, in words a person would use._

## How it was before

The drift screen showed one switch, and showed it paused, while three switches were being read on the Network page a tap away.

It also reported change as a difference between two states, which is accurate and unreadable. An engineer wants to know that a port went down twenty minutes ago, not that a field changed from one value to another.

## What we decided, and why

Follow the rack rather than a single device, and write the changes the way a person would say them out loud.

Keep a record per port, so a port that goes up and down repeatedly can be recognised as a flapping port rather than as whatever it happens to be at the moment you look.

## What we built

**Every switch in the rack, polled**

All of the rack's switches appear, each in its own band, and each is polled so its state is current rather than remembered from an old read.

**Ports laid out as they sit on the device**

A grid matching the physical faceplate, showing which ports are up, which are down, and which did not answer.

**A change list in plain words**

Ports going up or down, speed or duplex changes, neighbours appearing or disappearing, VLAN changes. Each one carries how long ago it happened, in a short form: 5m, 3h, 26h.

**A record for every port**

Tap a port to read its own history rather than only its present state.

**Say when it was read, and read it again**

Each switch says how long ago it was last read, with a control to read it again without leaving the screen.

## How it works

Every reading filed for a rack is compared against the one before it, and the differences are turned into events with a timestamp.

Events are stored per port, which is what allows a port's own history to be shown and what makes a flapping port visible.

Readings arrive from two directions and are treated identically: a read done by hand on the Network page, and the server's own background polling.

## An example

The change list reads like a person wrote it. Slot0/9 went down, 5m. Slot0/3 1 Gbps to 100 Mbps, 3h. Slot0/49 neighbour appeared: AP-Floor2, 26h.

## How to check it yourself

1. Open Drift on a rack whose switches have been read. All of them should be listed, not one.
2. Unplug a cable, read the switch again, and look at the change list. It should name the port and say it went down, with a time.
3. Tap a port. Its own history should open.

## Where it lives

- The screen: client/src/pages/PortHistoryPage.jsx
- Turning readings into events: server/lib/netbox/drift_feed.js
- Background polling: server/lib/port_poller.js

## What is not done

Nothing outstanding.
