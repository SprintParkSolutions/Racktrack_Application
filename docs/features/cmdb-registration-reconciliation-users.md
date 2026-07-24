# CMDB Registration & Reconciliation

**Feature Reference** · *Register what you scanned into your records database, and flag where the rack and the records disagree.*

**Category:** Integration — CMDB / ServiceNow bridge · **Audience:** Technicians registering racks, and anyone working a drift ticket · **Document date:** 24 July 2026 · Part of the RackTrack documentation set.

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

Your records database — the CMDB, usually ServiceNow — is supposed to say what's in every rack. Real racks change, and records fall behind. This feature closes that gap in two directions.

**Registration** takes a rack you just scanned and writes its inventory into the CMDB — the rack, its switches, patch panels and server, their ports, and how they're cabled. But it never writes silently: RackTrack first raises a **request** (a ServiceNow Service Request) and only pushes the inventory once that request is **approved**. That approval gate is the whole point — nothing lands in your records without a sign-off.

**Reconciliation** works the other way. When a scan is tied to a support ticket, RackTrack lines up what the CMDB *expects* to be in the rack against what the camera *actually saw*, position by position. Where they disagree — a switch at the wrong slot, or missing entirely — it raises that as **physical drift**, with the evidence, as a work note on the ticket.

## 2. At a glance

| | |
|---|---|
| **Category** | Integration — the bridge between a scan and your CMDB/ServiceNow. |
| **Who uses it** | Technicians registering a rack; anyone working a drift ticket. |
| **Where input comes from** | A completed scan's inventory, plus your existing CMDB records and (for reconciliation) an incident. |
| **What it outputs** | A registered rack, and a drift alert plus a work note / ticket describing any mismatch. |
| **Data source** | MIXED — the device list is REAL; some registered detail fields are synthetic placeholders. |

## 3. How it works — step by step

```
Fresh scan, rack not in CMDB   →  an approval card appears on the results
        ↓
Raise Ticket                   →  a Service Request is opened, with a reference
        ↓
Approve                        →  RackTrack synchronizes the inventory
        ↓
Registered                     →  devices, ports and connections written; summary shown
        ↓
Reconcile (ticket mode)        →  what the CMDB expects at each slot vs. what the scan saw
        ↓
Verdict + work note            →  confirmed / drift, posted to the incident
```

**Walkthrough — Registration**

1. Scan a rack that isn't in the CMDB yet. An **approval card** appears on the results: "Rack not registered in CMDB".
2. Press **Raise Ticket**. A request is opened and its reference number is shown ("Ticket submitted").
3. Press **Approve**. A "Synchronizing…" step runs while the inventory is written.
4. See **Successfully registered** — a summary with device / port / cable counts, a list of the registered devices, and a sample of the connections.

**Walkthrough — Reconciliation (ticket mode)**

1. Open a scan that's linked to a support incident. If the rack no longer matches the records, a **Physical Drift Detected** screen appears.
2. It shows, side by side, what the **CMDB expects** at a slot and what the **scan sees at U##**.
3. Read the next-step guidance, verify at the rack, and use **Raise ticket** to open an incident for the drift if needed.

## 4. Where the input comes from

- **The scan's inventory** — the devices the camera detected, their slot positions, their ports and which ports are in use.
- **Your existing CMDB records** — what the database currently claims is in that rack.
- **A service incident** — for reconciliation, the ticket that ties a scan to a specific piece of kit, so RackTrack knows which rack to check.

## 5. What it produces (output)

- **A registered rack** — the rack, its devices, their ports, and the cabling between them, written into the CMDB.
- **A registration summary** — counts of devices, ports and cables, the rack's height in slots, a list of registered devices, and a short sample of connections.
- **A drift alert** — a clear "CMDB expects *X*" vs. "scan sees *Y* at U##" comparison.
- **A work note or ticket** — posted to the real incident in ServiceNow, describing the mismatch, never overwriting what's already there.

## 6. What you see on screen

