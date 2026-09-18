# The plan against the code, and the order to build it in

Measured against the working tree on 18 September 2026. The plan is
[match-and-reconcile.html](../netbox/match-and-reconcile.html) and
[match-and-reconcile-detailed.html](../netbox/match-and-reconcile-detailed.html), written by the
product owner on 11 September 2026. The plan is the specification and is not re-opened here. This
document says only where the code stands against it, and what to build first.

## In one paragraph

A great deal of the hard part is already written. The photo side reads every box, every socket and
every cable colour. The switch side reads every port and whether it is up. The approval side is the
strongest part of the whole system: a frozen list, one admin, a re-check against the record
immediately before writing, and no way to delete anything. What is missing sits in the middle, and
it is smaller than it looks. Two pieces are one wire away from working: the rack label matcher is
finished, tested and reachable by no screen, and the port fingerprint that tells two identical
switches apart is finished, tested and called by nothing but its own test file. What is genuinely
not built is the one thing the owner asked for. RackTrack can only find an object in the customer's
database if RackTrack itself wrote that object. There is no way to look up a device by its serial,
its name or its shelf, so a rack the customer filled in by hand cannot be matched at all: every box
in it reads as new, and the devices already in the record are invisible. That single missing lookup
is why a live compare shows every device as "create" against a rack the database already holds. It
is the first real piece of work below, and the patch that would consume it is already written.

## How to read the tables

The state words mean:

- **Built** - it works and it runs in the normal flow.
- **Built, not wired** - the code exists and is tested, and nothing calls it.
- **Partly built** - some of the rung runs, and a named part of it does not.
- **Not built** - there is no code for it.

Two things to know before the tables. First, the plan makes no claim of its own about the rack
ladder. The phrase "In RackTrack today" appears five times in the detailed document and every one of
them sits in the device half, sections 08 to 12. So every state against the rack ladder below is a
measurement made for this document, not the plan's own account. Second, where the plan does state
what exists, it is accurate. Its note that the box-to-switch score uses model, make and port count
at plus 200, plus 100 and plus 60, high at 160 and medium at 55, is `reconcile.js` constant for
constant.

## The rack ladder, rung by rung

One rack out of every rack the customer has.

