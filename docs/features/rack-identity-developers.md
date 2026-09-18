# Rack identity (developers)

A scan is known only by a hash of its photo, the RK- id, and every new photo of
the same rack is a new hash. Rack identity says which of the customer's own
racks a scan is, shows the evidence it used, and refuses to choose when it is
not clear. It is the rack half of the ladder in
[match-and-reconcile](../netbox/match-and-reconcile.html). Added 18 September
2026. Nothing in it knows a customer, a naming scheme or a site.

It builds on `server/lib/netbox/rack_match.js`, the resolver the rest of the
system already uses for the contact lookup, the ticket and the NetBox key. That
resolver knows three things: a row typed for the scan, the name a person gave
the scan, and the rack looked up in NetBox. Rack identity adds what it does not
have: the label read from the photo, the devices read from the photo, a
stricter only-rack rule, the evidence, and a person's confirmation.

## Files

| File | What it holds |
|---|---|
| `server/lib/rack_identity.js` | `identify()`, `confirm()`, `confirmedRack()`, `tenantForRack()`, the text normalisation and the pattern repair |
| `server/routes/rack_identity.js` | the two routes, as a factory that app.js hands `requireAuth`, the audit log and the physical layer builder |
| `server/app.js` | `physicalLayerReport(rackId, { refresh })`, the one builder of the physical layer report, used by `GET /api/scan/:rackId/physical-layer` and by the identity route; and the mount |
| `server/test/rack_identity.test.js` | 23 tests against a seeded throwaway database, with NetBox and the report stood in |
| `server/test/rack_identity_mount.test.js` | the router is mounted in the real app behind the real gate, and two callers share one build |
| `pipeline/physical_layer.py` | one small change: a front label is tried whole before word by word, so a sign that says `RACK 2` is one reading |

## The ladder

In order. It stops at the first rung that leaves exactly one rack.

| # | Rule | What it looks at | Answer when it leaves one rack |
|---|---|---|---|
| 1 | `record` | A person confirmed this scan (`rack_identity` row), or the scan's own `racks_known` row was typed with a name or facility id | `matched`, with the rack key |
| 2 | `label` | A rack label from `physical_layer.json` (`rack.candidates`), or the name a person gave the scan (`lib/netbox/rack_names`), against the names and facility ids of the racks known in the scan's space, including spaces beneath it | `matched`, with the rack key. With no space chosen the whole Site is searched and one hit is only `suggested` |
| 3 | `label-netbox` | The same labels against the NetBox racks of this Site's NetBox site. Skipped when rung 2 found two or more: it is the same evidence and cannot break its own tie | `suggested` |
| 4 | `devices` | The device names read on the scan, looked up in NetBox one by one. At least 3 names read, one rack holding 60 percent of them, and no second rack within 10 points. The share is the score | `suggested` |
| 5 | `only-rack` | `rack_match.pickCandidate` says one rack is set up in the space, and also: the space's `rack_count` is 1, no other scan in the space is left untied to that rack, and no rack label read says otherwise | `suggested` |

A rung that finds more than one rack does not decide; its racks stay on the
list. Rungs 4 and 5 bring different evidence, so they may still speak after a
tie, but only by agreeing with exactly one rack already on the list. If they
name a rack that is not on the list, the two disagree and nobody is chosen.

When no rung leaves one rack:

- `ambiguous`: two or more candidates remain. They are listed best first, with
  scores and reasons, and none is chosen.
- `new`: nothing matched and the space still has racks nobody has scanned
  (`rack_count`, or the counts of the spaces beneath it, minus the racks a scan
  is already tied to). The name offered in `proposal` is the one label that
  reads as a rack identifier. With none, or with two that differ, `proposal` is
  null. A name is never made up.
- `unknown`: anything else. What was read is still shown.

## What states a rack and what only suggests

Only two rules state a rack (`decision: "matched"`, `rack` filled, `rackKey`
filled): `record`, and a `label` that equals one rack in the space the scan was
tied to. `rackKey` is `rack_match.rackKeyFor(tenantId, racks_known.id)`, the
key NetBox ids are built on (`t7:5`, so a rack reads `rack:t7:5`). Where the
resolver already answers for that rack, its key is passed through.

Everything else is inference: the label against the whole Site or against
NetBox, the devices, the only rack in the space. It comes back as
`decision: "suggested"` with the one candidate first in `candidates`, `rack`
null and `rackKey` null, and only a person's confirm turns it into a rack. The
reason is finding 2 in
[part-b-dedup-design-review](../design/part-b-dedup-design-review.md): a room
set up with one rack and holding twelve would merge all twelve into it.

