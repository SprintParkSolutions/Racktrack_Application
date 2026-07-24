# RackTrack documentation

Everything user-facing lives in this folder.

## Documentation set — two tracks (Markdown)

As of 24 July 2026 the architecture and feature docs come in **two parallel versions**, so each reader gets the right depth:

- **User track** (`*-users.md`) — plain, lucid English for users and stakeholders. No file paths, no endpoints, no code.
- **Developer track** (`*-developers.md`) — the same material for engineers, with verified file paths, endpoints, modules and versions (every technical claim checked against the code).

Every feature has a user version; the more technical features also have a developer version. These Markdown docs are the current source of truth and **supersede the older per-feature `.docx` files** in `features/` (kept for now for reference).

### Architecture

| Topic | For everyone | For engineers |
|---|---|---|
| How RackTrack works / Architecture | [overview-users](architecture/overview-users.md) | [overview-developers](architecture/overview-developers.md) |

### Features

| Feature | For everyone | For engineers |
|---|---|---|
| Rack scanning & capture | [users](features/rack-scanning-capture-users.md) | [developers](features/rack-scanning-capture-developers.md) |
| Scan results & device detection | [users](features/scan-results-device-detection-users.md) | [developers](features/scan-results-device-detection-developers.md) |
| Ground Truth (owner) | [users](features/ground-truth-users.md) | [developers](features/ground-truth-developers.md) |
| Multi-rack scans | [users](features/multi-rack-scans-users.md) | [developers](features/multi-rack-scans-developers.md) |
| Available ports | [users](features/available-ports-users.md) | [developers](features/available-ports-developers.md) |
| Network view / live discovery | [users](features/network-view-live-discovery-users.md) | [developers](features/network-view-live-discovery-developers.md) |
| Port history & drift | [users](features/port-history-drift-users.md) | [developers](features/port-history-drift-developers.md) |
| Rack topology (3D) | [users](features/rack-topology-users.md) | [developers](features/rack-topology-developers.md) |
| Switch information | [users](features/switch-information-users.md) | [developers](features/switch-information-developers.md) |
| Firmware check | [users](features/firmware-check-users.md) | [developers](features/firmware-check-developers.md) |
| Connections / Data Sources | [users](features/connections-integrations-users.md) | [developers](features/connections-integrations-developers.md) |
| CMDB registration & reconciliation | [users](features/cmdb-registration-reconciliation-users.md) | [developers](features/cmdb-registration-reconciliation-developers.md) |
| Accounts & onboarding | [users](features/accounts-onboarding-users.md) | — |
| Organization administration | [users](features/organization-administration-users.md) | — |
| Profile & scan history | [users](features/profile-scan-history-users.md) | — |
| Specifications lookup | [users](features/specifications-lookup-users.md) | — |
| SFP procurement advisor | [users](features/sfp-procurement-advisor-users.md) | — |
| Marketplace | [users](features/marketplace-users.md) | — |

### UI reference

| Topic | For everyone | For engineers |
|---|---|---|
| UI & design system | [ui-reference-users](reference/ui-reference-users.md) | [ui-reference-developers](reference/ui-reference-developers.md) |

---

## User guide

Two editions — one per device. The **words are identical**; only the screenshots differ.

- [**RackTrack-User-Guide-iPhone.html**](user-guide/RackTrack-User-Guide-iPhone.html) — screenshots taken on a phone
- [**RackTrack-User-Guide-iPad.html**](user-guide/RackTrack-User-Guide-iPad.html) — screenshots taken on an iPad, held sideways

Open either one in a browser. They are **self-contained** — the screenshots and the font are
built into the file — so you can email one, or drop it on a share, with nothing else alongside.
There is a contents bar down the left that follows you as you scroll.

Which one do I send someone?

- **A technician in the field** — the iPhone edition. The scanning workflow is a phone job.
- **Someone at a desk** — the iPad edition. It shows the sidebar layout, which is also what
  a laptop or desktop browser shows.
- An **upright iPad** shows the phone layout, not the sidebar — so send those users the
  iPhone edition.

The HTML files are self-contained (images are embedded), so they can be emailed or dropped
on a share with nothing else alongside. They also print cleanly — **Print → Save as PDF**
gives one task per page.

### How the guide is organised

It is built around **31 tasks**, not around screens — "Find a specific port", "Find out what
changed, and when", "Scan a rack too tall for one photo". The contents page asks *"What do
you want to do?"* Each task is one card: numbered steps on the left, the screenshot on the
right.

Tasks run in the order you meet them: get in → scan a rack → use the results → go deeper on
the equipment → look things up → your account → administration. Reference material
(troubleshooting by symptom, glossary, limits, and which screens need setting up) is at the back.

## Screenshots

- [screenshots/iPhone/](screenshots/iPhone/) — 30 PNGs, captured at 390×844
- [screenshots/iPad/](screenshots/iPad/) — 30 PNGs, captured at 1194×834 (landscape)

Filenames match one-to-one across the two folders, so `iPhone/netdisco.png` and
`iPad/netdisco.png` are the same screen on the two devices. These are the same images
embedded in the guides, at full 2× resolution — drop them straight into a deck.

Every screenshot was captured from the running application against real scan data
(rack `RK-325D10C3` and the bench TP-Link TL-SG2428P), not mocked up.

## Demo

[demo/](demo/) — everything for running a customer demo.

- [DEMO_SCRIPT_v2.docx](demo/DEMO_SCRIPT_v2.docx) — the current demo script
- [DEMO_SCRIPT.docx](demo/DEMO_SCRIPT.docx) — the earlier version
- [racktrack-client-demo-script.md](demo/racktrack-client-demo-script.md) — client-facing demo script

## Feature notes

[features/](features/) — one document per feature, written for the team rather than for end
users. Deeper than the user guide, and it assumes you know the product.

## Working notes

**Open [notes/index.html](notes/index.html) in a browser** — it lists all 18 notes, grouped and
described, and flags which of the overlapping ones is current.

They are filed by subject:

| Folder | What's in it |
|---|---|
| `notes/system-overview.html` | How the whole system fits together. The best page to hand a newcomer. |
| [notes/switch-access/](notes/switch-access/) | What access RackTrack needs from a switch (3 notes) |
| [notes/audits/](notes/audits/) | Worked audits of the bench switch and a two-rack setup (2) |
| [notes/ports-and-cabling/](notes/ports-and-cabling/) | Port reading, cable tracing, traceroute (4) |
| [notes/design/](notes/design/) | Layout, wordmark and font explorations (3) |
| [notes/status-and-demo/](notes/status-and-demo/) | Demo feedback and progress write-ups (3) |
| [notes/delivery/](notes/delivery/) | TestFlight readiness, Cloudflare tunnel (2) |

These are **working notes, not published documentation** — they capture thinking at a moment in
time, and some have been overtaken by later work. Where two cover the same ground, the index
marks the current one.

## Reference

- [reference/RackTrack_UI_Reference.docx](reference/RackTrack_UI_Reference.docx) — UI reference
- [reference/RackTrack_User_Guide_2026-07-09.docx](reference/RackTrack_User_Guide_2026-07-09.docx) —
  the previous user guide (superseded by `user-guide/` above; kept for reference)
