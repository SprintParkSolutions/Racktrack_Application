# Read live switches over SNMP from the phone

**SPRTMS-1632** · Sprintpark Rack Track Management System

## What this is

The app can now ask a switch about itself, directly from the phone.

## Why we did it

Before this, the phone asked our server, and the server logged into the switch over SSH.
That meant the switch had to be reachable from the data centre, and the switch password had to be stored on the server.
In practice the engineer is standing next to the rack with a phone that is already on the same network, so the long way round was slower and less safe.

## What we built

- A direct SNMP path inside the app on both iPhone and Android, so the request leaves the phone and reaches the switch.
- Both of the ways these switches answer: SNMP v2c with a community string, and SNMP v3 with no password.
- Results appear as they arrive. The name and model come first, then the port layout, then the rest.
- A Stop button, so a switch that is not answering does not hold the screen.

## Measured

| | |
|---|---|
| Name and model | 10 to 22 milliseconds |
| Full read, 52-port D-Link | about 0.36 seconds |
| Slowest switch in the office rack | 6.5 seconds |

## How to check it

1. Open the Network page, add a switch with its address, and read it.
2. The card should fill in from the top down, not appear all at once.

## What is not done

Nothing outstanding.
