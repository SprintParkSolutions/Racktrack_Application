# Part B, the dedup: why the first design failed, and the safer one

Status: design review, 17 September 2026. The first draft was put to three
independent adversarial reviewers before any code was written. All three
refuted it. This note records what broke it and the revised design, so the
reasoning is not lost and the mistakes are not repeated.

## The problem Part B solves

A scanned rack is identified only by a hash of its photo (the RK- id). Every
NetBox object id, the `racktrack_uid` custom field, is built from that hash:
`rack:<hash>`, `dev:<hash>:u<pos>`, `if:<devUid>:<n>`. Two photos of one
physical rack therefore produce two id sets and a duplicate rack in NetBox.
Part A (live) resolves a scan to the customer's known rack through the space it
was captured in. Part B is meant to key the NetBox ids on that known rack so
re-scans merge instead of duplicating.

## The first draft, in brief

1. Stable key = the typed rack row's own `rack_id`.
2. `cv.toSnapshot` uses the key for every uid when the scan resolves.
3. When confirmed, the writer adopts the existing NetBox rack by its id and
   stamps the new uid on it.
4. At export, before the write, re-key this scan's previously written objects
   from the hash uids to the key uids.
5. Resolve in the adopt path and pass the key into the snapshot.

## What broke it (high severity, agreed across reviewers)

1. **The key is not unique where it must be.** A typed `rack_id` is unique per
   tenant, but `racktrack_uid` is one field for the whole NetBox instance. Two
   tenants of one organisation sharing a NetBox, each typing `RK-ROW1`, merge
   their racks silently.
2. **"The only typed rack in the space" becomes a mis-merge engine.** A space
   set up with one typed rack but twelve physical racks keys every scan in that
   room onto the one rack and writes their hardware into it. The rule was safe
   when it only chose a contact; it is not safe when it chooses the write key.
3. **Adopt-by-name reaches across the whole instance.** The NetBox lookup has
   no site filter and takes the first hit, so `Rack 1` at another site can be
   adopted and then moved.
4. **Adopting the customer's rack lets the writer rename and move it.** The rack
   payload still comes from the scan (name, site, height), so the adopted rack
   is patched to the scan's local alias and the RackTrack site. There is no
   notion of a bind-only object.
5. **Adopting a rack that already holds devices fails every device.** Blind
   creates at occupied U positions are rejected by NetBox; every interface on
   them is skipped.
6. **Adopt and re-key can stamp one uid on two racks.** The writer's "more than
   one object shares this uid" guard then refuses everything for that rack, with
   no recovery path in code. Two earlier exports under two hashes hit the same
   trap.
7. **Migration at export time guarantees a refused first export.** Preview
   plans against the un-migrated NetBox (everything is "create"), the admin
   approves, the migration changes NetBox, the fingerprint no longer matches,
   export returns 409. Worse, NetBox was mutated on the refused path.
8. **Two different tenant ids.** Part A resolves with the plan's tenant (the
   caller's), Part B would resolve with the scan's tenant. For an owner or an
   org admin they disagree about the same rack.

Medium findings worth carrying: a half-completed re-key is not resumable;
re-detect and capture still mint hash uids and silently revert an adopted scan;
a NetBox that is down at adopt time freezes `netboxId = null` into an
idempotent snapshot; bumping `SNAPSHOT_RULES` wipes reconciled state; a
position-keyed device id rewrites a device's identity when the occupant of a
slot changes; two typed racks with one name are picked by sort order.

Facts from the code maps that shape any design: preview and export read the
snapshot stored at adopt and never rebuild it, so uids are frozen at adopt
time; the plan fingerprint hashes the uid, so any uid change is a 409 and the
old plan stays in the inbox; `filterSnapshot` withholds nothing when uids
differ, so the fingerprint is the only guard; the adopt handler is synchronous
and has no NetBox client; the scan's owning tenant is already on disk as
`meta.tenantId`.

## The revised design

1. **A server-minted, globally unique key.** `t<tenantId>:<racks_known.id>`, standing
   where the photo hash stood, so a rack reads `rack:t7:5` and a device `dev:t7:5:u10`.
   The row id is unique across tenants; nothing the admin types becomes a key.
2. **Key only on explicit identification.** Use the stable key when the resolver's
   source is `name` or `set-up-directly`. The single-rack-in-space rule keeps
   naming the contact but never chooses the write key.
3. **No adopt-by-hint and no migration inside export.** The planner becomes
   alias-aware: when `rack:<key>` misses in NetBox, it looks for this scan's old
   `rack:<hash>`; if found, it plans a visible **rebind** item (from uid, to uid)
   that the admin sees in preview and approves like any other change. Preview
   and export then agree, the fingerprint is stable, and NetBox is never touched
   before approval.
4. **Guards before any uid patch.** The target uid must be absent on every
   endpoint; a rack is bound only if it carries no `racktrack_uid`; a NetBox
   lookup must be filtered by site and return exactly one hit.
5. **Binding the customer's pre-existing rack is its own explicit action.**
   "Bind this rack" is a step the admin triggers, bind-only (custom field only,
   never name, site or height), with its existing devices matched by position
   and offered as "adopt device" items rather than blind creates.
6. **One tenant for both halves.** The scan's owning tenant (`meta.tenantId`) is
   stored on the scan and the plan, and Part A and Part B both read it.
7. **Persist the key.** The resolved key and why live in the scan payload, and
   re-detect and capture reuse it, so nothing silently reverts to the hash.

## Staged scope

- **Stage 1, safe dedup for new work.** Points 1, 2, 6, 7, and the alias-aware
  planner with the visible rebind item (3, 4). No adopting of pre-existing
  customer racks. Proved by the round-trip test: two hashes, one key, second
  write all no-op; a rebind appears as a plan item; two tenants, one typed id,
  two racks; never a delete.
- **Stage 2, bind the customer's existing rack.** Point 5, with device matching
  by position and the bind-only rack. Its own explicit action and its own test.
- **Out of scope for both.** Merging two earlier hash-keyed exports of the same
  rack automatically; that stays a reported finding for a person.

## Where the review came from

Three code-path maps (snapshot, writer, fingerprint and export) and three
adversarial reviews (dedup correctness, migration safety, blast radius), run as
one workflow on 17 September 2026 before any code was written. The per-agent
results are in the session's workflow journal.
