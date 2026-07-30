# Connections, Data Sources & CMDB Reconciliation

*Tell RackTrack how to reach the systems you already run — your CMDB, usually ServiceNow — then let it match what the camera actually saw in the rack against what your records claim is there, and flag every disagreement.*

Feature · Admins/operators · Last verified: 26 July 2026 against the live code.

---

## 1. In simple terms

RackTrack is far more useful when it can talk to the systems you already run. The main one is your **records database** — a CMDB (Configuration Management Database), and in practice that almost always means **ServiceNow**. RackTrack can also point at NetBox, SolarWinds Orion, CA/DX Spectrum, or your own database over SQL or REST.

There are two halves to this story, and it helps to keep them separate in your head.

**The first half is connecting.** The screen where you do this is called **Data Sources**. You add a **connection** by giving it a name, choosing what kind of system it is, and typing in the sign-in details. RackTrack locks those details away encrypted and never shows them back to you. You can save as many connections as you like, but only **one is active at a time**, and the active one is what the app reads from while you're signed in. Switch the active connection and the app quietly re-points at the new source.

There is one promise to remember here: **your credentials go in, but they never come back out.** Not even blanked-out with dots. To change a password you re-type it, and RackTrack replaces the old one without ever displaying it.

**The second half is reconciliation** — the part that actually earns its keep. Your CMDB is *supposed* to say exactly what's in every rack. Real racks change, and records fall behind. RackTrack closes that gap in two directions:

- **Registration** takes a rack you just scanned and writes its inventory into the CMDB — the rack, its switches, patch panels and servers, their ports, and how they're cabled. But it never writes silently. RackTrack first raises a **request** (a ServiceNow Service Request) and only pushes the inventory once that request is **approved**. That approval gate is the whole point: nothing lands in your records without a sign-off.

- **Reconciliation** works the other way. When a scan is tied to a support ticket, RackTrack lines up what the CMDB *expects* in the rack against what the camera *actually saw*, one rack position at a time. Where they disagree — a switch at the wrong slot, or missing entirely — it raises that as **physical drift** and writes the evidence as a work note on the ticket.

The short version: **you connect once, and from then on RackTrack can tell you where your records and your real racks disagree — with a photo to prove it.**

## 2. At a glance

| | |
|---|---|
| **What it is** | Saved, encrypted connections to your external systems, plus the bridge that registers scans into your CMDB and checks the CMDB against what was actually scanned. |
| **Who uses it** | Owners and organization admins reach the Data Sources screen; anyone who owns a rack can raise a registration ticket or work a drift ticket. |
| **Where you find it** | Profile → **Data Sources** (the "Connect a database" card), or the route `/connections`. |
| **What you add** | A connection: a name, a type, and that type's sign-in fields. |
| **Supported types** | ServiceNow / CMDB, NetBox, SolarWinds Orion, CA/DX Spectrum, "My own database (SQL)", "My own database (REST)". |
| **What actually runs today** | Refresh, registration, and reconciliation are **ServiceNow-specific**. The other types can be saved and activated, but the live pipeline is built around ServiceNow. |
| **How credentials are stored** | Encrypted (AES-256-GCM), write-only — never returned to any screen. |
| **What reconciliation produces** | A per-position verdict (match / low-confidence / mismatch / unknown) and a work note posted onto the real incident. |
| **Data source** | REAL — your actual connections and live results. Device lists are real; a few CMDB detail fields (serials, addresses) are clearly-marked synthetic placeholders. |

## 3. How it works — step by step

There are two flows. The first sets up a connection. The second — registration and reconciliation — is what the connection is *for*.

### Adding a connection (the Data Sources screen)

```
Add a connection      →  name, type, and that type's sign-in fields
        ↓
Stored securely       →  the secret is encrypted; never shown again
        ↓
Make one active       →  the active source is what the app reads from
        ↓
Refresh (ServiceNow)  →  pull the latest incidents from that source
        ↓
Edit / switch / delete → rotate a password, change sources, or remove one
```

