# Switch Information

**Feature Reference** · *Everything about a switch the scan found — who it is, its datasheet specs, whether its firmware is current, and which optics to buy — all in one card, driven by what the photo actually saw.*

**Category:** Per-rack switch reference — scanned identity plus live vendor lookups · **Audience:** Everyone — no technical background needed · **Document date:** 24 July 2026 · Part of the RackTrack documentation set.

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

When you scan a rack, RackTrack reads the make, model and firmware version off each switch's faceplate. **Switch Information** takes that identity and does the legwork you'd otherwise do by hand: it looks up the switch's datasheet, checks whether its firmware is the latest the vendor is shipping, and works out which SFP modules (the little plug-in optics) fit it.

It's built around a single card per switch. If the scan found several switches, you pick one from a strip of tabs across the top. The card header tells you who the switch is — vendor and model, its rack position, and its network address if that's known — with a link straight to the vendor's own page when there is one.

The card has three tabs. **Specifications** pulls the datasheet spec table. **Firmware** tells you whether you're up to date and what the latest version is. **SFP Advisor** recommends the transceivers and cables to buy for that exact switch.

The whole thing is driven by the photo, not by logging into the switch — this is the "what's physically in front of me" view. And when the label was blurry and RackTrack couldn't read something, it doesn't guess: it shows an honest "not detected" state and lets you type the make, model or version in yourself. Once you do, every lookup works from your correction, and it sticks even if you scan the same switch again later.

## 2. At a glance

| | |
|---|---|
| **Category** | Scanned switch identity plus live vendor lookups, scoped to one rack. |
| **Who uses it** | Technicians and engineers assessing what's installed. |
| **Where input comes from** | Switch identity read from the photo, plus live spec and firmware lookups from the vendor's own site. |
| **What it outputs** | A per-switch card with Specifications, Firmware and SFP Advisor tabs. |
| **Data source** | MIXED — identity is scanned; specs and firmware are live from the vendor; SFP advice has a fallback catalog. |

## 3. How it works — step by step

```
Pick a switch          →  from the detected list (a tab per switch if several)
        ↓
Confirm identity       →  vendor / model / version from the faceplate — editable if a read was missed
        ↓
Specifications         →  the datasheet spec table, looked up live
        ↓
Firmware               →  latest version and whether you're up to date
        ↓
SFP Advisor            →  compatible optics and cables to buy
```

**Walkthrough**

1. If several switches were detected, pick one from the tab strip (each tab is labelled by position, model or number).
2. Read the header: vendor and model, rack position, the network address if it's known, and a link out to the vendor's page when one is available.
3. If the make, model or firmware version wasn't read, type or correct it in the inline editor. This is the honest "not detected" path — no guessing.
4. Open the **Specifications** tab for the live datasheet lookup.
5. Open the **Firmware** tab to see whether you're current and what the latest version is.
6. Open the **SFP Advisor** tab for compatible transceivers and cables for that exact switch.

## 4. Where the input comes from

- **The scanned identity** — the vendor, model and firmware version read from the switch's faceplate in the photo.
- **A live specifications lookup** — the vendor's own product page for that model, fetched on demand.
- **A live firmware lookup** — the vendor's own site, checked for the newest firmware version they publish for the model.
- **Curated vendor links** — a maintained list of official vendor portals and support pages, so the "open on the vendor's site" links go somewhere real.
- **Your manual entry** — the make, model or version you type when the scan couldn't read it.

## 5. What it produces (output)

- **An identity card** — vendor and model, rack position, network address, and a link out to the vendor's page.
- **A fields grid** — firmware version, serial, network address and hardware address, each shown only when it's actually known.
- **A specifications table** — the datasheet specs, plus a link to the full product page.
- **A firmware status** — your current version versus the latest, and whether an upgrade is available.
- **SFP recommendations** — the modules and cables to buy for the switch.

## 6. What you see on screen