| Rung | What the plan wants | What the code has | State | What is left |
|---|---|---|---|---|
| 01. A code or label on the switches | "A QR or barcode is scanned, a label is read, and either is looked up in the record." The plan calls it "the fastest and most certain path in the whole ladder". Named inputs: QR or barcode, label text, MAC, serial, chassis ID. | No decoder of any kind exists in the photo path. The label half runs but answers the wrong question: `rack_identity.js:640` looks a read label up in NetBox by name only, and the answer names the rack, never a switch. `rack_identity.js` requires no switch source at all, so MAC, serial and chassis ID have no route into this rung. | Partly built | A decode pass that runs before OCR and reports a scan or nothing. A lookup that returns the switch's record. A wire from rack identity to the switch reader. |
| 02. The rack's own ID | "Get the rack ID and match it to the database. The database gives us the switch information for that rack. Then filter on the login devices." | `rack_match.js:52` asks NetBox by facility id first and then by name, which is the plan's stronger-key-first order, and it runs live. But it looks up the id an admin typed in setup, never one read off the scan; it carries no site filter and takes the first row; and the second half of the rung is absent. The switch candidate set is whatever an admin filed against that scan, not what the record says is in the rack. | Partly built | A site filter and a refusal rather than a first row. The rack ID read off the photo fed in. The matched rack's devices read from NetBox to narrow the switch set. |
| 03. Where it stands | "Filter the database by that location." The strong form uses a per-rack floor-plan coordinate and a capture device that reports where it is standing. | Room narrowing works: candidates come from the scan's space and the spaces beneath it, and with no space the whole site is searched and every answer is demoted to a suggestion. But space is an optional dropdown that defaults to "Not chosen", and no scan on disk carries one. No coordinate field exists anywhere. | Partly built | Ask for site and room before the ladder rather than offering it. The floor-plan form needs a coordinate on the rack record and a capture device that knows where it is, and neither exists. |
| 04. Print on the rack itself | "Use OCR to read the information off the individual rack. Filter on what it says, find that rack in the database." | The most complete rung in the tree. `rack_identity.js:373` matches rack labels in three strictness tiers, weights them by OCR confidence, repairs known confusables, compiles the customer's rack pattern under a time budget, and keeps two labels naming two racks as a disagreement rather than a choice. Its input readers exist too. It is reachable only at `GET /api/scan/:rackId/identity`, and no screen calls that route. The rail-chip reader has never produced a file. | Built, not wired | Call the rail-chip reader in the scan flow and put the identity answer on a screen. Nothing needs writing. |
| 05. What is inside it | "The devices in it, the units, the empty spaces, the cable information", compared with the racks still in play. | One of the four inputs, by name only. `rack_identity.js:632` ranks racks by the share of device names found under them, with a minimum of three names, a sixty per cent share and a tie that refuses to decide. Units, empty shelves and cable information are produced in the report and read by nothing. The label parser rejects a bare hostname, an asset tag and an address, so on four of the seven racks on disk no box is labelled at all. | Partly built | Compare the three inputs already sitting in the report against the surviving candidates. Widen the label parser. |
| 06. A person picks it, or says the rack is new | "The person selects the rack manually, and the flow carries on exactly as it would have if a label had identified it." Rung 6 also has a second choice: this rack is new. | Fully built on the server and reachable by nobody. `confirm()` takes exactly one of three answers, refuses a rack at another site, refuses when two set-up racks match one NetBox rack, and records the choice. No screen calls it, and the table it writes to does not exist yet, so it has never once run. | Built, not wired | A screen showing the shortlist the ladder already produces, with the "this rack is new" second choice. |
| The exit | "Whether the rack was identified from a label or chosen by hand, what happens next is identical." | Not true today. The write path calls `rackMatch.resolveRack` only, and nothing outside the rack-identity module reads a confirmed rack. Worse, of the three confirm branches only two name the scan's own record, so the branch that gives the right answer is the one whose answer the writer cannot see. | Not built | Make the write path read the confirmed rack, and fix the branch that does not name the row. |
| The outcome the owner asked for | "Connect a rack to the database rack exactly the one." | The only way any object is found in NetBox is our own custom field `racktrack_uid` (`netbox.js:193`). There is no lookup by serial, by name, or by rack and shelf anywhere. A rack the customer populated by hand is at the same moment un-findable, so every box is a create, and un-reportable, so the orphan list stays empty however many of their devices are in it. | Not built | One resolver that produces a target from a serial, a name or a rack and a shelf. The patch that consumes it is already written. |

Worth knowing about this ladder. The candidate universe on this checkout is empty: there are no rack
rows and no space rows in the database, and the rack-identity table has never been created. So the
rack matcher must answer "none" for every scan regardless of any code gap, which is consistent with
the live symptom. The ladder is not failing to choose between candidates. It has no candidates.

## The device ladder, rung by rung

One box tied to one record and one live switch.

