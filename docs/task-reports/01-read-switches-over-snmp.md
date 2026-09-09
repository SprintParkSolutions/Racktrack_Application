# Read live switches over SNMP from the phone

**SPRTMS-1632** · Sprintpark Rack Track Management System

_The app asks a switch about itself, directly, with nothing in between._

## How it was before

A switch knows a great deal about itself. It knows its own model and serial number, which of its sockets have a cable in them, how fast each link negotiated, and often what is on the other end. All of that is available over SNMP, a decades-old protocol that every managed switch speaks.

Until now we did not ask the switch. The phone asked our server, and our server logged into the switch over SSH, ran commands, and read the text that came back.

That approach had three costs. The switch had to be reachable from wherever the server lives, which in a customer's building it usually is not. The switch's login and password had to be stored on the server, which is a thing nobody wants to own. And parsing screen output written for humans is fragile: the same command prints differently on two makes, and a firmware update can change the wording overnight.

Meanwhile the engineer is standing in front of the rack holding a phone that is already on the same network as the switch. The short path was there the whole time.

## What we decided, and why

We moved the read onto the phone and switched from SSH to SNMP.

SNMP is the right tool because it returns structured values rather than text meant for a person. When we ask for the port table we get a table, not a screenful of columns to guess at.

We support two ways of asking. SNMP version 2c, where the switch accepts a shared word called a community string, and SNMP version 3 without a password, which is how the switches in the office rack are configured. Version 3 with encryption is deliberately out of scope for now.

## What we built

**A direct path from the phone**

The app carries its own SNMP code on both iPhone and Android. The request leaves the handset and reaches the switch on the local network. No server, no SSH session, no stored switch password.

**Two protocol versions, no more than the read needs**

Version 2c with a community string, and version 3 without authentication. The screen never asks for a credential the read does not use.

**Answers appear as they arrive**

A full read of a large switch is dozens of separate questions. Rather than wait for all of them, the screen paints in stages: first the name and model, then the port faceplate, then the detail. The engineer sees something within a fraction of a second.

**Give up quickly and say so**

Each question waits about a second and a half and is not retried. A switch that is not answering should be reported as not answering, not treated as slow. There is a Stop button for a read that is going nowhere.

## How it works

A read runs in phases, and each phase paints the screen as soon as it has something worth showing.

The first phase asks for the switch's own description and name. That is one exchange and comes back in roughly twenty milliseconds, which is why the card seems to appear instantly.

The second phase walks the port table and draws the faceplate. The third phase collects everything else: what is plugged in, the neighbours, the serial and firmware.

Because each phase reports separately, a switch that answers the first two questions and then goes quiet still produces a useful card, with the missing parts marked as not returned rather than left blank.

## Measured

| | |
|---|---|
| Name and model | 10 to 22 milliseconds |
| Faceplate drawn | 61 milliseconds on the fastest switch, about 1.2 seconds on the slowest |
| Complete read, 52-port D-Link | 0.36 seconds |
| Complete read, slowest switch in the rack | 6.5 seconds |

## How to check it yourself

1. Open the Network page and add a switch with its address and community string.
2. Press read. The name and model should appear almost at once, then the faceplate, then the rest.
3. If it fills in all at once after a pause, the staged painting is not working.
4. Point it at an address with nothing on it. It should give up within a couple of seconds and say the switch did not answer.

## Where it lives

- The read itself: client/src/utils/snmpClient.js
- The screen: client/src/pages/SwitchTestPage.jsx
- A test against a real switch, off by default: client/src/utils/liveprobe.test.js
- On iPhone the SNMP code is a native plugin, and it must be registered from a subclass of the Capacitor bridge view controller or the app cannot see it.

## What is not done

Nothing outstanding. SNMP version 3 with authentication and encryption is not built, by choice, and is not needed for the switches we have.
