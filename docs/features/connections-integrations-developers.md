# Connections & Integrations

**Feature Reference** · *Per-user, encrypted connection profiles for external data sources — the sole source of truth every CMDB/ITSM call resolves against.*

**Category:** Integration — external data sources · **Audience:** The team (assumes you know the product) · **Document date:** 24 July 2026 · Part of the RackTrack documentation set.

---

## On this page

1. In simple terms
2. At a glance
3. How it works — step by step
4. Where the input comes from
5. What it produces (output)
6. What you see on screen
7. The logic behind it
8. Detailed technical explanation
9. Real data vs. synthetic
10. Use cases

---

## 1. In simple terms

A **connection profile** is a named set of credentials for an external system — ServiceNow, NetBox, SolarWinds Orion, CA/DX Spectrum, or a generic SQL/REST database. Each user can save many profiles but has **at most one active**, and the active profile is the single source that every CMDB-touching request resolves against for that user's session. Secrets are stored AES-256-GCM and are never returned to the client — editing means re-supplying a value to replace it.

The screen is `client/src/pages/ConnectionsPage.jsx` (its on-screen title and nav label are both **"Data Sources"**; the route is `/connections`). The API is `server/connection_profiles_routes.js` over the store in `server/lib/connection_profiles.js`. There is a parallel **org-scoped** surface (admin-set, org-wide, write-only) alongside the per-user one.

## 2. At a glance

| | |
|---|---|
| **Category** | Integration — encrypted per-user (and org-wide) credentials for external sources. |
| **Who uses it** | `org_admin` and `owner` (route wrapped in `AdminRoute`). |
| **Where input comes from** | `{ name, type, secret }` posted from the connection form. |
| **What it outputs** | Metadata-only profile records (one active), and refresh-job outcomes. |
| **Data source** | REAL — encrypted profiles in `auth.db`; live refresh outcomes from the source. |

## 3. How it works — step by step

```
POST /api/connections            →  validate type + required secret fields
        ↓
encrypt(JSON.stringify(secret))  →  AES-256-GCM blob in connection_profiles.secret_blob
        ↓
activate (default on create)     →  one active PERSONAL profile per user (unique index)
        ↓
resolveCredsForType(userId,type) →  server-side adapters read the active profile's secret
        ↓
activate ServiceNow → POST /api/incidents/refresh (202) → poll /status until done|failed
```

**Walkthrough**

1. `ConnectionsPage` reads state from `ConnectionsContext` (`useConnections`), which wraps `client/src/utils/connectionsApi.js`.
2. **Create** → `POST /api/connections { name, type, secret, make_active }`. The route requires `name`, `type`, `secret`; the store validates the type and its required fields, encrypts, and inserts.
3. **Activate** → `POST /api/connections/:id/activate`. The store deactivates the user's other *personal* profile and sets this one active.
4. If the activated profile is `type === 'servicenow'`, the context fires `POST /api/incidents/refresh` (returns immediately) and polls `GET /api/incidents/refresh/status` every ~3 s until `state` is `done` or `failed`.
5. **Edit** → `PATCH /api/connections/:id { name?, secret? }`. Secret is merged onto the existing one and re-encrypted only if the user typed into a field.
6. **Delete** → `DELETE /api/connections/:id`.
7. Server-side consumers (e.g. `server/cmdb_ticket_proxy.js`) call `profiles.resolveCredsForOrg(orgId,'servicenow')` first, then fall back to `profiles.resolveCredsForType(userId,'servicenow')`, and inject `SN_INSTANCE/SN_USER/SN_PASSWORD` into the spawned Python process.

## 4. Where the input comes from

- **`name`** — free text, trimmed and capped at 120 chars.
- **`type`** — one of `SUPPORTED_TYPES` in `server/lib/connection_profiles.js`: `servicenow`, `netbox`, `orion`, `spectrum`, `generic_sql`, `generic_rest`. Immutable after create (the `<select>` is `disabled` when editing).
- **`secret`** — a type-specific object, validated by `validateSecret`:
  - `servicenow` → `{ instance, user, password }`
  - `netbox` → `{ base_url, token }`
  - `orion` → `{ host, user, password }`
  - `spectrum` → `{ base_url, user, password }`
  - `generic_sql` → `{ connection_string }`
  - `generic_rest` → `{ base_url }` (`token` optional)
  - The field labels/placeholders come from `TYPE_INFO` in `client/src/utils/connectionsApi.js`.

## 5. What it produces (output)

- **Profile metadata** — `rowToMeta`: `{ id, name, type, is_active, created_at, updated_at }`. **No secret is ever included** in any list/get response.
- **The active profile** — resolved for the caller via `GET /api/connections/active`; server-side via `getActiveWithSecret` / `resolveCredsForType`.
- **Refresh state** — `{ state, instance, startedAt, finishedAt, count, error }` from `GET /api/incidents/refresh/status`, surfaced in the context as `lastRefresh`.

## 6. What you see on screen

