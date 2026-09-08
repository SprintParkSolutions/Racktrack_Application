# Drift and port history

**SPRTMS-1638** · Sprintpark Rack Track Management System

## What this is

What has changed in the rack since the last time anyone looked.

## Why we did it

The screen showed one switch, paused, while three were being read on the Network page.

## What we built

- Every switch in the rack, polled, each in its own band.
- Each switch's ports laid out as they sit on the device, showing which are up and which are down.
- A change list in plain words with how long ago: a port going up or down, a speed or duplex change, a neighbour appearing or disappearing, a VLAN change.
- Each port keeps its own record, so you can open one and read what it has been doing rather than only what it is doing now.
- How long ago the switch was read, and a control to read it again without leaving the screen.

## An example

The change list reads like a person wrote it: “Slot0/9 went down, 5m”. “Slot0/3 1 Gbps to 100 Mbps, 3h”. “Slot0/49 neighbour appeared: AP-Floor2, 26h”.

## How to check it

1. Open Drift on a rack with switches. All of them should be listed, not one.

## What is not done

Nothing outstanding.