| Rung | What the plan wants | What the code has | State | What is left |
|---|---|---|---|---|
| 01. Where it sits, and what was here last time | The record says what should be on shelf 18, and last scan's binding says what was. Marked Modelled or Remembered, never Confirmed. | Position is carried to the screen and is never an input to matching. The record half is fetched and thrown away: the writer already pulls every device NetBox holds for the rack, with its position, serial and type, and reads four keys off the answer. There is no binding store at all; a person's answer lives on the scan payload and is replaced on the next re-adopt. | Not built | Index the devices already in that response by shelf and by serial at match time. A binding store keyed on something that survives a re-photograph. |
| 02. A code on the box | "Scanned, not read. Asset tag or serial straight to the record, then confirmed on the wire." The one rung that reaches Confirmed without a person. | Nothing. No decoder in the photo path, and no lookup by serial or asset tag on the record side. The camera writes serial and asset tag as null on purpose, with the comment that an empty field is a fact. | Not built | A decode pass, a field to carry the value with its source, and the record lookup. Half of it alone is worse than none: a code nobody can resolve. |
| 03. The label | "Label to record, then record to wire. A label the wire disagrees with is reported as stale and is not trusted." | A label is read and becomes the box's name, and is never compared with anything. There is no NetBox device lookup by name. There is no wire check and no stale-label finding. The parser also rejects three of the four label kinds the rung names. | Partly built | A name lookup scoped to the rack first, then the site, with no nearest-name guess. The wire check after it. A wider parser. |
| 04. The print | "Wordmark and model to the device type. Read and inferred kept apart, and only a read model is written." | The live matcher's main signal on paper and dead in the data. The score gives plus 200 for a model and plus 100 for a make, but the snapshot builder reads make and model from two keys that are present on 0 and 5 of 336 devices, so 331 boxes reach the matcher as make "Unknown" and model "Unidentified", and both terms drop out. The richer OCR exists in another file and never arrives. There is no read-versus-inferred marker. | Partly built | Carry the OCR that already exists into the snapshot, with its own confidence and alternates. Route make-only and failed boxes to the close-up endpoint that already exists. Keep read apart from inferred. |
| 05. The silhouette | "Class, height and port layout give the family and strike out every candidate of the wrong shape", matched as structure against front elevation images. | The class half only, and only as a veto over three classes, which is correct as far as it goes. Height is produced on both sides and never compared. The only shape term in the score is the raw port count. No structural matching exists. | Partly built | Height as a filter. A structural descriptor per crop against the device-type library. A wider class veto: the camera produces twelve classes and three are handled. |
| 06. The port fingerprint | "Cabled sockets against ports that are up, uplinks first. The winner must clear the runner-up. This is the rung that separates two identical, unlabelled switches." | Both inputs exist and are populated, and the comparer exists too, and nothing joins any of them. `fingerprint.js` implements the rung to the letter: the four verdicts, a dark cable counted as unknown and never a mismatch, sockets not visible dropped rather than read as empty, uplinks weighted three to one, virtual interfaces dropped, and a rank that refuses unless the winner clears a floor and beats the runner-up by a margin. Nothing imports it except its own test. | Built, not wired | A call site. The camera's occupancy read before the matcher replaces it. A passive-class gate. Honest digits. Then port templates, without which the two sides count a different number of sockets and the comparison falls back to counting. |
| 07. The beacon | "The admin lights the locator LED from their own console; the phone sees which box answers. RackTrack asks, watches, and never sends the command." | Nothing. The companion rule is already held structurally and would not have to change: both the phone and the server build read-only requests only, so there is no way to write to a switch anywhere. | Not built | One screen: a button that asks the admin to light a named candidate, a camera view that watches, and a place to record which box answered. Nothing on the switch side changes. |
| 08. A person picks from the shortlist | "The shortlist is two or three boxes, not the rack, and never the site. Recorded as Confirmed with the person as its source, and the next scan starts from it." | A person does decide, and that is the one thing holding the line today. None of the four properties holds. The screen offers every box in the rack. The posted answer is validated in no way at all: there is no check that the switch belongs to this rack, that the box exists, that it is not a patch panel, or that one box holds one switch, and the switch's serial, model and ports are then written onto whatever box was named, with no confidence gate. The answer carries no source and no date, and the next detection replaces it. | Partly built | Cut the list to the candidates the rungs left, and say the count and the reason when it is too long to be a shortlist. Validate the posted pairing on the server. Record the choice with the person and the date, outside the scan payload. |

Worth knowing about this ladder. The tie rule is not approximately broken, it is literally broken.
Pairs are sorted by score and then taken greedily first come, so two identical switches in two
identical boxes are separated by the order they happen to sit in a list. A lone candidate then has
its confidence raised a notch, which inverts the plan's Possible rule: the plan says exactly one
candidate fitting means put it to a person and never write it. The owner's hard case is currently
decided by array position.

## The build order

Ordered by how much certainty each slice buys and how soon, not by how easy it is. A slice that
makes a bind exact ranks above one that makes a guess prettier. Each slice is meant to be small
enough to review in one sitting.

### 1. Refuse the answers that cannot be right

**What it is.** Three small changes in the two places that decide, plus the route that stores a
person's answer. Scope the NetBox rack query by site, ask for two rows rather than one, and refuse
with both names when two answer. Add the runner-up margin to the box matcher and delete the notch
that raises a lone candidate's confidence. Validate a posted pairing on the server: the switch must
belong to this rack, the box must exist, it must not be a passive class, and one box holds one
switch.

**Rungs.** Rack rung 2's collision guard. Device rung 8's precondition. The plan's rule that a tie is
never resolved by picking the first one.

