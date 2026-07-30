# RackTrack — Complete Product Overview

*Take one photo of a server rack and get back a documented, verified inventory — every device, every port, checked against your records and ready to share.*

Overview · All audiences · Last verified: 26 July 2026 against the live code.

---

## On this page

1. What RackTrack is
2. Who uses it & the roles
3. The big picture — how a scan flows end to end
4. The feature map
5. The technology
6. The CV model & how detection works
7. Live network monitoring
8. Security & access
9. Architecture & data flow
10. Glossary
11. Common questions

---

## 1. What RackTrack is

RackTrack is a tool for documenting data-center server racks from photographs. Instead of a technician standing in front of a rack and writing down, by hand, what is in each shelf, RackTrack lets them take a single photo with a phone or tablet. It then reads that photo with trained computer-vision models, works out what equipment is in the rack — every switch, patch panel, PDU, firewall, server and so on — counts and locates the ports on each device, reads the make and model off the faceplate where the label is legible, and lays all of that back over the original photo so the person can see exactly what was found. The end product is a clean, structured inventory that can be turned into a shareable report.

The problem it solves is a familiar one in any large facility: the written record of what is *supposed* to be in a rack drifts away from what is *actually* there. Cables get moved, devices get swapped, and the spreadsheet or configuration database slowly stops matching reality. RackTrack closes that gap. It captures ground reality from a photo, and — for customers who connect their existing records database — compares what it saw against what the records claim, flagging the differences so the records can be corrected. For customers who give it permission to reach a live switch, it can go one step further and check what is really plugged in right now, and watch over time for ports that change.

RackTrack is a single product that ships in two forms from one codebase. There is a mobile app for iPhone, iPad and Android — the natural choice for someone walking the floor with a camera — and a web version that runs in any browser on a laptop or desktop, which is better suited to reviewing results, running reports, and administration. The words and the features are the same across all of them; only the layout adapts to the size of the screen. On a phone the app is a tall, single-column experience with a bottom navigation bar; on a tablet or desktop it becomes a full landscape layout with a sidebar.

The product is deliberately careful about certainty. It only tells you it is sure of something when it genuinely is. When a photo is too tilted or too dark to read, it says so and asks for a retake rather than guessing. When it cannot tell whether a port has a cable in it, it reports the port as "unknown" instead of inventing a connected-or-empty answer. When the built-in help assistant is asked a question it cannot ground in verified documentation, it declines and points the user to a human. This honesty is a design principle woven through the whole system, not a slogan — you will see it reflected in the detection logic, the access rules and the support bot described later in this document.

## 2. Who uses it & the roles

The people who use RackTrack are, in the main, data-center and network technicians, the managers who run their sites, and the administrators who oversee the whole organization. A field technician uses it to scan racks and act on the results. A manager uses it to review those scans and keep an organization's records honest. An administrator sets up the connections to other systems, manages who has access, and handles the commercial side such as the equipment marketplace. Above all of them sits the platform operator — the RackTrack team itself — who keeps the service running.

Underneath, the software recognises four roles, defined in the authentication layer, and every screen and every server request is gated against them:

- **Owner** is the platform superadmin — the RackTrack operator. An owner can see every rack, every organization and every scan across the whole platform, and is the only role that can reach the deepest administrative surfaces: the Operations Console, the Ground Truth verification tool, and the live-switch Lab. Owners sit above all organizations and are never blocked by an organization's approval status.
- **Organization admin** (`org_admin`) manages one organization. This role oversees all the sites within that organization, invites and manages members, configures the connected data sources, and runs the marketplace. When a new company signs itself up, the person who registered becomes that organization's admin.
- **Site manager** (`site_manager`) manages a single site — adding and editing that site's members and running scans within it.
- **Member** is the default role: a regular user who scans racks and works with the results for their own site.

Access always follows the hierarchy Owner → Organization → Site → Users, and it always fails safe. A regular member sees only the racks belonging to their own site. An organization admin sees every rack across every site in their organization. An owner sees everything. Nothing ever crosses between one customer and another. The two most sensitive tools deserve a special note: the **Ground Truth** verification screen and the **Lab** are owner-only today, enforced both in the app's routing and, more importantly, on the server. In the codebase you will see the roles referred to by their internal names — `owner`, `org_admin`, `site_manager`, `member` — and the client's admin-level screens treat `org_admin` and `owner` together as "admin".

