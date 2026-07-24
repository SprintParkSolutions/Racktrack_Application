# Connections & Integrations

**Feature Reference** · *Connect RackTrack to the systems you already run — your CMDB and network sources — and keep the keys safe.*

**Category:** Integration — external data sources · **Audience:** Owners and organization admins · **Document date:** 24 July 2026 · Part of the RackTrack documentation set.

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

RackTrack is more useful when it can talk to the systems you already run — your records database (a CMDB such as ServiceNow), your network management tools (NetBox, SolarWinds Orion, CA/DX Spectrum), or your own database. This screen, called **Data Sources**, is where you tell RackTrack how to reach them.

You add a **connection** by giving it a name, choosing what kind of system it is, and typing in the sign-in details. RackTrack locks those details away encrypted and never shows them back to you. You can save as many connections as you like, but only **one is active at a time** — and the active one is what every screen in the app reads from while you're signed in. Switch the active connection and the whole app quietly re-points at the new source.

The important promise: **your credentials go in, but never come back out.** To change a password you re-type it; RackTrack replaces the old one without ever displaying it.

## 2. At a glance

| | |
|---|---|
| **Category** | Integration — the external data sources RackTrack reads from. |
| **Who uses it** | Owners and organization admins. |
| **Where input comes from** | You: a name, a type, and the type's sign-in fields. |
| **What it outputs** | A list of saved connections with exactly one active, plus the outcome of each refresh. |
| **Data source** | REAL — your actual connection details and live refresh results. |

## 3. How it works — step by step

```
Add a connection            →  name, type, and that type's sign-in fields
        ↓
Stored securely             →  the secret is encrypted; never shown again
        ↓
Make one active             →  the active source drives every screen's data
        ↓
Refresh (ServiceNow)        →  pull the latest records from that source
        ↓
Edit / switch / delete      →  rotate a password, change sources, or remove one
```

**Walkthrough**

1. Open **Data Sources** from the menu (owners and org admins only).
2. Press **Add connection** and enter a name (e.g. "My ServiceNow Dev"), pick a type, and fill in that type's fields.
3. Press **Save & use**. The secret is encrypted and the connection becomes active.
4. To switch, press **Use** on any other saved connection — it becomes the active source and the app re-reads its data.
5. For an active ServiceNow source, press **Refresh data from this source** to pull the latest incidents. A banner shows the app working, then the result.
6. To change a credential, open the connection's **⋯** menu, choose **Edit**, and re-type the field you want to replace. Leave a field blank to keep what's already saved.
7. To remove a connection, choose **Delete** and confirm.

## 4. Where the input comes from

- **Connection name** — free text you choose. Required.
- **Connection type** — picked from the supported systems (ServiceNow, NetBox, SolarWinds Orion, CA/DX Spectrum, or your own database by SQL or REST). Chosen when you create the connection and **locked afterwards** — different systems need different fields.
- **Credentials** — the sign-in fields for that type (an instance name, a web address, a username, a password or an API token). These are always blank when you edit, so you only ever type a secret to *replace* it.

## 5. What it produces (output)

- **A set of saved connections** — one marked active, the others ready to switch to.
- **The active-source effect** — the active connection is the single source every screen reads from. There's no blending of two sources at once; whichever is active wins.
- **A refresh outcome** — for ServiceNow, either "Pulled *N* incidents from *[instance]*" or a plain reason it failed.

## 6. What you see on screen

- **An intro line** explaining that the active connection is what every screen uses while you're signed in.
- **An Active card** — a status dot, the connection's name and type, an **Active** badge, and a **⋯** menu (Edit / Delete). For a ServiceNow source it also shows a **Refresh data from this source** button.
- **An "Other saved" list** — every inactive connection, each with a **Use** button and its own **⋯** menu.
- **Banners** — a "Pulling fresh data…" spinner while a refresh runs, then a green success line or a red failure reason.
- **The Add / Edit form** — a name field, a type picker (greyed out when editing), and the type's credential fields. When editing, a note reminds you that blank fields keep the saved secret.

## 7. The logic behind it

- **One active source, no ambiguity.** Because exactly one connection is active, there is never any doubt about where a screen's data came from. Switching sources is deliberate and obvious.
- **Secrets go in, never out.** Saved credentials are encrypted and are never sent back to your screen — not even masked. Editing means re-entering a value, which also makes password rotation clean and safe.
- **The type is fixed for a reason.** Each system needs its own set of fields, so a connection's type can't change after it's created. If you need a different system, you add a new connection.
- **Personal vs. organization-wide.** The connections on this screen are **yours**. Separately, an organization admin can set one shared set of credentials for the whole organization in the admin console — those are used by everyone's pipeline and, like personal ones, can never be read back.
- **Switching triggers a refresh.** Making a ServiceNow connection active kicks off a background pull so the rest of the app sees fresh data without you asking.

## 8. Detailed technical explanation

**Where the secrets live.** When you save a connection, RackTrack validates that you supplied the fields that system needs, then encrypts the whole set of credentials with strong authenticated encryption before writing them down. Only the harmless parts — the name, the type, when it was created — are stored in plain form so the list can be shown. The encrypted part is only ever unlocked on the server, at the moment it needs to make an outbound call to your system. It is never returned to the app.

**One active at a time.** Each user has at most one active personal connection. Activating one automatically deactivates the previous one, so the "single source of truth" rule can't be broken by accident.

**The refresh.** ServiceNow can be slow to answer, especially a developer instance waking from cold, so a refresh doesn't make you wait. RackTrack kicks the pull off in the background and shows a "pulling…" banner; behind the scenes it checks on progress every few seconds and updates the banner to success ("Pulled *N* incidents") or a clear failure when the job finishes. There's a safety cap so the app never waits forever.

**Organization-wide credentials.** An organization admin can configure one shared credential per system for the entire organization. Members' scans then use those shared credentials automatically. They are write-only in exactly the same way — the server can decrypt them to make a call, but no screen and no admin can read them back.

## 9. Real data vs. synthetic

| Thing on screen | Real or synthetic |
|---|---|
| Your saved connections | **REAL** — the sources you added. |
| Credentials | **REAL** — stored encrypted, never returned to the screen. |
| The active-source badge | **REAL** — reflects which source the app is actually reading from. |
| Refresh results ("Pulled *N* incidents") | **REAL / LIVE** — the actual outcome of pulling from your source. |

## 10. Use cases

- **Point RackTrack at a new instance.** Add a ServiceNow connection and make it active so registration and reconciliation run against it.
- **Rotate a password safely.** Edit a connection and re-type just the secret — the old value is replaced without ever being shown.
- **Switch between environments.** Keep a "Dev" and a "Prod" connection saved and flip the active one; the whole app follows.
- **Set it once for everyone.** As an org admin, configure a shared credential in the admin console so every member's scans reconcile against the same system.

---

— Connections & Integrations —
