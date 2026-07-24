# UI Reference

**Feature Reference** · *The design system, responsive model, navigation source and routing — with the files that define each.*

**Category:** Reference — interface & design system · **Audience:** The team (assumes you know the product) · **Document date:** 24 July 2026 · Part of the RackTrack documentation set.

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

RackTrack's UI is a single **light** Material-3-flavoured theme defined in `client/src/index.css`, a **three-band responsive model** driven by two width hooks in `client/src/hooks/useIsDesktop.js`, and a **single navigation source** (`client/src/nav/navLinks.jsx`) that both the phone bottom bar and the desktop sidebar read. Routing and guards live in `client/src/App.jsx`. Per-component styling uses CSS Modules (`*.module.css`, ~48 files).

There is no working dark mode: `client/src/ThemeContext.jsx` hardcodes `'light'` and `toggleTheme` is a no-op; the dark selectors in `index.css` resolve to the same white tokens.

## 2. At a glance

| | |
|---|---|
| **Category** | Reference — design tokens, breakpoints, nav, routing/guards, screen index. |
| **Who uses it** | Engineers extending or restyling the app. |
| **Where input comes from** | Viewport width (matchMedia), `user.role`, and the token set in `index.css`. |
| **What it outputs** | The rendered shell (bottom nav / sidebar), the per-rack tab bar, and all routed screens. |
| **Data source** | REAL — the live component tree. Theme toggle inert; a few routes are orphaned. |

## 3. How it works — step by step

```
useHasSidebar() (≥768) / useIsDesktop() (≥1024)  — matchMedia, re-evaluated on resize
        ↓
ResponsiveLayout (App.jsx): showSidebar ? <DesktopShell> : bare + <BottomNav>
        ↓
usePrimaryNav() → one destination list → DesktopShell sidebar AND BottomNav
        ↓
open a rack → DesktopShell "Rack · <id>" section  /  ScanTabBar (phone)
        ↓
route guards (ProtectedRoute / AdminRoute / OwnerRoute / PendingRoute)
```

**Walkthrough**

