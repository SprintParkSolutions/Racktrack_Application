# Organizations, Roles & Access

*How RackTrack keeps every company's racks, people, and scans walled off from every other company's — who is allowed to see what, who can manage whom, and exactly how those boundaries are enforced.*

Admin feature · Owners & org admins · Last verified: 26 July 2026 against the live code.

---

## On this page

1. In simple terms
2. At a glance
3. The roles
4. How it works — step by step
5. What you see on screen
6. How access is scoped
7. Under the hood
8. Edge cases & limits
9. Common questions

---

## 1. In simple terms

RackTrack is used by many different companies at once, and none of them should ever see anyone else's racks. To make that safe, everything in RackTrack is arranged as a simple family tree.

At the very top is the **platform owner** — that is the RackTrack team itself. Below the owner sit the **organizations**. An organization is one customer company. Inside each organization are one or more **sites** — think of a site as a location or a team, like "HQ Datacenter" or "London Floor 3." And inside each site are the **people** who actually do the scanning.

So the shape is always the same:

> **Owner → Organization → Site → People**

Every person belongs to exactly one organization, and (almost always) to one site inside it. What you are allowed to see and do depends entirely on where you sit in that tree. A regular team member sees only the racks they personally scanned. Their organization's admin sees everything across the whole organization. The platform owner sees everything, everywhere. Nobody can look sideways into a different company's data — that boundary is the whole point.

Because a scan can only happen when someone is signed in, every rack, every photo, and every correction is tied to a real named person. There is no anonymous activity. When the console shows "12 scans by Jane," that is genuinely Jane's work, recorded against her account.

This document explains the roles, how organizations get created and joined, what the management console looks like, and — importantly — the precise rules that decide who can see which racks.

## 2. At a glance

| | |
|---|---|
| **What it is** | The system of organizations, roles, and access rules that separates every customer's data and decides who can manage whom. |
| **Who uses the console** | Platform owners and organization admins. Site managers and members never open it — they are sent back to the app. |
| **The tree** | Owner → Organization → Site → People. Everyone belongs to one organization and usually one site. |
| **The four roles** | `owner`, `org_admin`, `site_manager`, `member`. |
| **Two ways in** | Found a new organization (self-signup, needs owner approval) · or accept an invitation to an existing site (no approval). |
| **How racks are walled off** | A rack is owned by the site that scanned it. A member sees only their own scans; an admin sees the whole organization; the owner sees the whole platform. |
| **Where it's enforced** | On the server, on every request — not on the phone. The screen and the server agree, and the server is the one that counts. |
| **Data source** | REAL — genuine organizations, sites, members, invitations, and scans, all live. |

## 3. The roles

RackTrack has **four** roles, arranged as a ladder. Each one can do everything the role below it can, within its own slice of the tree, plus a little more. (The console labels them Owner, Org Admin, Site Manager, and Member.)

### Owner — the platform superadmin

The owner is RackTrack itself. There is no organization above the owner; the owner sits above every organization. An owner can:

- Create a new organization and its first admin.
- See every organization on the platform, open any one of them, and look inside at its sites, its people, and everything they have scanned.
- Approve or reject an organization that signed itself up.
- Rename an organization, switch it off (deactivate) and back on, or remove it entirely.
- Edit or remove anyone — including an organization's admin. The owner is the only role that may touch an org admin.
- See every rack on the whole platform.

An owner account cannot be created, edited, or removed from the console by anyone. It can never be managed by a lower role.

### Org admin — runs one organization

An org admin runs a single organization and only that one. They land straight in their own organization and can:

- Add and arrange the **sites** inside their organization.
- Add, edit, deactivate, and remove the **members** of their organization.
- Send **invitation links** to bring new people into a specific site.
- Set up the **organization-wide integrations** (shared external credentials).
- See every rack across all of their organization's sites, and everyone's scans within it.

What an org admin cannot do: reach into a different organization, touch the owner, or manage another org admin. When they add a member or send an invite, the only roles they can hand out are Site Manager or Member — never something at or above their own level.

### Site manager — runs one site

A site manager looks after one site. They can add plain members to their own site and send invitations for it, but their reach is deliberately narrow:

