# Make, model and firmware

**SPRTMS-1637** · Sprintpark Rack Track Management System

## What this is

Deciding what a device actually is, and whether its firmware is current.

## Why we did it

Someone typing a make and model by hand was being overruled by a blurry photograph.
The firmware tab said it could not check for updates, for every switch we own.

## What we built

- A make and model typed by a person wins over anything read from a photo, and those values carry through to the report and the NetBox export.
- Unit numbers misread from labels are repaired. The camera reads U15 as UIS, because a 1 looks like an I and a 5 looks like an S.
- Firmware comes from the manufacturers' own published lists, matched to the hardware revision the switch reports, so a model with several firmware lines gets the right answer.
- The ports and cables an engineer would need are shown for the vendor and model.

## The rule we hold to

The firmware tab always says something true: the verified latest version, or that the maker keeps downloads behind a sign-in, or which page to check. Never a dead end.

## An example

A TL-SG2428P running 5.20.27 is now correctly told it is current, instead of being sent away to a download page.

## How to check it

1. Type a make and model on the Switches tab. It should hold, and reach the report and the export.
2. Open the Firmware tab on a TP-Link or D-Link switch. It should name a version, not a failure.

## What is not done

Firmware lookup covers TP-Link and D-Link. Other makes get the manufacturer's download page instead of a version.
