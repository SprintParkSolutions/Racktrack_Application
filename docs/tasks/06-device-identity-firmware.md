# Make, model and firmware

**SPRTMS-1637** · Sprintpark Rack Track Management System

_Deciding what a device actually is, and telling the truth about whether its firmware is current._

## How it was before

Two separate things were wrong, and both undermined trust in the app.

First, a person typing a make and model by hand could be overruled by the camera. Someone would enter TP-Link TL-SG2428P, and a later reading of a blurry photograph would replace it with something else. The one source of information we can be most confident about, a human being who is standing in front of the device, was being treated as the least reliable.

Second, the firmware tab said it could not check for updates. Not for some switches. For every switch we own. The feature existed and had never once produced an answer.

There was a third, smaller problem underneath both. Rack labels read by the camera came back wrong in a specific and repeatable way: U15 was read as UIS, because a one looks like an I and a five looks like an S.

## What we decided, and why

Rank the sources of truth honestly, and go to the manufacturers for firmware rather than guessing.

The ranking is simple: what a person typed beats what a camera read, and what the switch says about itself beats both. A photograph is evidence, not testimony.

For firmware we stopped trying to infer a version and went to the source. Each manufacturer publishes its own list of releases. That list is the only thing worth quoting.

## What we built

**A typed make and model wins, and travels**

Values entered by hand take precedence over anything read from a photo, and they carry through to the report and into the NetBox export, so the whole system agrees about what a device is.

**Misread unit numbers are repaired**

Where a label reads U followed by two characters, letters that the camera commonly substitutes for digits are converted back. UIS becomes U15. Words that merely start with a U, such as USB, are left alone.

**Readings are remembered per photograph**

The result of reading a photograph is stored against the image itself, so the same photo is never read twice. This is what makes the make and model appear immediately on a rack you have already scanned.

**Real firmware versions from the manufacturers**

TP-Link's is read from the public part of its support portal, and D-Link's from its official firmware mirror. Both are matched to the hardware revision the switch reports, because one model can have several firmware lines that must not be mixed.

**The tab always says something true**

Either the verified latest version, or that the maker keeps its downloads behind a sign-in, or which page to check. Never a dead end and never a version we cannot support.

**Ports and cables for the model**

The advisor shows the ports a given model has and the cables that fit them, rather than cables alone.

## How it works

Matching a firmware release to a switch is harder than it sounds, because a manufacturer will sell one model number in several hardware revisions and publish a different firmware line for each. Quote the wrong line and you tell an engineer to install something that will not run.

So the switch is asked for its hardware revision over SNMP, and that revision picks the line before any version is compared. TP-Link renamed part of its range in 2023, dropping a prefix, which means one switch can be listed under two names; both are checked.

Where a manufacturer puts its downloads behind a sign-in, we say so plainly and link to the page rather than pretending to have failed.

## What we found on the office rack

- A TL-SG2428P running 5.20.27 is correctly reported as current, with high confidence, instead of being sent away to a download page.
- A DGS-1210-52 running 6.30.016 is correctly told an update exists, 6.33.B005.
- A DGS-1024C returns an empty firmware folder, which is the correct answer: it is an unmanaged switch and has no firmware to publish.

## Measured

| | |
|---|---|
| Firmware lookup test suite | 522 tests, all passing |
| A lookup against the live manufacturer site | about 3 seconds |

## How to check it yourself

1. On the Switches tab, type a make and model for a device. It should hold, and appear on the report and in the export.
2. Photograph a rack whose labels include a unit number. Check that U15 does not come back as UIS.
3. Open the Firmware tab on a TP-Link or a D-Link switch. It should name a version or a sign-in wall, not a failure.
4. Open the same rack a second time. The make and model should appear at once, not after a wait.

## Where it lives

- Label repair: pipeline/ocr_labels.py
- Remembering readings per image: server/lib/ocr_cache.js
- Manufacturer lookups: firmware_lookup/providers/tplink.py and firmware_lookup/providers/dlink.py
- The screen: client/src/pages/SwitchInformationPage.jsx

## What is not done

Firmware lookup covers TP-Link and D-Link. Every other make gets the manufacturer's download page instead of a version. Each additional manufacturer is a self-contained piece of work of roughly the same size.