- **The approval card**, which moves through clear states: not registered → ticket submitted (with its reference) → synchronizing → successfully registered.
- **The registration summary** — a row of counts (Devices · Ports · Cables · Rack U), then the list of registered devices (each with its slot, type, and any model / address it carries) and a sample of connections.
- **The drift screen** — a "Physical Drift Detected" header, a two-column "CMDB expects" vs "Scan sees at U##" comparison, the annotated rack photo so you can eyeball it, and plain next-step guidance.
- **A Raise-ticket action** on the drift screen that opens an incident inline.

## 7. The logic behind it

- **Nothing is written without approval.** Registration always goes through a Service Request that has to be approved first. This is the product's core compliance promise — every CMDB write is gated.
- **Four honest verdicts.** For each thing the CMDB expects, reconciliation returns one of: **confirmed** (right type, seen clearly), **low-confidence** (right type but the photo was unsure — rescan), **mismatch** (nothing there, or a different type — physical drift), or **unknown** (the CMDB never recorded a slot position, so it can't be checked).
- **A dead port shows up as drift too.** A port that's cabled in the records but reads empty in the scan surfaces as a discrepancy, because the scan marks it empty.
- **No duplicate noise.** RackTrack fingerprints the difference between scan and records. If nothing changed since last time, it won't raise the same ticket again; if it did change, it appends a note rather than opening a second ticket.

## 8. Detailed technical explanation

**Registration, end to end.** When you approve, RackTrack builds the rack's inventory from the scan and writes each part into the CMDB one record at a time — a rack, its switches, its patch panels, the server, every port, and the "contains" and "connects-to" relationships between them. Every write is *idempotent*: it looks for an existing matching record first and updates it, or creates it if it's not there, so re-running against an unchanged scan changes nothing. Each record is tagged with which rack it belongs to, so two different racks can never overwrite each other's devices even when they share slot-derived names.

**The approval gate.** Between "raise" and "write" sits a real ServiceNow Service Request. In normal operation a person approves it in ServiceNow; a background check runs every few minutes, notices the approval, and only then performs the write. (There is a demo-only shortcut that skips the wait, but it is switched off by default and reserved for owners — the genuine promise is that approval always comes first.)

**Reconciliation, end to end.** Starting from an incident, RackTrack reads the item the ticket is about, walks the CMDB up to the rack that contains it, and uses the rack's stored scan identifier to pull the most recent scan. It then maps each recorded item to the visual type it *should* look like, reads the slot the record says it's at, and compares that against what the scan detected at that slot. The comparison becomes a readable work note — a header, what was expected, where the scan came from, a line per item, a count of how many agree, and a recommended action — appended to the incident.

**Real device list, placeholder detail.** The registration pushes the scan's **real** detected device list, but a photo can't reveal a serial number, a management address, or a cable's exact attributes. RackTrack fills those with clearly-marked placeholder values so the CMDB record is complete-looking, and records exactly which fields were synthesised. Treat the sampled cabling and asset details on the success screen as illustrative, not verified facts.

## 9. Real data vs. synthetic

| Thing on screen | Real or synthetic |
|---|---|
| Registered device list & counts | **REAL** — from the scan's detected inventory. |
| Slot positions and device types | **REAL** — detected from your photo. |
| Serials, addresses, cable attributes | SYNTHETIC — placeholder values a photo can't reveal, clearly marked as such. |
| Reconciliation verdicts | **REAL** — computed from expected-type-at-slot vs detected-type-at-slot. |
| The work note / ticket | **REAL** — posted to the actual incident in ServiceNow. |

## 10. Use cases

- **Onboard a rack.** One scan plus a guided approval registers the whole rack — devices, ports and cabling — into the CMDB.
- **Prove physical drift.** A ticket-linked scan shows a switch at the wrong slot, or missing, and raises it with a photo and a side-by-side comparison.
- **Confirm it's not physical.** When the rack agrees with the records, the work note says so — pointing the investigation at a config or logical issue instead of a truck roll.
- **Keep records honest over time.** Re-scanning updates the same records rather than piling up duplicates, because unchanged scans raise nothing.

---

— CMDB Registration & Reconciliation —
