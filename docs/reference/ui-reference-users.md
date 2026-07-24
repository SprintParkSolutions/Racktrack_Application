# UI Reference

**Feature Reference** · *The cross-cutting interface — the look, the layout, how you move around, and every screen you can reach.*

**Category:** Reference — interface & design system · **Audience:** Everyone — a plain tour of how RackTrack looks and moves · **Document date:** 24 July 2026 · Part of the RackTrack documentation set.

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

RackTrack has one deliberate look: a **white, uncluttered surface** with near-black text and a single dark accent, in the spirit of Material Design. It's built to stay calm and legible on a phone held up in a data-center aisle. Whitespace does the separating, hairline borders do the dividing, and there are almost no heavy fills, gradients or drop shadows anywhere.

The app **adapts to your screen**. On a phone it's a single column with a bar of tabs along the bottom. On a tablet or laptop it grows a permanent sidebar down the left and spreads content across the width. Rotate or resize and it switches between those layouts instantly.

One thing to know up front: RackTrack is **light-only**. A theme toggle appears in a couple of places, but it does nothing — the appearance is fixed to the white theme until a real dark mode ships.

## 2. At a glance

| | |
|---|---|
| **Category** | Reference — the shared interface, navigation and screen index. |
| **Who uses it** | Everyone; this page is background, not a feature you operate. |
| **Where input comes from** | Your screen size and role, and the app's single set of design tokens. |
| **What it outputs** | The rendered layout, navigation and screens you see. |
| **Data source** | REAL — the live interface. (The theme toggle is inert; a few screens aren't user-facing.) |

## 3. How it works — step by step

```
Your screen width decides the layout
        ↓
Phone (< 768px)      →  single column + a bottom tab bar
        ↓
Tablet (768–1023px)  →  a left sidebar + one wide column
        ↓
Desktop (≥ 1024px)   →  left sidebar + full-width, side-by-side content
        ↓
Open a rack          →  a rack section / tab bar appears for that rack
```

**Walkthrough**

1. **Open the app.** You land on a full-screen welcome hero — the same immersive home on any device.
2. **On a phone**, move around with the bottom bar: Home, Scan, Profile, and a **Menu** button that opens everything else. On the Scan screen the central button becomes the camera shutter.
3. **On a tablet or laptop**, use the left **sidebar** instead. It lists your main destinations; a couple of them appear only if you're an admin or owner.
4. **Scan a rack.** After analysis you get a rack results screen with its own tab bar — Overview, Switches, Ports, Topology, and a **More** button for Network and Drift.
5. **Come back to that rack later.** On desktop, a "Rack · *[id]*" section stays in the sidebar so you can jump straight to Topology or Network without re-scanning.

## 4. Where the input comes from

- **Your screen** — the width of your device (or browser window) decides which of the three layouts you get, live.
- **Your role** — most people see the same navigation; a few destinations (like Marketplace, Data Sources and the admin consoles) only appear for admins and owners.
- **The app's design tokens** — one shared set of colours, fonts, spacing and corner radii defines the whole look, so every screen matches.

## 5. What it produces (output)

- **A consistent surface** — flat white cards with hairline borders, pill-shaped buttons, and one dark accent for primary actions.
- **A layout that fits the screen** — phone, tablet or desktop, chosen automatically.
- **Navigation that fits the screen** — a bottom bar on phones, a sidebar on larger screens, both drawn from the same list of destinations.
- **A per-rack workspace** — a tab bar (and, on desktop, a sidebar section) for moving around a scanned rack.

## 6. What you see on screen

RackTrack reuses a small set of building blocks across the app:

- **Bottom navigation** (phone) — Home, Scan, Profile, and a Menu button; the Scan tab doubles as the camera shutter.
- **Desktop shell** (tablet/desktop) — the left sidebar plus one shared top bar (a back button and the page title) and a full-width content area. The sidebar also grows a contextual "Rack · *[id]*" section once you've opened a rack.
- **Results tab bar** (inside a rack) — Overview, Switches, Ports, Topology, with More revealing Network and Drift. Tabs can carry small number badges.
- **Rack tabs** — when a scan covers more than one rack, a strip lets you switch between them (keeping your current sub-page) and open a Combined 3D view.
- **CMDB approval modal** — the guided "register this rack" flow (not registered → submitted → synchronizing → registered).
- **SFP advisor** — the transceiver-recommendation panel inside Switch Information.
- **Mini 3D rack** — the small animated rack shown while a scan is analyzing.
- **Theme toggle** — present but inert; it renders nothing and can't change the single theme.

**Screen index** — every screen you can reach, and what it's for:

| Screen | What it's for |
|---|---|
| Home / Welcome | The landing hero; starts a scan or sign-up. |
| Sign In | Existing-user login; routes you by role. |
| Create an Organization | Two-step founder sign-up with an emailed code. |
| Accept Invitation | Join an organization via a single-use link. |
| Forgot Password | Emailed-code recovery. |
| Waiting for Approval | Holds you until your organization is approved. |
| Scan | The core capture screen (upload / camera / video; optional incident link). |
| Scan Results (Overview) | The annotated rack; device picker, port finder, feedback, and the tab hub. |
| Available Ports | Live free-vs-used port inventory for a switch. |
| Switch Information | Per-switch identity, specs, firmware, and the SFP advisor. |
| Specifications | Scan-free datasheet lookup by make/model. |
| Firmware Check | Version currency and release notes. |
| Rack Topology | 2D elevation and 3D scene of one rack. |
| Network View | Live discovery — port state, VLANs, neighbors, learned MACs. |
| Port History & Drift | Per-port telemetry, timeline and change log. |
| Combined Topology | Every rack in a multi-rack group in one 3D scene. |
| Profile | Account identity and recent scans; admin shortcuts. |
| Data Sources (Connections) | Manage your CMDB/ITSM connections; one active at a time. |
| Organizations Console | Admin for organizations, sites, members and invites. |
| Marketplace | Buy, sell and swap surplus gear. |
| Ask DOT | Answers from RackTrack's verified documentation. |
| Contact | Email the RackTrack support team directly. |

## 7. The logic behind it

- **One calm surface.** A single light theme, flat white, hairlines over shadows — the interface should recede so the rack data stands out.
- **One layout that flexes.** Rather than separate apps, one interface reshapes itself to phone, tablet or desktop, so the words and features are identical everywhere.
- **One list of destinations.** The bottom bar and the sidebar are drawn from the same list, so a destination shows up in both places or neither — no screen ends up unreachable on one device.
- **Motion with a job.** The scan-line sweep, the analyzing overlay and subtle hovers exist to communicate progress, not to decorate.
- **Monospace for identities.** Rack IDs and interface names are shown in a monospace face so they're easy to read and copy.

## 8. Detailed technical explanation

**The single theme.** Every colour, font and measurement comes from one shared set of design tokens. The primary colour is a near-black, the accent surfaces are white, and separators are a light grey hairline. Even the "dark theme" settings resolve to the same white values, which is why the toggle has no visible effect — there is deliberately no working dark mode yet. Text uses the Geist typeface, with a monospace companion for identifiers.

**The three layouts.** The interface has two size thresholds. Below the first, you get the phone layout: a single column and the bottom tab bar. Past the first threshold (roughly a tablet in portrait), a permanent sidebar appears and the content fills the screen in one wide column. Past the second threshold (a laptop or larger), content that benefits from width — like two racks side by side — spreads out fully. The switch is live: rotating a tablet or dragging a browser window across a threshold reflows the page immediately. The home welcome is an exception — it's one full-screen immersive hero at every size.

**One navigation source.** The phone's bottom bar and the desktop sidebar both read the same list of destinations, with the same order and the same role rules. Three destinations get a permanent slot on the phone bar; the rest live behind the Menu button on a phone and in the sidebar on larger screens. A few — Marketplace, Data Sources, the Organizations console — appear only for admins and owners, and a couple more only for the platform owner.

**Access and routing.** Screens that need you to be signed in are protected; if you're not, you're sent to sign in and returned to where you were headed afterwards. Admin-only and owner-only screens have their own gates, and a user whose organization isn't active yet is held on the waiting screen. These gates are enforced both in the interface and, for anything sensitive, again on the server.

## 9. Real data vs. synthetic

| Thing on screen | Live or not |
|---|---|
| The layout, navigation and screens | **LIVE** — the real interface, chosen by your screen and role. |
| Design tokens (colours, fonts, spacing) | **LIVE** — one shared set drives every screen. |
| The theme toggle | INERT — it renders nothing and can't change the (single) theme. |
| Internal / orphaned screens | NOT USER-FACING — a few developer-only or superseded surfaces exist (see below) and are excluded from this guide. |

**Not part of the live experience.** A handful of surfaces live in the codebase but aren't real features: earlier alternate home layouts that the current single immersive home replaced; a standalone scan-history page whose link now redirects to Profile's Recent Scans; a developer logo-comparison utility; and an isolated demo topology page backed by sample data. They're documented here only so they aren't mistaken for features.

## 10. Use cases

- **Hand it to someone new.** This page explains the look and the map of screens without any product knowledge assumed.
- **Know where you are.** The single shared top bar and the sidebar's rack section always tell you which rack and which screen you're on.
- **Work on any device.** The same features are one tap away whether you're on a phone in the aisle or a laptop at a desk.
- **Understand the theme.** If a dark-mode toggle looks like it's doing nothing — it is; the app is light-only by design.

---

— UI Reference —
