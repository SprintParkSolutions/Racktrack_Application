# The Network page: one card per switch

**SPRTMS-1634** · Sprintpark Rack Track Management System

_The live-switch screen, rebuilt so three switches can be understood at a glance._

## How it was before

The screen had grown by accretion. Each new thing we learned how to read was appended to the page, and by the time it could read everything it was a wall of text.

Three switches produced a page that had to be scrolled several times to find a single fact, and the faceplate did not fit the width of a phone, so a 52-port switch had to be scrolled sideways.

The form for adding a switch pre-filled an address and a community string. That looked helpful and was not: when a read failed there was no way to tell whether the switch was unreachable or the guess had simply been wrong.

## What we decided, and why

Give each switch a card, put the summary on the face of it, and hide everything else one tap away.

The measure we held to is that a person should be able to hold the phone at arm's length and see, for each switch, its name, what it is, and how much of it is in use, without reading a word of detail.

## What we built

**One numbered card per switch**

Numbered because engineers refer to them by position in the list. Each card carries the name, the model, the address, and how many ports are up out of the total.

**A faceplate that fits the phone**

The ports are drawn in two rows across the width of the screen, numbered, coloured by state. A 52-port switch fits without pinching or scrolling sideways. Virtual interfaces are left out, because they are not sockets and drawing them makes the count wrong.

**Actions on the card they belong to**

Each card has its own small menu, and a switch can be edited where it sits rather than in a form somewhere below the fold. When you press edit, the fields open on that card, in view.

**Detail behind Read more**

What is plugged in, the neighbours, the labels, the addresses and the traffic counters are all one tap away and folded by default.

**An empty form when adding**

Every field starts blank, and the form names what is still needed rather than refusing silently.

## How it works

The cards are held per rack, so a scan you did yesterday shows the switches you read yesterday, and a new scan starts clean.

Reads are filed against the rack automatically when the page opens, which is what makes the same switches appear on the report and on the drift screen without anyone pressing a button.

## The rule we hold to

> Nothing is pre-filled when a switch is added. A guessed address that half works is worse than a blank one, because a failure then has two possible causes and the engineer cannot tell them apart.

## How to check it yourself

1. Add three switches and read them. You should get three cards, each fitting the screen width.
2. Count the ports on the faceplate against the physical switch. A 28-port switch should draw 28 ports.
3. Press edit on the second card. The fields should open on that card, without scrolling.
4. Press add. Every field should be empty, and the form should say what is still needed.

## Where it lives

- The page: client/src/pages/SwitchTestPage.jsx and its stylesheet

## What is not done

Nothing outstanding.
