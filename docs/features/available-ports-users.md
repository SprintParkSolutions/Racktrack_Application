# Available Ports

**Feature Reference** · *How many switch ports are free right now — copper and fiber, read live from the real switch.*

**Category:** Live switch data — reads the real device, not the photo · **Audience:** Any technician planning a patch or checking capacity · **Document date:** 24 July 2026 · Part of the RackTrack documentation set.

---

## On this page

1. In simple terms
2. At a glance
3. How it works — step by step
4. Where the input comes from
5. What it produces (output)
6. What you see on screen
7. The logic behind it
8. Detailed technical explanation
9. Real data vs. synthetic
10. Use cases

---

## 1. In simple terms

Every other RackTrack view tells you what the *photo* showed. This one talks to the *actual switch*. When you open the Ports view for a scanned rack, RackTrack quietly logs in to the switch and asks it, right now, which ports are in use and which are free — and for each free one, whether it's a copper (Ethernet) socket or a fiber SFP slot.

The point is to answer a question you have while standing at the rack: *"Is there room to plug something in, and what kind of room?"* A single number like "5 ports free" isn't enough — you need to know if those five are copper ports or SFP cages, because that decides whether your uplink fits. Available Ports splits the answer for you: so many Ethernet free, so many SFP free, and a bar showing how full the switch already is.

Because it reads the live switch, the state is real, not guessed. And because the last reading is remembered on your device, the next time you open the view it appears instantly while a fresh read runs in the background.

## 2. At a glance

| | |
|---|---|
| **Category** | Live switch data — reads the real device, not the photo. |
| **Who uses it** | Any technician planning a patch or checking a switch's spare capacity. |
| **Where input comes from** | A live login to the actual switch's interface table. |
| **What it outputs** | An availability summary, a copper/fiber split, a utilisation bar, and a per-port inventory. |
| **Data source** | REAL / LIVE — read straight from the switch; cached so it re-opens instantly. |

## 3. How it works — step by step

```
Open the Ports view for a rack   →  a loader shows the seconds ticking while it probes
        ↓
Log in to the switch             →  a secure session; ask for its interface status
        ↓
Read every interface             →  each port becomes Available / In use / Reserved
        ↓
Sort copper from fiber           →  Ethernet vs SFP, from the switch's own data
        ↓
Read the switch itself           →  model, firmware, uptime, PoE draw, VLANs
        ↓
Show the summary + inventory      →  free-of-total, ETH/SFP chips, a faceplate, filters
```

**Walkthrough**

1. Open the **Ports** view for a rack. While it works, an animated loader shows an elapsed-seconds counter so you know it's live, not stuck.
2. RackTrack opens a session to the switch and asks it for its interface status.
3. Each interface is read and given a plain verdict: **Available**, **In use**, or **Reserved**.
4. A summary card is drawn — how many ports are free out of the total, split into Ethernet and SFP, with a utilisation bar.
5. A **faceplate** draws the physical front panel, one coloured cell per port, so the switch on screen matches the one in front of you.
6. Use the filter pills (**All / In Use / Available / Linked / Errors**) to narrow the list, and tap a port for its detail.
7. If the read fails, the loader turns into a short, readable reason and a **Retry** button.

## 4. Where the input comes from

- **The switch's interface table** — the live result of asking the switch to show its interface status. This is the heart of it: real up/down state, straight from the device.
- **The switch's medium column** — where the switch reports it, this tells copper from fiber directly.
- **The scan's port count** — used only as a hint to split Ethernet from SFP when the switch itself is quiet about the medium.
- **The switch's own identity** — a second read pulls the model, firmware, uptime, management address, PoE power draw and VLAN membership, so the view is a full picture, not just a port list.

## 5. What it produces (output)

- **An availability badge** — "N of M" free, shown in an empty style when nothing is free.
- **Copper / fiber chips** — separate counts of free Ethernet ports and free SFP ports.
- **A utilisation bar** — how much of the switch is already used, as a percentage.
- **A faceplate map** — the physical front panel, each port coloured for up, uplink, or free.
- **A per-port inventory** — each port's number, full interface name, description, medium, live status and plain verdict.
- **A cached snapshot** — the last live read, shown instantly next time, then refreshed.