- They can only create and invite **members** — never other site managers.
- When they edit an existing member of their own site, they may only change that person's **on/off status or password** — not their username, email, role, or which site they belong to.
- They see only **their own scans** (the same as a member), and their access does not widen to the rest of the organization even when their organization gains a second site.
- Site managers do **not** open the organization console; it is for owners and admins only.

### Member — the everyday user

A member is a regular technician who signs in and scans racks. A member:

- Sees only the racks **they personally scanned**, and only within their own site.
- Cannot see other people's scans, other sites, or the console.

> **A note on wording.** In casual conversation people say "user" for anyone who is not an admin. In the actual system there is no role literally called "user" — the everyday user is a `member`, and there is one step above them, `site_manager`, for a person who also looks after a site. This document uses the real role names.

## 4. How it works — step by step

There are two front doors into RackTrack. Which one you use decides whether anyone has to approve you.

### Path A — found a new organization (self-signup)

This is for the first person from a company who arrives on their own.

1. On the sign-up screen you enter your email, a username, your **company name**, and a strong password. The company name is required — every account must belong to a real organization.
2. RackTrack emails you a **six-digit code** to prove the email address is yours. You type it in to finish creating the account.
3. Behind the scenes this creates a brand-new **organization**, a first site inside it called **"Main Site,"** and makes **you that organization's admin**.
4. But the organization starts in a **pending** state. It is a *request*, not a live account. You are held on a friendly waiting screen until the platform owner reviews and approves it. The screen re-checks by itself every few seconds, so the moment you are approved the app opens on its own — you never have to sign in again to find out.

Until the owner approves it, a pending organization cannot add members or run scans.

### Path B — accept an invitation (no approval)

This is for someone joining a company that is already set up.

1. An owner, org admin, or site manager sends you an **invitation link** by email. The link already knows your email address (it is filled in and locked), which **site** you are joining, and what your **role** will be.
2. You open the link, pick a username and a password, and press Join.
3. You are signed in **immediately** — no code to type and no waiting room, because the person who invited you has already vouched for you. You land already attached to the right organization, site, and role.

Invitation links are **single-use** and expire after **7 days**. If a link is not used in time it simply stops working, and a fresh one can be generated.

### Owner-created organizations (the other way an org begins)

An owner can also create an organization directly, without waiting for anyone to sign up. When the owner does this, they set the organization's name and its first admin's username, email, and password. An owner-created organization is **active straight away** — it never sits in the pending queue.

### Approvals — the owner's decision

When a company self-signs-up, the owner sees it in a **Pending approvals** list. For each request the owner can:

- **Approve** it — the organization goes live; its admin can now add members and its people can start scanning.
- **Reject** it — the request is turned down.
- **Remove** it — the organization and everything in it is deleted (used to clear stray sign-ups).

### Growing the team

Once an organization is active, its admin builds it out:

- **Add a site** for each location or team.
- **Add a member** directly by setting their username, email, password, and role (Member or Site Manager).
- Or **send an invitation link** and let the new person choose their own username and password.

## 5. What you see on screen

The console lives at **Organizations** and is reached from the Administration shortcut. It shows two quite different things depending on who opens it. A member or site manager who somehow reaches it is simply bounced back to the app.

### The owner's view — the whole platform

- **Platform totals** across the top: how many Organizations, Sites, and Users exist, and the Total scans run.
- **Pending approvals** — any organizations awaiting a decision, each showing who requested it and their email, with **Approve**, **Reject**, and **Remove** buttons.
- **All organizations** — the full list. Each row shows the organization's initials badge, its name (with a "Pending" or "Inactive" tag if it is not active), how many sites and users it has, and a little bar of its scan volume. A per-row menu offers **Edit** (rename), **Deactivate / Reactivate**, and **Remove**.
- Clicking any organization opens its detail view (below). There is also a **+ New organization** button.

### The org admin's view — one organization

An org admin skips the platform list and lands directly inside their own organization's detail view. If their organization is still pending approval, they instead see a calm **"awaiting approval"** notice explaining that once the owner approves it, they will be able to add sites, invite members, and start scanning.

