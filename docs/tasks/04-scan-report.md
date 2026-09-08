# The scan report, as a summary

**SPRTMS-1635** · Sprintpark Rack Track Management System

## What this is

The report a person reads after scanning a rack.

## Why we did it

It printed every field whether or not we had a value.
Roughly half of it read “not stated”, which taught people to skim past the parts that mattered.

## What we built

- The rack's figures first: ports in use, devices, switches read, addresses seen.
- Then each device with the facts we actually hold for it.
- Fields with no value are left out entirely.
- Any list that has been shortened carries a control naming the full count, so no number has to be taken on trust.

## How to check it

1. Open a report. The top should carry only figures we can prove, and no line should read “not stated”.

## What is not done

Nothing outstanding.