## 6. What you see on screen

- **Identity card** — the switch's model, firmware, uptime, management address, MAC and live PoE draw, with a "live" dot.
- **Summary stats** — In use, Available, and Identified (ports with a known device on the other end), each as a live count.
- **Faceplate** — one cell per port, coloured: green up, a distinct colour for an uplink (a port with many devices behind it), faint for free.
- **Filter pills** — All, In Use, Available, Linked, and Errors (Errors only appears when there are reserved ports), each with its own count.
- **Port rows** — a zero-padded number, the full interface name, what's on the other end where known, the medium (Copper/Fiber), and an Up/Down state with an Available / In use / Reserved verdict.
- **Cables and Ping tabs** — a companion view listing every live cable and the device on the far end, and a tool that pings a target *from the switch* to confirm the switch itself can reach it.
- **Retry on failure** — with a plain reason (wrong network, closed session, rejected credentials) instead of a raw error.

## 7. The logic behind it

- **Available** — the link is down and the port has no description. Nothing is plugged in and nothing is reserving it.
- **In use** — the link is up / connected.
- **Reserved** — the port is administratively down, shut, or error-disabled, *or* it's down but still carries a description — a sign someone is holding it on purpose.
- **Honest capacity.** A reserved port never counts as free. Spare capacity you can't actually use isn't spare.
- **Copper vs fiber, best signal first.** If the switch reports the medium, that wins. If not, the interface naming is used, and only as a last resort the scan's detected SFP-cage count.
- **Fast on return, fresh in the background.** The last good read is remembered so the view opens instantly; a new scan or a Retry triggers a fresh live read.

## 8. Detailed technical explanation

**Connecting and reading.** RackTrack opens a secure remote session to the switch's management address and runs a "show interface status" style command. The switch's reply — its interface table — is parsed into one row per port. A second, broader read pulls the switch's identity, per-port administrative config, PoE, VLANs, the neighbours it can see, and its address table, so the view can show not just free/used but *what's on the other end* of each live port.

**Tolerant parsing.** Switches from different makers print their tables in different shapes. The reader is written to cope with several styles (for example Cisco-like and TP-Link-like output) rather than assuming one exact format, and it copes with the "press any key to continue" paging prompts long tables produce.

**Caching and errors.** The last successful read is stored on your device, so returning to the view is instant. Raw connection errors are translated into short, human explanations — "you may not be on the same network as the switch", "the switch limits simultaneous sessions, tap Retry", "the saved credentials were rejected" — because these switches typically allow only one login at a time, so a background process can briefly hold the line and a Retry clears it.

**The single-port view.** From the scanned rack you can also drill into one specific port. RackTrack re-examines that exact port on the original photo, produces a close-up of the device with the port marked and a full-rack shot with the same port highlighted, reads its cable colour and type, and — when you ask — reads that one interface live from the switch. Any correction you've made to that port's numbering or cable colour is applied so the view shows what you confirmed, not the old guess.

## 9. Real data vs. synthetic

| Thing on screen | Real or synthetic |
|---|---|
| Port up/down / in-use state | **REAL / LIVE** — from the switch's interface table. |
| ETH vs SFP classification | **REAL** — from the switch's medium column or naming, or the scan's port count as a hint. |
| Switch identity, PoE, VLANs, neighbours | **REAL / LIVE** — read from the switch in a second pass. |
| Cached last-known state | **REAL** — the previous live read, re-probed on demand. |
| Fallback switch address | Used only when no switch address is remembered for you yet. |

## 10. Use cases

- **Planning a patch.** Confirm a free copper port and note its exact interface name before you run a cable.
- **Capacity check.** The utilisation bar shows at a glance whether a switch is nearly full — before you promise someone a port.
- **Spotting reserved ports.** The Errors filter reveals ports that are down on purpose, so they aren't mistaken for spare capacity.
- **Seeing what's connected.** The faceplate and Cables tab show which live ports have a device or a whole downstream network behind them, read straight from the switch.

---

— Available Ports —
