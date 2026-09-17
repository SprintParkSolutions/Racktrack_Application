# Organisation setup — developer note (slice one: the estate tree; slice two: the profile)

A tenant IS a datacentre. The console calls it a Site; setup calls it a datacentre; both are one `tenants` row. There is no separate datacentre table. Under it sit **spaces** (hall, floor, room, row — nested through `parent_id`, named however the customer names them) and **racks_known** (racks the admin typed or the camera learned, keyed by the `RK-` scan id once one exists). Nothing here is vendor-, naming- or rack-specific, and nothing calls out: coordinates are stored as the client sends them.

Slice two adds what first-run onboarding asks for beyond the mandatory three: an **organisation profile** and six optional **tenant profile sections** (contacts, vendors, conventions, systems, network, snmp), every one editable later under organisation settings. Same rules as slice one: every row says who created it, when, when it changed and its `source`; nothing is invented; secrets never come back out.

Code: `server/lib/estate.js` (estate tree, mandatory facts, completeness, state), `server/lib/estate_profile.js` (organisation profile, sections, SNMP sealing, pattern checker, vendor catalogue), `server/routes/setup.js` (HTTP), mounted in `server/app.js` at `/api/setup` behind `auth.requireAuth`. Tests: `server/test/setup.test.js`, `server/test/setup_profile.test.js` (both: seeded throwaway DB, real modules, real router behind a stub gate), `server/test/setup_mount.test.js` (the real gate answers 401; the larger body limit is mounted).

## Tables (all additive, created lazily on first use, idempotent)

`tenants` gains: `address, timezone, lat, lng, approver_user_id, approver_email, rules_accepted_at, rules_accepted_by, setup_completed_at`.

`organizations` gains: `short_code` (unique across organisations where not null; backfilled from the slug), `timezone, country, website, phone, industry, logo_data, primary_contact_name, primary_contact_email, profile_updated_at, profile_updated_by`.

| table | columns | notes |
|---|---|---|
| `spaces` | id, tenant_id, parent_id, name (NOCASE), facility_id, rack_count, kind, floor, room, row, source, created_by, created_at, updated_at | unique on `(tenant_id, COALESCE(parent_id,0), name)` — plain `parent_id` would let two NULLs coexist |
| `racks_known` | id, tenant_id, space_id, rack_id, name, facility_id, u_height (42), source, created_by, created_at, updated_at | unique `(tenant_id, rack_id)` where rack_id not null |
| `tenant_rules` | tenant_id PK, approve_before_write (1), never_delete (1), ticket_route ('rack_then_site'), photo_retention_days (90), default_u_height (42), u_from_bottom (1), source, created_by, created_at, updated_at | one row per tenant; defaults live in DDL |
| `tenant_profile` | (tenant_id, section) PK, data (JSON), source, created_by, created_at, updated_by, updated_at | one row per section; a PUT replaces `data` whole and stamps `updated_*`, `created_*` survive; for `snmp` the secrets inside `data` are sealed strings |

`source` is always one of `typed | imported | learned`. The router defaults to `typed`; a body may say `imported`; `/api/analyze` writes `learned`. Section PUTs take it as `?source=` because a list body has nowhere to carry it.

## Endpoints (JSON, authenticated, org-scoped)

Access, decided once per request in the `:tenantId` param: owner, org_admin of the Site's org, site_manager of the Site → write; member of the Site → read; anyone else → **404** (never 403, so existence is not leaked — same rule as `lib/rack_access`). A member who tries to write gets 403 (they already know the Site exists). An org_admin also writes for the Site they themselves sit in.

The organisation profile has its own gate in the `:orgId` param: owner or org_admin of that organisation → read and write; anyone else in the organisation → 403; strangers → 404.

