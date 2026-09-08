# Export a rack into NetBox

**SPRTMS-1636** · Sprintpark Rack Track Management System

## What this is

Sending a scanned rack into NetBox, from the report.

## Why we did it

Pressing Preview took about five seconds with no sign of life, which read as broken.
After pressing Push you were given a number with no way to see what was behind it.

## What we built

- The report starts comparing against NetBox in the background the moment it opens, so the answer is already there when Export is opened.
- Counts of new, changed, unchanged and held back, and a control that lists every object by name with what would happen to each.
- A clear confirmation after the write, with the count and a link that opens the rack in NetBox.
- Running it a second time is safe. What already exists is updated rather than duplicated, and nothing is ever deleted.

## Measured

| | |
|---|---|
| Comparison on the demo server | 3 to 5 seconds, now done while you read |
| Typical result for the office rack | 37 new, 241 unchanged |

## How to check it

1. Open a report and go straight to Export. The comparison should already be done.
2. Push, then follow the link and find the rack in NetBox.

## What is not done

Nothing outstanding.