## 3. The big picture — how a scan flows end to end

Here is the journey of a single photo, from the moment it is taken to the moment a report is shared. Every step below happens in the current product; where the old documentation described the flow differently, this is the corrected version.

**You must be signed in first.** Scanning is no longer anonymous. The upload endpoint requires a valid login, and so does every correction you later make. If you are not signed in, the app sends you to the login screen and remembers where you were trying to go.

1. **Capture and send.** On the Scan screen you take a live photo, choose an existing picture, or upload a short video. The image is sent to RackTrack's service.
2. **Quality gate.** Before spending effort on detection, the service checks the photo is usable — not too tilted, not letter-boxed, not shot from a steep side angle, and not so occluded by cabling that the equipment is hidden. A bad photo is either hard-failed with an explanation or flagged with a soft warning you can choose to proceed past. The measured quality is stored alongside the scan.
3. **Detect.** The computer-vision pipeline finds every device in the rack and works out its type, builds a grid of rack units (the 1U slots), assigns each device to the units it occupies, then detects and classifies the ports on the devices that have them. Power outlets on PDUs are detected by their own model. Just afterwards, optical character recognition tries to read each device's make and model from its faceplate.
4. **Identity and caching.** The service computes a content-based identity for the rack — a short `RK-…` code derived from the image itself (plus the owner's scope). Because the same photo always produces the same code, re-uploading an image you have already scanned is a fast cache hit rather than a fresh analysis.
5. **Show and correct.** You land on the results, where the app draws labelled boxes over your photo. From the Overview you can move through the rack's other views — Ports, Topology, Network, Switches and Drift — and, if you are an owner, into Ground Truth for that scan. When something is wrong, a correction (a device that was mis-typed, a port count that is off, a cable colour) is saved. Corrections require login, are appended to that scan's record, and feed the learning memory so future scans of similar-looking gear can apply the fix automatically.
6. **Report and share.** The scan can be turned into a report — viewed in the app, downloaded as a PDF, or sent straight to Slack, Teams or Outlook. Shared links carry a short-lived, read-only token so the recipient can open the report images without a login.

Alongside the single-rack path there is a **two-rack flow**. From "Scan two racks" (also called the Two-rack scan) you pick two images, or a single video that pans across both racks; the service splits the video into the best frame of each rack, detects both, and then produces a combined view — including the uplinks that cross between the two racks — with a 3D combined topology you can open. Each rack in a group still exists as an ordinary rack with all its normal views; the group is simply the parent record that ties them together, and a strip of rack tabs lets you move between the members.

## 4. The feature map

RackTrack is large, so this overview stays at altitude and each feature has its own detailed document. The table below is the map. Paths are relative to this file (`docs/knowledge-base/`), so they point up into the shared documentation set.

| Feature | What it is | For everyone | For engineers |
|---|---|---|---|
| Rack scanning & capture | Taking the photo/video and the quality gate | [users](../features/rack-scanning-capture-users.md) | [developers](../features/rack-scanning-capture-developers.md) |
| Scan results & device detection | The Overview and how detection is shown/corrected | [users](../features/scan-results-device-detection-users.md) | [developers](../features/scan-results-device-detection-developers.md) |
| Ground Truth (owner) | Per-scan human verification of what the model saw | [users](../features/ground-truth-users.md) | [developers](../features/ground-truth-developers.md) |
| Multi-rack (two-rack) scans | Two racks at once + the cabling between them | [users](../features/multi-rack-scans-users.md) | [developers](../features/multi-rack-scans-developers.md) |
| Available ports | Finding and reading a device's free ports | [users](../features/available-ports-users.md) | [developers](../features/available-ports-developers.md) |
| Network view / live discovery | Matching a rack to what the network can see | [users](../features/network-view-live-discovery-users.md) | [developers](../features/network-view-live-discovery-developers.md) |
| Port history & drift | Watching a live switch's ports change over time | [users](../features/port-history-drift-users.md) | [developers](../features/port-history-drift-developers.md) |
| Rack topology (3D) | The 3D rack-and-cabling view | [users](../features/rack-topology-users.md) | [developers](../features/rack-topology-developers.md) |
| Switch information | The CMDB-driven switch list | [users](../features/switch-information-users.md) | [developers](../features/switch-information-developers.md) |
| Firmware check | Checking a switch's firmware version | [users](../features/firmware-check-users.md) | [developers](../features/firmware-check-developers.md) |
| Connections / Data Sources | Connecting ServiceNow, NetBox and others | [users](../features/connections-integrations-users.md) | [developers](../features/connections-integrations-developers.md) |
| CMDB registration & reconciliation | Comparing scans to the records database | [users](../features/cmdb-registration-reconciliation-users.md) | [developers](../features/cmdb-registration-reconciliation-developers.md) |
| Accounts & onboarding | Signing up, verifying, joining a site | [users](../features/accounts-onboarding-users.md) | — |
| Organization administration | Managing organizations, sites and members | [users](../features/organization-administration-users.md) | — |
| Profile & scan history | Your account and your past scans | [users](../features/profile-scan-history-users.md) | — |
| Specifications lookup | Vendor & model reference lookup | [users](../features/specifications-lookup-users.md) | — |
| SFP procurement advisor | Guidance on the right SFP transceiver | [users](../features/sfp-procurement-advisor-users.md) | — |
| Marketplace | Buying and selling surplus hardware | [users](../features/marketplace-users.md) | — |
| Architecture (whole system) | How the parts fit together | [users](../architecture/overview-users.md) | [developers](../architecture/overview-developers.md) |
| UI & design system | The look, layout and components | [users](../reference/ui-reference-users.md) | [developers](../reference/ui-reference-developers.md) |

Two features do not have their own page in the set above and are described in this overview instead: the **Ask DOT** support assistant with its Contact/escalation path (Section 11 and below), and the owner-only **Operations Console** and **Lab** (Sections 7 and 8).

## 5. The technology

RackTrack is built from three cooperating parts, plus the native mobile shell. A user only ever touches the first one; the rest do their work out of sight.

**The client — one React app, two shapes.** The user-facing app is a single React 18 application built with Vite, using React Router for navigation. That same codebase ships as a web page you open in a browser *and* as native iOS and Android apps, wrapped with Capacitor (app id `com.racktrack.app`). The native wrapper gives the app a real camera, handles the Android hardware back button so it walks the app's own history instead of closing, and reclaims an in-flight scan if the app is suspended and resumed mid-analysis. The native build also announces itself with a custom `RackTrack/1.0 (native app)` user-agent so the server can recognise it. The interface deliberately uses a single light theme — flat white surfaces, one clean look on every screen — and there is no dark mode by design. On screens 1024 pixels wide and up the whole app renders inside a desktop "shell" (a persistent left sidebar, one shared top bar, and a full-width canvas); below that width it renders as the phone layout with a bottom navigation bar. The list of navigation destinations lives in one place and is read by both the sidebar and the phone's bar, so a destination is either reachable everywhere or nowhere — they can no longer drift apart.

**The server — a Node/Express service.** Behind the app sits a single Node.js service built on Express. It is the product's brain: it authenticates users, receives uploaded photos, drives the vision pipeline, stores results, reconciles against records databases, renders reports, and serves the images back. It keeps identity and records in SQLite and stores each scan's files on disk. It uses `bcrypt` for password hashing and signed JSON Web Tokens for sessions, `helmet` and a strict cross-origin allow-list for HTTP hardening, `multer` for uploads, `puppeteer` to turn report HTML into PDFs, `sharp` for image work, `ssh2` to talk to live switches, and `stripe` for marketplace payments. It produces structured logs (via `pino`) and Prometheus-style metrics, and mirrors its logs into a queryable database. The default listening port is 3001.

**The pipeline — Python computer vision.** The actual "seeing" is done by a set of Python models built on PyTorch and Ultralytics YOLO, with EasyOCR for reading faceplate text and OpenCV for image handling. Rather than launch Python afresh for every photo — which would pay the model-loading cost every time — the server keeps a persistent pool of Python workers running with the models resident in memory, and talks to them by sending newline-delimited JSON messages back and forth. Requests name a command (`quality_check`, `detect_only`, `analyze`, `select`, video splitting, ticket extraction, and more) and the worker replies with the result. This is what "the eye that reads the photo" is, in practice.

**Where things are stored.** Two stores are used on purpose. Identity and relational records — users, organizations, sites, rack ownership, monitored switches, marketplace listings and so on — live in a SQLite database (`auth.db`), with operational logs in a second one (`logs.db`). Everything a scan produces — the master detection map, the API-facing result, the OCR text, the rendered images, the report files, the corrections log — lives on disk in a per-rack folder named after the rack's `RK-…` id. Because that id is a hash of the image, two customers who happen to scan the very same picture share the same folder, and the database's record of *who owns which rack* is what keeps one from seeing the other's view of it.

## 6. The CV model & how detection works

The heart of RackTrack is a computer-vision pipeline that turns a flat photograph into a structured, position-aware inventory. It runs as an ordered sequence of stages, each handing its output to the next.

**Finding the rack, then the devices.** The pipeline first tries to find the rack itself within the photo using line-detection, falling back to the whole image if it cannot. It then runs the device-detection model on that region. The active device model is `Models/devices_seg.pt`, a YOLOv8m instance-segmentation model, and the pipeline is configured to run in "seg" mode (a single-model path) — this is the current setup, replacing an older two-model "dual" arrangement that some documentation still describes. The model recognises **twelve classes**, exactly:

> Closed Unit · Empty · Firewall · Gateway · Load Balancer · PDU · Patch Panel · Router · Server · Storage unit · Switch · UPS

(One older code comment lists "PSU" as the twelfth class; the model's own class table has been checked and the twelfth class is **Load Balancer**, not PSU.) Each detected device comes back with its class, a confidence score, and a bounding box. Overlapping duplicates are removed, the boxes are cleaned up so devices in the same rack line up to a uniform width and sit edge-to-edge (real blank gaps are preserved), and the stack is validated.

**Building the unit grid and placing devices.** Real racks are measured in units (U), the 1U slots stacked top to bottom. The pipeline derives the true height of one unit from the median height of the detected switches (or patch panels), then builds a strict, contiguous grid of equal-height rows anchored to the real equipment — so that a mis-detected rail at the very top or bottom cannot drag the grid into the ceiling or floor. Each device is then assigned the units it occupies, based on its height relative to one unit. Rows that no real device claims are filled with an "Unidentified" placeholder rather than being called "Empty" — because a rack row almost always contains *something*, and asserting "Empty" without visual proof would be a false certainty. This is the same reasoning that later makes the Ground Truth tool drop the model's own "Empty" and "Closed Unit" slot rows while deliberately keeping "Unidentified" rows, since an unlabelled device is exactly what verification exists to fix.

**Reading the ports.** Only the classes that actually have ports on their visible face — Switch, Patch Panel, Firewall, Gateway and Router — are run through port detection; servers, storage chassis, PDUs and the like are skipped so the model does not hallucinate ports where there are none. Ports are found and typed by one model (`ports_9.pt`, which distinguishes RJ45, SFP, console and other types) and their occupancy is judged by a second (`port_count.pt`). PDUs are handled specially: their power outlets are found by a dedicated model and counted as connected or empty, which also tells RackTrack whether the rack is actually receiving power. If port detection finds no ports at all on a device the model thought was port-bearing, that device is demoted to "Unidentified" — the class was almost certainly wrong — and a detection that *crashed* is marked distinctly so it is never confused with a device that genuinely has no ports.

**Cables, occupancy honesty, and faceplate text.** When a port is occupied, a separate EfficientNet cable classifier can identify the cable — but this deserves a careful note, because it is a place where the product refuses to guess. That classifier has fourteen outputs and every one of them is a cable *colour*; it has no "no-cable" class. Its confidence therefore only ever answers "which colour", never "is there a cable at all", so it must not be used to decide whether a port is occupied. Occupancy comes only from the status model's sweep: a port the sweep tagged is reported as connected or empty, and a port it could not tag is reported honestly as **unknown**, with the source of that verdict recorded. Separately, once the make and model can be read off a device's faceplate by OCR, RackTrack can cross-check the visually counted ports against the known port count for that model and trust the catalogue figure when the visual count falls well short.

**Learning from corrections.** Every correction a technician makes — a device re-typed, a cable colour fixed, a port type tagged, a port count confirmed — is stored in a per-organization learning memory, keyed to the exact image crop it refers to. On later scans, freshly detected items are matched against that memory (first by a fast perceptual hash, then by a more robust deep-feature similarity), and on a confident match the earlier human correction is re-applied automatically. A user-confirmed port layout can even be served back directly instead of re-running the model, and a re-shot rack that closely matches a previously confirmed one can be recognised without re-detecting it. This is how RackTrack gets better at recognising a specific customer's equipment over time.

## 7. Live network monitoring

Everything above works from a photograph. RackTrack can also, with permission, look at the live network — and this is strictly opt-in: it never quietly connects to a customer's equipment in the background.

**Live discovery (the Network view).** For a scanned rack, the Network tab lines the physical devices up against what the network can actually see on the wire — LLDP neighbours and learned MAC addresses — through a discovery back-end (netdisco). This is how a physical box in a photo gets matched to its live network identity.

**The Switches tab and switch information.** The Switches view is driven by the records database (CMDB): it lists the switches associated with a rack and their details, and is where switch-level information such as firmware is surfaced.

**Port polling and drift.** For switches a customer chooses to monitor, RackTrack can connect over SSH on a schedule and read the real state of each port. It records that state over time, so that when a port changes — something plugged in, something unplugged — the change is captured as **drift**. Drift is surfaced as a view on the rack (reached from the rack's navigation), letting a technician see what has actually changed on a live switch since the last reading, rather than only what a photo froze in a moment. Vendor-specific parsers (for Cisco and TP-Link, among others) translate each switch's console output into a common shape, and the switches that are polled are stored as owner-managed monitored devices with their credentials encrypted at rest.

**The Lab.** There is an owner-only Lab that administers live switches in a test environment (an EVE-NG lab) — the safe place where the live-switch path is exercised. Like Ground Truth, the Lab is gated to owners both in the app and, decisively, on the server; a non-owner who reaches the page sees a plain refusal rather than a blank screen.

## 8. Security & access

RackTrack handles multiple customers' infrastructure data, so isolation and access control are foundational rather than an afterthought.

**Signing in.** Accounts are protected with bcrypt-hashed passwords, and a successful login returns a signed JSON Web Token that the app sends on every subsequent request; the token carries the user's identity, their site and organization, and their role, and it is valid for 30 days. The signing secret is generated once and kept on the server. Because an `<img>` tag cannot send an authorization header, the app also mints a separate short-lived **asset token** so rack images can be fetched securely, and report links carry their own short-lived, read-only token so a shared report opens without a login while still expiring quickly.

**Signing up and approval.** Public self-signup is restricted to Gmail addresses and is treated as a *request*, not an instant account. A new signup verifies a six-digit code sent by email (which is never returned in the API response or written to the logs), and on success provisions a whole Organization with a default "Main Site", making the person who registered that organization's admin. Crucially, the new organization starts in a **pending** state and cannot add members or run scans until the platform owner approves it. This org-status gate is enforced centrally on the server — an earlier version enforced it only in the app's routing, which a direct API call could bypass — so a token from an unapproved account is rejected on essentially every endpoint until approval lands. Owner-created organizations are active immediately.

**The four roles, again, as controls.** `owner` sees and manages everything and is never org-gated. `org_admin` manages one organization; `site_manager` manages one site; `member` is a regular user. Role checks run on the server (not just in the UI), and the sensitive tools — Operations Console, Ground Truth, Lab — are owner-gated at the API level.

**Tenancy and rack access.** The data model is Owner → Organization → Site → Users, where a "Site" is a tenant row. Racks are owned at the site level through a many-to-many ownership table, which is what lets two tenants scan the same image (and thus share the same `RK-…` folder on disk) without either seeing the other's ownership of it. A single access rule decides who may open a given rack: an owner may open any rack; an org admin may open any rack held by a site in their organization; everyone else may open only their own site's racks — and it **fails closed**, meaning if there is any doubt, access is denied. The rule is applied not just on the main app but on every sub-section of the API, after an audit once found one section unguarded.

**Not leaking existence.** The service that hands back rack images normalises the requested path (guarding against tricks like repeated URL-encoding or `..` escapes), serves only image files, and — when access is denied — returns a 404 "not found" rather than a 403 "forbidden". A 403 would quietly confirm that a rack with that id exists, which across tenants is itself a leak; a 404 gives nothing away. Sensitive actions are recorded in an append-only audit log, and secrets are stripped from the logs.

## 9. Architecture & data flow

Putting the pieces together, the shape of the system is: a React client (web and native) talks over HTTPS to a Node/Express server; the server drives a pool of resident Python vision workers; identity lives in SQLite and scan artifacts live on the filesystem; and a ring of optional, fail-soft integrations sit around the edge.

```
        ┌─────────────────────────────────────────────┐
        │  CLIENT  (client/)                            │
        │  React 18 + Vite SPA · Capacitor iOS/Android  │
        │  camera → POST /api/analyze → /results/:rackId │
        └───────────────┬───────────────────────────────┘
                        │  HTTPS
                        │  (Bearer JWT · asset token · report token)
                        ▼
        ┌─────────────────────────────────────────────┐
        │  SERVER  (Node / Express)                     │
        │  auth · scan/analyze · feedback · report ·    │
        │  ground-truth · sub-routers (netdisco, cmdb,  │
        │  ports/drift, support, lab, connections,      │
        │  marketplace)                                 │
        └───┬───────────────┬───────────────┬───────────┘
            │               │               │
   newline-JSON        SQLite          filesystem
   over stdin/out    (better-sqlite3)   outputs/<rackId>/
            │               │               │
            ▼               ▼               ▼
    ┌───────────────┐  ┌──────────┐  ┌──────────────────┐
    │ PYTHON POOL   │  │ auth.db  │  │ device_unit_map  │
    │ (pipeline/)   │  │ logs.db  │  │ scan_result.json │
    │ YOLO seg ·    │  └──────────┘  │ ocr_devices.json │
    │ ports · OCR · │                │ feedback.jsonl   │
    │ active learn  │                │ images/*.png     │
    └───────────────┘                └──────────────────┘

  External (all optional & fail-soft):
  ServiceNow CMDB · NetBox/DCIM · netdisco discovery ·
  live switches over SSH (poller + Lab) · Ask DOT (OpenRouter/
  Nemotron → Ollama → verbatim KB) · Marketplace (Stripe)
```

The data flow for one scan, traced through those boxes: the client posts the photo to the analyze endpoint (which requires a logged-in user); the server saves the image, runs the quality gate in a Python worker, then runs detection, unit-gridding, port and PDU detection, and OCR; it computes the rack's content-based id and, if that id has been seen, returns the cached result immediately; it writes the master detection map and a canonical result file, overlaying any prior user corrections; the client draws the boxes and lets the user correct anything, with each correction appended to that scan's record and fed into the learning memory; and finally the scan can be rendered to a self-contained HTML/PDF/CSV/JSON report and shared behind a short-lived report token.

The integrations around the edge are all optional and degrade gracefully. If a records database, a discovery back-end, a payment provider or the support bot's language-model back-ends are absent or unreachable, the relevant feature simply turns itself off or returns a "not available" response — the core product keeps working. This "fail-soft" behaviour is deliberate and consistent across the system.

## 10. Glossary

| Term | What it means |
|---|---|
| **Scan** | One photo (or video frame) of a rack and everything RackTrack worked out from it. |
| **Rack id / scan id** | The `RK-…` code identifying a scan. It is a content hash of the image plus the owner's scope, so the same photo always yields the same id and a re-upload is a cache hit. |
| **Unit (U)** | One slot in a rack. A device fills one or more units. |
| **Device** | A piece of rack equipment — a switch, patch panel, PDU, firewall, server and so on — one of the twelve classes the model recognises. |
| **Empty / Closed Unit** | Rack-slot placeholders the model emits for blank or covered slots; they are not real equipment, and Ground Truth drops them from its device list. |
| **Unidentified** | A rack row with a device the model could not confidently classify. Kept (not dropped) because it is exactly what verification exists to correct. |
| **Ports** | The connectors on a device. Typed (RJ45, SFP, console, other) and judged connected / empty / unknown. |
| **Occupancy** | Whether a port has a cable. Comes only from the status sweep; when unmeasured it is honestly "unknown", never guessed from cable colour. |
| **Ground truth** | A human-verified device label, recorded per scan by an owner, used to measure and improve the model. |
| **Drift** | A change in a live switch's port state over time, captured by the scheduled SSH poller. |
| **CMDB** | The customer's configuration/records database (e.g. ServiceNow) that scans are reconciled against. |
| **Active learning** | The per-organization memory of user corrections that lets future scans auto-apply earlier fixes. |
| **Site** | The level at which racks are owned; internally a tenant row. |
| **Organization** | A group of sites; the level at which learning memory is shared. |
| **Owner** | The platform superadmin (the RackTrack operator) who can see across the whole platform. |
| **Ask DOT** | The in-app support assistant that answers from verified documentation and hands off to a human when unsure. |

## 11. Common questions

**Do I need to be logged in to scan a rack?**
Yes. Scanning is no longer anonymous — the upload requires a valid login, and so does saving any correction afterwards. If you are signed out, the app sends you to the login screen and returns you to where you were once you are in.

**I signed my company up and I cannot scan or add anyone. Why?**
A self-signup creates an organization in a *pending* state. It cannot add members or run scans until the platform owner approves it. You will wait on an approval screen that advances automatically the moment approval lands. (Organizations that the platform owner creates directly are active straight away.)

**Why does it only let me sign up with a Gmail address?**
Public self-signup is deliberately limited to `@gmail.com` addresses. Existing staff and owner accounts, invites and password resets are not subject to that rule — it applies only to the public signup path.

**What kinds of equipment can RackTrack recognise?**
The device model recognises twelve classes: Closed Unit, Empty, Firewall, Gateway, Load Balancer, PDU, Patch Panel, Router, Server, Storage unit, Switch and UPS. "Closed Unit" and "Empty" are slot placeholders rather than equipment.

**What does it mean when a port says "unknown"?**
It means RackTrack could not measure whether that port has a cable. Occupancy comes only from the status sweep; when the sweep cannot tag a port, RackTrack reports "unknown" rather than guessing. It specifically does *not* use the cable-colour classifier to decide occupancy, because that model only identifies a colour and has no way to say whether a cable is present at all.

**If two people scan the exact same photo, do they see each other's data?**
No. The same image produces the same `RK-…` id and shares one folder on disk, but ownership is recorded per site, and the access rule (owner → all; org admin → their org's racks; everyone else → their own site's racks, failing closed) is what governs who can open it. Neither tenant can see the other's ownership or view of it.

**Who can use Ground Truth?**
Ground Truth is owner-only for now, enforced on the server. It is per-scan — you reach it from a specific rack's results after analysis — and it lists only the real devices in that scan, dropping the "Empty" and "Closed Unit" slot rows while keeping "Unidentified" rows (those are what most need labelling).

**Can I scan two racks at once?**
Yes — use "Scan two racks". Pick two images, or a single video that pans across both; RackTrack picks the best frame of each rack, detects both, and produces a combined view including the cabling that crosses between them, with a 3D combined topology. Each rack still exists on its own with all its normal views, and a rack-tabs strip lets you move between the members of the group.

**Does RackTrack connect to my live switches?**
Only when you ask it to. Live-switch access is opt-in: for switches you choose to monitor, it connects over SSH on a schedule to read real port state and record drift over time. It never reaches into your equipment in the background.

**What is the difference between the Network tab and the Switches tab?**
The Network tab matches the physical devices in a scan to what the live network can actually see (LLDP neighbours and learned MACs) through the discovery back-end. The Switches tab is driven by your records database (CMDB) and lists the switches associated with the rack, with details such as firmware.

**Is there a dark mode?**
No. RackTrack uses a single light theme by design — flat white surfaces and one consistent look across every screen.

**What is "Ask DOT" and can it make things up?**
Ask DOT is the built-in support assistant. It answers only from RackTrack's own verified knowledge base. When search is confident it returns the verified answer word-for-word (nothing is generated, so nothing can be invented). When a question is relevant but needs phrasing, it can use a language model to compose a grounded answer — preferring a hosted model (OpenRouter, defaulting to NVIDIA's Nemotron on the free tier) when configured, falling back to a local model (Ollama), and, with neither available, degrading to the verbatim knowledge-base answers. When nothing relevant matches, it refuses and points you to a human rather than guessing.

**How do I reach a real person?**
Use the Contact screen (also where Ask DOT's "reach a person" hand-off leads). It emails the RackTrack support team; support can reply to you directly.

**What happens if one of the connected systems is down?**
The product keeps working. Every external integration — the records database, live discovery, the payment provider for the marketplace, the support bot's language-model back-ends — is optional and fail-soft: if it is missing or unreachable, that one feature turns off or returns a clear "not available", and the rest of RackTrack is unaffected.

**Which should I use — the app or the browser?**
Both come from the same product and have the same features. The mobile app (iPhone, iPad, Android) is best for a technician standing in front of a rack with a camera; the browser version on a laptop or desktop is better for reviewing results, running reports and administration. The layout adapts to the screen — a sidebar on wide screens, a bottom bar on a phone — but the words and features are identical.

---

— RackTrack — Complete Product Overview —
