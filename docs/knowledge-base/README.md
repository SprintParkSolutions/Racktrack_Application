# RackTrack Knowledge Base

A complete, plain-English, deeply-detailed documentation set for RackTrack — written to feed the **Ask DOT support bot** and **Confluence**. Every document was re-verified against the live code on **26 July 2026** (not carried over from older docs), so it is current truth, not aspiration.

Each feature doc follows the same shape: *In simple terms → At a glance → How it works → What you see on screen → The logic behind it → Under the hood → Edge cases → Real vs synthetic → Use cases → Common questions*. The **Common questions** section of every doc is written as ready-to-ingest Q&A for the bot's knowledge base.

## Start here

- **[RackTrack — Complete Product Overview](00-RackTrack-Overview.md)** — what the product is, the end-to-end flow, the feature map, roles/tenancy, and the architecture. Read this first.
- **[Getting Started](getting-started.md)** — install (TestFlight / Firebase / web), sign up or use an invite, run your first scan, find your way around.

## The scan pipeline (capture → inventory)

- **[Rack Scanning & Capture](rack-scanning-capture.md)** — upload / camera / video, the live camera coaching + quality gate.
- **[Scan Results & Device Detection](scan-results-device-detection.md)** — the mapped rack, device classes, relabeling, reports.
- **[Ports & Port Locate](ports-and-port-locate.md)** — available ports, port categories, locating a specific port.
- **[Switch Information — Specs, Firmware & SFP Advisor](switch-information.md)** — per-switch identification, vendor specs, firmware check, optics advisor.
- **[Rack Topology (3D)](rack-topology-3d.md)** — the rack elevation and the 3D rack-and-cabling scene.
- **[Multi-Rack Scans (Two Racks)](multi-rack-scans.md)** — capture two racks and the cabling between them.

## The computer vision

- **[The Computer-Vision Pipeline](cv-pipeline.md)** — how a photo becomes an inventory, stage by stage.
- **[Detection Models — the CV Model Catalog](detection-models.md)** — every model, verified from its checkpoint: what it detects and how it's used.

## Live network & verification

- **[Lab — Live Switches](lab-live-switches.md)** — live SSH to real switches in the test lab (read-only), the per-port table.
- **[Network View & Live Discovery](network-view-live-discovery.md)** — the scanned rack vs what's live on the network.
- **[Port History & Drift](port-history-drift.md)** — the change log, what "drift" means, the poller.
- **[Ground Truth](ground-truth.md)** — owner-only, per-scan verification of what the model detected.

## Platform & administration

- **[Organizations, Roles & Access](organizations-roles-access.md)** — the four roles, membership, approvals, how visibility is scoped.
- **[Connections, Data Sources & CMDB Reconciliation](connections-and-cmdb.md)** — connecting asset systems and matching scans to records.
- **[Marketplace](marketplace.md)** — buy / sell / swap surplus gear (admins & owners).
- **[Operations Console & Logs](operations-console-and-logs.md)** — live activity, health, and server logs.
- **[Profile & Scan History](profile-and-scan-history.md)** — your account and your past scans.

## Support

- **[Ask DOT — the Support Assistant](ask-dot-support-assistant.md)** — how the bot answers (grounded, no hallucination), its guards, and the Contact → support escalation. *(This doc describes the bot itself.)*

## Reference & FAQ

*Dense, atomic answers written specifically to feed the support bot's knowledge base.*

- **[Accounts, Sign-in & Sessions](accounts-signin-sessions.md)** — sign up, invite codes, sign in, forgot password, the 30-day session, and **how to sign out** (mobile & desktop).
- **[Device Classes & Labels](device-classes-and-labels.md)** — the **12 model classes** (verified from the checkpoint), the OCR-derived extra types, labels and positions.
- **[Reports, Sharing & Export](reports-sharing-export.md)** — what a report contains, sharing to Teams/Outlook/Slack, and the CSV / PDF / JSON / HTML export formats.
- **[Feedback & Corrections](feedback-and-corrections.md)** — correcting a device type, port type, or port count — and why it never touches your hardware.
- **[Troubleshooting & Common Messages](troubleshooting.md)** — every on-screen error/message, why it happens, and what to do.
- **[Glossary & Terminology](glossary.md)** — plain definitions for every term (U, RJ45, SFP, LLDP, drift, CMDB, ground truth…).
