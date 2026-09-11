# The drift-to-record workflow — frozen

Status: **frozen, 11 September 2026.** This is the definition. Do not reshape it
from a one-line message; change it here first, deliberately, or not at all.

## The one line

> Technician assigns nothing → admin assigns → assignee resolves → admin decides → write.

## The five steps, and who does each

| # | Step | Who | What they can do | What they cannot do |
|---|---|---|---|---|
| 1 | **Check** | Technician | Scan a rack, compare it to NetBox, see what differs, send the whole list to the admin. | Approve, reject, assign, or write anything. |
| 2 | **Assign** | Admin | Hand each difference to the person who looks after that rack (its SPOC), which raises a ServiceNow incident and emails them. | Approve or reject on their own judgment. |
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

When the admin assigns (step 2), the SPOC is emailed and a ServiceNow incident
is raised in their name. When the incident is resolved (step 3), the item
returns to the admin's Approvals inbox and appears resolved in Drift tickets.
