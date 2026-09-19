# RackTrack documentation

Every document in the project lives in this folder, including a copy of every page
published as a claude.ai artifact. Nothing documentary lives anywhere else in the repo
(the `README.md` files beside code describe that code and stay where they are).

Reorganised on 9 September 2026. Folder names say what is inside; file names say what the
document is. Artifact copies carry their claude.ai link in an HTML comment on line 1.

## The folders

| Folder | What is in it |
|---|---|
| [architecture/](architecture/) | How RackTrack works, for everyone and for engineers |
| [features/](features/) | One document per feature, user and developer tracks, plus the older `.docx` versions |
| [knowledge-base/](knowledge-base/) | The plain-English knowledge base that feeds the Ask DOT support bot and Confluence |
| [user-guide/](user-guide/) | The end-user guides (iPhone and iPad editions), the illustrated guide, onboarding |
| [screenshots/](screenshots/) | The 60 app screenshots used by the guides, iPhone and iPad |
| [demo/](demo/) | Demo scripts, the feature book for marketing, demo screenshots |
| [design/](design/) | Design write-ups: the rack binding standard, rack-versus-network cases, the SNMP ask, the chain UI plan |
| [netbox/](netbox/) | Everything NetBox: export schema, object reference, workflows, the plan, the customer evaluation pages |
| [servicenow/](servicenow/) | The ServiceNow bridge build plan and the CMDB seed data |
| [support-bot/](support-bot/) | The Ask DOT support assistant, and the help-bot feedback form |
| [setup/](setup/) | Setting the product up: demo VPS, private deployment, iOS build, social login, deploy notes |
| [cloud-migration/](cloud-migration/) | The August 2026 cloud study: briefs, proposals, AWS versus Azure, the rehearsal |
| [audits/](audits/) | Code audits, the website audit, the server capability assessment, the audit catalogue |
| [status-reports/](status-reports/) | Progress and status write-ups, build changelogs, sprint updates, tester feedback |
| [task-reports/](task-reports/) | One document per Jira ticket for the September 2026 work, and the build notes |
| [pitch-and-collateral/](pitch-and-collateral/) | The enterprise pitch, meeting scripts, the presentation pack, certifications |
| [notes/](notes/) | Working notes by subject, with their own [index page](notes/index.html) |
| [reference/](reference/) | The UI reference, engineering handoffs, the style note, superseded guides |

---

## Architecture and features — two tracks

The architecture and feature documents come in two parallel versions so each reader gets the right depth:

- **User track** (`*-users.md`), plain English for users and stakeholders. No file paths, no endpoints, no code.
- **Developer track** (`*-developers.md`), the same material for engineers, with verified file paths, endpoints, modules and versions.

Every feature has a user version; the more technical features also have a developer version. These Markdown
documents are the source of truth and supersede the older per-feature `.docx` files in `features/`, which are kept for reference.

| Topic | For everyone | For engineers |
|---|---|---|
| How RackTrack works | [overview-users](architecture/overview-users.md) | [overview-developers](architecture/overview-developers.md) |
| Rack scanning and capture | [users](features/rack-scanning-capture-users.md) | [developers](features/rack-scanning-capture-developers.md) |
| Scan results and device detection | [users](features/scan-results-device-detection-users.md) | [developers](features/scan-results-device-detection-developers.md) |
| Ground Truth (owner) | [users](features/ground-truth-users.md) | [developers](features/ground-truth-developers.md) |
| Multi-rack scans | [users](features/multi-rack-scans-users.md) | [developers](features/multi-rack-scans-developers.md) |
| Available ports | [users](features/available-ports-users.md) | [developers](features/available-ports-developers.md) |
| Network view and live discovery | [users](features/network-view-live-discovery-users.md) | [developers](features/network-view-live-discovery-developers.md) |
| Port history and drift | [users](features/port-history-drift-users.md) | [developers](features/port-history-drift-developers.md) |
| Rack topology (3D) | [users](features/rack-topology-users.md) | [developers](features/rack-topology-developers.md) |
| Switch information | [users](features/switch-information-users.md) | [developers](features/switch-information-developers.md) |
| Firmware check | [users](features/firmware-check-users.md) | [developers](features/firmware-check-developers.md) |
| Connections and data sources | [users](features/connections-integrations-users.md) | [developers](features/connections-integrations-developers.md) |
| CMDB registration and reconciliation | [users](features/cmdb-registration-reconciliation-users.md) | [developers](features/cmdb-registration-reconciliation-developers.md) |
| Accounts and onboarding | [users](features/accounts-onboarding-users.md) | |
| Organization administration | [users](features/organization-administration-users.md) | |
| Profile and scan history | [users](features/profile-scan-history-users.md) | |
| Specifications lookup | [users](features/specifications-lookup-users.md) | |
| SFP procurement advisor | [users](features/sfp-procurement-advisor-users.md) | |
| Marketplace | [users](features/marketplace-users.md), [feature report](features/marketplace-feature-report.md) | |
| UI and design system | [ui-reference-users](reference/ui-reference-users.md) | [ui-reference-developers](reference/ui-reference-developers.md) |

