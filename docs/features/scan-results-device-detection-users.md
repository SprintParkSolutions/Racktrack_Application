# Scan Results & Device Detection

**Feature Reference** · *The annotated rack: what the app found, and your chance to confirm it.*

**Category:** Core feature — the results hub for a scanned rack · **Audience:** Everyone who runs a scan · **Document date:** 24 July 2026 · Part of the RackTrack documentation set. *A developer version with the technical detail is in [scan-results-device-detection-developers.md](scan-results-device-detection-developers.md).*

---

## On this page

1. In simple terms
2. At a glance
3. How it works — step by step
4. Where the input comes from
5. What it produces (output)
6. What you see on screen
7. The logic behind it
8. A little more detail
9. Real data vs. synthetic
10. Use cases

---

## 1. In simple terms

You point the camera at a rack and take one photo. A few seconds later RackTrack shows you that same photo with every device boxed and labelled — *switch here, patch panel there, PDU at the bottom* — laid out slot by slot. From that screen you can zoom into any device, drill into a single port to see what's plugged in, and, whenever the app gets something wrong, tell it so in one tap.

This is the **results hub**: the screen you land on after every scan, and the doorway to every deeper view — live ports, cable tracing, a 3D map, firmware checks and change history. It's built to be trusted at a glance and corrected in seconds.

## 2. At a glance

| | |
|---|---|
| **Category** | Core feature — the results hub for a scanned rack. |
| **Who uses it** | Everyone who runs a scan. |
| **Where input comes from** | The completed scan, plus on-demand live switch data and your corrections. |
| **What it outputs** | An interactive annotated rack, per-port detail, and training feedback. |
| **Data source** | REAL — everything is read from your photo; live port checks come from the switch. |

## 3. How it works — step by step

```
Take one photo
        ↓
The app checks it's usable   (straight, clear, and actually a rack)
        ↓
It reads the rack            (every device, port and label)
        ↓
You see the result           (your photo, everything boxed and named)
        ↓
Pick a device / a port       (drill into a switch, panel or PDU)
        ↓
Confirm or correct           (a tap fixes anything it got wrong)
        ↓
Branch out                   (Ports · Map · Network · Switches · Drift · Report)
```

**Walkthrough**

1. On the **Scan** screen, take a photo or upload one. The app opens the results page for that rack.
2. The result loads and draws coloured boxes over your photo — one per detected device — each with a name chip.
3. Pinch-zoom or tap a device to focus on it.
4. Open the device list and choose one to inspect. A switch or panel shows its ports; a PDU shows its power outlets.
5. To check a specific port, pick a port type (network, fibre, console, USB) and type a port number, then press **Find Port** — this can check the switch live for that port's real state.
6. Answer the quick prompts, e.g. *"Detected as Switch — right?"* and *"Detected 24 ports — right?"* Your fixes stick.
7. Use the tab bar or the report row to open any deeper view.

## 4. Where the input comes from

- **Your photo** — one still, from the in-app camera or an upload. It's the picture the labels are drawn on.
- **The app's reading of it** — the device types, positions, port counts and cable colours all come from RackTrack looking at the photo.
- **On-demand live checks** — only when you open a specific port does RackTrack look at the real switch; nothing connects to your equipment until you ask.
- **Your confirmations** — the Yes/No answers and fixes you give.

## 5. What it produces (output)

- **An annotated rack** — your zoomable photo with a labelled box on every device.
- **A per-port view** — status, cable type and colour, and the device on the far end of the cable.
- **One tidy record of the rack** — the single description every other screen and the report read from.
- **Feedback** — each correction saved (with the picture it refers to) to make the app better.
- **A launch point** — direct entry into Ports, the Map, Network view, Switch info, Drift and the shareable report.

## 6. What you see on screen

- **Hero image** — the photo with device boxes, name chips, a brief scan-line animation, and a "Done in *[time]*" badge.
- **Device list** — each device's type and a port breakdown (or, for a PDU, a power summary).
- **Port view** — status (connected / empty / unknown), the cable type and colour shown as a real swatch, and the end device when it can be worked out.
- **Confirm cards** — *"Detected as Switch — right?"* and *"Detected 24 ports — right?"*, each with Yes/No and a place to type the correct answer.
- **"Your correction" badge** — marks any value that came from you rather than the app.
- **Report row** — View, Report, Console and Share.
- **Tab bar** — Overview, Switches, Ports, Map, Network, Drift.

## 7. The logic behind it

- **Trust the photo; only go live when asked.** The overview reflects what the photo showed. A switch is only checked live when you open one of its ports — so the screen stays fast and nothing is disturbed in the background.
- **Every correction teaches the app.** Each fix is saved with the exact part of the picture it refers to, so RackTrack improves on the equipment *you* actually have.
- **No clutter.** Empty and unrecognised rack slots are kept out of the overlay and the device list, so you see equipment, not noise.
- **Fixes are sticky.** A value you correct is remembered and reused next time.
- **The same photo always makes the same rack.** An accidental re-upload lands on the existing record instead of creating a duplicate.

## 8. A little more detail

RackTrack checks the photo before reading it — if it's too tilted, too dark, or the cabling hides too much, it tells you why and lets you retake it (or proceed anyway). Then it finds each device and its type, counts and identifies the ports, works out cable colours, and reads the make and model off the faceplate where the label is legible. All of that is drawn back over your original photo so the boxes line up exactly, even as you zoom.

When you open a single port, RackTrack briefly checks the real switch to read that one port's live state and what's connected, then leaves it alone. Your corrections are saved as teaching examples, and the finished result becomes a report you can view, download as a PDF, or send straight to Teams, Slack or email.

## 9. Real data vs. synthetic

| Thing on screen | Real or synthetic |
|---|---|
| Device boxes, types, port counts | **REAL** — read from your photo. |
| Cable colour / type | **REAL** — read by the app, with a confidence level. |
| Make / model / firmware | **REAL** — read from the faceplate where legible. |
| Live port status & end device | **REAL / LIVE** — checked from the switch on demand. |
| "Unidentified" placeholder slots | SYNTHETIC — stand-ins for slots the app couldn't classify; hidden from view. |
| Your corrections | **REAL** — your input, stored and reused. |

## 10. Use cases

- **Verifying an install.** Scan, confirm the switch and its port count, and trust the rest — the rack is documented in seconds instead of typed up by hand.
- **Chasing a bad port.** Selecting the port shows its live status and the device on the other end, without opening a terminal.
- **Improving accuracy over time.** Correcting a misread model or port count sharpens the app for your whole fleet.
- **Feeding the other views.** The same detected rack is what the Map, Network, Drift and CMDB checks all build on — get it right once and every view benefits.

---

— Scan Results & Device Detection —
