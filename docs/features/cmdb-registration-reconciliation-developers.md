# CMDB Registration & Reconciliation

**Feature Reference** · *Scan → Service Request → approved → idempotent CMDB upsert; and incident → containment walk → per-U audit → work note.*

**Category:** Integration — CMDB / ServiceNow bridge · **Audience:** The team (assumes you know the product) · **Document date:** 24 July 2026 · Part of the RackTrack documentation set.

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

Two flows share one ServiceNow bridge. **Registration** turns a scan into CMDB records, but only through an approved `sc_request` (Service Request) — the compliance claim is that *every CMDB write is gated behind an approval*. **Reconciliation** compares CMDB expectation with physical scan reality for a rack tied to an incident, and posts a work note.

The Node surface is `server/cmdb_ticket_proxy.js` (`/api/cmdb/ticket/*`), which spawns the Python in `servicenow/`. The registration UI is `client/src/components/CmdbApprovalModal.jsx`, triggered from `client/src/pages/ResultsPage.jsx`; the drift view is also rendered by `ResultsPage.jsx`.

## 2. At a glance

| | |
|---|---|
| **Category** | Integration — ServiceNow CMDB registration + reconciliation. |
| **Who uses it** | Any authed user for a rack they own; sweep + dev-approve are `owner`-only. |
| **Where input comes from** | `outputs/<rackId>/scan_result.json` + the live CMDB; an incident for reconciliation. |
| **What it outputs** | Upserted `cmdb_ci_*` rows + rels; a reconciliation work note; a local ticket state file. |
| **Data source** | MIXED — device list REAL; some registered fields SYNTHETIC (`synth`). |

## 3. How it works — step by step

```
scan completes → scheduleCmdbTicket(rackId)  (debounced 4s)
        ↓
cmdb_ticket.py create → diff_cmdb.compute_diff()
        ↓ (non-empty, no open ticket)
POST /table/sc_request  →  write outputs/<rackId>/cmdb_ticket.json (state=open)
        ↓
startTicketPoller (every 5 min) → poll_one → GET /table/sc_request/<sys_id>
        ↓ (approved + complete)
cmdb_apply.py --rack-id → upsert cmdb_ci_* + cmdb_rel_ci → state=applied
```

**Walkthrough — Registration**

1. After a scan, `scheduleCmdbTicket(rackId)` (in `cmdb_ticket_proxy.js`) debounces a background `cmdb_ticket.py create`.
2. `ResultsPage` opens `CmdbApprovalModal` when the ticket is `open` with `added_devices > 0`, or when no ticket exists. Its `step` is `missing → pending → applying → applied`.
3. **Raise Ticket** → `POST /api/cmdb/ticket/:rackId/create` → `create_ticket_for_rack` computes the diff and opens an `sc_request` if non-empty.
4. Approval: in production the SR is approved in ServiceNow and the 5-minute poller applies it. The modal's **Approve** button calls `POST /api/cmdb/ticket/:rackId/dev-approve` — a **demo-only** shortcut, gated on `CMDB_DEV_APPROVE=1` and `owner`.
5. Apply → `cmdb_apply.py --rack-id <id>` upserts the CI rows and relationships; ticket state → `applied`.

**Walkthrough — Reconciliation**

1. `servicenow/main.py <incident_number>` fetches the incident, resolves its primary CI, walks `cmdb_rel_ci` to the parent rack, reads the rack's `u_racktrack_scan_id`, loads the scan, and lists rack children.
2. `reconciler.reconcile(...)` builds the work note and it's appended to the incident (never overwritten).
3. The drift screen in `ResultsPage.jsx` renders `result.drift` (`expected_u`, `expected_device`, `expected_class`, `detections_at_u`, `reason`) as "CMDB expects" vs "Scan sees at U##".

## 4. Where the input comes from

- **Scan inventory** — `outputs/<rackId>/scan_result.json`, read by `cmdb_apply.apply_rack` via `synth.build_inventory(rack_id, scan, override)` (+ `load_port_detail` / `merge_port_detail`) and by the diff/reconcile paths.
- **Existing CMDB state** — `diff_cmdb.compute_diff` fetches the current CMDB rack state (keyed on `u_racktrack_scan_id`) to diff against.
- **A ServiceNow incident** — the correlation point for reconciliation (`servicenow/main.py`).
- **ServiceNow creds** — injected by `cmdb_ticket_proxy` from the active connection profile (org profile preferred, then user) as `SN_INSTANCE/SN_USER/SN_PASSWORD`. No env/file fallback: with no active profile, `_sn()` returns `None` and the script fails fast.

## 5. What it produces (output)