`confidence` follows the [rack binding standard](../design/rack-binding-standard.md):
`confirmed` for `record`, `probable` for `label`, `possible` for a suggestion,
`unidentified` for the rest.

## Putting text in one shape

Before anything is compared, both sides go through the same steps.

1. Case and outer space. `rk 07 ` is `RK 07`.
2. The pipeline's own repair (`_repair` in `pipeline/physical_layer.py`): O and
   I read as 0 and 1 when they sit next to a digit. It runs on the text as
   printed, before separators go, exactly as the pipeline runs it.
3. Separators. Space, hyphen, underscore, dot, slash and colon are set aside,
   so `RK 07`, `rk-07` and `RK07` are one key.
4. The organisation's rack pattern, when conventions has a `rack_pattern`
   (`lib/estate_profile`). A literal template (`RK-##`) is fitted position by
   position; a letter sitting where the template says digit is repaired through
   the pipeline's confusable table (O, Q, D to 0; I, L to 1; S to 5; B to 8; Z
   to 2). A regular expression is tried as read, then with the confusable
   letters as digits, and a repair is taken only when exactly one repaired
   reading fits; two that fit is a guess, so neither is used. A digit is never
   turned back into a letter, and a letter is only ever changed where the
   pattern says digit.

So `RK 07` matches a rack named `RK-07` with no pattern at all, and `rk-o7`
matches it only when the pattern says those places are digits. Without a
pattern nothing says the O is a zero, and it is left unmatched.

Per label only the strictest way it matches anything counts: as written, then
with separators aside, then as repaired. `R1-01` read cleanly equals one rack
and does not also drag in `R10-1`; `R101`, with its hyphen lost, fits both and
chooses neither. Two labels in one frame naming two racks is a disagreement,
whatever their confidence. A label that equals nothing is kept word for word in
the evidence and never matched to the nearest similar name.

The score of a label match is how it matched (1, 0.95 or 0.85) times the
confidence of the reading (1 for a name a person gave, 0.6 for a rack segment
inferred from device labels, which carries no confidence of its own).

## NetBox

Every NetBox lookup carries a site filter. The NetBox site that is this Site is
the one named like the tenant, or with its slug, or the only site there is.
When that cannot be told, NetBox is still asked, by name and facility id and by
device name, but whatever it answers is listed as a candidate with the reason
"candidate only" and is never suggested: `Rack 1` at another site is a
different rack. No NetBox client, or NetBox down, skips both NetBox rungs and
says so in `evidence.notes`. NetBox is never written to here.

A NetBox rack that is one rack already set up for the Site (same facility id,
else same name) is shown as that rack, `source: "known"`, with `netboxId`.

## The routes

Both need a signed-in user and are scoped the way the other `/api/scan` routes
are, through `lib/rack_access`: the owner, an admin of the rack's organisation,
or a member of the Site that holds it. Everyone else gets 404, never 403. For
the owner or an organisation admin the Site is the one they can see that holds
the scan; `?tenantId=` says which when two do.

### `GET /api/scan/:rackId/identity`

Optional `?spaceId=` overrides the space the scan was captured in; it must
belong to the Site. Writes nothing. When `physical_layer.json` is missing and a
rung needs it, it is built through `physicalLayerReport` in app.js, the same
function the physical layer route uses, which runs one build per rack at a
time. A scan the record already names never reads the photo.

```json
{
  "ok": true,
  "rackId": "RK-3CD81888",
  "spaceId": 4,
  "decision": "matched",
  "confidence": "probable",
  "rack": { "source": "known", "id": 5, "name": "RK-07", "facilityId": "F-07", "netboxId": 42 },
  "rackKey": "t7:5",
  "candidates": [
    { "source": "known", "id": 5, "name": "RK-07", "facilityId": "F-07", "score": 0.77,
      "reasons": ["the label \"rk-o7\" (rail chip, confidence 0.9) was repaired to \"RK-07\" because the rack pattern says digits there, and that equals the name of a rack in Hall A"] }
  ],
  "evidence": {
    "labels": [{ "text": "rk-o7", "normalized": "RK-07", "where": "rail chip", "confidence": 0.9, "repaired": true }],
    "pattern": { "rackPattern": "RK-##", "matches": true },
    "deviceHints": [{ "device": "SP-R1-U15-SW04", "unit": "u15", "netboxRack": null }],
    "notes": []
  },
  "rule": "label",
  "proposal": null
}
```