```
GET    /api/setup/state
       → admin:  { needsSetup, blocked:false, profile:{ org }, tenants:[{ id, name, completeness, canScan, profile:{ org } }] }
       → others: { needsSetup:false, blocked:false, reason:null }   (never another Site's data, never a gate)
GET    /api/setup/catalogue/vendors    → { vendors:[{ name }], count }   (any signed-in user; read once, then from memory)
GET    /api/setup/org/10/profile       → { profile:{ id, name, slug, short_code, timezone, country, website, phone, industry, logo_data, primary_contact_name, primary_contact_email, profile_updated_at, profile_updated_by } }
PUT    /api/setup/org/10/profile       { "short_code": "ACME", "timezone": "Asia/Kolkata", "country": "IN", "website": "racktrack.ai", "phone": "+91 98765 43210", "industry": "Colocation", "primary_contact_name": "Priya Nair", "primary_contact_email": "priya@acme.example", "logo_data": "data:image/png;base64,…" }
GET    /api/setup/11
       → { tenant, datacentre, spaces:[tree], racks, approver, rules, profile, completeness }   (profile = the six sections + updated, snmp masked)
PUT    /api/setup/11/datacentre        { "address": "1 Rack Row", "timezone": "Europe/London", "lat": 51.5, "lng": -0.12 }
POST   /api/setup/11/spaces            { "name": "Hall 1", "rack_count": 10, "facility_id": "H1", "kind": "hall", "floor": "1", "room": "", "row": "" }   → 201 { space }
PUT    /api/setup/11/spaces/3          { "name": "Row A", "parent_id": 2 }
DELETE /api/setup/11/spaces/3          → 409 while racks_known or child spaces still point at it
PUT    /api/setup/11/approver          { "user_id": 4 }   or   { "email": "approver@customer.example" }
PUT    /api/setup/11/rules             { "accepted": true, "ticket_route": "site_only", "photo_retention_days": 30 }
GET    /api/setup/11/candidates?spaceId=3
       → { space:{id,name}, racks, count, expected }
POST   /api/setup/11/spaces/3/racks    { "rack_id": "RK-AAAA1111", "name": "R01", "u_height": 45 }   → 201 created / 200 updated
GET    /api/setup/11/profile           → { profile:{ contacts, vendors, conventions, systems, network, facility, snmp, updated:{ <section>: { source, created_by, created_at, updated_by, updated_at } | null } } }
PUT    /api/setup/11/profile/contacts?source=imported
                                       [ { "name": "Priya", "role": "on_site", "email": "priya@customer.example", "phone": "+44 20 7946 0000", "hours": "Mon-Fri 08-18", "notes": "" } ]
PUT    /api/setup/11/profile/vendors   [ { "name": "Cisco", "models": ["C9300-48P"], "contact_name": "TAC", "contact_email": "tac@cisco.example", "contact_phone": "", "support_ref": "CON-123" } ]
PUT    /api/setup/11/profile/conventions
                                       { "rack_pattern": "RK-####", "port_pattern": "^(Gi|Te)\\d+/\\d+/\\d+$", "cable_colours": [{ "color": "blue", "meaning": "uplink" }], "u_from_bottom": true, "faces": "front" }
PUT    /api/setup/11/profile/systems   { "record": "netbox", "ticketing": "servicenow", "notifications": ["teams", "email"] }
PUT    /api/setup/11/profile/network   { "management_ranges": ["10.0.0.0/24", "fd00::/64"], "wifi_ssid": "RT-OPS", "unmanaged_makes": ["Zyxel"], "notes": "" }
PUT    /api/setup/11/profile/facility  { "code": "RDG-1", "address_line1": "1 Station Road", "address_line2": "", "city": "Reading", "region": "Berkshire", "postcode": "RG1 1AA", "country": "GB", "provider": "Equinix", "access_notes": "Ask for the NOC", "hours": "Mon-Fri 08:00-18:00" }
PUT    /api/setup/11/profile/snmp      { "version": "v2c", "community": "…" }
                                       { "version": "v3", "username": "rtread", "auth_protocol": "sha", "auth_key": "…", "priv_protocol": "aes", "priv_key": "…" }
                                       → { data:{ configured, version, username, security_level, auth_protocol, priv_protocol, has:{ community, auth_key, priv_key } } }
DELETE /api/setup/11/profile/<section> → { existed }   (any section; snmp is the one that matters)
POST   /api/setup/11/conventions/check { "pattern": "RK-####", "example": "RK-0001" }   → { ok, mode:'regex'|'literal', matches, reason }   (read access is enough)
```

Every section PUT / DELETE returns `{ section, data, updated, completeness }`; the body of a PUT **is** the section (a list for contacts and vendors, an object for the rest) and replaces it whole. Unknown keys are dropped. Every other write returns the fresh `completeness` alongside its result, as before.

### Validation

Slice one: names ≤ 120 chars, unique per level case-insensitively; a space's `kind` ∈ `hall | floor | room | row | cage | other`, `floor` ≤ 40, `room` ≤ 80, `row` ≤ 40 chars, all optional; `timezone` must satisfy `Intl.DateTimeFormat` (aliases accepted); `lat` −90..90, `lng` −180..180; `rack_count` 0..100000; `rack_id` must match `RK-[A-Za-z0-9]{4,32}`; `ticket_route` ∈ `rack_then_site | rack_only | site_only`; `photo_retention_days` 1..3650; `default_u_height` 1..100. A space cannot be moved beneath itself. `approver.user_id` must be a member of the Site or an org_admin of its organisation; setting `user_id` clears `email` and vice versa. `approve_before_write` and `never_delete` are always true.

