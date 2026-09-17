# Rack Book: enter one rack in NetBox's own fields and export it

Ticket SPRTMS-1667, sub-tasks SPRTMS-1673 to 1675. Built 11 September 2026 as a published page.

## How it was before

There was no way to enter the ground truth for a rack. The NetBox on the demo box was empty, the end-to-end test of the scan pipeline needed a record a person had typed, and the only route was typing into NetBox screen by screen.

## What we decided, and why

One page that asks for everything NetBox holds about a rack, in NetBox's own field names and choice values, so the exports load with no translation. Seven export formats, because the same entries have to reach NetBox, ServiceNow, a spreadsheet and our own writer. Entries autosave into the page's own database so they can be read back directly, without files being passed around.

## What we built

Eight steps: site and rack; manufacturers, device types and roles; devices with position, face, status, serial and asset tag; interfaces, patch-panel rear and front ports, PDU power ports and outlets, inventory items; VLANs, prefixes and addresses; cables with both ends; contacts; export. A live rack elevation that flags overlaps and positions outside the rack. Generators for interfaces from a name pattern, for a patch panel's rear and front ports mapped one to one, and for a PDU's outlets. A check list before export. Seven exports: NetBox bulk-import CSVs zipped in dependency order with a README, a NetBox JSON bundle, device-type library YAML per model, an XLSX workbook, ServiceNow import CSVs, the RackTrack as-built JSON, and a Markdown elevation. A JSON backup and restore of the whole book.

## How it works

The book is one JSON document, schema `rackbook/1`, kept in the page database under the collection `racks` with the rack's slug as the id, and mirrored in the browser's local storage. Every export is built from one set of tables derived from that document, so the CSV, JSON, YAML and XLSX views never disagree. Files are handed over through the viewer's download prompt; when downloads are unavailable the text appears in a copy box.

## The rule we hold to

Field names and choices are NetBox's, verbatim. The only derived values are slugs. A device that overlaps another, a cable end that names no port, or a port cabled twice is flagged before export, because NetBox refuses those at import time after the objects above them are already written.

## An example

Rack R12 at site Reading DC: one manufacturer TP-Link, one device type TL-SG2428P, one device SP-R1-U15-SW02 at U15, 28 interfaces generated from `GigabitEthernet1/0/{n}`, the check list noting the missing serial, and every export produced.

## What we found

- Null attributes were being set as the string "null", so every select showed its last option instead of the stored value. Fixed.
- Grid cells did not shrink below the tables, so phones scrolled sideways. Fixed with min-width zero on the containers.
- Plain download links are inert in the artifact viewer, so the page uses the downloads capability and falls back to a copy box.

## Measured

- Local drive in Chrome: a rack created, a type and a device entered, 28 interfaces generated, the check list rendered, the JSON bundle produced, the book restored after a reload, no script errors.
- Page size 61 KB; no horizontal overflow at 390 px on any step.

## How to check it yourself

Open https://claude.ai/code/artifact/d035dd87-c330-4333-bf9c-b17f5de670c9, create a rack, enter a device and generate its interfaces, then use the Export tab. Accept the database prompt so the entries are saved to the page and can be read back.

## Where it lives

`docs/netbox/rack-book.html` in the app repository, and the published page at the address above.

## What is not done

- No rack has been entered yet.
- The scripted loader that takes the JSON bundle into NetBox, and the ServiceNow transform maps, are not written; the CSV route needs no code.
- The end-to-end scan against the loaded record has not been run.
