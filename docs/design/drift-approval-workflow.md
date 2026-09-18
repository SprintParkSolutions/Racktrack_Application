# The drift-to-record workflow — frozen

Status: **frozen, 11 September 2026.** This is the definition. Do not reshape it
from a one-line message; change it here first, deliberately, or not at all.

## The one line

> Technician assigns nothing → admin assigns → assignee resolves → admin decides → write.

## The five steps, and who does each

| # | Step | Who | What they can do | What they cannot do |
|---|---|---|---|---|
| 1 | **Check** | Technician | Scan a rack, compare it to NetBox, see what differs, send the whole list to the admin. | Approve, reject, assign, or write anything. |
| 2 | **Assign** | Admin | Hand each difference to a person. NetBox names the rack’s SPOC and that is the default; if NetBox names none, the admin picks someone. It raises a ServiceNow incident and emails whoever it is assigned to. | Approve or reject on their own judgment. Leave it unassigned. |
| 3 | **Resolve** | Assignee | Go to the rack, check it, resolve the incident in ServiceNow with a finding. | Change NetBox. A resolved incident writes nothing by itself. |
| 4 | **Decide** | Admin | With the finding in hand, approve the item, reject it, or assign it again. | Approve before it has come back. |
| 5 | **Write** | System | Write only the approved items to NetBox, after one last check that NetBox has not moved. | Write anything not approved. Delete anything. |

## The rules that do not bend

1. **The technician never decides.** They report what they saw and hand it over.
   The person at the rack is not the person who changes the record.
2. **The admin assigns before they decide.** A difference is handed to whoever
   owns the rack, not judged from a desk. Approve and reject appear only *after*
   the assignee has resolved it and reported a finding.
3. **A resolved ticket is not an approval.** It comes back to the admin as
   undecided, carrying the finding. Somebody having looked is not somebody
   having approved.
4. **Only the admin's approval writes.** Not a scan, not a resolved ticket, not
   a confident guess. One name against every change that reaches NetBox.
5. **Nothing is written if NetBox moved.** The plan is fingerprinted at compare
   time and checked again just before the write. If it changed, nothing is
   written and a fresh plan goes back to the admin.
6. **It goes to the person NetBox names, or the one the admin picks.** The
   rack’s SPOC in NetBox is the default assignee. The admin may choose someone
   else, and when NetBox names no SPOC the admin must pick a person — the ticket
   is never left assigned to nobody. The ServiceNow incident and the email reach
   whoever is actually assigned, not whoever NetBox happens to call the SPOC.

## Where each step happens

- **Check** — the RackTrack app, in the field. Export → Drift vs NetBox.
- **Assign / Decide** — the portal, at a desk. Approvals tab.
- **Track** — the portal, Incidents → Drift tickets. Every ticket, its assignee,
  its state before and after resolve, and the finding.
- **Resolve** — ServiceNow, by the assignee.

## What is deliberately out of scope

- The technician assigning directly. They cannot; step 1 forbids it.
- Auto-writing on a resolved ticket. Step 3 forbids it.
- A second, parallel ticket path. The CMDB Service Request loop still exists in
  the code but is not the customer-facing path for drift; drift uses this
  workflow only.

## Notifications

When the admin assigns (step 2), the person it is assigned to — the SPOC by
default, or whoever the admin picked — is emailed, and a ServiceNow incident is
raised for the rack. When the incident is resolved (step 3), the item
returns to the admin's Approvals inbox and appears resolved in Drift tickets.

## Enforced on the server, 17 September 2026

The rules above were checked against the code on 17 September and eight gaps
were closed (ticket SPRTMS-1684, report docs/task-reports/13-drift-rules-enforced.md):
approve and reject are refused on the server until the item's ticket is
resolved; a write with failures is "write failed", named, emailed and
retryable; every transition writes an audit row; a technician can compare and
submit and nothing more; My checks shows the caller's own plans; the ticket
list is gated on the server; the assignee is stored by contact id and email;
the whole-rack assign and the ports under a device work. The manager's wider
specification (verification re-scan, status model, SLA, notifications,
reports) is planned in docs/design/drift-approval-spec-plan.html and waits
for the owner's discussion with the manager.