The [knowledge base](knowledge-base/README.md) covers the same ground as one continuous set of
plain-English documents, written to be ingested by the support bot.

## User guides

Two editions of the user guide, one per device. The words are identical; only the screenshots differ.

- [RackTrack-User-Guide-iPhone.html](user-guide/RackTrack-User-Guide-iPhone.html), screenshots taken on a phone. Send this to a technician in the field.
- [RackTrack-User-Guide-iPad.html](user-guide/RackTrack-User-Guide-iPad.html), screenshots taken on an iPad held sideways. Send this to someone at a desk; it shows the sidebar layout a laptop shows too.

Both are self-contained (screenshots and font embedded), so they can be emailed or dropped on a share as they are,
and they print cleanly with one task per page. Each is built around 31 tasks, not screens: "Find a specific port",
"Find out what changed, and when", "Scan a rack too tall for one photo". Reference material (troubleshooting by
symptom, glossary, limits) is at the back. The same text as Markdown: [iPhone](user-guide/RackTrack-User-Guide-iPhone.md),
[iPad](user-guide/RackTrack-User-Guide-iPad.md), [device-neutral source](user-guide/RackTrack-User-Guide.md);
as Word: [iPhone](user-guide/RackTrack-User-Guide-iPhone.docx), [iPad](user-guide/RackTrack-User-Guide-iPad.docx).