- `decision`: `matched`, `suggested`, `ambiguous`, `new` or `unknown`.
- `rack`: filled only for `matched`. `source` is `known` (a `racks_known` row)
  or `netbox`; `netboxId` rides along when the NetBox rack is known.
- `rackKey`: filled only for `matched`.
- `candidates`: every rack seen, best first, each with `score` and `reasons`.
  For `suggested`, the first one is the suggestion.
- `evidence.labels[].where`: `record`, `rail chip`, `front label` or `inferred
  from device labels`, as the pipeline names them.
- `evidence.pattern.matches`: true when any label read fits the rack pattern;
  false when none does or no pattern is set.
- `evidence.deviceHints[].netboxRack`: the one NetBox rack that device is
  under, or null.
- `evidence.notes`: what was skipped and why.
- `rule`: the rung that spoke, or null.
- `proposal`: `{ name, where, confidence }` for a `new` rack whose label was
  read, else null.

### `POST /api/scan/:rackId/identity/confirm`

Body: exactly one of `knownRackId`, `netboxRackId` or `name`. Allowed for an
admin of the Site (owner, its organisation's admin, its site manager) and for
the technician who scanned this rack; another member of the Site gets 403.

- `knownRackId`: a rack already set up for this Site. A rack of another Site or
  organisation is 404.
- `netboxRackId`: a rack in NetBox. When this Site's NetBox site is known, a
  rack at another site is 404; when it is not, NetBox only ever offered
  candidates, and choosing among them is what a confirm is for. The rack is
  tied to the one rack set up here that it is; if there is none, the scan's own
  row takes its name and facility id. With no NetBox connected it is 409.
- `name`: a rack with no record yet. The scan's own `racks_known` row takes the
  name, and is created when the scan never had one. A name that is already a
  rack here is 409 with that rack's `knownRackId`, so it is confirmed instead
  of duplicated.

It writes the binding to `rack_identity` (`tenant_id, rack_id, known_rack_id,
netbox_rack_id, source 'confirmed', confirmed_by, confirmed_at`), one row per
scan, replaced when an admin corrects it, and writes `audit.log` action
`rack.identity.confirm` with status ok or fail. `racks_known.source` keeps its
three values; that a person confirmed is on the binding row. The table has no
foreign keys on purpose, so removing an organisation is not blocked; a row whose
rack is gone never resolves.

Response: `{ ok, rackKey, bound: { rackId, knownRackId, netboxRackId, name,
facilityId, rackKey, created, source }, identity }`, where `identity` is what
the GET now answers (rule `record`).

## The rule it holds to

Never pick between ties, and never invent a value nobody read. A tie is listed,
not broken. A name offered for a new rack is a label that was read. An
inference is a suggestion until a person confirms it, and only a stated rack
carries the key NetBox ids are built on.

## How to check it

```bash
cd server
node --test test/rack_identity.test.js test/rack_identity_mount.test.js
npx eslint lib/rack_identity.js routes/rack_identity.js
npm test
```

By hand, signed in on a server that has a scan tied to a space:

```bash
curl -s -b cookies.txt https://demo.racktrack.ai/api/scan/RK-3CD81888/identity | jq '.decision, .rule, .rackKey, .candidates'
curl -s -b cookies.txt -X POST -H 'content-type: application/json' \
  -d '{"knownRackId": 5}' https://demo.racktrack.ai/api/scan/RK-3CD81888/identity/confirm | jq '.rackKey, .identity.rule'
```

## Not in this slice

- `rack_match.resolveRack` does not read a confirmation yet. When a person
  confirms a scan onto a typed rack that is not the scan's own row, the contact
  lookup, the ticket and the adopt step still resolve the old way, so the key
  they use can differ from the `rackKey` answered here until the resolver asks
  `rackIdentity.confirmedRack(tenantId, rackId)` first. Confirming a new name or
  a NetBox rack with no twin names the scan's own row, which the resolver
  already honours.
- No client screen. The app and the portal do not call these routes yet.
- Removing an organisation does not clear `rack_identity` rows. They can never
  resolve, because `racks_known` ids are not reused, but `auth.js` should list
  the table with the others.
- The pipeline's own best label (`rack.label`) can still be front-panel print
  such as ROUTER, because its rack pattern accepts any word starting with R.
  Rack identity does not use that field, only `rack.candidates`, and never
  proposes a label that does not read as a rack identifier.
- Cached `physical_layer.json` files written before 18 September 2026 do not
  have whole-sign readings such as `RACK 2`; `?refresh=1` on the physical layer
  route rebuilds one.