Organisation profile: `short_code` 2–16 of `A-Z 0-9 -`, upper-cased, unique across organisations (409), cannot be cleared; `timezone` via Intl; `country` ≤ 80 chars, a two-letter code is upper-cased and a name is kept as a name; `website` a URL or bare hostname, stored as typed; `phone` `+` digits spaces `()./-`; `industry` ≤ 80; `primary_contact_name` ≤ 120; `primary_contact_email` ≤ 200 and must look like an address; `logo_data` a base64 `data:image/(png|jpeg|gif|webp|svg+xml)` URI whose decoded size is ≤ 200 KB, `null` clears it. Only the fields named are touched; an empty body is 400. **Serve the logo through `<img src>` only** — an SVG is stored as given.

Sections (each field optional unless said; text limits in brackets):

| section | shape |
|---|---|
| `contacts` | list ≤ 50 of `{ name* [120], role* ∈ approver\|on_site\|escalation\|facilities\|security\|vendor, email (shape-checked, lower-cased), phone [40], hours [120], notes [500] }`. The mandatory approver stays on `tenants`; this list is everyone else |
| `vendors` | list ≤ 100 of `{ name* [120] (a catalogue name or free text), models [≤ 50 × 80, trimmed, empties dropped], contact_name [120], contact_email, contact_phone, support_ref [120] }` |
| `conventions` | `{ rack_pattern, device_pattern, asset_pattern, port_pattern [200 each, must compile by the rule below], cable_colours [≤ 40 × { color* [40], meaning [120] }], u_from_bottom (bool), faces ∈ front\|rear\|both }` |
| `systems` | `{ record ∈ netbox\|servicenow\|both\|none, ticketing ∈ servicenow\|jira\|email\|none, notifications ⊆ [teams, outlook, email] (deduplicated) }`. No credentials: those stay in the connections feature |
| `network` | `{ management_ranges [≤ 100 IPv4/IPv6 CIDRs, a bare address allowed and kept as typed], wifi_ssid [32], unmanaged_makes [≤ 100 × 80], notes [2000] }`. No credentials |
| `snmp` | `version* ∈ v2c\|v3`; v2c needs `community`; v3 needs `username` [64]; `auth_key` / `priv_key` ≥ 8 chars and each **requires its protocol named** (`auth_protocol ∈ md5\|sha\|sha256`, `priv_protocol ∈ des\|aes`), a protocol without its key is refused, and `priv_key` without `auth_key` is refused (SNMPv3 cannot encrypt without authenticating). `security_level` is derived: noAuthNoPriv / authNoPriv / authPriv |

### Facility section

The datacentre as a building: `code` ≤ 40, `address_line1/2` ≤ 200, `city`/`region` ≤ 120, `postcode` ≤ 32, `country` ≤ 80 (a two-letter value is upper-cased), `provider` ≤ 160, `access_notes` ≤ 2000, `hours` ≤ 200. Every field optional; an empty PUT is a valid section of nulls. It has no completeness flag: it is context for the people who visit, not a gate.

### Pattern rule (conventions and the checker)

"Whatever parses as a regex" would never fall through — `RK-####` parses — so the split is on what the pattern contains:

- **regex** when wrapped in slashes (`/…/` or `/…/i`), or when it contains any of `\ ^ $ [ ] ( ) | { } + ? *`. Anchored for you (`^(?:…)$`), so `Gi\d+/\d+/\d+` matches the whole example only; a `^`/`$` you wrote still works.
- **literal** otherwise: `#` is a digit, `A` is a letter, every other character stands for itself (`.` and `/` included). `RK-####` matches `RK-0001`, not `RK-A001`; `A##` matches `R01`, not `RACK`.

Both match the whole example. The check runs under a 100 ms `vm` budget: a pattern that backtracks catastrophically is reported (`ok:false`, "takes too long"), not waited for. A pattern that cannot be used answers **200** with `ok:false` and a `reason` so a form can show it live; only a malformed request (no pattern, > 200 chars) is 400. A section PUT applies the same compile check to each pattern (400 on failure).

### SNMP secrets

`community`, `auth_key` and `priv_key` are sealed one by one with `lib/netbox/secrets` (AES-256-GCM, `RT_SECRET` or the generated `.secret-key` under `RT_DATA_DIR`) before the row is written; the clear part of the row is `version, username, security_level, auth_protocol, priv_protocol`. Reads — the section, the snapshot, the PUT response — return `configured` plus `has` booleans, never a value, and nothing about the body is logged beyond the version. `estate_profile.resolveSnmp(tenantId)` opens them for a server-side caller about to speak to a switch; it is not routed and returns null when a needed secret can no longer be opened (rotated key), so the switch reports "no login held" instead of sending rubbish.

## Completeness