- **A switch selector** — a strip of tabs when several switches were detected.
- **An identity header** — the combined vendor-and-model title, or a clear "Unidentified device" when nothing was read.
- **An identification editor** — a status chip plus a make/model corrector whenever a read was only partial or missing.
- **The Specifications tab** — a two-column spec table and a "View full details" link out to the vendor.
- **The Firmware tab** — a status headline, your current version and the latest one, and a link to the vendor's page.
- **The SFP Advisor tab** — the built-in transceiver-and-cable recommendations for that switch.

## 7. The logic behind it

- **It trusts the photo, not a login.** This is the "what's physically in front of me" view — RackTrack reads the switch from the picture and looks things up on the web; it does not log into the device. (Logging into a live switch to read its ports is a separate part of the product.)
- **Switches only.** Only devices the scan classified as switches appear here. Routers are a different device class and are deliberately kept out, so a router doesn't show up mislabelled as a switch.
- **It cleans up messy reads.** A garbled model fragment from the faceplate is expanded against a small built-in map, so a partial read (like a mis-scanned character) still resolves to a usable model wherever possible.
- **It remembers, per rack.** The live lookups are cached for the rack, so reopening a switch is instant rather than fetching everything again.
- **It's honest about gaps.** When something wasn't read, you get an explicit "not detected" state and an editor — never a made-up value.
- **Your corrections stick.** A make, model or version you type is saved against that switch and re-attaches after a re-scan, so you only fix a bad read once.

## 8. Detailed technical explanation

**Where the identity comes from.** After a scan, RackTrack runs a close-up text read on each device's faceplate and keeps the make, model and firmware version it could make out. Switch Information reads that list, keeps only the devices classed as switches, and builds one card per switch. If a model came through garbled, it's matched against a small correction map so a near-miss still lands on a real model name.

**The specifications lookup.** When you open a switch, RackTrack asks its spec service for that vendor and model. The service answers from a fast local cache when it can, and falls back to a live web fetch for models it hasn't seen before, then hands back a tidy spec table and a link to the real product page. When the identity came from the imperfect faceplate read, RackTrack also runs a light auto-correction pass so a slightly-wrong model still finds its datasheet.

**The firmware lookup.** RackTrack takes the current version you're running and compares it against the newest version it can find on the vendor's own site. It reports whether you're up to date and what the latest is, and it always carries a link back to the source page so you can verify it yourself. When a vendor's site needs a login, RackTrack hands you that portal link rather than pretending it knows.

**The SFP advisor.** For the selected switch, RackTrack works out what kind of optical slots it has and recommends compatible transceiver modules and pre-terminated cables to buy, with a sensible generic fallback when there are no exact listings.

**Corrections that last.** When you type a make, model or version, RackTrack saves it against a stable key for that switch — its serial number if known, otherwise its hardware address, otherwise its rack position. Because the key doesn't change, your correction survives another scan of the same switch and keeps driving the lookups.

## 9. Real data vs. synthetic

| Thing on screen | Real or synthetic |
|---|---|
| The switch list, make, model, firmware version, position | **REAL** — read from the scan, with light cleanup of garbled reads. |
| The specifications | **REAL / LIVE** — from the vendor's own product page. |
| The firmware status and latest version | **REAL / LIVE** — from the vendor's own site. |
| Vendor portal / download links | **REAL** — from a curated map of official pages. |
| Your manual make / model / version | **REAL** — your input, saved locally and surviving re-scans. |
| A "not detected" gap | Shown honestly as an empty state with an editor — never a faked value. |

## 10. Use cases

- **Audit a switch on sight.** Scan the rack, open the switch, and read its specs and firmware without logging into it.
- **Fix a bad read once.** When the label was blurry, type the model in — from then on every lookup works from your correction, even after a re-scan.
- **Plan optics.** Jump to the SFP Advisor to order the right transceivers and cables for that exact switch.

---

— Switch Information —