- **Header** — a back button, the title **"Data Sources"**, and the (inert) `ThemeToggle`.
- **Active card** (`styles.activeCard`) — status dot, name, `typeLabel(type)`, an **Active** badge, and a **⋯** menu (Edit / Delete). For `active.type === 'servicenow'`, a **Refresh data from this source** button.
- **"Other saved"** — inactive profiles, each with a **Use** button (→ `activate`) and a **⋯** menu.
- **Banners** — `refreshBanner` (spinner) while `refreshing`; then `successBanner` ("✓ Pulled *N* incident(s) from *[instance]*") or `errorBanner`.
- **Modal form** — name input, type `<select>` (disabled when `editingId`), and `TYPE_INFO[type].fields`. Editing shows "Leave the credential fields blank to keep what's already saved."

## 7. The logic behind it

- **Sole source of truth, no fallback.** `resolveCredsForType` / `resolveCredsForOrg` return `null` if there's no matching active profile. There is intentionally **no env/file fallback** — data only flows from a configured connection, so an unconfigured tenant simply gets no external data rather than silently hitting some default instance.
- **One active per scope.** A partial unique index enforces one active *personal* profile per user (`WHERE is_active = 1 AND organization_id IS NULL`) and one active *org* profile per `(organization_id, type)`. The two scopes are kept from bleeding into each other — a historical single index once capped an admin at one active profile across both scopes and surfaced as a raw 500; the store migrates that old index shape on load.
- **Write-only secrets.** Metadata queries never select `secret_blob`; only `getWithSecret` / `getActiveWithSecret*` do, and those are server-side only.
- **Switch triggers refresh.** Activating a ServiceNow profile re-polls the incident inbox in the background so downstream screens see fresh data.

## 8. Detailed technical explanation

**Store & schema** (`server/lib/connection_profiles.js`). One row per profile in the `connection_profiles` table in `server/data/auth.db` (better-sqlite3, WAL): `id, user_id, name, type, secret_blob, is_active, created_at, updated_at`, plus a lazily-added `organization_id` column. Indexes: `idx_conn_profiles_user`, `idx_conn_profiles_org`, and the two partial-unique active indexes described above.

**Encryption.** `secret_blob` is `base64(iv|tag|ciphertext)` of the JSON credentials, produced by `encrypt`/`decrypt` from `server/lib/ssh-creds.js`. The key is shared with the SSH-creds store — `server/.env.key` (auto-generated 32-byte hex on first run, mode `0600`) or the `SSH_CREDS_KEY` env var — so there is one key and one rotation surface.

**HTTP surface** (`server/connection_profiles_routes.js`, all under `requireAuth`, scoped to `req.user.id`):
- `GET /api/connections` · `GET /api/connections/active` · `POST /api/connections`
- `GET /api/connections/:id` · `PATCH /api/connections/:id` · `POST /api/connections/:id/activate` · `POST /api/connections/deactivate` · `DELETE /api/connections/:id`
- Org-scoped (`requireOrgAdmin`, i.e. `org_admin`/`owner` with an `organization_id`): `GET/POST /api/org-connections`, `PATCH/DELETE /api/org-connections/:id`. Create replaces any prior active credential of the same `type`; the writing admin's id is recorded for audit only.

**Client** (`client/src/ConnectionsContext.jsx` + `connectionsApi.js`). The context auto-loads on mount when authed, derives `active` from the profile list, and exposes `create/update/activate/deactivate/remove/refreshActiveSource`. On ServiceNow activation it dispatches a `rt:connection-activated` window event and drives the "pulling…" banner via a poll loop with a 6-minute client-side cap (the server's own poller has a 5-minute hard timeout).

**Refresh job.** `POST /api/incidents/refresh`, `GET /api/incidents/refresh/status`, and `GET /api/incidents/active` live in `server/app.js`. The status shape is `{ state: idle|running|done|failed, instance, startedAt, finishedAt, count, error }`.

**Consumption.** `server/cmdb_ticket_proxy.js` injects ServiceNow creds by resolving the org profile first, then the user profile: `profiles.resolveCredsForOrg(orgId,'servicenow') || profiles.resolveCredsForType(userId,'servicenow')`, mapping `secret.{instance,user,password}` to `SN_INSTANCE/SN_USER/SN_PASSWORD` for the spawned `servicenow/cmdb_ticket.py`. Mock responses for offline development live in `server/mock_routes.js`.

## 9. Real data vs. synthetic

| Thing on screen | Real or synthetic |
|---|---|
| Saved profiles & metadata | **REAL** — rows in `connection_profiles`. |
| Credentials | **REAL** — AES-256-GCM `secret_blob`; never returned by any route. |
| Active badge | **REAL** — `is_active` under the partial-unique index. |
| Refresh outcome (`count`, `instance`) | **REAL / LIVE** — the actual `/api/incidents/refresh` job result. |
| Mock connection responses | SYNTHETIC — only when `server/mock_routes.js` is mounted for offline dev. |

## 10. Use cases

- **Repoint an org.** Add + activate a ServiceNow profile so `cmdb_ticket_proxy` resolves creds and the SR flow runs against it.
- **Rotate a secret.** `PATCH /api/connections/:id` with just the changed field — merged onto the decrypted existing secret and re-encrypted, old value never surfaced.
- **Org-wide credentials.** An `org_admin` sets one write-only credential per type via `/api/org-connections`; every member's pipeline resolves it through `resolveCredsForOrg`.
- **Bring your own DB.** `generic_sql` (`connection_string`) or `generic_rest` (`base_url` + optional `token`) let a customer point RackTrack at a non-standard CMDB.

---

— Connections & Integrations —
