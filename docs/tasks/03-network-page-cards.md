# The Network page: one card per switch

**SPRTMS-1634** · Sprintpark Rack Track Management System

## What this is

The screen that shows the live switches in a rack, rebuilt.

## Why we did it

The screen had grown into a wall of text.
Three switches produced a page nobody could take in at a glance.

## What we built

- One numbered card per switch, carrying its name, model, address and how many ports are up.
- The faceplate drawn to the width of the phone, in two rows of numbered ports, so a 52-port switch fits without pinching or scrolling sideways.
- Each card's actions behind a small menu on that card, and a switch can be edited where it sits.
- Everything else behind Read more.
- Adding a switch starts with every field empty, and the form says what is still needed.

## The rule we hold to

Nothing is pre-filled when a switch is added. A guessed address that half works is worse than a blank one, because you cannot tell whether the read failed or the guess was wrong.

## How to check it

1. Three switches should read as three clean cards, each fitting the screen width.

## What is not done

Nothing outstanding.
