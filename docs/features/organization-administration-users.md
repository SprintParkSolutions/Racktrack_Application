# Organization Administration

**Feature Reference** · *A role-aware console for organizations, sites, members, and invitations — where each role sees exactly what it is allowed to manage, and nothing more.*

**Category:** Administration — role-scoped management · **Audience:** Platform owners and organization admins · **Document date:** 24 July 2026 · Part of the RackTrack documentation set.

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

Organization Administration is the console where the people in charge keep everything tidy — the organizations, the sites within them, the members who belong to each site, and the invitations that bring new people in. It is one screen, but it shows two quite different things depending on who opens it.

If you are the **platform owner**, you see the whole platform. You can create a new organization, approve one that has just signed up, rename one, switch one off, or remove it entirely. You can open any organization and look inside — its sites, its people, and everything they have scanned. In short, the top-level lifecycle of every customer runs through your hands.

If you are an **organization admin**, you see your own organization and only your own. You add and arrange the sites within it, add and edit the members who work there, set up the integrations your organization shares, and send out invitations. What you cannot do is reach into anyone else's organization, and you cannot touch the owner role.

If you are a **member** or a **site manager**, this console is simply not for you. Opening it just sends you back where you came from. That is by design: administration is a role-scoped tool, and the roles that do not administer never see it.

Whichever door you come through, the console does the same everyday jobs — managing people and places, sending single-use invitation links, approving what needs approving, and letting you filter the record of scanning activity down to one person or one site.

## 2. At a glance

| | |
|---|---|
| **Category** | Administration — management that is scoped to your role. |
| **Who uses it** | Platform owners and organization admins only. Members and site managers are turned away. |
| **Where input comes from** | Actions taken by owners and admins — creating organizations, adding sites and members, sending invitations, approving requests. |
| **What it outputs** | A managed, live directory of organizations, sites, members, and invitations, plus a filterable view of scan activity. |
| **Data source** | REAL — genuine organizations, sites, members, invitations, and scans, all live. |

## 3. How it works — step by step

```
Open the console           →  from the Administration shortcut on your Profile
        ↓
Owner or admin scope       →  every organization  ·  or  just your one organization
        ↓
Manage                     →  sites · members · invitations · approvals
        ↓
Filter the activity        →  narrow the scan record to a person or a site
```

**Walkthrough**

1. Open the console from the Administration shortcut on your Profile. If you are a member or a site manager, you are simply redirected away — the console does not open for you.
2. As the **platform owner**, you first see platform-wide figures and the full list of organizations. From here you can create, approve, rename, deactivate, or remove any organization.
3. As the owner, you can drill into any single organization to see the sites inside it, the people who belong to it, and the scans they have produced.
4. As an **organization admin**, you land straight in your own organization. You add sites, add and edit members, and set the integrations that apply across the whole organization.
5. Either role can generate a single-use invitation link to bring in a new person, and either role can filter the scan activity by a particular person or a particular site to see just the slice they care about.

## 4. Where the input comes from

- **Organization actions (owner only)** — creating a new organization, approving a pending one, renaming it, deactivating it, or removing it.
- **Site and member actions** — adding a site, and adding, editing, deactivating, or removing a member.
- **Invitations** — an email address and a chosen role, which together produce a single-use link to send.
- **Filters** — choosing a person or a site to narrow the grid of scan activity down to just that scope.

## 5. What it produces (output)

- **A managed, live directory** — the current, real set of organizations, sites, and members that everyone else relies on.
- **Invitation links** — single-use, valid for seven days, and easy to copy and send.
- **Approval decisions** — the owner's choices that move an organization through its lifecycle, from pending to active or otherwise.
- **Filtered scan activity** — the record of what has been scanned, narrowed to one person or one site on demand.

## 6. What you see on screen

- **Owner platform statistics** — the totals across the whole platform: how many organizations, sites, and users there are, and how many scans have been run.
- **Pending approvals** — a list of organizations awaiting a decision, each with clear approve, reject, or remove actions.
- **Organization detail** — a single organization opened up, showing its people, its sites, and a scan grid you can filter.
- **A people grid** — one row per person with an avatar, their role, whether their account is switched on or off, and a running tally of how many scans they have done.
- **An invitation panel** — a simple form for an email address and a role, which produces a copyable, single-use link.

## 7. The logic behind it

- **Guardrails keep roles in their lanes.** The owner role can never be managed by anyone else. One organization admin can never manage another organization. And when an admin adds a new member or sends an invitation, the only roles they can hand out are Member or Site Manager — never something higher than themselves.
- **History is preserved.** Removing a member deletes their account, but their past scans stay on the record. The people change; the work they did remains documented.
- **Status governs access.** An admin of an organization that is still pending sees only an "awaiting approval" notice rather than the full console. And if an organization is deactivated, scanning pauses for every one of its members until it is switched back on.

## 8. Detailed technical explanation

**Everything is scoped by role, and the scope is enforced, not trusted.** The platform owner operates across the whole platform; an organization admin is confined to their own organization. This boundary is applied behind the scenes on the server for every action, so it holds even if someone tries to reach past their own organization — the console on the screen and the enforcement underneath agree, and the enforcement is the one that counts.

**Invitations are deliberately limited.** Each invitation link works only once and stops working after seven days. It carries the organization, the specific site, and the role baked in, so the person who accepts it lands exactly where the admin intended and cannot quietly upgrade themselves along the way. If a link is not used in time, it simply expires, and a fresh one can be generated.

**Shared integration credentials are kept secret.** When an organization sets up an integration that applies across the whole organization, the credentials behind it are stored in an encrypted form and are never shown back on screen. The console will tell you *that* an integration is configured, but it will never reveal the secret itself — so the settings can be reviewed safely without ever exposing the sensitive part.

## 9. Real data vs. synthetic

| Thing on screen | Real or synthetic |
|---|---|
| Organizations, sites, members, invitations, and scans | **REAL** — live account and organization data. |
| Approvals and status changes | **REAL** — the owner-driven lifecycle of an organization. |
| Organization-wide integration secrets | **REAL, but hidden** — stored encrypted and shown only as "configured," never displayed. |

## 10. Use cases

- **Standing up a new customer.** The platform owner creates an organization and its first admin. That admin then invites the field team, and the whole company is up and running.
- **Reorganizing a team.** An organization admin moves members between sites as the work shifts, and rotates invitation links as staff come and go — all without ever touching another organization's data.

---

— Organization Administration —
