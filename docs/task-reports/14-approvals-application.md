# RackTrack Approvals: the drift ticketing and approval workflow as its own application

Ticket SPRTMS-1688, sub-tasks SPRTMS-1711 to 1715. Built 18 September 2026, live on demo.racktrack.ai the same day. Rack identity is SPRTMS-1693.

## How it was before

The drift workflow was five steps enforced across two screens: a technician's check in the phone app, and an approvals page inside the portal. Plans were JSON files on disk, one per plan. There was no status model, no verification before approval, no clocks, no notifications beyond one email, no reports, and no way to record a difference somebody had decided to keep. The manager sent a functional specification on 16 September describing the product it should be. The owner asked for all of it, in one day, for a demonstration the next morning.

## What we decided, and why

- **Its own application, not a page in another product.** The manager asked for a separate thing RackTrack redirects to, so RackTrack stays about scanning racks. It is a separate bundle at demo.racktrack.ai/approvals/ with its own repository, sharing one server, one database and one sign-in. It is not in the portal: the owner was explicit that the portal is a different product and is not to be touched.
- **Three records, not one.** A drift is the difference. A work ticket is the job of fixing it. A change approval is the permission to write. Keeping them apart is what stops a resolved ticket being mistaken for permission.
- **A verification between the fix and the approval.** The one thing the specification adds to the frozen rules that we did not have.
- **The fourteen decisions the specification leaves open were settled as defaults** in docs/design/approvals-api-contract.md, so the build could start the same day; each is a setting, not a constant.

## What we built

Server, in `server/lib/approvals` and `server/routes/approvals`: the tables, a status machine of twenty-one states with a guard and an actor on every move, the operations, a ServiceNow poller, the verification, the controlled write, four SLA clocks, the notifier, the reports, exceptions and windows. `server/lib/netbox/plans.js` became a thin adapter so the phone app and the older screens kept working, and every JSON plan was imported once at boot (31 on the demo, none lost).

RackTrack Approvals, at `/Volumes/Racktrack/racktrack_approvals`: eleven screens, an action bar that offers only the moves the server allows, a dialog per action with the mandatory fields starred, and a refusal shown beside the action in the server's own words.

Phone app: the approvals screens removed, one link out for admins, a "Track this check" link after a check is sent, and a new panel when no record system is connected that tells an admin to connect one and a technician who to ask.

Rack identity, `server/lib/rack_identity.js`: a ladder from the record, the label read from the photo, NetBox, the device names and the only rack a space expects, refusing to choose between two and never minting a key from a guess.

## How it works

Every move goes through one machine that knows the plan, the actor and the item. A decision needs its ticket resolved. A rebind is decided as it stands and is never assigned. Ports follow their device. Verification compares a second scan with the plan item by item. An approval stores the hash of exactly what was approved and the plan's version; a second approver is required where the organisation says the risk demands it, and never the person who resolved. The write snapshots NetBox before and after, writes only approved items, records every object's outcome, refuses to call a partial write a success, and verifies what it wrote. Visibility is one rule: a plan belongs to the organisation that raised it, or to its raiser when that account has no organisation, and the list applies exactly the test the read applies.

## The rule we hold to

The technician never decides. The admin assigns before deciding. A resolved ticket is not an approval. Only an approval writes. Nothing is written if NetBox moved. Nothing is ever deleted. All six were frozen on 11 September and none of them moved.

## An example

Rack RK-3CD81888, thirteen devices. The comparison found 281 differences, 255 of them ports, and asked nine questions. The admin triaged it, assigned the whole rack to the contact NetBox names, nine tickets went out, the person checked the rack and wrote what they found. The admin then tried to approve and was refused, because they had resolved the tickets themselves. An approver approved it. The approver tried to write and was refused. The admin wrote: 65 objects into NetBox, 8 refused because NetBox already held them, each named, with the retry offered.

## What we found

- The owner account could list plans it could not open, and a plan it raised belonged to nobody. One visibility rule now serves the list and the read; measured before and after on the live server.
- A failed write sent two emails, and the frozen-rules test asked for one. The notifier is now the only sender and names every refused object.
- Two test files shared the development database, so a second run of the suite was a different run. Each now uses a throwaway database.
- The approver and auditor roles existed in the gates but could not be given to anybody. An admin can now hand them out.
- The eight write failures were objects NetBox already held; the other session fixed the writer to claim them by their natural key, excluding racks and devices deliberately. Four remained, and they turned out to be two ports on one device that the camera had read with the same name; that fix reaches new photographs, not scans already taken.
- A write of a few hundred objects outlasts the request that starts it, so the page now follows the plan until it lands.

## Measured

- Server suite: 482 tests, 456 pass, 0 fail, 26 skipped, green twice in a row from the same checkout.
- Phone app: 142 tests pass, build clean. RackTrack Approvals: lint clean, build clean, a headless walk of twenty assertions at 1440 and 390 with no console errors and nothing past the edge.
- Live: the whole workflow run on demo.racktrack.ai with two people, and the three answers the phone screens depend on measured unchanged before and after the deploy by the other session.

## How to check it yourself

Sign in on demo.racktrack.ai as an organisation admin and open Approvals. Do not use the platform owner account: a plan belongs to an organisation and the owner is in none. The walkthrough with a screenshot of every step is at https://claude.ai/artifact/XYjHfgufUUMY6gzCY49jYY.

## Where it lives

`server/lib/approvals/`, `server/routes/approvals/`, `server/test/approvals/`, `server/lib/netbox/plans.js`, `server/lib/rack_identity.js` and its route and tests, `client/src/pages/DriftPage.jsx`, `client/src/utils/approvals.js`, `deploy/caddy/Caddyfile`, `docker-compose.demo.yml`, `deploy/deploy-demo.sh`, `docs/design/approvals-api-contract.md`, `docs/design/drift-approval-spec-plan.html`. The application itself is the repository `/Volumes/Racktrack/racktrack_approvals`.

## What is not done

- Alerts into Teams: the tokens do not exist yet.
- The intelligence phase of the specification, which is advisory by its own description.
- The write is one long request rather than a job with a status; the page follows the plan instead.
- The settings translate between the shape the screens use and the shape the SLA and notifier store; that wants unifying.
- RackTrack Approvals is committed in its own repository but not pushed anywhere.