1. Open your **Profile** and tap the **Data Sources** card (owners and org admins only).
2. Press **Add connection**. Enter a name (for example "My ServiceNow Dev"), pick a **Type**, and fill in that type's fields.
3. Press **Save & use**. The secret is encrypted and this connection becomes the active one.
4. To switch, press **Use** on any other saved connection — it becomes active and the app re-reads its data.
5. For an active **ServiceNow** source, press **Refresh data from this source** to pull the latest incidents. A banner shows it working, then the result.
6. To change a credential, open the connection's **⋯** menu, choose **Edit**, and re-type just the field you want to replace. Leave a field blank to keep what's already saved. (The **Type** can't be changed after creation — different systems need different fields, so you'd add a new connection instead.)
7. To remove a connection, choose **Delete** from the **⋯** menu and confirm.

### Registering a rack into the CMDB

```
Fresh scan, rack not in CMDB   →  an approval card appears on the results
        ↓
Raise Ticket                   →  a ServiceNow Service Request is opened
        ↓
Approve                        →  RackTrack synchronises the inventory
        ↓
Registered                     →  devices, ports and cabling written; summary shown
```

1. Scan a rack that isn't in the CMDB yet. On the results, an **approval card** appears: "Rack not registered in CMDB".
2. Press **Raise Ticket**. A Service Request is opened and its reference number is shown.
3. Approval happens in ServiceNow. In normal operation a person approves the request there, and a background poller notices the approval and performs the write. (There is an owner-only **Approve** button in the modal for demos, but it is switched off unless explicitly enabled — see §5 and §7.)
4. Once approved, a "Synchronizing…" step runs and you see **Successfully registered** — a summary with device / port / cable counts, the list of registered devices, and a sample of the connections.

### Reconciling a rack against the CMDB (ticket mode)

```
Incident → find the rack → what the CMDB expects at each slot vs. what the scan saw → work note
```

1. Open a scan that's linked to a support incident. If the rack no longer matches the records, a **Physical Drift Detected** screen appears.
2. It shows, side by side, what the **CMDB expects** at a slot versus what the **scan sees at U##** (the rack unit).
3. Read the next-step guidance, verify at the rack, and — if needed — use **Raise ticket** to open an incident for the drift. Either way, RackTrack posts a work note onto the incident describing what agreed and what didn't.

## 4. What you see on screen

### The Data Sources screen

- **A header** titled **Data Sources**, with a back button. (In the desktop layout the top bar labels this page **Connections** — same screen, two names.)
- **An intro line** explaining that the active connection is what every screen uses while you're signed in.
- **An "Active" card** — a status dot, the connection's name, its type label, an **Active** badge, and a **⋯** menu (Edit / Delete). For a ServiceNow source it also shows a **Refresh data from this source** button.
- **An "Other saved" list** — every inactive connection, each with a **Use** button and its own **⋯** menu.
- **Banners** — while a refresh runs you see "Pulling fresh data from *[name]*…" with a spinner; when it finishes you see either a green "✓ Pulled *N* incident(s) from *[instance]*" line or a red "Refresh failed: *[reason]*".
- **An empty state** — if nothing is active: "No active connection." and "Add a connection below to start pulling data from your CMDB."
- **The Add / Edit form** (a pop-up) — a **Name** field, a **Type** picker (greyed out when editing), and the credential fields for the chosen type. When editing, a note reminds you: "Leave the credential fields blank to keep what's already saved." The save button reads **Save & use** when creating and **Save changes** when editing.

The **Type** dropdown offers: ServiceNow / CMDB, NetBox, SolarWinds Orion, CA / DX Spectrum, My own database (SQL), and My own database (REST). Each type asks for its own fields — for example ServiceNow asks for an Instance ID, Username and Password; NetBox asks for a Base URL and an API Token; the SQL option asks for a single connection string.

### The registration card and summary

- **The approval card** moves through clear states: not registered → ticket submitted (with its reference number) → synchronizing → successfully registered.
- **The registration summary** shows a row of counts (Devices · Ports · Cables · Rack U), then the list of registered devices — each with its slot, kind, and any model / address / asset tag / serial it carries — and a short sample of connections.

### The drift screen