```
mandatory.location = a space with rack_count > 0 exists, or any racks_known row
mandatory.approver = approver_user_id or approver_email is set
mandatory.rules    = rules_accepted_at is set
canScan            = all three
counts             = { spaces, racksTyped: SUM(spaces.rack_count), racksKnown }
```

`setup_completed_at` is stamped by the writers the first time all three hold (never by a read). `/api/analyze` is **not** gated on `canScan`. For an admin, `needsSetup` is true when any visible Site lacks the three, or when they have no Site at all. Nobody is ever `blocked`: the field is kept in the shape for older clients and is always false. The organisation admin finishes setup before inviting anyone, so a member (technician or site manager) walks straight into the app whatever their Site's state (rule from the owner, 15 Sep 2026). The platform owner is never `needsSetup`.

`optional` flags read what exists:

| flag | how |
|---|---|
| `records` | any `connection_profiles` row for the Site's organisation or one of its users |
| `plans` | any entry in `RT_DATA_DIR/plans/index.json` for a rack the Site owns or knows (best-effort; index shape not verified) |
| `switches` | an SNMP login configured in the profile, **or** any `switches.json` entry whose `rackId` the Site owns or knows |
| `conventions` | any of the four patterns set (cable colours or faces alone do not count) |
| `vendors` | any vendor row |
| `people` | any contact row (the mandatory approver on `tenants` does not count) |

`profile.org` on `/api/setup/state` is true when the organisation profile has both `timezone` and `country`; it is answered for the caller's own organisation at the top (the owner has none → false) and for each Site's organisation inside `tenants[]`. The member/site-manager shape of `/state` is unchanged.

### Removing an organisation

`DELETE /api/orgs/:orgId` (auth.js) runs in one transaction with foreign keys ON. The setup tables reference `tenants(id)` and `users(id)` (spaces, racks_known, tenant_rules, tenant_profile, plus `tenants.approver_user_id`, `tenants.rules_accepted_by` and `organizations.profile_updated_by`), so the delete clears them first, on its own connection: rows per Site from `racks_known`, `spaces`, `tenant_rules`, `tenant_profile` (guarded by table existence, since they appear only once setup has been used), then the user references on `tenants` and `organizations`, then invites, members, Sites, the organisation. Before 15 Sep 2026 the delete failed with "FOREIGN KEY constraint failed" as soon as a Site had any setup data and rolled back whole. `estate.js` and `estate_profile.js` open their own database connection, so a purge helper in those modules cannot run inside auth.js's transaction ("database is locked"); the SQL lives in the delete handler. Test: `server/test/org_remove.test.js`.

### Session gate

`GET /api/auth/me` returns `user.setup = { needsSetup, blocked, reason }` — the same fields as `/api/setup/state`, computed lazily and never fatal. Only `needsSetup` ever turns true, and only for an org_admin. The full per-Site list is only on `/api/setup/state`.

### Body limit

`app.js` parses `/api/setup/org` with `express.json({ limit: '320kb' })` ahead of the global 100 kb parser, so a 200 KB logo (~275 KB as base64) reaches the validator instead of dying as a 413; the global parser skips a body already read. `setup_mount.test.js` proves the larger limit is there and is not global.

### Decisions where the spec left room

- `tenant_profile` is a table of `(tenant, section)` rows rather than JSON columns on `tenants`, so each section carries its own who/when/source like `tenant_rules` does.
- `short_code` defaults to the slug minus the 4-hex suffix `auth._slug` appends, upper-cased, letters and digits, 8 chars (`acme-datacentres-3f2a` → `ACMEDATA`); a clash gets `-<id>` appended. Backfilled for existing organisations the first time the module runs; derived on first read for an organisation created later.
- The masked SNMP read carries `security_level`, `auth_protocol`, `priv_protocol` and `has` beyond `{configured, version, username}`: none is a secret, and an edit form needs to know a key is held to offer "replace" (the connector store's own convention).
- `conventions.u_from_bottom` duplicates `tenant_rules.u_from_bottom` because the spec lists it in both. The rule is the accepted one; the convention is a note. The portal should write the rule and show the convention — or drop the convention field.
- `DELETE` works on every section, not only `snmp`: it removes the row, which is the honest "never written" state; `PUT []` / `PUT {}` is the "written, empty" state.
- Nothing is defaulted in `snmp`: the switch store defaults `sha`/`aes`, this does not — a key without its protocol named is refused.

## Scan binding

`POST /api/analyze` accepts an optional multipart field `spaceId`. When present it must be a space of the Site the scan is claimed for; otherwise the scan is refused with 404 before any work. When valid, the served rack id is upserted into `racks_known` with `source: 'learned'`, `space: { id, name }` is written into that rack's `scan_meta.json`, and the JSON response carries the same `space` field. Without `spaceId` the handler is byte-for-byte what it was. The stitch handler is untouched.
