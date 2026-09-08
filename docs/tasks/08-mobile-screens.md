# The app's screens on a phone

**SPRTMS-1639** · Sprintpark Rack Track Management System

## What this is

Three screens reshaped around the job, rather than around the order they were built in.

## Why we did it

The same complaint arrived from three directions.
Each screen did its work in an order nobody walks, and the thing you needed last was off the bottom of it.

## What we built

- Placing a switch: a switch read over the network can be matched to the device in the rack photograph, either from a list or by tapping the unit on the photo. Where only one device can fit, the app takes the match without asking. The placement survives a reload, including a deliberate “not in this rack”, and the save reports back in words, for example Sw1 went to U15 and Sw2 to U14.
- The report's actions: Download, Export and Share sit at the top, each opening its choices underneath. Download gives CSV, JSON or PDF. Share sends by Teams, by email, or as a link that opens without an account. The separate export screen is gone.
- Navigation: a rack has five steps in the order a person walks them, Overview, Network, Topology, Switches and Report, with Drift behind More. The side menu fits the height of the screen so no entry needs scrolling. History sits under Support, and the person's name and role show beside their avatar.

## How to check it

1. Read a switch, then save its place. The message should name where each switch went.
2. Open the menu on a small phone. Every entry should be visible without scrolling.

## What is not done

Nothing outstanding.