- **CMDB rows** (`servicenow/cmdb_apply.py`): `cmdb_ci_rack`, `cmdb_ci_ip_switch` (switch / AGG-CORE), `cmdb_ci_netgear` (patch panel), `cmdb_ci_server`, `cmdb_ci_network_adapter` (switch/server ports & NICs), `cmdb_ci_port` (patch-panel ports), and `cmdb_rel_ci` (Contains for rack→device / device→port, Connects-to for cable peers). Counters: `{ created, updated, ports, rels }`.
- **Local ticket state** — `outputs/<rackId>/cmdb_ticket.json` (schema `cmdb_ticket.v1`): `number, sys_id, state (open|applied|rejected|cancelled|failed), sn_state, sn_approval, diff_hash, summary, opened_at, last_polled_at, applied_at, apply_error, ticket_url`.
- **A reconciliation work note** — the multi-line string from `reconciler.reconcile`, appended to the incident.
- **A synthetic-fields record** — `outputs/<rackId>/cmdb_synthesis.json` (marker `synthetic_data=true`), listing which device fields were synthesised.

## 6. What you see on screen

- **`CmdbApprovalModal`** steps: `missing` ("Rack not registered in CMDB", **Raise Ticket**) → `pending` ("Ticket submitted", reference = `ticket.number`, **Approve**) → `applying` ("Synchronizing…") → `applied` ("Successfully registered").
- **`ApplyDetails`** (from the `dev-approve` response `details`): a stats row (Devices · Ports · Cables · Rack U), a "Registered devices" list (name, `U<pos>`, kind, model, `mgmt_ip`, `mac`, `asset_tag`, `serial`, port count), and a "Connections (sample of *N*)" list.
- **Drift screen** (`ResultsPage.jsx`, ~line 3040): "Physical Drift Detected" header, "CMDB ↔ scan mismatch for *[incident]*", a two-column **CMDB expects** (`expected_device`, `expected_class @ U##`) vs **Scan sees at U##** (each detection's `class_name` + confidence), next-step guidance, and the annotated rack image. **Raise ticket** → `POST .../create`.

## 7. The logic behind it

- **Every write is gated.** `cmdb_apply.py` only runs from the poller after `_classify_sn_state` returns `approved`, or from the `owner`-only, env-gated `dev-approve`. `dev-approve` exists purely for demos and is `403` unless `CMDB_DEV_APPROVE=1`.
- **Idempotent upserts, rack-scoped.** `upsert()` matches on `name=<n>^<scope_field>=<rackId>` (`u_racktrack_rack_id` for devices, `u_racktrack_scan_id` for the rack) and refuses to PATCH a row already owned by a *different* rack — because device names are U-derived (`SW-U06`, `PP-U18`) and collide across racks.
- **Four reconciliation verdicts** (`reconciler._check_ci`): `✓` match (best confidence ≥ `LOW_CONF_THRESHOLD` = 0.5), `⚠` low-confidence match (< 0.5 → rescan), `✗` mismatch (nothing detected at U, or a different class = physical drift), `?` unknown (no `rack_unit_position` on the CI).
- **Stable diff hash, no duplicate tickets.** `diff_cmdb` produces a deterministic `diff_hash` (excludes `computed_at`/`diff_hash` itself). An unchanged hash on an open ticket → `unchanged`; a changed hash → a `work_notes` PATCH, not a second SR.
- **Never act on an unreachable CMDB.** If `compute_diff` reports `cmdb_reachable: false`, create refuses — a failed read makes every device look "added", which would file a bogus "everything is missing" SR.

## 8. Detailed technical explanation

**Node proxy** (`server/cmdb_ticket_proxy.js`). Mounts under `requireAuth`, with `router.param('rackId', rackOwnershipParam({ tenant, logger }))` (the guard doesn't propagate from the parent app, so it's re-registered here). Routes: `GET /api/cmdb/ticket/:rackId` (`status`), `POST .../refresh` (`poll --rack-id`), `POST .../create` (`create`, `?force=1` → `--force`), `POST .../cancel` (`cancel`), `POST /api/cmdb/ticket/poll` (`owner`-only sweep), `POST .../dev-approve` (`owner` + `CMDB_DEV_APPROVE=1`). `runTicketCmd` spawns `python cmdb_ticket.py <args> --json`, extracts the trailing JSON, and `scrubError` strips any `*.service-now.com` host and truncates error strings before returning them. `scheduleCmdbTicket(rackId, delayMs=4000)` debounces post-scan creates; `startTicketPoller(5min)` runs `poll_all` (first cycle ~30 s after boot).