**Files.** `server/lib/netbox/rack_match.js`, `server/lib/netbox/reconcile.js`,
`server/routes/netbox/scans.js`.

**Proof.** Two NetBox racks sharing a facility id at two sites returns no rack, both names and a
reason. Two identical switches against two identical boxes returns no match and names both boxes,
with no confidence attached. A pairing naming a patch panel, or a switch from another rack, is
refused with a sentence.

**Leaves out.** Making either decision right. Nothing new is found and nothing new is read. This
slice only changes what happens when the evidence does not separate the candidates.

**Why first.** Every slice below adds candidates. More candidates fed to a decider that breaks ties
by array position is a net increase in the number of ways to bind the wrong one.

### 2. Find the customer's own record, not only our own

**What it is.** One resolver that produces a target from something other than our own custom field: a
rack by site plus facility id or name, a device by rack plus shelf, a device by serial. Feed it into
the writer where the target for a bind-only patch is chosen. Stop the orphan check discarding NetBox
devices that do not carry our field.

**Rungs.** The rack ladder's outcome, which is the owner's sentence. Device rung 1's record half.
The high-tier findings "Replaced: same shelf, same address, different serial inside" and "A device
turns up in a different rack from its record", neither of which can be seen today.

**Files.** `server/lib/netbox/netbox.js`, `server/lib/netbox/writer.js`.

**Proof.** A compare against a rack the customer populated by hand comes back with rebind and update
rows instead of a list of creates. The orphan list is no longer empty. A device already sitting on
that shelf is reported when the list is frozen, rather than discovered from an error at write time.

**Leaves out.** Choosing between two devices that both answer. That is slice 1 doing its job: two
answers means no bind and a shortlist.

**Why here.** This is the single highest-value change in the document. The bind-only patch that
consumes it is already written, already reports as its own action, already re-checks for a
collision immediately before patching, and already refuses rather than guess. The plan row, the
approval, the freeze and the audit trail all sit behind it unchanged. What it needs is a way to name
the target.

### 3. One confidence scale, and nothing weak is written

**What it is.** The plan's four outcomes and the binding standard's eight ranks as the single scale,
carried on the plan item. The item shape already passes unknown keys through, and its own comment
names a future binding object, so the carrier is prepared. Then gate the hardware facts on it, so a
Possible binding is a question and never a write, and a conflict waits for a person.

**Rungs.** None on its own. It is what makes every rung's answer mean the same thing.

**Files.** `server/lib/netbox/model.js`, `server/lib/netbox/reconcile.js`,
`server/lib/approvals/shape.js`, `server/lib/netbox/writer.js`.

**Proof.** A Possible binding produces a question on the admin's list and writes nothing. A Probable
one is written on approval and marked at the destination. The three unrelated scales in the tree
today become one, and a plan item carries a confidence where today it carries none.

**Leaves out.** The finding tiers and the five difference kinds. A plan item's vocabulary stays the
writer's for now.

**Why here, and not later.** Slice 2 changes the consequence of a weak match. Today a weak match
creates a duplicate, which is untidy. Once the customer's own records are findable, the same weak
match edits a record the customer relies on. Slices 2 and 3 are two reviews and one release.

### 4. Let a person answer the rack question, and make the answer the write key

**What it is.** Fix the confirm branch that does not name the scan's own record, so all three
branches behave alike. Make the adopt and capture paths read a confirmed rack before falling back to
the setup-time match. Add the screen that shows the shortlist the ladder already produces, with the
second choice that says this rack is new.

**Rungs.** Rack rung 6 and its second choice. The exit rule that says every rung exits to the same
place.

**Files.** `server/lib/rack_identity.js`, `server/routes/netbox/scans.js`, one client screen.

**Proof.** Confirm by each of the three branches in turn, and the next compare writes under the same
rack key in all three cases. Today two of the three reach the writer and one silently does not.

**Leaves out.** Rungs 1 to 5 deciding on their own. Until slice 6 a person answers the rack question
on most racks, which is the plan's worst case working correctly rather than a failure.

### 5. Ask for site and room before the ladder, and make the saved match survive a re-photograph

**What it is.** Make the space a question the technician answers before the ladder runs rather than a
dropdown that defaults to "Not chosen". Store it on the scan. Key the saved match on the rack
identity rather than on a fingerprint of the photograph, so a second photo from a different angle
starts from the earlier answer.

