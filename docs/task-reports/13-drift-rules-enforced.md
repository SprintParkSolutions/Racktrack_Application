# Drift approval: the frozen rules enforced on the server and in the screens

Ticket SPRTMS-1684, sub-tasks SPRTMS-1685 to 1687. Built 17 September 2026, live on demo.racktrack.ai and portal.racktrack.ai the same day.

## How it was before

The drift-to-record workflow was frozen on 11 September: technician checks, admin assigns, assignee resolves, admin decides, system writes. A code check on 17 September, made while reading the manager's Ticketing and Drift Approval specification, found eight places where the code did not keep those rules. The server accepted an approve or reject on an item nobody had been assigned to, and the phone app offered Approve and Reject straight away. A NetBox write with failures still marked the plan as applied and told nobody. No drift action reached the audit table. A technician could not run the compare at all, because every route under /api/nb needed a site manager. The portal showed two controls the server did not implement. My checks listed the whole organization's plans. The assignee was stored by name only. The drift ticket list was admin-only in the portal navigation but not on the server.

## What we decided, and why

This is Phase 0.5 of the plan written against the manager's specification: the part that needs no decision from anyone, because it only makes the code do what we already agreed. It is done first so the later phases build on behaviour that is true.

## What we built

- Server (`server/lib/netbox/plans.js`, `server/routes/netbox/plans.js`, `netbox.js`, `scans.js`, new `gates.js` and `trail.js`, `app.js` mount): approve and reject are refused on the server for any item whose ticket is not resolved, with the refusal "assign first"; the whole-rack assign (uid "*") raises one incident per pending item and answers with the list; a write with failures marks the plan "write failed", keeps the named failures, emails the admin who ran it, and allows a retried export under the same fingerprint check; an audit row is written for submit, assign, resolve, decide and write; a member can adopt, compare, read their own plans, read contacts and submit, and is refused everything else with 403; the plan list takes `?mine=1` and forces it for members; the ticket list is gated to admins; the assignee is stored with the NetBox contact id and email, and an assign whose name matches no contact or more than one is refused.
- Portal (`src/pages/Approvals.jsx`, `MyChecks.jsx`, `Incidents.jsx`, `src/lib/api.js`): a write failed plan shows which objects failed in plain words with "Try the write again"; the server's "assign first" refusal appears beside the item; whole-rack assign and "ports follow this device" work from the server's data and hide when it is absent; My checks asks for the caller's own plans; the drift tab shows the assignee email and whether the record was written.
- Phone app (`client/src/pages/ApprovalsPage.jsx`, `AdminInboxPage.jsx`): Approve and Reject appear only after the item's ticket is resolved; the first move is Assign; write failed plans are listed with the failed objects and a retry.

## How it works

Every decision goes through one function on the server that knows the item's ticket state. A ticket moves open, resolved, closed; only a resolved ticket lets the admin decide, and the decision closes it. The export route reads the writer's result: any failure sets the plan to write failed instead of applied, stores the failures by uid, type, name and reason, and sends one email; the next export on that plan is the retry, still fingerprinted against live NetBox. Route gates are explicit per route: `admin` is owner, org admin and site manager; `technician` adds member. A member's reads are filtered to plans they created, and a preview is allowed only on racks their Site owns.

## The rule we hold to

Nothing changed in the frozen workflow. The technician never decides, the admin assigns before deciding, a resolved ticket is not an approval, only the admin's approval writes, nothing is written if NetBox moved, and the ticket goes to the person NetBox names or the one the admin picks.

## An example

A technician in Hyderabad DC1 runs the compare on rack R01 and sends it. The admin opens Approvals, sees two differences, presses "Assign the whole rack" and picks the NetBox contact; two incidents are raised and one email goes out. The admin tries Approve on one item before the contact has looked: the server answers "assign first" and the portal shows it beside the item. The contact resolves the incident in ServiceNow; the admin opens the plan, sees the finding, approves both, and writes. NetBox refuses one interface; the plan shows "Write failed", names the interface and the reason, and the admin gets an email. After the contact fixes it, "Try the write again" writes the rest and the plan is applied. Every step is in the audit log.

## What we found

- Parent and child items were already produced by the plan builder; only the route test was missing. Added.
- The portal reads the failed list from `result.failures` when the server names each failure, and falls back to a count.
- Owner and org admin may resolve any ticket; a site manager must be the assignee, matched on name, email or contact id.
- A contacts read for a member is limited to their own plan.

## Measured

- Server suite: 285 tests, 259 pass, 0 fail, 26 skipped (before: 278 and 252). New test file `server/test/netbox/rules.test.js` boots the app and checks each rule at the HTTP layer, including a member getting 200 on the six allowed routes and 403 on decide, export and the ticket list.
- App: 145 tests pass, 1 skipped (before 136); nine new tests on ApprovalsPage, AdminInboxPage and DriftPage; build clean.
- Portal: lint 0 errors, build clean. Driven headless at 1440 px and 390 px against a stub of the server contract: inbox, plan with ports folded under the device, approve refused with "assign first", whole-rack assign, write failed, retry, drift tab, My checks; no console or page errors.
- Live on the demo after deploy: as the owner, the plan list with `mine=1`, the ticket list and the write failed filter answer 200; as a new technician `meridian.tech` in Hyderabad DC1, the plan list answers 200 and the ticket list, decide and export answer 403.

## How to check it yourself

Sign in on portal.racktrack.ai as an admin with a submitted plan and press Approve on an item that has not been assigned: the item says "assign first". Assign the whole rack: one incident per item. Sign in on demo.racktrack.ai as meridian.tech (a technician): the drift check runs and sends; the approvals inbox and the write are refused.

## Where it lives

Server: `server/lib/netbox/plans.js`, `server/routes/netbox/plans.js`, `server/routes/netbox/netbox.js`, `server/routes/netbox/scans.js`, `server/routes/netbox/gates.js`, `server/routes/netbox/trail.js`, `server/app.js`, `server/test/netbox/rules.test.js`, `server/test/netbox/plans.test.js`. Portal: `src/pages/Approvals.jsx`, `MyChecks.jsx`, `Incidents.jsx`, `src/lib/api.js`. App: `client/src/pages/ApprovalsPage.jsx`, `AdminInboxPage.jsx` and their tests. Plan: `docs/design/drift-approval-spec-plan.html`.

## What is not done

- Plans are still JSON files on disk; moving them into tables is Phase 1 of the plan and waits for the manager.
- ServiceNow state is still read only when the admin opens a plan; a timer or webhook is Phase 1 or 3.
- The verification re-scan, reason codes, SLA clocks, notifications beyond the assign and write failed emails, exceptions, dashboards and the new roles are the remaining phases, pending the owner's discussion with the manager.
- Nothing is committed.