### The organization detail view

Whether opened by the owner or by that organization's own admin, one organization looks the same:

- **Summary stats** — People, Active (people who have actually recorded a scan), Scans, and Sites.
- **People** — a grid, one card per person, showing their avatar, their role, whether their account is switched on or off, when they last scanned, and a running tally of how many scans they have done. Clicking a person filters the scan grid below to just their scans. Each card has a menu with **Edit**, **Deactivate / Reactivate**, and **Remove** — but only for people you are allowed to manage (you never see these options on the owner, and an org admin never sees them on another org admin).
- **Sites** — a list of the organization's sites, each showing its user and scan counts and last activity, with **Invite** and **+ Add member** buttons. Clicking a site filters the scan grid to that site. There is an **+ Add site** button.
- **Recent scans** — a grid of thumbnails from real scans, showing who scanned what and where. It filters live when you click a person or a site.
- **Organization integrations** (org admin only, not the owner) — a panel to configure the organization's shared external access. The owner does not see this because the owner has no single organization context.

### The modals

Small pop-up forms handle the actions: **New organization** (name + the first admin's username, email, and password), **Add site**, **Add member** (username, email, password, and a role of Member or Site Manager), **Edit member**, **Invite** (an email and a role, which produces a copyable single-use link), **Rename organization**, and confirmation dialogs for deactivating or removing an organization.

## 6. How access is scoped

This is the heart of the feature: who can see which racks. A rack in RackTrack is identified by a fingerprint of its photo, and it is **owned by the site that scanned it**. From there the rule is short:

- **A member sees only the racks they personally scanned** — and only within their own site. Not their teammates' scans, not other sites.
- **A site manager also sees only their own scans** — their view does not widen to the rest of the site or organization.
- **An org admin sees every rack across all of their organization's sites** — everyone's scans, organization-wide.
- **The owner sees every rack on the whole platform.**

The same ladder governs everything built on top of scans — the Profile scan-history list, the Ground Truth labelling queue, and the per-site network and switch data all narrow to exactly the slice each role is allowed.

A member's history is genuinely their **own** work. Even if a member re-scans a rack that a colleague already scanned (RackTrack recognises the identical photo and reuses the result instantly), that scan still shows up as the member's own, because ownership is recorded per person, not just per site.

Two boundaries are deliberately firm:

- **A site manager does not inherit the whole organization.** If an organization adds a second site, its existing site managers do **not** suddenly gain that new site's inventory. A site manager manages exactly one site.
- **Nobody sees another organization.** There is no path, in the screen or underneath it, from one organization to another's racks.

## 7. Under the hood

This section is accurate to the current code. It is written for engineers and technically-minded readers.

### Identity and the token

Sign-in is handled in `server/auth.js` using SQLite (`better-sqlite3`), bcrypt password hashing, and a signed JWT. On login the server issues a token that carries the user's id, username, `tenantId`, `organizationId`, and `role`, so middleware can read the caller's position in the tree without a database round-trip. The `requireAuth` middleware verifies the token, reloads the user row, and attaches it (plus its tenant) to the request. `requireRole(...)` layers a role check on top.

### The data model (the tree)

- **`organizations`** — one row per customer company, with a `status` of `active`, `pending`, `inactive`, or `rejected`.
- **`tenants`** — a "site" is a tenant row, each carrying an `organization_id` linking it to its organization. (The word "tenant" is the internal name; the UI calls it a "site.")
- **`users`** — each carries a `role`, a `tenant_id` (their site), and a denormalized `organization_id` so org-level scoping is a single indexed lookup rather than a join.
- **`invites`** — a single-use code bound to an email, a role, an `organization_id`, and a `tenant_id`, with a 7-day `expires_at`.

Roles are exactly four: `owner`, `org_admin`, `site_manager`, `member`. Each user also gets a stable, role-prefixed public member number (`OWN-`, `ADM-` for admins/managers, or `USR-`), assigned once and never renumbered.

### How an org begins

- **Self-signup** (`POST /api/auth/signup` then `/verify`): public sign-up is limited to `@gmail.com` addresses and requires a company name of at least two characters. Verifying the emailed code creates an organization set to `status = 'pending'`, a `"Main Site"` tenant, and the founder as an `org_admin` attached to that site.
- **Owner-created** (`POST /api/orgs`, `requireRole('owner')`): creates the organization already `active` and its first `org_admin` in one transaction. (An owner-created admin has no site of their own — `tenant_id` is null — whereas a self-signup admin owns the "Main Site.")

### The org-status gate

`requireAuth` contains a central gate: `orgBlocked(user)` returns 403 (`"Your organization is awaiting approval"`) for any non-owner whose organization is not active. This runs on **every** endpoint except `/api/auth/*` — the exception exists so the pending-approval screen can keep polling `/api/auth/me` to notice the moment it is approved. The client mirrors this with `orgNotActive()`, which routes such users to the `/pending` screen. The server gate is the real control; the client routing is a convenience.

### Rack ownership and visibility

A rack id is `RK-` plus a truncated SHA-256 of the source image, so two sites scanning the same physical rack land on the same id. The `rack_owners` table (`tenant_id`, `rack_id`, `created_by`) records which site claimed each rack and which user did it. Because scanning (`POST /api/analyze`) and every feedback route (`POST /api/feedback`, `/api/feedback/device`, etc.) all sit behind `requireAuth`, every claim carries a real `created_by` — activity is always attributable.

The single policy that decides "may this caller touch this rack?" lives in `server/lib/rack_access.js`:

- `owner` → every rack.
- `org_admin` → any rack held by a site in their organization (`tenant.rackInOrg`).
- anyone else → their own site only, and only if they have one (`tenant.tenantOwnsRack`).

Every branch **fails closed** — a principal with no site inherits nothing — and denials return **404, not 403**, so the response never confirms that a rack exists in another tenant.

The helper functions in `server/lib/tenant.js` implement the breadth per role:

- `tenantUserRackIds(tenantId, userId)` — the racks a specific user claimed. This is what a **member** and a **site manager** see (their own scans only), used by `/api/scans` and the Ground Truth queue.
- `orgRackIds(orgId)` — every rack across every site in an organization. This is the **org admin** breadth.
- `allRackIds()` / a `null` allow-set — unrestricted, the **owner** breadth.
- `visibleTenantIds(principal)` — used to scope non-rack resources like port history. Returns `null` (no restriction) for the owner, the full list of the organization's site ids for an org admin, and just the caller's single site for everyone else. **Site manager is deliberately excluded from org-wide breadth here** — including it once meant every site manager picked up a newly-added site's switch inventory and its SSH access, so it is pinned to one site.

### Management guardrails

The member edit/remove routes (`PATCH`/`DELETE /api/orgs/:orgId/members/:memberId`) enforce, on the server:

- An **owner** account can never be edited or removed.
- Only the **owner** may edit or remove an **org admin**.
- A **site manager** may only manage plain members within their own site, and only their `active` status or password.
- The only roles that can be assigned are `member` and `site_manager`; a site manager can only ever produce members.
- You cannot remove your own account.

Removing a member **deletes the account but keeps their scans** — `rack_owners.created_by` is set to null, so the history survives and simply shows the scanner as "—".

### Shared integration secrets

Organization-wide external credentials (CMDB/ITSM, live network sources) are entered once by the admin and stored **AES-256-GCM encrypted**. The plaintext is never returned to the client — the panel shows only *which* integrations are configured, never the secret itself.

## 8. Edge cases & limits

- **Pending organization.** A self-signed-up organization cannot add members or scan until the owner approves it. Its admin sees an "awaiting approval" notice, and the server rejects every non-auth request from its users with a 403. Owner-created organizations skip this entirely.
- **Deactivating an organization.** An owner can switch an organization off. Its members then cannot scan until it is switched back on — the data is untouched and returns intact on reactivation.
- **Deactivating a person.** Setting a member to "off" (a soft-disable) keeps all of their data and history but blocks sign-in — a login attempt returns `"This account has been deactivated. Contact your administrator."` Reactivating restores access.
- **Removing a member.** The account is deleted, but every rack they scanned stays on the record, now shown against "—" instead of a name. You cannot remove your own account, and no admin can remove the owner or (unless they are the owner) an org admin.
- **Removing an organization.** This permanently deletes the organization and all of its members, sites, and invites, and cannot be undone. Past scan artefacts on disk are dissociated (rack ownership and audit rows are cleared), not the outputs themselves.
- **The owner has no organization.** Owners sit above the tree, so features that need an organization context — the org-wide integrations panel, for example — are not shown to them. This is why the org-status gate never applies to an owner.
- **Owner-created admins have no site.** An org admin created directly by the owner has no site of their own until sites are added; a self-signup admin always starts with the "Main Site."
- **Invitations expire and are single-use.** A link works exactly once and stops after 7 days. It carries the organization, site, and role baked in, so an invitee can never quietly upgrade their own access.
- **Public sign-up is Gmail-only.** Founding a new organization from the public sign-up form requires an `@gmail.com` address and a company name. Invited members and staff/owner accounts are not subject to that Gmail rule.
- **The "Organization" field at sign-in.** It is optional. When filled in it is matched against an organization (by name or slug) first, then a site, which lets the same username exist safely in different organizations. Owners sign in with it left blank.

## 9. Common questions

**Q: Who can see my racks?**
A: Only you, your organization's admin, and the platform owner. As a member you see just the racks you personally scanned; your org admin sees everything across your whole organization; the owner sees everything on the platform. Your teammates do **not** see your scans, and nobody in another organization can see them at all.

**Q: Can another company ever see our data?**
A: No. Every organization is walled off. There is no path — through the screen or underneath it — from one organization to another's racks, sites, or people.

**Q: What exactly can an owner do?**
A: Everything, everywhere. The owner creates organizations and their admins, approves or rejects sign-ups, renames, deactivates, or removes organizations, edits or removes anyone (including org admins), and sees every rack on the platform. The owner is also the only role that can manage an org admin.

**Q: What's the difference between an org admin and a site manager?**
A: An org admin runs the whole organization — all its sites, all its members, its shared integrations, and it sees every rack in the organization. A site manager looks after just one site: they can add and invite plain members to it and can toggle those members on/off or reset their passwords, but they cannot manage other managers, cannot reach other sites, and see only their own scans.

**Q: Is there a role called "user"?**
A: Not literally. The everyday user is a `member`. Above members sits `site_manager`, and above that `org_admin`, then `owner`. People often say "user" informally to mean a member.

**Q: How do I get into RackTrack?**
A: Two ways. Either found a new organization by signing up with your company name (which needs the platform owner's approval), or accept an invitation link from someone already in an organization (no approval, no waiting).

**Q: Why is my new organization stuck on a waiting screen?**
A: Because self-signed-up organizations start as a *request* and need the platform owner to approve them before they go live. The screen re-checks every few seconds and opens on its own the moment you are approved — you don't need to sign in again.

**Q: Do invitations expire?**
A: Yes. An invitation link works once and stops working after 7 days. If it lapses, ask your admin to generate a new one.

**Q: If I invite someone, can they give themselves a higher role?**
A: No. The role and site are baked into the invitation link. Whoever accepts it lands exactly where you set them, and cannot upgrade themselves. Admins and managers also can only ever hand out roles at or below their own level.

**Q: What happens to someone's scans if I remove them?**
A: The scans stay. Removing a member deletes the account but preserves their scan history; those scans simply show the scanner as "—" from then on. (You can't remove your own account.)

**Q: What's the difference between deactivating and removing?**
A: Deactivating is reversible — an off account keeps all its data and history but can't sign in until it's switched back on. Removing is permanent — it deletes the account (though, again, its past scans remain on the record).

**Q: Are the scans and counts on the console real?**
A: Yes. Everything shown — organizations, sites, members, invitations, and scans — is live, real data. And because scanning and giving feedback both require being signed in, every scan is attributed to a genuine, named person.

**Q: Can a member or site manager open the organization console?**
A: No. The console is only for owners and org admins. Anyone else who reaches it is sent straight back to the app — administration is a role-scoped tool, and the roles that don't administer never see it.

---

— Organizations, Roles & Access —
