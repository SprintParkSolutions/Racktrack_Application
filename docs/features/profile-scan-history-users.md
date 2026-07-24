# Profile & Scan History

**Feature Reference** · *Your account home — who you are signed in as, and a quick list of the racks you have recently scanned, each one a tap away from its full report.*

**Category:** Account — identity and recent activity · **Audience:** Everyone; admins and owners see extra shortcuts · **Document date:** 24 July 2026 · Part of the RackTrack documentation set.

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

Profile is your home base inside RackTrack. It answers two simple questions at a glance: *who am I signed in as?* and *what have I scanned lately?*

At the top sits your identity — your avatar, your username, the email on your account, the organization you belong to, and the month you joined. It is the quick reassurance that you are in the right account, working under the right organization.

Below that is your **Recent Scans** list: the racks you have photographed, newest first, each shown with a small thumbnail, its rack ID, a few quick numbers about what was found, and a friendly "how long ago" label. Tap any row and RackTrack reopens that scan's full report, exactly as it was — no searching, no re-scanning. The list starts short, showing your five most recent scans, and expands to the full history whenever you want it.

This history follows you. Because it lives with your account rather than on one particular phone or tablet, you can scan on one device and pick the report back up on another. And if you happen to be an admin or an owner, the Profile screen also gives you handy shortcuts into your management tools, so your day-to-day home and your control panel are never more than a tap apart.

## 2. At a glance

| | |
|---|---|
| **Category** | Account — your identity and your recent activity in one place. |
| **Who uses it** | Everyone. Admins and owners also see extra management shortcuts. |
| **Where input comes from** | Your signed-in account and the scans stored against it on the server. |
| **What it outputs** | Your identity details, a list of recent scans with quick stats, and role-based shortcuts. |
| **Data source** | REAL — backed by your account on the server, not tied to any one device. |

## 3. How it works — step by step

```
Open Profile               →  from the bottom navigation
        ↓
Show your identity          →  username, email, organization, join date
        ↓
List your recent scans      →  newest first, each with quick stats
        ↓
Reopen a scan               →  tap a row to load its full report
```

**Walkthrough**

1. Open Profile from the bottom navigation.
2. Read the identity area at the top — your avatar, username, email, organization, and the month you joined.
3. Look over your Recent Scans list, which shows up to five to begin with and expands to show them all.
4. Tap any scan row to reopen its full report, loaded straight from that rack's saved record.
5. If you are an admin or an owner, use the extra Administration and Integrations shortcuts to jump to your management tools.

## 4. Where the input comes from

- **Your account** — your username, email, organization, and the date you joined, all read from the account you are signed in with.
- **Your scans** — the racks you have photographed, fetched for the signed-in user from the server.
- **Your role** — which decides whether the admin shortcuts appear at all.

## 5. What it produces (output)

- **An identity area** — your avatar and the key details of your account, gathered in one place.
- **A recent-scans list** — each entry carrying a thumbnail, the rack ID, quick counts of devices, units, and ports, and a relative time such as "2 hours ago."
- **Admin shortcuts** — quick links to the management console and to Connections, shown only to the roles allowed to use them.
- **A sign-out control** — with a confirmation step so you never sign out by accident.

## 6. What you see on screen

- **An identity hero** — your avatar shown as an initial, your username, your email, your organization, and your join date.
- **Recent scans** — up to five rows, each with a thumbnail, the rack ID, a set of quick stats, and a relative time.
- **A "Show all / Show less" toggle** — expand the list to your full scan history, or collapse it back to the recent few.
- **Administration and Integrations rows** — shown only to owners and organization admins, and hidden entirely for everyone else.
- **A sign-out confirmation** — a gentle check, "Sign out? You'll need to sign in again," before it actually signs you out.

## 7. The logic behind it

- **The history is account-backed.** This real, server-stored list replaced an older approach that kept the history on the device itself. Because your scans now live with your account, they travel with you — scan on one device, review on another, and nothing is lost when you switch phones.
- **Shortcuts are role-gated.** Members and site managers see only their own profile and their own scans. The Administration and Integrations shortcuts appear solely for the roles that are meant to use them, so the screen stays clean and shows each person only what is theirs to reach.

## 8. Detailed technical explanation

**How the list is built.** When you open Profile, RackTrack fetches the scans that belong to the account you are signed in with and shows them newest first, so your latest work is always at the top. Each row is a live link to its rack: tapping it reopens that exact scan's report by its rack identifier, rather than reconstructing it or scanning again. Because the report is loaded from the saved record, it comes back precisely as it was left.

**Sections that appear by role.** The Administration and Integrations rows are not always present — they are shown or hidden based on the role attached to your account. An owner or an organization admin sees them; a member or a site manager does not. This keeps the same Profile screen honest for every role: it never offers a shortcut to something you are not allowed to open.

**Why it follows you across devices.** The scan history is stored with your account on the server, not saved locally on a single device. That is the deliberate reason it stays in sync: the same list appears whether you are on the phone you scanned with or a tablet you have only just picked up.

## 9. Real data vs. synthetic

| Thing on screen | Real or synthetic |
|---|---|
| Your identity and organization | **REAL** — read straight from your authenticated account. |
| Your scan list and its quick stats | **REAL** — stored with your account and synced across your devices. |
| The Administration and Integrations shortcuts | **REAL** — genuinely present, and shown only to owners and organization admins. |

## 10. Use cases

- **Jumping back to a scan.** Reopen this morning's rack straight from the Recent Scans list, with its full report loaded exactly as it was — no re-scanning required.
- **Reaching your admin tools.** An organization admin hops from their profile straight into the management console using the Administration shortcut, keeping home and control panel one tap apart.

---

— Profile & Scan History —
