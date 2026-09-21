# RackTrack Approvals: the contract every builder follows

Written 18 September 2026 for the build of the manager's Ticketing and Drift Approval specification v1.0. One server, one database, one sign-in. The Approvals sub-application is a front-end only; every rule lives in the server. Plain English and the plain hyphen everywhere.

## Decisions taken as defaults (the manager may change them later)

1. Every drift raises a ServiceNow Incident (as today). Task and Change Request are not used yet.
2. RackTrack writes racks, devices, interfaces and their supporting records to NetBox. Never a delete.
3. Dual approval is off unless an organization turns it on; the second approver must be a different user. Setting `dual_approval_risks` per organization, default `[]` (changed 21 September 2026: the SPOC's one approval writes).
4. The `pending` status pauses the resolution clock only.
5. Business hours Mon to Fri 09:00 to 18:00 in the datacentre's time zone (tenants.timezone), no holidays. Setting `calendar` per organization.
6. Evidence: a scan is required to submit; a second scan is required for verification.
7. Photos kept `photo_retention_days` from tenant_rules; audit and approval history kept forever.
8. Channels: in-app and email are mandatory. Teams is off until tokens exist.
9. Identity: RackTrack accounts. Roles gain `approver` and `auditor`.
10. Volume: small; SQLite is enough.
11. Roles: owner = super admin; org_admin = triage, reassign, cancel, approve, write; site_manager = reads their Site (no triage, assign or cancel since 21 September 2026); approver = the second signature only; auditor = read everything; member = technician: compare, submit, verify. Whatever their role, the SPOC a check is with decides and approves it, and the person who sent a check decides nothing on it.
12. No approvals inside the phone app. Admins use the sub-application in a browser.
13. Plans move from JSON files into SQLite tables in auth.db, migrated once at boot.
14. Any technician of the Site may run the verification re-scan, including the one who reported the drift. The record stores who did it.

SLA defaults (spec table 7): P1 acceptance 15 min, investigation 30 min, resolution 2 h, approval 30 min. P2 30 min, 1 h, 4 h, 2 h. P3 4 h, 8 h, 2 business days, 8 business hours. P4 8 h, 1 business day, 5 business days, 2 business days. Warn at 80 percent, breach at 100, escalate at 120.

## Where things live

- Tables: `server/lib/approvals/store.js` creates them lazily in auth.db (better-sqlite3, same connection module pattern as `server/lib/estate.js`, foreign keys on). Prefix `approval_`.
- Domain: `server/lib/approvals/` with `store.js` (tables, plain reads and writes), `machine.js` (statuses, transitions, guards), `service.js` (the operations the routes call), `migrate.js` (JSON plans into tables), `bus.js` (an EventEmitter; every transition emits `transition` with `{ plan, from, to, actor, reason, item }`), later `verify.js`, `write.js`, `sla.js`, `notify.js`, `reports.js`, `exceptions.js`.
- Routes: `server/routes/approvals/` mounted at `/api/approvals` behind `auth.requireAuth` with explicit per-route gates from `server/routes/netbox/gates.js` (extend it with `approver`, `auditor`, `readers`).
- Compatibility: the phone app keeps calling `/api/nb/scans/adopt`, `/api/nb/netbox/:id/preview`, `/api/nb/plans`, `/api/nb/plans/:id`, `/api/nb/plans/:id/contacts`, `/api/nb/plans/:id/submit`. These keep their shapes and now read and write the tables through `service.js`. `server/lib/netbox/plans.js` becomes a thin adapter over the store (same exported function names, same return shapes) so existing tests keep passing where the behaviour did not change.
- RackTrack Approvals: repo `/Volumes/Racktrack/racktrack_approvals`, Vite + React + react-router, plain CSS, the kit copied (not imported), base path from `VITE_BASE` (default `/approvals/`), API same origin under `/api`. Served by Caddy as another page of the RackTrack site at `demo.racktrack.ai/approvals/` from `/srv/approvals` (bind mount `./approvals-dist`), with a fallback to `/approvals/index.html` for deep paths.
- **The portal is a different product and is not involved.** Nothing is served under `portal.racktrack.ai`, nothing is added to or removed from that repository, and no screen links to it. The owner was explicit about this on 18 September.
- Same origin means the same session: a person signed in to RackTrack is signed in here. A 401 sends the browser to `/login?next=<path>`, the application's own sign-in. No second sign-in, no second domain, no cookie domain setting.

## Tables

approval_plans: id, org_id, tenant_id, scan_id, rack_id, rack_uid, rack_name, netbox_url, status, disposition, category, priority (P1..P4, default P3), risk (low, medium, high, critical, default medium), fingerprint, payload_hash, version (int, +1 on every change), counts (json), warnings (json), orphans (json), custom_field, created_by, created_at, submitted_at, submitted_by, submitted_note, triaged_at, triaged_by, pending_reason, reopen_count (default 0), reopen_reason, parent_plan_id, duplicate_of, exception_id, window_id, verification (json, latest), result (json, latest write), pre_snapshot (json), post_snapshot (json), written_at, written_by, completed_at, cancelled_at, cancel_reason, updated_at.

approval_items: id, plan_id, uid, type, name, action, netbox_id, diff (json), reason, supporting (0/1), decidable (0/1), decision (pending, ticketed, approved, rejected, excepted, not_applicable), decided_by, decided_at, note, reason_code, parent_uid, following (int), exception_id. Unique (plan_id, uid).

approval_tickets: id, plan_id, item_uid, assignee, assignee_id, assignee_email, assignee_user_id (nullable, a RackTrack user when the email matches), spoc (json), raised_by, raised_at, status (open, accepted, in_progress, pending, resolved, closed), pending_reason, pending_since, accepted_at, question, finding, disposition, resolved_by, resolved_at, closed_by, closed_at, external (json: system, number, sysId, url, state, reused, reopened, raisedAt, error), emailed_at, email_note. Unique (plan_id, item_uid).

approval_overrides: id, plan_id, item_uid (nullable for offline), kind (move, offline, value), netbox_id, record_name, fields (json {field: {from, to}}), shown (json), source (suggestion, manual), suggestion_id, rule, note, created_by, created_by_id, created_at, revoked_at, revoked_by. What a person changed on a check before approving it; never edited or deleted, a change taken back is stamped revoked. approval_plans also holds findings, evidence and suggestion_state (json) and base_fingerprint (the fingerprint the check was filed with, kept when a change re-plans it).

approval_changes: id, org_id, tenant_id, plan_id, attempt, rack_id, rack_name, item_uid, object_type, object_name, netbox_id, netbox_url, action (create, update, rebind, fail, check), field (`*` for a whole record), before (json), after (json), internal (0/1, RackTrack's own link fields), result (written, failed, verified, mismatch), reason, source (scan, suggestion, manual), rule, approved_by, approved_by_id, approved_at, written_by (`system` for a write an approval started), written_by_id, written_at, incident_number, incident_sys_id. Append only, by triggers; no foreign key, so removing an organization deletes its rows by hand after its plans. The verdict of the check after a write is a row of its own (action `check`), never an update.

approval_decisions: id, plan_id, stage (first, second), approver_id, decision (approved, rejected, rework), reason_code, comment, payload_hash, plan_version, decided_at.

approval_verifications: id, plan_id, kind (post_fix, post_write), scan_id, result (pass, fail), performed_by, performed_at, detail (json: per item uid, expected, observed, ok), evidence (json).

approval_comments: id, plan_id, item_uid (nullable), visibility (internal, shared), body, author_id, created_at.

approval_events: id, plan_id, item_uid (nullable), action, actor_id, from_status, to_status, reason, payload (json), ts. Append only; nothing updates or deletes rows here.

approval_sla: id, plan_id, clock (acceptance, investigation, resolution, approval), started_at, target_at, paused_since, paused_ms (default 0), warned_at, breached_at, escalated_at, status (running, paused, met, breached, cancelled), met_at.

approval_notifications: id, event, plan_id, recipient_user_id, recipient_email, channel (inapp, email, teams), subject, body, status (queued, sent, failed, skipped), attempts, last_error, dedupe_key (unique), created_at, sent_at, read_at.

approval_exceptions: id, org_id, tenant_id, rack_id (nullable), item_type, item_name, attribute (nullable), kind (accepted_drift, known_exception), justification, owner_id, starts_at, expires_at, review_at, approved_by, created_at, revoked_at.

approval_windows: id, tenant_id, starts_at, ends_at, note, created_by, created_at.

approval_settings: org_id, key, value (json), updated_by, updated_at. Primary key (org_id, key). Keys: sla_targets, calendar, dual_approval_risks, notification_prefs, escalation.

Every write to a plan bumps version and updated_at. Every transition writes one approval_events row and one audit_log row (server/audit.js, action `approval.<action>`, targetType `approval_plan`).

## Plan statuses and transitions

Statuses: draft, submitted, triage, assigned, accepted, in_progress, pending, resolved, verification_pending, approval_pending, approved, rejected, rework, write_in_progress, written, write_failed, manual_review, completed, reopened, cancelled, duplicate, known_exception.

| From | To | Who | Guard |
|---|---|---|---|
| draft | submitted, cancelled | technician (creator), admin | a scan exists; at least one decidable item or the plan is empty and cancelled |
| submitted | assigned | system, on submit | the Site has a valid SPOC who is not the sender; the check gets that person as its holder (`spoc_user_id`) and a ticket for each item sent, all to them |
| submitted | triage | system, on submit | nobody valid to give it to: no Site, no SPOC, the SPOC's account is gone or is an auditor, or the SPOC is the sender. `needs_admin` says which |
| triage | assigned | admin | names a holder: a RackTrack user (site manager removed) |
| triage | rejected, duplicate, known_exception, cancelled | admin | duplicate needs duplicate_of; known_exception needs exception_id; rejected needs reason_code and comment (site manager removed) |
| assigned | accepted | assignee user or admin | optional on a check with a holder: it does not follow its tickets |
| assigned | assigned (reassign) | admin | a different holder, with a reason |
| accepted | in_progress, pending | assignee user or admin | pending needs pending_reason |
| in_progress | pending, resolved | assignee user, admin, or ServiceNow sync | resolved needs a finding on every open ticket |
| pending | in_progress, resolved | assignee user or admin | |
| assigned, accepted, in_progress, pending | approved | the SPOC the check is with, or admin; never the sender | every decidable item decided; the decision record with payload_hash |
| assigned, accepted, in_progress, pending | approval_pending | the SPOC or admin; never the sender | the first of two signatures, only when risk is in dual_approval_risks |
| assigned, accepted, in_progress, pending | rejected, rework | the SPOC or admin; never the sender | reason_code and comment |
| assigned, accepted, in_progress, pending | duplicate | the SPOC or admin; never the sender | duplicate_of |
| assigned, accepted, in_progress, pending | cancelled | admin | with reason |
| assigned, accepted, in_progress, pending | triage | admin, system | the holder has gone; back to "needs an admin" |
| resolved | verification_pending | system | automatic |
| verification_pending | approval_pending, reopened | technician of the Site (verify), admin (skip only with reason, audited) | approval_pending needs a passing post_fix verification, or an admin skip with reason |
| approval_pending | approved, rejected, rework | approver, the SPOC, org_admin, owner (never the sender) | approved needs every decidable item decided and the decision record with payload_hash; dual approval when risk is in dual_approval_risks and the second approver differs |
| approval_pending | cancelled | admin | with reason |
| rejected, rework | assigned, in_progress, verification_pending | admin | with reason; assigned needs a holder |
| approved | write_in_progress, completed (nothing to write) | org_admin, owner, or system | the payload_hash still equals the live fingerprint and the approval's hash; else back to its holder (assigned), or to approval_pending for a check with no holder, with a fresh plan version |
| approved, write_failed, manual_review | assigned | system | a stale approval on a check with a holder |
| write_in_progress | written, write_failed | system | |
| write_failed | write_in_progress, manual_review, rejected | org_admin, owner | retry keeps the same approval when the hash still matches |
| manual_review | write_in_progress, rejected, cancelled | org_admin, owner | with reason |
| written | completed, reopened | system (post_write verification) | completed needs a passing post_write verification; fail goes to reopened with reason `write_mismatch` |
| completed | reopened | admin | with reopen_reason; reopen_count + 1; history kept |
| reopened | assigned | admin | names a holder |

Reason codes. Reject: insufficient_evidence, incorrect_remediation, configuration_still_differs, wrong_spoc, wrong_asset, change_not_authorized, duplicate, known_exception, maintenance_window_required, other. Pending: awaiting_requester, awaiting_vendor, awaiting_change_window, awaiting_access, awaiting_parts, awaiting_external_team. Reopen: verification_failed, drift_recurred, incorrect_closure, write_mismatch, new_evidence, other. Disposition: remediate, accept_drift, update_source_of_truth, false_positive, duplicate, known_exception, decommissioned_asset, requires_change_request.

Item decisions stay: pending, ticketed, approved, rejected, excepted, not_applicable. The rule "assign first" now holds only for the old library and for a check imported from the old plan files that nobody holds: the SPOC or an admin decides with the drift report beside them, and a ticket still open closes with the decision as its finding.

## Routes under /api/approvals

All answer JSON `{ ok: true, ... }` or `{ error }` with the right status. Every list takes `limit`, `cursor`, and filters by `status`, `tenantId`, `rackId`, `priority`, `risk`, `assignee`, `createdBy`, `since`, `until`, `q`. Org scoping is strict; no owner bypass except read.

- GET `/me` -> `{ user: { id, username, email, role, orgId, tenantId }, can: { triage, assign, reassign, approve, write, verify, audit, admin, spoc, registry } }` (triage, assign and reassign are admin only; spoc is true for the SPOC of a Site or the holder of an open check)
- GET `/queue` -> role-specific: `{ sections: [{ key, title, plans: [...] }] }` (a SPOC: spoc "Assigned to me", first; technician: mine; admin: triage "Needs an admin", approval_pending "Waiting for a second approval", write_failed, manual_review, sla_breached; site manager: mine, the checks of their Site; approver: approval_pending; assignee user: assigned, accepted, in_progress, pending; auditor: recent)
- GET `/dashboard` -> counts by status, priority, sla state, plus `{ filters }` for each count so the UI opens the exact list
- GET `/plans` (also `holder=me`; rows carry `holder`, `sender`, `incidentNumber`, `incidentUrl`), GET `/plans/:id` (plan, items, tickets, decisions, verifications, comments, events, sla, holder, siteSpoc, sender, incident, incidentStates, suggestions, overrides, changes, rackContact, can)
- POST `/plans/:id/submit` `{ note, items }` -> `{ plan, already, holder, needsAdmin, incident }`
- POST `/plans/:id/triage` `{ category, priority, risk, disposition, duplicateOf, exceptionId, note }` (admin only)
- POST `/plans/:id/assign` `{ userId, reason }` or `{ assignee | assigneeId, reason }` -> `{ plan, holder, previous, incident, applied, refused }` (admin only; a check goes to one person as a whole)
- POST `/plans/:id/tickets/:uid/accept`, `/start`, `/pending` `{ reason }`, `/resolve` `{ finding, disposition }`
- POST `/plans/:id/verify` `{ scanId }` -> runs the compare of the new scan against the plan and stores a post_fix verification; `{ result, detail }`
- POST `/plans/:id/decide` `{ decisions: [{ uid, decision, note, reasonCode }] }` (item level; the SPOC the check is with or an admin, never the sender)
  A row may be a change: `{ uid, decision: "modified", modified: { serial, asset_tag, description }, note }`. It is stored as `approved` with `item.modified`, the check is compared again in place and the answer says `replanned: true`. The shelf is never changed by hand.
- POST `/plans/:id/suggestions/:sid/accept` `{ note }`, POST `/plans/:id/suggestions/:sid/dismiss` `{ note }` (`:sid` URL-encoded) -> the whole check as GET `/plans/:id` gives it. 409 when the suggestion no longer applies, when NetBox could not be compared, or when the fresh comparison does not show the change.
- DELETE `/plans/:id/overrides/:overrideId` -> takes a change back, compares the check again, and answers the whole check.
- POST `/plans/:id/approve` `{ comment, incidentState }` -> plan-level approval record with payload_hash, plus `write` and `incident`; second call by a different approver when dual approval applies
  The final approval writes at once: the server does it, as the system, on the approver's word, and waits up to 25 seconds. `write` is `{ state, status, written, failed, failures, changes, why }` with `state` one of `written`, `nothing_to_write`, `failed`, `bounced` (NetBox or the check changed after the approval: nothing written, the check is back with its holder, compared again in place, and `why` says so), `not_started` (the write could not begin; the check stays `approved`), `writing` (still going; poll the check). It is null while a second approval is awaited. `incident` is `{ number, state, pushed, error }`, with `pending: true` when ServiceNow has not answered within 10 seconds; its `state` is ServiceNow's own word (`new`, `in progress`, `on hold`, `resolved`, `closed`, `cancelled`) or `raising` while a slow ServiceNow has not yet given a number.
- POST `/plans/:id/reject` `{ reasonCode, comment, incidentState }`; POST `/plans/:id/rework` `{ reasonCode, comment, incidentState }`
- POST `/plans/:id/write` -> the retry of a failed write, or the write of a check approved before approvals wrote (organization admin only): pre_snapshot, write, post_snapshot, post_write verification; `{ status, result, failures }`
- POST `/plans/:id/reopen` `{ reasonCode, comment }`; POST `/plans/:id/cancel` `{ reason }`
- POST `/plans/:id/comments` `{ body, visibility, itemUid }`; GET `/plans/:id/comments`
- GET `/plans/:id/contacts`
- GET `/tickets` (all tickets with plan and SLA)
- GET `/sla/:planId`; GET `/settings`; PUT `/settings/:key` (org_admin, owner)
- GET `/exceptions`, POST `/exceptions`, DELETE `/exceptions/:id` (revoke)
- GET `/windows`, POST `/windows`, DELETE `/windows/:id`
- GET `/notifications` (mine), POST `/notifications/:id/read`, GET `/notifications/prefs`, PUT `/notifications/prefs`
- GET `/reports/:name` for backlog, sla, quality, trends, resolvers, approvals, writes, exceptions, changes -> `{ rows, filtersFor: { ... } }`; GET `/reports/:name.csv`
- GET `/changes` -> the change registry, newest first: `{ changes: [{ id, writtenAt, planId, attempt, tenantId, siteName, rackId, rackName, objectType, objectName, netboxId, netboxUrl, action, field, before, after, internal, result, reason, source, rule, approvedBy, approvedById, approvedAt, writtenBy, incidentNumber, incidentUrl, checked }], nextCursor }`. Filters: `tenantId`, `rackId`, `planId`, `objectType`, `field`, `approvedById`, `incident`, `result`, `since`, `until`, `q`, `internal=1` (RackTrack's own link fields too), `limit`, `cursor`. An admin and an auditor read the organization; anybody else the Sites they are the SPOC of and the checks they hold or held; with neither, 403. `checked` is the verdict of the check after that attempt (`verified`, `mismatch` or null). GET `/changes.csv` is the same rows as a file. GET `/plans/:id` carries the rows of that check under `changes`, link fields included.
- GET `/users` (assignable RackTrack users of the org, for approver and assignee pickers)

Errors: 400 for a bad body, 403 with a plain sentence for a role refusal, 404 for another organization's plan, 409 for a guard refusal `{ error, code: 'guard', from, to, why }`.

## Events on the bus and the notifications they cause

submitted -> nobody (the event stays for the clocks and the audit). assigned -> the holder (inapp and email, always). reassigned -> the previous holder (inapp). reassign_needed -> admins (inapp and email, always). incident_failed -> admins, and the holder when ServiceNow closed the incident (inapp and email, always). p1_p2_created -> admins (email). sla_warn (80) -> assignee and admin. sla_breach (100) -> assignee, admin, org owner (email). sla_escalate (120) -> org owner. pending -> requester. resolved -> technician (creator) and admin. verification_failed -> assignee and admin. approval_requested -> approvers. approval_overdue -> approvers then org owner. approved / rejected -> the sender. write_failed -> admin and the holder (email, always). completed -> the sender (inapp and email). Every row carries `data` `{ planId, rackId, rackName, siteName, incidentNumber, incidentUrl, kind }`. Dedupe key = event + plan id + recipient + plan version.

## The verification rule

post_fix: the new scan is compared with NetBox the same way a preview is. For every item in the plan: if the item's observed value on the new scan equals the proposed value (the drift is confirmed twice), ok; if the item no longer differs from NetBox (the field was fixed to match the record), ok and the item becomes `not_applicable` with disposition `remediate`; anything else fails with `observed` recorded. Pass = every decidable item ok.

post_write: re-read NetBox after the write; every written item must match its proposed value. Fail -> reopened with `write_mismatch`.

## Rules carried from the code as it stood on 18 September (commit 8b78a16)

- Assign before decide: approve or reject on an item needs its ticket resolved or closed. One exception: a rebind.
- A rebind re-labels a record NetBox already has under another key. It is approved or rejected as it stands, it is never assigned, and a whole-rack assign leaves rebinds for approve or reject.
- Decisions are per device, not per port. A port follows its device (parent_uid on the port, following on the device); ports are never separate questions.
- The rack key is minted by server/lib/netbox/rack_match.js as t<tenant>:<row> from the customer's own rack row; uids read rack:t7:5, dev:t7:5:u10, if:dev:t7:5:u10:1 and are opaque to every screen.
- A write with failures is write_failed, named per object, emailed to the admin who ran it, and retryable under the fingerprint check.
- A technician (member) may adopt, preview, read their own plans and contacts, and submit. Nothing else.
- Every rule above is asserted in server/test/netbox/plans.test.js, approvals-grouping.test.js and rules.test.js; those assertions must keep passing over the new storage.

## Defects found in review on 18 September, to be built right in the new store

From a three-reviewer check of commit 8b78a16 by the owner's second session. None of these may be carried over.

- A plan is not settled while any decidable item has an open ticket. The write refuses when no decidable item is approved. A ticket cannot be resolved on a written or completed plan.
- A write_failed retry: the plan records writtenUids across attempts; the recheck passes when every fresh actionable row is in the approved plan with the same action and diff, and every approved row missing from the fresh compare is in writtenUids.
- A child follows a rebind parent only when it is itself a rebind. A create or update port under a rebind device is its own item under assign-first.
- A whole-rack assign takes only the waiting set: pending, decidable, not a rebind, no ticket, no finding. It never wipes a finding. The server returns the waiting set so the client's count matches.
- Resolve matches the assignee against the signed-in user only, and a non-empty finding is mandatory.
- Rack access is checked for every role, inside the snapshot builder, so preview, export, the file exports and the webhook share it.
- A plan is opened by id. A compare that matches the open plan of the same rack returns it with reused: true. GET /plans?rackId=&open=1 finds it.
- The fingerprint stays byte for byte: uid NUL action NUL stableJSON(diff), rows sorted, sha256. A test pins a known input to a known hash.
- 400 for a body that mixes the whole-rack form with single items; 409 for resolving a shared ticket other than through its device; a whole-rack assign skips rebinds. All three tested at the route.
- Unknown item fields pass through unchanged (json extra column). What an action may do (decidable, ticketable, exempt from assign-first) comes from one table of action traits, so a future adopt or bind action needs no route change.
- server/routes/netbox/scans.js belongs to the second session (adopt is being fixed there).
