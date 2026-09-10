# Two ticket paths, and which one a customer gets

RackTrack has two entirely separate ways of turning "the rack does not match the
record" into a ticket somebody works. They target different systems, they were
built two months apart, and **both are kept on purpose** — a customer uses
whichever system of record they actually run.

Neither is a replacement for the other. If you are changing one, check whether
the change belongs in both.

## The two

| | CMDB path | NetBox path |
|---|---|---|
| Built | 9 July 2026 | 10 September 2026 |
| System of record | ServiceNow CMDB | NetBox |
| Ticket type | Service Request (`sc_request`) | Incident (`incident`) |
| Scope of a ticket | One per rack, covering the whole diff | One per item that differs |
| Who decides | ServiceNow approval workflow | An admin, inside RackTrack |
| On approval | Applies automatically | Comes back to the admin, who then writes |
| Change detection | `diff_hash` in `cmdb_ticket.json` | `fingerprint` on the plan |
| Hears back | Polls every 5 minutes | Not wired yet — `statusOf()` exists, nothing calls it |
| State lives in | `outputs/<rackId>/cmdb_ticket.json` | `server/data/plans/<id>.json` |
| Entry point | Automatic, after a scan completes | Export → Approvals |

## The CMDB path

`servicenow/cmdb_ticket.py`, driven by `server/cmdb_ticket_proxy.js`.

Runs on its own. `server/app.js` starts a poller every five minutes and
schedules a ticket when a scan finishes. `diff_cmdb.compute_diff()` produces
the difference; if it is non-empty and no ticket is open for that rack, it
opens a Service Request. The poll cycle maps ServiceNow state back to local
state, and **on approval it runs `bootstrap_cmdb_full` and applies the changes
itself**.

Commands: `create`, `poll`, `status`, `cancel`, `dev-approve`.

The proven one. It has the whole loop, including hearing back.

## The NetBox path

`server/lib/netbox/plans.js`, `tickets.js`, `spoc.js`, and the Approvals screen.

Nothing is automatic. A comparison is filed as a **plan** with a fingerprint;
an admin goes through it item by item and approves, rejects, or hands one item
to a person. Handing it over raises a ServiceNow **incident** assigned to the
rack's SPOC, read live from NetBox contacts. A resolved incident returns the
item to the admin undecided — it never writes anything itself.

Before writing, the comparison runs again. If the fingerprint moved, nothing is
written, because somebody edited NetBox between the approval and the push.

## What they share

Both read the same `servicenow` credentials from Data Sources, so configuring
ServiceNow once serves both. Both are idempotent about repeat findings: the
CMDB path via `_find_existing_sr`, the NetBox path via a correlation id built
from the rack and the item rather than the scan.

## What is deliberately different

The CMDB path trusts ServiceNow's approval and applies on its own. The NetBox
path does not: approval happens in RackTrack, by a named person, against a
frozen list, and is checked again against reality immediately before the write.

That is not an accident of history. Writing into a customer's NetBox on the
strength of a ticket state change would mean nobody at RackTrack ever saw what
was written.

## Known gap

The NetBox path does not yet poll ServiceNow for incident state. `statusOf()`
in `tickets.js` is written and tested; nothing calls it. Until it is wired, a
person resolving an incident in ServiceNow does not alert RackTrack — the CMDB
path does this, the NetBox path does not.