| Document | What it is |
|---|---|
| [RackTrack-Illustrated-Guide.html](user-guide/RackTrack-Illustrated-Guide.html) | What RackTrack does, in the order you meet it, with pictures |
| [getting-into-racktrack-onboarding.html](user-guide/getting-into-racktrack-onboarding.html) | The two ways in (invitation link, or a company account), the rules that trip people up, roles, error messages. [Artifact](https://claude.ai/code/artifact/481a6112-dc47-4a6a-952d-fe2dc22a1e21) |
| [RackTrack-Onboarding-Guide.docx](user-guide/RackTrack-Onboarding-Guide.docx) | The onboarding guide as Word, built by [build-onboarding-docx.py](user-guide/build-onboarding-docx.py) |

Screenshots: [screenshots/iPhone/](screenshots/iPhone/) (390×844) and [screenshots/iPad/](screenshots/iPad/) (1194×834, landscape).
Filenames match one-to-one across the two folders. All captured from the running application against real scan data.

## Demo

| Document | What it is |
|---|---|
| [office-rack-demo-script-8-minutes.md](demo/office-rack-demo-script-8-minutes.md) | The current demo: six steps on the office rack, about eight minutes, with where each fact comes from. Also as a page: [office-rack-demo-script-8-minutes.html](demo/office-rack-demo-script-8-minutes.html), [Artifact](https://claude.ai/code/artifact/8a5dfb28-f2c4-4293-be38-56897919500d) |
| [demo-screenshots/](demo/demo-screenshots/) | The twelve screens the demo walks through, in order |
| [feature-book-for-marketing.html](demo/feature-book-for-marketing.html) | Every feature in plain English with its screenshot, why a client cares, and the shot worth filming. Written for the marketing team |
| [client-demo-script-40-minutes.md](demo/client-demo-script-40-minutes.md) | The long-form client demo: 40 minutes plus Q&A, with a 20-minute cut in an appendix. An [alternative draft](demo/client-demo-script-40-minutes-alt-draft.md) is kept alongside |
| [client-demo-script-v2.docx](demo/client-demo-script-v2.docx) | The July demo script as Word (v2 is current; [v1](demo/client-demo-script-v1.docx) is the earlier version) |

## Design

| Document | What it is |
|---|---|
| [rack-binding-standard.md](design/rack-binding-standard.md) | Draft 2 of the standard for deciding which network device is which box in a rack photo: tiers, identity, ranked evidence, confidence, conformance. Also as a page: [rack-binding-standard.html](design/rack-binding-standard.html), [Artifact](https://claude.ai/code/artifact/2bc68d9c-a12e-4bcc-a648-5013342b2184) |
| [finding-a-racks-switches.md](design/finding-a-racks-switches.md) | Rack and network, case by case: 28 situations where the photo and the network disagree, and what we do |
| [snmp-what-we-ask-a-switch.md](design/snmp-what-we-ask-a-switch.md) | Every value RackTrack asks a switch for over SNMP, and why |
| [app-screen-by-screen-chain-plan.html](design/app-screen-by-screen-chain-plan.html) | The UI plan that turns a rack into a chain of steps: which screens are new, which change, which go. [Artifact](https://claude.ai/code/artifact/d82ff4a1-5155-4fa3-a5c8-e06a4cd07b6c) |
| [organisation-setup-plan.html](design/organisation-setup-plan.html) | Setup after an organization is created, as built on 15 Sep 2026: one container over the phone app or the portal, one step at a time with Back and Next, no step bar; five required steps (organization with primary contact, datacentres as facility records with spaces and rack counts, people, rules, review) and five optional ones in the same container (systems, vendors, conventions, switch access, more people); only the admin sees it, technicians are never held; one table of required versus optional; build order. [Artifact](https://claude.ai/code/artifact/ba316079-b270-466f-8106-780b1eb18200) |
| [drift-approval-spec-plan.html](design/drift-approval-spec-plan.html) | The manager's Ticketing and Drift Approval functional specification v1.0 (16 Sep 2026) explained in plain words; what RackTrack does today, checked in the code; a side-by-side gap table; the twenty acceptance criteria scored (3 pass, 7 partly, 10 no); eight mismatches with the frozen rules to fix first; a plan in phases 0, 0.5, 1 to 5 with weeks; the fourteen decisions the manager must make; risks. Nothing built. [Artifact](https://claude.ai/artifact/31gLYDK3ebBBpNS9ddX1Cp) |
| [approvals-end-to-end.html](features/approvals-end-to-end.html) | The drift ticketing and approval workflow run end to end on the live server on 18 Sep 2026, with a screenshot of every step: a technician's rack check in the app, the check arriving in RackTrack Approvals with 281 differences asked as 9 questions, triage, the whole rack assigned to the contact NetBox names, resolved with a finding, verified, decided, the admin refused approval of their own work, approved by a second person, the approver refused the write, and the write itself with what NetBox refused; plus the dashboard, list, tickets, reports, exceptions, notifications, settings and audit view, the same screens on a phone, and a table of the eleven rules and where each was proved. [Artifact](https://claude.ai/artifact/XYjHfgufUUMY6gzCY49jYY) |
| [racktrack-changes-reference.html](features/racktrack-changes-reference.html) | The developer's reference for RackTrack Changes, 18 Sep 2026: all twelve tabs with who can see each and what it calls, the dashboard taken apart number by number, the anatomy of a drift, the 22 statuses and 17 moves, the role table, the five rules that refuse with the words the server uses, the four SLA clocks and how pauses move a target, verification, the twelve steps of the write, the two hashes, the eight reports, every setting, exceptions and windows, the fifteen notification events, the eleven tables, where each file lives, and fourteen known mismatches between the screens and the server. [Artifact](https://claude.ai/artifact/A5aB8SAjgjmRKhdgX3z3NL) |
| [approvals-test-sheet.html](features/approvals-test-sheet.html) | The tester's checklist for RackTrack Changes, updated 18 Sep 2026 for the rename: 40 numbered checks in the order a real day goes, each with what to do, what should happen and a screenshot of the screen, grouped as the technician on the phone, the whole path in Changes, the screens around it, five phone checks for the in-app view and the card lists, and the things that must be refused; plus the accounts to sign in with and what is known and not a bug. [Artifact](https://claude.ai/artifact/W7tTiEGDXDUJFRQZX87eVD) |
| [drift-rules-walkthrough.html](features/drift-rules-walkthrough.html) | Phase 0.5 of the drift approval plan shown: the eight frozen-rule fixes built on 17 Sep 2026 (assign before decide on the server, write failed with email and retry, audit rows, technicians compare and submit only, own checks, gated ticket list, assignee by contact id, whole-rack assign and ports under a device), portal screenshots at 1440 px and 390 px, test counts and the live checks as owner and technician. [Artifact](https://claude.ai/artifact/LDrRnxTRbQSh13k1p2WXFt) |
| [first-run-walkthrough.html](features/first-run-walkthrough.html) | Plain-English guide to the organization setup as it runs on the live servers (15 Sep 2026): what the setup is, who sees it and when, what the red star means, a table of the ten steps with what each asks and why, what happens behind the screen, then captioned screenshots of fresh admins walking it on the phone app (390 px), the desktop browser (1280 px) and the portal (1440 px and 390 px), a glossary of the words on the screens, and the untouched sign-ins left for a live first run. [Artifact](https://claude.ai/artifact/13FzKj4Lb333BfBMudeoim) |
| [physical-layer-developers.md](features/physical-layer-developers.md) | The physical layer report per scan: rack label or id, device labels with shape-guided repair, ports, cables, OCR metadata; how to run it and the GET route |
| [rack-identity-developers.md](features/rack-identity-developers.md) | Rack identity: which of the customer's racks a scan is, with the evidence. The five-rung ladder (record, label, label-netbox, devices, only-rack), what states a rack with its rack key and what only suggests, the text normalisation and rack pattern repair, the response shape, the confirm route, and how to check it |
| [drift-approval-workflow-proof.html](design/drift-approval-workflow-proof.html) | Six-step proof of the drift-to-NetBox workflow, one real screenshot each: the technician compares and sends on the phone, it reaches the admin, the admin assigns to the SPOC, a ServiceNow incident is raised on dev322173 and resolved with a finding, and the technician sees it has gone. Proves [drift-approval-workflow.md](design/drift-approval-workflow.md). [Artifact](https://claude.ai/code/artifact/c8aead03-d4a7-450e-82ca-ca6ad3f44f33) |
| [part-b-dedup-design-review.md](design/part-b-dedup-design-review.md) | Why the first design for keying NetBox ids on a known rack failed three adversarial reviews (per-tenant key, only-rack-in-space mis-merge, adopt-by-name across sites, rename on adopt, one uid on two racks, migration inside export), and the revised, staged design that replaces it. 17 Sep 2026, written before any code. |
| [plan-versus-code.md](design/plan-versus-code.md) | The 11 Sep match-and-reconcile plan measured against the code on 18 Sep 2026: the rack ladder's six rungs and the device ladder's eight rungs each scored built, built but not wired, partly built or not built, with the file behind every claim; then a build order of ten slices ordered by how much certainty each buys, starting with refusing ties and with the missing NetBox lookup that makes a customer's own rack findable at all; then the rungs that still need a person and why that is the honest answer. Two pieces are finished and called by nothing: the rack label matcher and the port fingerprint |

## NetBox

| Document | What it is |
|---|---|
| [netbox-export-schema.html](netbox/netbox-export-schema.html) | All sixteen object types a rack scan writes, field by field, the evidence ladder, creation order, and the version traps. [Artifact](https://claude.ai/code/artifact/d45796f4-7a60-48c6-822c-77e014d53bc4) |
| [netbox-cmdb-field-mapping-review.html](netbox/netbox-cmdb-field-mapping-review.html) | Review (18 Sep 2026) of the teammate's NetBox vs CMDB field report: the NetBox column is complete and correct (254 of 261 names right), but the sheet is built from NetBox and ServiceNow outward, so it covers 8 of the 16 object types RackTrack produces, invents 7 NetBox fields, misses front and rear ports, wrongly says cables need the paid TNI plugin, and has no row for evidence, confidence, provenance or the port fingerprint. Ends with the nine changes and the suggested column set. [Artifact](https://claude.ai/artifact/1Rnev2VBXf3RkhsQDpLNyP) |
| [netbox-object-reference.html](netbox/netbox-object-reference.html) | Every NetBox object (173) and field (2632) from the live schema. Rebuilt by [build-netbox-object-reference.py](netbox/build-netbox-object-reference.py) from a schema dump in `schema-dumps/` (git-ignored, 33 MB, regenerable). [Artifact](https://claude.ai/code/artifact/252e8182-261f-4343-a647-6ff832907c62) |
| [netbox-push-workflow.html](netbox/netbox-push-workflow.html) | How a rack should go into NetBox: compare, identify, hand to one admin who approves, tickets or rejects. [Artifact](https://claude.ai/code/artifact/54fca09a-c2af-4afa-b95a-7ffe8074d586) |
| [match-and-reconcile.html](netbox/match-and-reconcile.html) | One full-width page (11 Sep 2026) in aligned tables: the three sources side by side, the six steps with what each uses and produces, the six-rung rack ladder, the eight-rung box ladder with the four confidence outcomes, the match fields by strength, the admin's three choices and the finding tiers, twelve situations with their rule, and the six rules that never change. [Artifact](https://claude.ai/code/artifact/d77ffa65-545a-43c6-a599-ea8fcec34155) |
| [match-and-reconcile-detailed.html](netbox/match-and-reconcile-detailed.html) | The long fourteen-section version the short one replaced: rack level (tabs 01-07) with the field tables and nine edge cases; device level (tabs 08-14) with the label, the print, the port fingerprint, the device ladder, the build order and what exists in the code today. Local copy only, no longer live at the artifact link. |
| [knowing-which-rack-plan.html](netbox/knowing-which-rack-plan.html) | Plain-English build plan (15 Sep 2026) for the four not-started Match and Reconcile pieces: recognise the rack against known racks, read the labels, sort the devices inside, and a safety test, with a recommended build order. [Artifact](https://claude.ai/artifact/6AyGK8W4AeYWYqJqikY24Q) |
| [knowing-which-device.html](netbox/knowing-which-device.html) | Plain-English companion (15 Sep 2026) to the rack plan: how RackTrack decides which network device is which box, from the Rack Binding Standard - identity from the hardware not a name, the estate tiers, the eight-rank evidence, the four confidence outcomes, and narrowing before matching; almost none built. [Artifact](https://claude.ai/artifact/43cMa7YaDsPgENG2GREcjn) |
| [from-photo-to-record-plan.html](netbox/from-photo-to-record-plan.html) | The combined build order (15 Sep 2026) for both identity questions in four phases: make identity real (recognise the rack, hardware device identity), a safety net, good inputs (labels, narrowing), then sort the devices inside with confidence. Ties [knowing-which-rack-plan](netbox/knowing-which-rack-plan.html) and [knowing-which-device](netbox/knowing-which-device.html). [Artifact](https://claude.ai/artifact/KS91xyoKfXqu37vUJsHXr9) |
| [rack-book.html](netbox/rack-book.html) | Ground-truth entry page for one rack in NetBox's own fields: site, location, rack, manufacturers, device types, roles, devices with position and serial, interfaces, front and rear ports, power ports and outlets, inventory items, VLANs, prefixes, addresses, cables, contacts; live elevation, generators for port lists, checks; exports as NetBox CSV set, NetBox JSON bundle, devicetype-library YAML, XLSX, ServiceNow import CSVs, RackTrack as-built JSON, Markdown elevation. Entries autosave into the page database (collection racks). [Artifact](https://claude.ai/code/artifact/d035dd87-c330-4333-bf9c-b17f5de670c9) |
| [netbox-compare-identify-admin-review.html](netbox/netbox-compare-identify-admin-review.html) | Owner review in three tabs: the intended flow, what exists in the code today (verified), the six pieces still to build. [Artifact](https://claude.ai/code/artifact/2b8ee8e2-7fd1-4dc0-ab6b-7ea9f66347d5) |
| [netbox-plan-2026-08-27.md](netbox/netbox-plan-2026-08-27.md) | The complete internal plan of 27 August: the university enquiry, the honest state of the product, the office rack build, the phases. Internal only. Also as a page: [netbox-plan-2026-08-27.html](netbox/netbox-plan-2026-08-27.html) |
| [netbox-seven-questions-answered-2026-08-26.html](netbox/netbox-seven-questions-answered-2026-08-26.html) | Answers to the university's seven questions about NetBox integration, with an internal section backing each claim. [Artifact](https://claude.ai/code/artifact/3c359f77-f8ba-4d5e-b076-2329751a757e) |
| [netbox-evaluation-page-for-the-customer-2026-08-31.html](netbox/netbox-evaluation-page-for-the-customer-2026-08-31.html) | The customer-facing walkthrough for the NetBox evaluation: pipeline, export status per object, what the switches and the camera give. [Artifact](https://claude.ai/code/artifact/7453ccb1-3901-4d59-a9af-ce4a9e1bf40b) |
| [requirement-fit-2026-08-31.html](netbox/requirement-fit-2026-08-31.html) | The customer's request scored against what works now, half works, or is not there yet. [Artifact](https://claude.ai/code/artifact/1e52be5a-6822-42cb-ad31-6669ccdf7927) |
| [what-we-need-from-you-customer-readiness-2026-08-31.html](netbox/what-we-need-from-you-customer-readiness-2026-08-31.html) | The readiness checklist for the customer's end: SNMP, LLDP, address tables, asset tags, photos. [Artifact](https://claude.ai/code/artifact/df1e8aa7-a410-4471-a4ff-3dfb3495d279) |
| [note-for-the-customer-network-team-2026-09-01.html](netbox/note-for-the-customer-network-team-2026-09-01.html) | The short note that accompanied the screen recording sent to the customer's network team. [Artifact](https://claude.ai/code/artifact/c3181ddc-1417-4074-bb5a-cb9859a2a988) |

## ServiceNow

| Document | What it is |
|---|---|
| [servicenow-bridge-build-plan.md](servicenow/servicenow-bridge-build-plan.md) | The one-day build plan for the ServiceNow bridge (the code is in `servicenow/` at the repo root) |
| [servicenow-cmdb-seed-data.md](servicenow/servicenow-cmdb-seed-data.md) | The exact CMDB values to type into ServiceNow so the correlator matches |

## Support bot

| Document | What it is |
|---|---|
| [support-assistant-ask-dot.md](support-bot/support-assistant-ask-dot.md) | How Ask DOT works: grounded answers only, the refusal log as the knowledge-base backlog, zero running cost |
| [help-bot-feedback-form.html](support-bot/help-bot-feedback-form.html) | "What would you ask a help bot?", the discovery form given to testers. Also as [Word](support-bot/help-bot-feedback-form.docx), built by [build-help-bot-feedback-docx.py](support-bot/build-help-bot-feedback-docx.py); the [question list](support-bot/help-bot-feedback-questions.md) |

## Setup and deployment

| Document | What it is |
|---|---|
| [demo-vps-setup.md](setup/demo-vps-setup.md) | demo.racktrack.ai on the Hostinger VPS: install, DNS, first run, updating |
| [private-deployment.html](setup/private-deployment.html) | Running RackTrack privately on a customer's own server: what it needs, sizing, the install steps, what leaves the box. [Artifact](https://claude.ai/code/artifact/541736f6-fe05-43cf-b2de-fdfa8136a50d) |
| [mac-ipa-build-for-testflight.md](setup/mac-ipa-build-for-testflight.md) | Building the iOS IPA for TestFlight on the Mac |
| [social-login-setup.md](setup/social-login-setup.md) | Google, Apple and Facebook sign-in configuration |
| [windows-gpu-server-setup.md](setup/windows-gpu-server-setup.md) | The Windows GPU server migration. That server was retired in August 2026; kept for the record |
| [deploy-notes-model-swaps-and-restarts.md](setup/deploy-notes-model-swaps-and-restarts.md) | The July log of model swaps on the old auto-pull box, and the restart mechanism it relied on (also retired) |

## Cloud migration (August 2026)

The study of moving RackTrack off its single VPS. The written report and the proposal are the formal pieces; the
rehearsal is the one that actually ran the image.

| Document | What it is |
|---|---|
| [cloud-hosting-brief-one-page.html](cloud-migration/cloud-hosting-brief-one-page.html) | One page: what the Docker image needs, capacity, the three-phase plan, five gaps to fix. [Artifact](https://claude.ai/code/artifact/62b55fdd-8a74-4c6a-b9f2-4e2392772cab) |
| [cloud-migration-proposal-2026-08-19.html](cloud-migration/cloud-migration-proposal-2026-08-19.html) | Management proposal: the 7R framework, compatibility, Azure versus AWS, a gated plan, risks, approvals. [Artifact](https://claude.ai/code/artifact/d8cefa53-8461-41d7-a503-ddcae63a12eb) |
| [cloud-migration-report-2026-08-19.html](cloud-migration/cloud-migration-report-2026-08-19.html) | The twelve-section written report behind the deck, with the security review and risk register. [Artifact](https://claude.ai/code/artifact/7570a3cf-a0ba-4cdf-9edc-86905a50cf08) |
| [cloud-migration-deck-design-canvas-2026-08-19.html](cloud-migration/cloud-migration-deck-design-canvas-2026-08-19.html) | The ten-artboard presentation deck, as a design canvas. [Artifact](https://claude.ai/code/artifact/593377bb-d28a-42d8-be3d-bd572ffc02fd) |
| [racktrack-on-aws-migration-plan.html](cloud-migration/racktrack-on-aws-migration-plan.html) | Every component mapped to an AWS service, three ways to run the GPU pipeline, six stages, costs. [Artifact](https://claude.ai/code/artifact/c9c62e2c-2881-4d0b-867c-1566c33ec522) |
| [azure-vs-aws-deep-dive.html](cloud-migration/azure-vs-aws-deep-dive.html) | Service-by-service comparison with a target architecture and cost trajectory, plus a plain-English retelling. [Artifact](https://claude.ai/code/artifact/4794ade5-ca9c-464e-81d0-e5f02b9eac87) |
| [aws-vs-azure-side-by-side-slides-2026-08-20.html](cloud-migration/aws-vs-azure-side-by-side-slides-2026-08-20.html) | Sixteen slides comparing the same move on both clouds, with a scorecard. [Artifact](https://claude.ai/code/artifact/c074159d-01e9-4993-8794-2fc128770400) |
| [cloud-pitch-two-minutes.html](cloud-migration/cloud-pitch-two-minutes.html) | Six slides and exactly what to say out loud, two minutes. [Artifact](https://claude.ai/code/artifact/53ed7e75-afd1-4bb9-a563-137e2585a674) |
| [cloud-migration-plan-aws-and-azure-2026-08-26.html](cloud-migration/cloud-migration-plan-aws-and-azure-2026-08-26.html) | The later, eleven-tab plan: the SQLite-on-network-storage blocker, what is already written, step by step on both clouds, go-live day, costs. [Artifact](https://claude.ai/code/artifact/2bd5e4a8-18b5-4fca-856a-9dc49745cb4f) |
| [cloud-rehearsal-real-image-test-2026-08-26.html](cloud-migration/cloud-rehearsal-real-image-test-2026-08-26.html) | The rehearsal: the real image run the way a managed platform runs it, three scenarios, what broke. [Artifact](https://claude.ai/code/artifact/44f9f633-f31c-4da6-9116-0b4d9820fa75) |

## Audits

| Document | What it is |
|---|---|
| [code-audit-2026-07-21/audit-report.html](audits/code-audit-2026-07-21/audit-report.html) | The July line-level audit of the whole repository ahead of external review, with [issues and fixes](audits/code-audit-2026-07-21/issues-and-fixes.html) and the [verification and evidence report](audits/code-audit-2026-07-21/verification.html) |
| [Code audit report (August)](pitch-and-collateral/presentation-pack-2026-08/2-code-audit-report.html) | Nine audit types and seventeen tools across every layer, with tool output as evidence. Lives in the presentation pack. [Artifact](https://claude.ai/code/artifact/613bd716-bf14-4e24-97ee-c341bc0a5f89) |
| [code-audit-proposal-vs-delivered-2026-08-20.html](audits/code-audit-proposal-vs-delivered-2026-08-20.html) | The proposed six-tool toolchain against what is actually running, with real output and coverage figures. [Artifact](https://claude.ai/code/artifact/b2e89af3-66ee-498c-9e0e-d6af876def59) |
| [code-auditing-tools-overview.docx](audits/code-auditing-tools-overview.docx) | Short technical overview of the code-auditing tools, as Word |
| [where-racktrack-stands-audit-and-status-2026-08-19.html](audits/where-racktrack-stands-audit-and-status-2026-08-19.html) | Twelve audit methods run on the real code, a scorecard by area, the two security findings, a fix order. [Artifact](https://claude.ai/code/artifact/b6015e8c-2dbe-4b75-8be6-2db163070ed7) |
| [engineering-and-audit-portal-2026-08-19.html](audits/engineering-and-audit-portal-2026-08-19.html) | The tabbed portal: methodology, coding standards, quality, security, access, scanners, findings, compliance, accessibility, plan. [Artifact](https://claude.ai/code/artifact/273658fc-344b-4b68-823e-6bf20fd32759) |
| [enterprise-audit-catalog-42-checks.html](audits/enterprise-audit-catalog-42-checks.html) | The 42 standard checks an enterprise product should pass, in seven domains, each with where RackTrack stands. [Artifact](https://claude.ai/code/artifact/09606904-25ee-4530-a85b-27c705c5cb24) |
| [enterprise-readiness-checklist-template.html](audits/enterprise-readiness-checklist-template.html) | The checklist template across Security, Access, Code and Vulnerabilities, with tool, command, cadence and pass bar. [Artifact](https://claude.ai/code/artifact/06f42175-18f7-4f9a-ac2f-664440ab5de5) |
| [server-capability-assessment-2026-09-03.html](audits/server-capability-assessment-2026-09-03.html) | Thirteen claimed server gaps, each verified against source and the live API, with severity, effort and a remediation plan. [Artifact](https://claude.ai/code/artifact/ed4e6c06-f215-47bb-b21f-dc0712ac3f78) |
| [website-audit-racktrack-ai-2026-09-08.html](audits/website-audit-racktrack-ai-2026-09-08.html) | The marketing website audited: security headers, privacy, weight, bugs, accessibility, mobile, SEO, copy, with a top-ten fix list. [Artifact](https://claude.ai/code/artifact/74af5767-0c28-440d-a8cd-d5a64b2915f3) |

## Status reports

| Document | What it is |
|---|---|
| [whats-there-and-whats-next-2026-09-03.html](status-reports/whats-there-and-whats-next-2026-09-03.html) | What is built and what is not as of 3 September, and the seven-step plan. [Artifact](https://claude.ai/code/artifact/914dfb14-60c6-4aaa-a3da-35d42176b267) |
| [tester-feedback-status-2026-08-26.html](status-reports/tester-feedback-status-2026-08-26.html) | All 23 items testers raised: fixed, answered, or open with the detail still needed. [Artifact](https://claude.ai/code/artifact/1f0ce084-68b3-44f0-b58a-9625be203147) |
| [enterprise-readiness-reports-index-2026-08-19.html](status-reports/enterprise-readiness-reports-index-2026-08-19.html) | Card index of the August enterprise-readiness reports, marking the roadmap as the master. [Artifact](https://claude.ai/code/artifact/49a989fc-fa8c-4fcc-b311-1e1eb7fb69fa) |
| [explainer-style-sample-2026-08-19.html](status-reports/explainer-style-sample-2026-08-19.html) | One topic written in the plain style agreed for the roadmap: why a real database with backups comes first. [Artifact](https://claude.ai/code/artifact/909b4dab-4ea1-485b-858b-aa4b32fe9606) |
| [sprint-update-2026-07-22.docx](status-reports/sprint-update-2026-07-22.docx) | Sprint review, 8 to 22 July 2026: twenty tasks closed |
| [build-15-changelog.html](status-reports/build-15-changelog.html) | Build 15 technical summary: the state of the product as shipped to testers in July |

| [photo-network-record-progress-2026-09-18.html](status-reports/photo-network-record-progress-2026-09-18.html) | Plain-English progress page, full width with a sidebar of eight sections and real screens from the running system: the three layers (photo, network, record) taken apart one by one, each working link step by step, the missing photo-to-network link, what was built, where it stands, what is next, and how it is kept safe. [Artifact](https://claude.ai/artifact/H3PuhwJ3RrvTVa5khaR1JY) |
| [android-test-round-2026-09-18.html](status-reports/android-test-round-2026-09-18.html) | The internal Android test round for build 1.0 (61): what changed since the last build, twelve things to test with what a correct answer looks like and what to report, the eleven test accounts by role, and the list of deliberate behaviours that are not faults. [Artifact](https://claude.ai/artifact/MiyVy5ZER7ULLYgKUptLdH) |
| [work-log-2026-08-28-to-09-18.html](status-reports/work-log-2026-08-28-to-09-18.html) | The thirteen major pieces of work finished between 28 August and 18 September 2026, in the order they were completed. A day-by-day table of hours worked, commits and lines, then each piece with what was built, why it took the effort it did, and the measured cost - 13 working days, 105 hours, 156 commits, 178,430 lines added across three applications. Small fixes left out. [Artifact](https://claude.ai/artifact/7dg9XGweWZXqg6N2TH5yPd) |
## Task reports (September 2026)

[task-reports/README.md](task-reports/README.md) lists the nine pieces of work from the first week of September, one
document per Jira ticket (SPRTMS-1632 to 1640), each following the shape in [CONVENTIONS.md](task-reports/CONVENTIONS.md).
The same nine as a single page: [build-notes-2026-09-03-to-07.html](task-reports/build-notes-2026-09-03-to-07.html)
([Artifact](https://claude.ai/code/artifact/b4d3d74b-eff7-49c2-90db-c270e8c2727f)). The interactive review checklist
used for the Jira intake: [jira-intake-checklist-2026-09.html](task-reports/jira-intake-checklist-2026-09.html)
([Artifact](https://claude.ai/code/artifact/8a9266d8-61cb-4808-afc8-b1ba0140c3b3)).

## Pitch and collateral

| Document | What it is |
|---|---|
| [enterprise-readiness-pitch.html](pitch-and-collateral/enterprise-readiness-pitch.html) | The enterprise-readiness pitch page |
| [enterprise-plan-pitch-slides-2026-08-20.html](pitch-and-collateral/enterprise-plan-pitch-slides-2026-08-20.html) | Fifteen slides: the code is strong, the setup is demo-stage, the five-step plan, the ask. [Artifact](https://claude.ai/code/artifact/5ba2a557-cf99-4716-b613-f1f0d77e2199) |
| [meeting-script-10-minutes.docx](pitch-and-collateral/meeting-script-10-minutes.docx) | What to say in the meeting: audit results, the three blockers, the cloud plan. A [six-minute version](pitch-and-collateral/meeting-script-6-minutes.docx) too |
| [presentation-pack-2026-08/index.html](pitch-and-collateral/presentation-pack-2026-08/index.html) | The presentation pack: the plan, the code audit report, AWS versus Azure, the [enterprise roadmap](pitch-and-collateral/presentation-pack-2026-08/4-roadmap.html) ([Artifact](https://claude.ai/code/artifact/8ce156ef-eab4-4285-87ff-8bc1b8db4aaa)), the nine audits in detail, the Jira tickets, with the evidence screenshots |
| [certifications-policies-and-documentation.html](pitch-and-collateral/certifications-policies-and-documentation.html) | The major certifications, policies and documentation an enterprise customer asks for |

## Working notes

Open [notes/index.html](notes/index.html) in a browser: it lists all 32 notes, grouped by subject and described, and
marks which of the overlapping ones is current. Subjects: switch access, network audits, ports and cabling,
lab network, pipeline and vision, design explorations, status and demo, delivery. These are working notes, not
published documentation; they capture thinking at a moment in time.

## Reference

| Document | What it is |
|---|---|
| [ui-reference-users.md](reference/ui-reference-users.md), [ui-reference-developers.md](reference/ui-reference-developers.md) | The cross-cutting interface: layout, navigation, components, screen index. Also as [Word](reference/ui-reference.docx) |
| [neumorphism-style.md](reference/neumorphism-style.md) | The slight-neumorphism style used on the feedback form, as a reusable prompt |
| [firmware-check-feature-report.html](reference/firmware-check-feature-report.html) | Firmware check: how it works, which vendors it can answer for, which need a login, which it gets wrong |
| [live-switch-vendor-support-handoff.html](reference/live-switch-vendor-support-handoff.html) | Which switches RackTrack can talk to, the exact commands, what is missing, how to add a vendor |
| [live-switch-command-research-task.html](reference/live-switch-command-research-task.html) | The research task that accompanies the vendor handoff |
| [marketplace-engineering-handoff.html](reference/marketplace-engineering-handoff.html) | Marketplace: what it is for, what is built, how it works end to end, what to add next |
| [rack-planning-guide.html](reference/rack-planning-guide.html) | How devices are placed in a data centre rack: rack types, rack units, the size each kind of device takes, placement order and rules, a 42U example, a workflow and checklist, and an interactive RU calculator and placement planner. Its rack drawing and its device size table are what the photo-to-network matching reuses |
| [user-guide-2026-07-09-superseded.docx](reference/user-guide-2026-07-09-superseded.docx) | The previous user guide, superseded by `user-guide/`; kept for reference |
| [netbox/our-rack/](reference/netbox/our-rack/) | NetBox import CSVs for the office rack, being built on 9 September 2026 (in progress) |