**Rungs.** The rule before rung 1. Rung 3's room half. Rack case 09, "save the match, rerun the
ladder only when the rack stops looking the same".

**Files.** `client/src/pages/ScanPage.jsx`, `server/app.js`, `server/lib/rack_identity.js`.

**Proof.** The same rack ID in two rooms resolves separately rather than colliding. A second photo of
a rack that was confirmed once does not ask again.

**Leaves out.** Floor-plan coordinates. No coordinate field exists on either side, and a capture
device that reports where it is standing is a separate project, not a slice.

**Why before slice 6.** With no space, the candidate set is the whole site and the ladder demotes
every answer it finds to a suggestion. Slice 6 produces answers, and this slice is what lets them
count.

### 6. Run the rack ladder that is already written

**What it is.** Call the rail-chip reader in the scan flow so it produces a file for the first time.
Put the rack identity answer on a screen. Rebuild the physical layer report when its inputs change
instead of serving a report built once, in September, from cache forever.

**Rungs.** Rack rung 4 outright, and the device-name half of rung 5.

**Files.** `server/app.js`, one client screen, `pipeline/physical_layer.py`.

**Proof.** A rack carrying a rail chip or a front label comes back with a rack label and a source
that is not "minted". Six of the seven reports on disk are minted today, and the seventh got its
name only because a second OCR engine happened to have been run on that folder.

**Leaves out.** Rung 1's scanned code, and the three inputs of rung 5 that are produced and read by
nothing.

**Why this is cheap.** The matcher, the confusable repair, the tier weighting, the disagreement rule
and the route are all built and tested. This is plumbing, not design.

### 7. Wire the port fingerprint, honestly

**What it is.** Call the ranking function from the matcher. Read the camera's occupancy before the
matcher replaces it with the switch's ports, because after that line the socket side of the
comparison no longer exists. Gate passive classes at the call site, since the module has no class
rule of its own. Keep a weak count-based score out of the margin comparison, so it cannot act as the
runner-up a real score has to beat. Report the digits actually compared rather than a percentage of
them.

**Rungs.** Device rung 6, its safe half.

**Files.** `server/lib/netbox/reconcile.js`, `server/lib/netbox/fingerprint.js`,
`server/test/netbox/fingerprint.test.js`.

**Proof.** On the racks that hold both a camera scan and a switch reading, the boxes whose two sides
count a different number of sockets come back unsettled with a named shortlist, rather than settled
on a handful of comparable sockets. The boxes that do line up settle with their real digit count
shown.

**Leaves out.** Making it settle often. Run as it stands it settles about two boxes in twenty,
because without a port template the two sides do not line up. An admin reading "100 per cent" off
five sockets of twenty-eight would take it for proof, so the honest digits are part of this slice
and not a later polish.

### 8. Remember a box

**What it is.** One record per box carrying every claim verbatim with its source and its date, and a
binding that outlives the photograph. A person's device choice recorded as Confirmed with their
name, read back at the top of the next scan.

**Rungs.** Device rung 1's remembered half. Device rung 8's promise that the next scan starts from
the answer.

**Files.** a new store under `server/lib/netbox/`, `server/lib/netbox/reconcile.js`,
`server/routes/netbox/scans.js`.

**Proof.** Confirm a box, re-photograph the rack from a different angle, and the binding is offered
again with its source and its date. Change the box on that shelf and the binding refuses to apply,
and says which claim changed.

**Leaves out.** Inference from the card. It stores and it recalls, and nothing scores on it yet.

### 9. Port templates per model

**What it is.** A grid-to-port-name template per device type, and keeping each socket's row, column
and drawn-or-seen flag in the report so a template can be applied at all. Today the report drops
both, so a template cannot be built from it.

**Rungs.** Device rung 6 properly. This is the plan's own build item 04, the piece it says solves two
identical switches.

**Files.** `pipeline/physical_layer.py`, `pipeline/port_pattern.py`, a template store,
`server/lib/netbox/fingerprint.js`.

**Proof.** On a 48-port switch the compared digit count rises from single figures toward the plan's
worked example of 44 of 48. A vendor that numbers odd on the top row and even on the bottom, and one
that counts straight across, both map correctly.