**Ticket lifecycle** (`servicenow/cmdb_ticket.py`). `create_ticket_for_rack` holds a cross-process `_TicketLock` (`outputs/<rackId>/cmdb_ticket.lock`, O_CREAT|O_EXCL, 180 s stale steal) so a background create and a user click can't double-open. It reads any existing `cmdb_ticket.json`, recomputes `compute_diff`, and either leaves an unchanged ticket, PATCHes a work note on a changed diff, adopts a pre-existing SR (`_find_existing_sr` by `u_racktrack_rack_id`), or POSTs a new `sc_request` with `u_racktrack_rack_id` + `u_racktrack_diff_hash`. `poll_one` GETs the SR, maps `state`/`approval` via `_classify_sn_state` (OOTB state code sets), and on `approved` runs `_apply_to_cmdb` (spawns `cmdb_apply.py`). Apply failures back off exponentially (`APPLY_BACKOFF_BASE_SECS=300`, cap 6 h) and go terminal `failed` after `MAX_APPLY_ATTEMPTS=5`.

**Apply** (`servicenow/cmdb_apply.py`). `apply_rack` builds the inventory (`synth.build_inventory` + per-rack override + port detail), requires `SN_INSTANCE/SN_USER/SN_PASSWORD`, then upserts rack → switches (+ network-adapter ports) → patch panels (+ `cmdb_ci_port`) → server (+ NICs), wiring `cmdb_rel_ci` Contains relationships (relationship type resolved via `cmdb_rel_type` "Contains::Contained by"). Provenance (`discovery_source`, `ocr_make/model/version/conf`, `synthetic_data=true`) is written into the CI `comments` field; `servicenow/list_rack_switches.py` parses it back out for the Switch-Info UI (rack CI resolved by `u_racktrack_scan_id`, switch children returned with serial/model/mgmt_ip + a discovery-source badge).

**Reconciliation** (`servicenow/reconciler.py` + `main.py`). `_expected_scan_class` maps `sys_class_name` via `CMDB_CLASS_TO_SCAN_CLASS` (e.g. `cmdb_ci_ip_switch → Switch`, `cmdb_ci_netgear`/patch panel fall back to `NAME_PREFIX_TO_SCAN_CLASS` on `PP-`/`SW-`/`SRV-`). `_ci_u` reads `rack_unit_position`/`u_position_in_rack`, else parses `-U##` from the name. `_scan_detections_at(scan, u)` collects `(class_name, confidence)` for devices whose `units` contain `u{NN}`. `reconcile` composes the note: correlation header, primary-CI verification, a per-CI rack audit sorted by U (descending), an `matched/total` agreement count, and a `Suggested action` keyed on the primary verdict. `main.py` posts it via `sn.add_work_note` (append-only).

**Diff** (`servicenow/diff_cmdb.py`). `compute_diff(rack_id)` returns `summary { added_devices, removed_devices, changed_devices }`, `diff_hash`, and `cmdb_reachable`; `diff_is_empty` is true when all three counts are 0; `render_diff_text` renders the human body embedded in the SR description alongside a capped machine-readable JSON block.

## 9. Real data vs. synthetic

| Thing on screen | Real or synthetic |
|---|---|
| Registered device list & counts | **REAL** — from `scan_result.json` via `synth.build_inventory`. |
| U-positions & device classes | **REAL** — detected by the scan pipeline. |
| Serials / `mgmt_ip` / `mac` / asset tags / cable attrs | SYNTHETIC — `synth`-generated; recorded in `cmdb_synthesis.json` and CI `comments` (`synthetic_data=true`). |
| Reconciliation verdicts (✓/⚠/✗/?) | **REAL** — expected-class-at-U vs detected-class-at-U. |
| Work note / ticket | **REAL** — posted to the live incident / `sc_request`. |
| `DEV-<rackId>` ticket number | SYNTHETIC — only when `dev-approve` fabricates a ticket in demo mode. |

## 10. Use cases

- **Onboard a rack.** `scheduleCmdbTicket` → SR → approval → `cmdb_apply.py` writes the full `cmdb_ci_*` graph, idempotently.
- **Prove drift on a ticket.** `main.py INC…` walks to the rack, audits per-U, and posts a `✗`-flagged work note; the `ResultsPage` drift view shows the side-by-side evidence.
- **Avoid duplicate SRs.** `diff_hash` + `_TicketLock` + `_find_existing_sr` ensure one SR per rack per change.
- **Surface provenance in-app.** `list_rack_switches.py` reads back the `discovery_source` written into `comments` so the Switch-Info screen badges OCR / synth / override.

---

— CMDB Registration & Reconciliation —