- A **"Physical Drift Detected"** header, naming the incident.
- A two-column comparison: **CMDB expects** (the device the records name, and the class it should be, at U##) versus **Scan sees at U##** (each thing the camera detected there, with its confidence).
- Plain **next-step guidance**, the **annotated rack photo** so you can eyeball it, and a **Raise ticket** action.

## 5. The logic behind it — how a scanned device is matched to a CMDB record

This is the heart of reconciliation, and it is simpler than it sounds once you know the one key idea:

**RackTrack's scan does not know device names.** When the camera looks at a rack, it identifies each device by its **visual class** — "Switch", "Patch Panel", "Server", "Closed Unit" — and by the **rack unit (U) position** it sits at. It does *not* read the asset name off the box. Knowing the name is the CMDB's job. So the whole comparison is done **by position and by type**, not by name.

Here is the match, step by step, for each record the CMDB holds for that rack:

1. **Work out what class the record *should* look like.** A CMDB record has a class (for example `cmdb_ci_ip_switch`). RackTrack maps that to the scan's visual language: an IP switch class becomes "Switch", a server class becomes "Server", and so on. When the class is too generic to tell (some CMDBs lump network gear together), RackTrack falls back to the **name prefix** — `SW-` means Switch, `PP-` means Patch Panel, `SRV-` means Server.

2. **Work out what U position the record claims.** RackTrack reads the record's stored rack position if it has one; if not, it parses the position out of the name (for example `SW-U10` means U10).

3. **Look at what the scan actually detected at that U.** RackTrack gathers every device the camera saw at that exact rack unit, each with a confidence score.

4. **Compare, and return one of four honest verdicts:**
   - **✓ Match** — the scan saw the expected class at that U, clearly (confidence at or above 0.5).
   - **⚠ Low-confidence match** — the right class was seen at that U, but the photo was unsure (confidence below 0.5). The advice is to rescan with better light or angle before sending anyone to the rack.
   - **✗ Mismatch (physical drift)** — either nothing was detected at that U, or something of a *different* class was. This is the real "your records and your rack disagree" signal.
   - **? Unknown** — the CMDB never recorded a rack position for that record, so there is simply nothing to compare against. The fix is to set the position on the record and rerun.

RackTrack does this for the record the ticket is actually about **and** for every other record in the rack, then writes a tidy work note: a header naming the incident, the check on the primary device, a line per record sorted by U, a running "*matched* / *total* agree" count, and a suggested next action based on the primary verdict (agree → probably a config/logical issue, not a truck roll; low-confidence → rescan; mismatch → verify physically or update the CMDB; unknown → add position data).

A few deliberate design choices worth understanding:

- **One active source, no blending.** Because exactly one connection is active, there is never any doubt about where a screen's data came from. There is *no* silent fallback to some default instance — if no connection is configured, RackTrack simply has no external data rather than guessing.
- **Secrets go in, never out.** Saved credentials are encrypted and are never sent back to your screen. Editing means re-entering a value, which also makes rotating a password clean and safe.
- **Every CMDB write is gated.** Registration always goes through a Service Request that has to be approved first. That is the product's core compliance promise.
- **No duplicate ticket noise.** RackTrack fingerprints the difference between scan and records. If nothing changed since last time, it won't raise the same ticket again; if something did change, it appends a note rather than opening a second ticket.
- **A dead port counts as drift too.** A port the records say is cabled but the scan reads as empty shows up as a discrepancy — because the scan marks it empty.

## 6. Under the hood (technical section)

**The Data Sources screen.** The UI is `client/src/pages/ConnectionsPage.jsx` (route `/connections`, wrapped in `AdminRoute`, so only `org_admin` and `owner` reach it). Its on-screen title is **"Data Sources"**; the desktop shell's top-bar title for the same route is **"Connections"**. State comes from `client/src/ConnectionsContext.jsx` (`useConnections`), which wraps `client/src/utils/connectionsApi.js`. The type labels and per-type field schemas live in `TYPE_INFO` in that same `connectionsApi.js`.

**Per-user connection HTTP surface** (`server/connection_profiles_routes.js`, all under `requireAuth`, scoped to `req.user.id`):

- `GET /api/connections` — list metadata (never includes secrets)
- `GET /api/connections/active` — the active profile's metadata
- `POST /api/connections` — create `{ name, type, secret, make_active? }` (defaults active)
- `GET /api/connections/:id` — one profile's metadata
- `PATCH /api/connections/:id` — update `{ name?, secret? }`
- `POST /api/connections/:id/activate` — make this profile active
- `POST /api/connections/deactivate` — clear the active profile
- `DELETE /api/connections/:id` — delete one

**Org-scoped connections** (`requireOrgAdmin`, i.e. `org_admin`/`owner` with an organization): `GET`/`POST /api/org-connections` and `PATCH`/`DELETE /api/org-connections/:id`. An admin sets one write-only credential per type for the whole organization; creating one replaces any prior active credential of the same type, and the writing admin's id is recorded for audit only.

**The store** (`server/lib/connection_profiles.js`). One row per connection in the `connection_profiles` table of `server/data/auth.db` (better-sqlite3, WAL). The credentials are stored as an **AES-256-GCM** blob (`secret_blob` = `base64(iv|tag|ciphertext)` of the JSON); only harmless metadata (name, type, timestamps, active flag) is queryable in cleartext. The encryption key is shared with the SSH-creds store — `server/.env.key` (auto-generated 32-byte hex on first run, mode `0600`) or the `SSH_CREDS_KEY` env var — so there is one key and one rotation surface. Two partial-unique indexes enforce the "one active" rule per scope: one active **personal** profile per user (`WHERE is_active = 1 AND organization_id IS NULL`), and one active **org** profile per `(organization_id, type)`. Metadata reads never select the blob; only the server-side `getWithSecret` / `getActiveWithSecret*` helpers decrypt, and only when a real outbound call needs them.

**Supported types** (`SUPPORTED_TYPES`): `servicenow`, `netbox`, `orion`, `spectrum`, `generic_sql`, `generic_rest`. Each has required fields validated by `validateSecret`:

- `servicenow` → `{ instance, user, password }`
- `netbox` → `{ base_url, token }`
- `orion` → `{ host, user, password }`
- `spectrum` → `{ base_url, user, password }`
- `generic_sql` → `{ connection_string }`
- `generic_rest` → `{ base_url }` (token optional)

Note on scope: the **refresh**, **registration**, and **reconciliation** pipelines are all keyed on the `servicenow` type. The other five types can be saved and activated, but their only server-side wiring today is the fixture/mock router in `server/mock_routes.js` (mounted when `MOCK_SERVER_URL` is set or outside production) — there is no live production adapter for NetBox / Orion / Spectrum / generic SQL / generic REST.

**The refresh job** (in `server/app.js`): `POST /api/incidents/refresh` spawns `servicenow_inbox/poll.py` against the caller's active ServiceNow credentials and returns **immediately** (HTTP 202); `GET /api/incidents/refresh/status` reports `{ state: idle|running|done|failed, instance, startedAt, finishedAt, count, error }`; `GET /api/incidents/active` returns the pulled tickets. Credentials are resolved by `getSnCreds`, which prefers the **org** ServiceNow profile and falls back to the user's personal profile. The client (`ConnectionsContext`) polls status every ~3 s with a 6-minute client-side cap; the server's poller has its own 5-minute hard timeout and cancels an in-flight poll if you switch profiles mid-run. This refresh state is global (per-server), not per-user — a deliberate MVP simplification.

**The CMDB bridge** (`server/cmdb_ticket_proxy.js`, under `requireAuth`) spawns the Python in `servicenow/` and injects ServiceNow creds resolved the same way (org profile first, then user) as `SN_INSTANCE` / `SN_USER` / `SN_PASSWORD`. Its routes:

- `GET /api/cmdb/ticket/:rackId` — ticket status
- `POST /api/cmdb/ticket/:rackId/refresh` — re-poll this rack's ticket
- `POST /api/cmdb/ticket/:rackId/create` (`?force=1` to force) — compute the diff and open a Service Request
- `POST /api/cmdb/ticket/:rackId/cancel` — cancel the ticket
- `POST /api/cmdb/ticket/poll` — owner-only sweep of all tickets
- `POST /api/cmdb/ticket/:rackId/dev-approve` — **demo-only** shortcut, owner-only and gated on `CMDB_DEV_APPROVE=1`; returns 403 otherwise

Error strings are scrubbed of any `*.service-now.com` host before being returned.

**Registration internals.** `scheduleCmdbTicket(rackId)` debounces a background `cmdb_ticket.py create` ~4 s after a scan completes; `startTicketPoller` runs every 5 minutes. `create_ticket_for_rack` computes a diff of the scan against current CMDB state, and — if non-empty and there is no open ticket — opens an `sc_request` tagged with the rack id and a deterministic diff hash. When the request reaches an approved state, the poller runs `cmdb_apply.py`, which **upserts** the CMDB rows: `cmdb_ci_rack`, `cmdb_ci_ip_switch`, `cmdb_ci_netgear` (patch panels), `cmdb_ci_server`, port/NIC records, and the `cmdb_rel_ci` "Contains" / "Connects to" relationships. Upserts are **idempotent and rack-scoped** — they match on name plus the rack id and refuse to overwrite a row owned by a different rack, because device names are U-derived (`SW-U06`, `PP-U18`) and would otherwise collide across racks.

**Reconciliation internals** (`servicenow/reconciler.py` + `main.py`). Starting from an incident, RackTrack resolves the primary CI, walks `cmdb_rel_ci` up to the parent rack, reads the rack's stored `u_racktrack_scan_id`, loads that scan, and audits each rack child. `_expected_scan_class` maps `sys_class_name` (with a name-prefix fallback for generic classes), `_ci_u` reads `rack_unit_position` / `u_position_in_rack` or parses `-U##` from the name, and `_scan_detections_at` collects `(class_name, confidence)` for devices whose `units` include that U. `_check_ci` returns the four verdicts against `LOW_CONF_THRESHOLD = 0.5`. The resulting work note is **appended** to the incident (never overwritten).

**Files worth knowing:** `outputs/<rackId>/scan_result.json` (the scan), `outputs/<rackId>/cmdb_ticket.json` (local ticket state), and `outputs/<rackId>/cmdb_synthesis.json` (which fields were synthesised).

## 7. Edge cases & limits

- **No active connection.** With nothing active, there is no external data — by design, RackTrack does not fall back to a default instance. The screen shows "No active connection" and prompts you to add one. Refresh and CMDB actions that need ServiceNow return a clear "No active ServiceNow connection" error.
- **Connection down / instance asleep.** A ServiceNow developer instance often sleeps. A refresh that can't reach it fails cleanly after the server's 5-minute cap with a message telling you to open the instance in a browser, sign in to wake it, and try again. The banner shows the failure rather than hanging.
- **No match at a slot.** If the CMDB expects a device at a U but the scan detected **nothing** there, that is a **✗ mismatch** — treated as physical drift.
- **Different device at a slot.** If the scan saw a *different* class than the record expects, that too is a **✗ mismatch**, and the note lists what was actually seen.
- **Low-confidence read.** The right class at the right U but a shaky photo yields **⚠** — the advice is to rescan before dispatching anyone, not to raise drift.
- **No position on the record.** If a CMDB record has no rack position, it comes back **?** (unknown) — it can't be checked until someone sets the position.
- **CMDB unreachable during registration.** If RackTrack can't read the current CMDB state, it **refuses** to open a registration ticket — a failed read makes every device look "added", which would file a bogus "everything is missing" request.
- **Duplicate protection.** An unchanged diff on an open ticket raises nothing; a changed diff appends a work note rather than opening a second Service Request. A cross-process lock stops a background create and a user click from double-opening.
- **Non-ServiceNow types.** You can save and activate NetBox / Orion / Spectrum / SQL / REST connections, but the live registration, reconciliation, and refresh flows are ServiceNow-specific today; those other types are backed only by mock/fixture routes for offline development.
- **The type is fixed after creation.** To point at a different kind of system, add a new connection rather than editing an existing one.

## 8. Real vs synthetic

| Thing on screen | Real or synthetic |
|---|---|
| Your saved connections | **REAL** — the sources you added. |
| Credentials | **REAL** — stored encrypted (AES-256-GCM), never returned to any screen. |
| The active badge | **REAL** — reflects the one source the app is actually reading from. |
| Refresh result ("Pulled *N* incidents") | **REAL / LIVE** — the actual outcome of pulling from your source. |
| Registered device list, slots, device types, counts | **REAL** — from the scan's detected inventory. |
| Serials, management addresses, cable attributes on a registered device | **SYNTHETIC** — placeholder values a photo can't reveal, clearly marked as such and recorded in `cmdb_synthesis.json`. Treat sampled cabling and asset detail on the success screen as illustrative, not verified. |
| Reconciliation verdicts (✓ / ⚠ / ✗ / ?) | **REAL** — computed from expected-class-at-U versus detected-class-at-U. |
| The work note / drift ticket | **REAL** — posted to the actual incident in ServiceNow. |
| NetBox / Orion / Spectrum / SQL / REST responses | **SYNTHETIC** — served by mock routes for offline development; no live adapter yet. |
| A `DEV-…` ticket number | **SYNTHETIC** — only appears when the demo-only `dev-approve` shortcut fabricates one. |

## 9. Common questions

**Q1. Where do I add a connection?**
Open your **Profile** and tap the **Data Sources** card (it says "Connect a database" if nothing is set up yet), then press **Add connection**. Only owners and organization admins can reach this screen.

**Q2. Can I have more than one connection at once?**
You can *save* as many as you like, but only **one is active** at a time. The active one is what the whole app reads from. Press **Use** on any saved connection to switch; the app re-reads its data from the new source. There is no blending of two sources at once.

**Q3. Why can't I see my saved password?**
Because credentials are **write-only** on purpose. They're encrypted and never sent back to any screen — not even masked with dots. This is a security promise: a secret can go in, but it can never come back out.

**Q4. How do I change a password or token?**
Open the connection's **⋯** menu, choose **Edit**, and type the new value into just the field you want to replace. Leave the other credential fields blank to keep what's already saved, then press **Save changes**.

**Q5. Why can't I change a connection's type after creating it?**
Each system needs a different set of fields, so the **Type** is locked once the connection exists. If you need a different kind of system, add a new connection.

**Q6. What does "Refresh data from this source" do, and why only for ServiceNow?**
It pulls the latest incidents from your active ServiceNow instance in the background and updates the banner with the result. Only ServiceNow shows this button because the live refresh (and the registration and reconciliation flows) are built around ServiceNow today.

**Q7. Reconciliation says a device is a "mismatch" — what does that mean?**
It means what your records expect at that rack slot and what the camera actually saw disagree — either nothing was detected there, or a different type of device was. That's physical drift. Go verify at the rack, and either move the device to where the CMDB says, or update the CMDB if it really did move.

**Q8. It says "low confidence" instead of a clean match — do I have drift?**
Not necessarily. The right kind of device was seen at the right slot, but the photo wasn't clear enough to be sure. Rescan with better lighting or a straighter angle before sending anyone to the rack.

**Q9. How does RackTrack match a scan to my CMDB when the scan doesn't know device names?**
It matches by **position and type**, not by name. It takes each CMDB record, works out the U position and the visual class it should be, and checks whether the scan detected that class at that U. Names are the CMDB's job; the camera only knows "a Switch at U10", so that's what the comparison uses.

**Q10. Does registering a rack write to my CMDB immediately?**
No. Registration always opens a **Service Request** first and only writes once that request is **approved** in ServiceNow. Every CMDB write is gated behind an approval — that's the core compliance promise. (There's a demo-only shortcut for owners, but it's disabled unless someone explicitly turns it on.)

**Q11. Will re-scanning the same rack create duplicate records or duplicate tickets?**
No. Writes are idempotent and rack-scoped — re-running against an unchanged scan changes nothing. And RackTrack fingerprints the difference between scan and records: an unchanged difference raises nothing, and a changed one appends a note instead of opening a second request.

**Q12. The refresh failed and mentions the instance being asleep — what now?**
ServiceNow developer instances go to sleep. Open your instance in a browser (`<instance>.service-now.com`), sign in to confirm it's awake, then press **Refresh data from this source** again. The failure banner tells you exactly this.

---

— Connections, Data Sources & CMDB Reconciliation —