**Leaves out.** "Sockets not visible" as a state of its own. The photo side has one word, unknown,
for a bundle, a rear port and a detector miss alike, and splitting it is a detector change.

### 10. Make the print actually fire

**What it is.** Route make-only and failed boxes to the close-up endpoint that already exists. Carry
the OCR that already exists into the snapshot the matcher reads, with the identifier's own
confidence and its alternates rather than a number re-derived from the OCR confidence. Keep read
apart from inferred, so only a read model can score or be written and a guess is shown as
"probably".

**Rungs.** Device rung 4, and the parser widening rung 3 needs.

**Files.** `server/lib/netbox/cv.js`, `pipeline/ocr_devices.py`, `server/app.js`,
`pipeline/physical_layer.py`.

**Proof.** The model term fires on a rack where it does not fire today. Right now 331 of 336 boxes
reach the matcher with no make and no model at all, so the live matcher is scoring on port count
alone.

**Leaves out.** The silhouette.

**Why this far down, when it looks so useful.** It is. But the print is a guess-improver, not a
bind-maker: two identical switches have the same print, so it can never separate them, which is the
owner's case. It also carries the one measured risk of a confident wrong answer, a model returned at
0.74 confidence on a string that appeared nowhere in the text read. Wired without the read and
inferred split, that answer would earn the largest single term in the score and drive a binding. The
split is the reason this slice waits for slice 3.

### After that

In the plan's own order, and none of them changes an existing bind from wrong to right:

- **The silhouette.** A structural descriptor per crop against the device-type library's front
  elevations, plus height as a filter and a wider class veto. It is the answer to the measured OCR
  problem of make often and model rarely.
- **The beacon step.** One screen. Nothing on the switch side changes, because there is no way to
  write to a switch anywhere in the code and that is structural, not a matter of discipline.
- **LED reading.** So that "cannot determine" splits into powered off, unreachable and gone.
- **The finding tiers and the five difference kinds.** Today a plan item says create, update or
  rebind, so a low-tier gap fill and a high-tier replacement look the same and the list cannot be
  sorted with the serious things first.

## What still needs a person after all of this

This is the honest answer rather than a gap, and the plan says so itself.

- **The last rung of each ladder.** Rack rung 6 and device rung 8 are a person by design. The work
  above does not remove them, it shortens what they are shown: a shortlist of two or three, with the
  reason, instead of a rack or a site.
- **Two identical switches with the same cable pattern and no beacon.** The plan names this exactly:
  the pattern decides, then the uplinks, then the beacon, then a person with a two-item shortlist,
  never guessed. When the gear has no locator LED there is nothing left below the person.
- **A rack or a box that is in no record.** Creating it is a choice somebody makes, not a fallback
  the code takes on its own. Today it is the only outcome and it is reached in one step, because
  there is no ladder above it to fail.
- **Every write.** One admin per site approves each item, the preview is exactly what happens, and
  nothing is deleted. That is not a limitation of the matching, it is the point of it.
- **Anything where the photo and the switch disagree.** Our own two layers disagreeing is our
  problem and never the customer's, so it is held back rather than raised.

One further limit, measured rather than designed. Rungs 1, 2 and 3 of the device ladder all end with
the same step: confirm the record against the wire. On the gear in the lab there is nothing to
confirm against. The chassis serial is empty in all eighteen stored switch readings, no switch there
implements the inventory table, and a switch read from the phone stores no chassis id at all. So
until the estate holds gear that answers those questions, or the phone is taught to read the chassis
id the server already reads, a person will be asked more often than the plan's arithmetic suggests.
That is worth knowing before any of the work above is sized, because it is not fixed by any of it.

## Notes on this reading

- Two items in the brief this document was written from are out of date, and both were checked
  rather than assumed. `server/lib/rack_identity.js` is committed, not uncommitted. And the two
  modules said to be arriving with a build in flight, a hardware-alias set and a binding that
  survives a re-photograph, do not exist on this branch at all: they are worktree-only. Nothing
  downstream can read a binding object today, which is why slice 8 exists.
- The port fingerprint, by contrast, does exist and was described as absent. It landed during the
  week this was written and implements the rung faithfully. It is the only code in the tree that
  refuses a tie by a real runner-up margin, and it is called by nothing.
- Another session edits this checkout, so line numbers move. Files are named without line numbers
  above for that reason.