1. `ResponsiveLayout` calls `useHasSidebar()` (≥768px). If true it wraps the page in `DesktopShell`; otherwise it renders the page bare, optionally with `<BottomNav>`.
2. Both `DesktopShell` and `BottomNav` call `usePrimaryNav()` for the destination list — one source, so a destination added there appears in both.
3. `DesktopShell` portals to `<body>` (escaping `#root`'s 540px cap), draws the sidebar + one top bar, and — once a `/results/:rackId` (or `/switch-info/:rackId`) URL is active or an `rt:rack-id-changed` event fires — adds a contextual "Rack · *[id]*" section.
4. On phone, the in-rack tab bar is `ScanTabBar`; on desktop it's suppressed (`!isDesktop`) in favour of the sidebar rack section.
5. Route access is enforced by the guards in `App.jsx`.

## 4. Where the input comes from

- **Viewport width** — `useMinWidth(px)` (matchMedia) in `client/src/hooks/useIsDesktop.js`. `DESKTOP_BREAKPOINT = 1024` (`useIsDesktop`), `SIDEBAR_BREAKPOINT = 768` (`useHasSidebar`). Both re-evaluate on `change`.
- **Role** — `useAuth().user.role` (`member` / `site_manager` / `org_admin` / `owner`), read in `usePrimaryNav` and the route guards.
- **Design tokens** — the `:root` custom properties in `client/src/index.css`.
- **Rack context** — `extractRackId(pathname)` in `DesktopShell.jsx` plus the module-level `_liveRackId` set on the `rt:rack-id-changed` window event.

## 5. What it produces (output)

- **The shell** — `DesktopShell` (sidebar + top bar + `styles.fluid` content) at ≥768px, or bare page + `BottomNav` below.
- **The per-rack nav** — the sidebar "Rack · *[id]*" links (Overview / Ports / Topology / Network / Switches / Drift, + Ground Truth for `owner`) and, on phone, `ScanTabBar`.
- **Routed screens** — every `<Route>` in `App.jsx`, each wrapped in a guard + `ResponsiveLayout`.

## 6. What you see on screen

Shared components:

- **`client/src/components/BottomNav.jsx`** — phone bar; renders `usePrimaryNav().filter(l => l.inBar)` (Home, Scan, Profile) plus a **MENU** button opening `MoreSheet.jsx` with the overflow. The Scan tab fires the shutter (`useShutter`) instead of navigating while the viewfinder is live.
- **`client/src/components/DesktopShell.jsx`** — 240px sidebar (brand, "Workflow" section, contextual "Rack · *[id]*" section, bottom `ThemeToggle` + Sign out) and one top bar `[back] [crumb.title] [actions portal]`. Header right-side controls are portalled in via `ShellHeader.jsx` (`HeaderActions`); Contact and Organizations draw their own hero and suppress the crumb.
- **`client/src/components/ScanTabBar.jsx`** — in-rack tabs: primary `overview / switches / ports / topology`; behind **More**: `network / drift`. Supports numeric badges.
- **`client/src/components/RackTabs.jsx`** — multi-rack strip (member racks + Combined 3D), preserving the current sub-page.
- **`CmdbApprovalModal.jsx`** (register-into-CMDB), **`SfpAdvisor.jsx`** (transceiver recommendations in Switch Info), **`MiniRack3D.jsx`** (analyzing/loading rack), **`ThemeToggle.jsx`** (inert).

Screen index (routes in `App.jsx`):

| Route | Component | Guard |
|---|---|---|
| `/` | `HomePage` → `HomeImmersive` | public; bypasses `DesktopShell` |
| `/login`, `/signup`, `/invite/:code`, `/forgot-password` | auth pages | public |
| `/pending` | `PendingApprovalPage` | `PendingRoute` |
| `/scan` | `ScanPage` | `ProtectedRoute` |
| `/results/:rackId` (+ `/ports`, `/topology`, `/netdisco`) | `RackResultsRoute` / rack routes | `ProtectedRoute` |
| `/switch-info[/:rackId]` | `SwitchInformationPage` / `RackSwitchesRoute` | `ProtectedRoute` |
| `/specifications`, `/firmware` | spec/firmware pages | `ProtectedRoute` |
| `/multi-rack/new`, `/multi-rack/:groupId[/topology]` | multi-rack pages | `ProtectedRoute` |
| `/port-history` | `PortHistoryPage` | `ProtectedRoute` |
| `/profile`, `/help`, `/contact` | Profile / DOT / Contact | `ProtectedRoute` |
| `/organizations` | `OrgConsolePage` | `ProtectedRoute` (role-aware inside) |
| `/connections` | `ConnectionsPage` ("Data Sources") | `AdminRoute` |
| `/marketplace[...]` | Marketplace cluster (lazy) | `AdminRoute` |
| `/dashboard` | `DashboardPage` (Operations Console) | `AdminRoute` |
| `/lab` | `LabPage` | `ProtectedRoute` (server `owner`-gated) |
| `/ground-truth/:rackId` | `GroundTruthPage` | `OwnerRoute` |

## 7. The logic behind it

- **Single theme, enforced.** Beyond the token set, `index.css` has a "white-surface enforcement" block that strips `background-image`, `box-shadow`, gradient text-clip and filters from broad `[class*=...]` selectors, so module CSS can't reintroduce gradients or elevation.
- **One nav source of truth.** `usePrimaryNav` exists because the sidebar and bottom bar previously kept separate hardcoded lists and drifted (Lab and Marketplace became untappable on phone). Add destinations there, not in a component.
- **Guard on the parent *and* mounted routers.** UI guards (`AdminRoute`/`OwnerRoute`) are convenience; the real gate is server-side (e.g. `/api/lab/*`, ground-truth endpoints are `owner`-only). `LabPage` renders a refusal for non-owners rather than a blank.
- **Rack context is memory-only.** `_liveRackId` is module-level (not `sessionStorage`), so a full refresh drops the rack section until the user re-enters a rack — stale racks don't leak into the sidebar.

## 8. Detailed technical explanation

**Tokens** (`client/src/index.css`). The palette is defined once under `:root, [data-theme='light'], [data-theme='dark']` (all three share the block). Key values: `--md-primary: #121417`, `--md-secondary: #717171`, `--md-outline / --md-outline-variant: #E0E0E0`, and every surface token (`--md-background`, `--md-surface`, `--md-surface-container*`) forced to `#FFFFFF`. `html { color-scheme: light }`. Fonts: `--font` = Geist stack, `--mono` = Geist Mono. `#root` is `max-width: 540px` (the phone frame), lifted to `max-width: none` at `768–1023px`; body scrolling is locked and `#root` is the scroller (Android WebView reliability). Responsive `html` font-size steps: 14px `≤360px`, 15.5px `410–480px`, 16px `≥480px`; bare form controls are pinned to `font-size: 16px` to defeat iOS focus auto-zoom.

**Theme** (`client/src/ThemeContext.jsx`, `ThemeToggle.jsx`). `ThemeProvider` sets `data-theme="light"` on `<html>` once and exposes a no-op `toggleTheme`; `useTheme().theme` is always `'light'`.

**Responsive** (`client/src/hooks/useIsDesktop.js`, `App.jsx`). `ResponsiveLayout({ withBottomNav })` picks `DesktopShell` when `useHasSidebar()` (≥768) else bare + `BottomNav`. Content that needs real two-column width (side-by-side racks) additionally checks `useIsDesktop()` (≥1024). `HomePage` returns `<HomeImmersive/>` for all sizes and is routed outside `ResponsiveLayout`, so `/` bypasses the shell (avoids double chrome).

**Navigation** (`client/src/nav/navLinks.jsx`). `usePrimaryNav()` returns the ordered destination list with `{ to, label, icon, end, inBar?, hint? }`. `inBar: true` marks the three phone-bar slots (Home, Scan, Profile). Role gating inline: Organizations + Data Sources + Marketplace require `isAdmin` (`org_admin`/`owner`); Console (`/dashboard`) and Lab require `isOwner`. `BottomNav` splits the list into `inBar` vs overflow (→ `MoreSheet`); `DesktopShell` renders the whole list under "Workflow".

**Rack-context sidebar** (`DesktopShell.jsx`). `rackLinks` are built from `rackId` (URL param or `_liveRackId`), preserving a `?group` query across sub-pages. Overview vs Drift share `/results/:rackId` and are disambiguated by the `#drift` hash (NavLink ignores the hash, so their active state is resolved manually). Ground Truth (`/ground-truth/:rackId`) is appended only for `owner`.

**Routing & guards** (`App.jsx`). `ProtectedRoute` (authed + org active, else `/login` or `/pending`), `AdminRoute` (`org_admin`/`owner`), `OwnerRoute` (`owner`), `PendingRoute` (only a signed-in, non-active-org user). `orgNotActive(user)` gates non-owner users whose `organization.status !== 'active'`. Marketplace + `MultiRackTopologyPage` are `React.lazy` (keep three.js and the admin-only cluster off the login critical path). `OverflowGuard` (DEV-only) warns on horizontal overflow. `AndroidBackHandler` + `PendingScanResumer` bridge Capacitor back/resume.

**Styling convention.** CSS Modules (`*.module.css`) per component/page (~48 files), imported as `styles` and referenced as `styles.foo`; the global reset, tokens and enforcement live in `index.css`.

## 9. Real data vs. synthetic

| Thing on screen | Live or not |
|---|---|
| Shell / nav / routed screens | **LIVE** — the real component tree, chosen by breakpoint + role. |
| Design tokens | **LIVE** — `index.css` `:root` custom properties. |
| `ThemeToggle` | INERT — `toggleTheme` is a no-op; dark tokens equal light tokens. |
| `/compare` (`LogoCompare`), `/demo/topology` (`TenantMatPage`) | NOT USER-FACING — a dev logo utility and an unauthenticated demo backed by `server/data/demo_tenant.json`. |
| `/history` | REDIRECT — `Navigate to /profile`; the standalone `HistoryPage` is superseded by Profile's Recent Scans. |

## 10. Use cases

- **Add a destination.** Add it to `usePrimaryNav` (with `inBar`/role gating) and it appears in both the sidebar and the phone Menu from one definition.
- **Restyle safely.** Change tokens in `index.css`; the enforcement block keeps surfaces flat/white regardless of module CSS.
- **Add a rack sub-page.** Extend `rackLinks` in `DesktopShell` and the `ScanTabBar` tab list, and add the `/results/:rackId/...` route in `App.jsx`.
- **Gate a screen.** Wrap its route in `AdminRoute`/`OwnerRoute` and enforce the same role server-side — the UI guard is not the security boundary.

---

— UI Reference —
