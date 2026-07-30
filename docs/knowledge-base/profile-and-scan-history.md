# Profile & Scan History

*Your account home inside RackTrack — who you are signed in as, and a tap-away list of the racks you have recently scanned, each one ready to reopen exactly as you left it.*

Feature · All users · Last verified: 26 July 2026 against the live code.

---

## 1. In simple terms (your account + your past scans)

Profile is your home base in RackTrack. It quietly answers two everyday questions: *who am I signed in as?* and *what have I scanned lately?*

At the top of the screen sits your identity. You see your avatar (a coloured circle with your initial on it), your username, the email on your account, the organization you belong to, and the month you joined. It is a quick, friendly reassurance that you are in the right account before you start work.

Just below that is your **Recent Scans** list. These are the racks you have photographed, newest first. Each one shows a small picture of the rack, its rack ID, a few quick numbers about what was found inside it, and a plain-English "how long ago" label such as "2h ago". Tap any row and RackTrack reopens that scan's full report — the same devices, the same details — without you having to search for it or photograph the rack again. The list keeps things tidy by showing only your five most recent scans to begin with, and it expands to your full history the moment you ask it to.

This history is tied to your account, not to one particular phone or tablet. That is the important part: because it lives on the server against your login, you can scan on one device and pick the report back up on another. Nothing is lost when you switch phones or hand a tablet to a colleague who signs in as themselves.

There is one thing Profile deliberately does **not** have: a theme or "dark mode" switch. RackTrack is a single, clean, light theme throughout, so there is no appearance setting to hunt for here.

If you happen to be an owner or an organization admin, Profile also gives you a couple of shortcut rows into your management tools, so your day-to-day home and your control panel are never more than a tap apart. Everyone else sees a simpler screen with just their identity and their scans.

## 2. At a glance

| | |
|---|---|
| **What it is** | Your account identity plus your recent scan history, together on one screen. |
| **Who uses it** | Everyone. Owners and organization admins also see extra management shortcuts. |
| **How you reach it** | The **Profile** tab in the bottom navigation. |
| **What you can do** | See your account details, change your avatar, reopen any past scan, and sign out. |
| **Where the data comes from** | Your signed-in account and the scans stored against it on the server. |
| **Stored where** | On the server, tied to your account — not saved on any one device. |
| **Follows you across devices** | Yes. The same list appears wherever you sign in. |
| **Theme / dark mode** | None. RackTrack is a single light theme. |

## 3. What you see on screen

**The identity area (top of the screen).** A large circular avatar sits front and centre, showing your initial on a coloured gradient. Under it is your username (or the word "Guest" if no username is set), then your email if your account has one, and finally a line showing your organization's name followed by "Since" and the month and year you joined — for example, "Sprintpark · Since Mar 2026". If a piece of information is missing, that piece simply does not appear; the rest still shows.

**Changing your picture.** Tapping the avatar opens a small panel that slides up from the bottom, titled "Choose your picture". It offers a grid of eight preset gradient avatars, with your current one gently ringed. Tap any one and it saves straight away; the panel closes on its own. There is nothing to upload — the avatars are built in, so they work offline.

**The Recent Scans list.** Below your identity is the heart of the screen. Each scan appears as a row with:

- a small **thumbnail** — the photo of the rack you scanned (or a terminal icon if no picture is stored),
- the **rack ID** shown in a monospaced style (for example `RK-2026-0412`),
- a **quick summary** line reading something like "8 dev · 42 units · 3 ports" — the number of devices found, the number of rack units detected, and the number of ports that have been identified,
- a **relative time** on the right such as "just now", "15m ago", "3d ago", or "2mo ago",
- and a small **chevron** hinting that the row opens something.

By default you see your five most recent scans. If you have more, a button appears reading "Show all N scans"; tapping it reveals your entire history, and it then reads "Show less" so you can collapse the list again.

**When you have no scans yet.** Instead of an empty list you see a short message, "No scans yet.", and a "Start your first scan" button that takes you straight to the scanning screen.

**If the list cannot load.** A small red banner appears with the reason, but the rest of your Profile (your identity, your shortcuts) still shows normally.

**Owner / admin shortcuts.** If your role is owner or organization admin, two extra sections appear above your scans:

- **Administration** — a single row that opens your management console. For an owner it reads "Owner Dashboard" with the note "All organizations, sites & scans"; for an organization admin it reads "Organization Dashboard" with "Sites, members & scan activity".
- **Data Sources** — a row that opens your database connections. It shows the name of your active connection (with its type and "Active"), or, if none is set up, invites you to "Connect a database" and to "Tap to set up ServiceNow, NetBox, Orion…".

Members and site managers do not see either of these sections at all — their Profile stays focused on identity and scans.

**Signing out.** In the top-right corner of the header is a sign-out icon. Tapping it does not sign you out immediately; instead it shows a gentle confirmation card that asks "Sign out?" and warns "You'll need to sign in again to scan racks." You then choose "Cancel" or "Sign out". Only if you confirm are you signed out and returned to the start screen.

## 4. How it works — step by step (opening a past scan again)

1. Open **Profile** from the bottom navigation.
2. Look down the **Recent Scans** list. If the rack you want is not among the first five, tap **"Show all …"** to reveal the rest.
3. **Tap the row** for the scan you want to reopen.
4. RackTrack fetches that rack's saved report from the server and hands it to the results screen, which opens at a proper web address for that rack (so it also works as a deep link and highlights the right tab).
5. The full report opens — the devices, units, and details exactly as they were saved. You did not have to re-scan anything.
6. If the scan can no longer be loaded (for example the rack was removed), RackTrack shows a short error rather than opening a broken page.

## 5. The logic behind it (what is stored, how a past scan reopens)

**Your history is account-backed, not device-backed.** The list of scans you see is fetched fresh from the server for whoever is signed in. It is not read from the phone or tablet in your hand. This is the deliberate reason the same history shows up everywhere you sign in — scan on the phone, review on the tablet, and it all stays in step. (An older version of RackTrack kept this history on the device itself; that approach has been replaced by the server-backed list.)

**What each row actually stores.** The list you see is a lightweight summary — for each rack, its ID, the time it was scanned, the counts of devices, units and ports, and a link to its thumbnail image. It is not the full scan payload. That keeps the list quick to load. The heavy detail (every device, every port) stays in the rack's own saved record on the server and is only pulled in when you open the scan.

**What "newest first" means.** The server sorts your scans by their timestamp, most recent at the top, so your latest work is always the first thing you see.

**How a tap reopens a scan.** When you tap a row, RackTrack asks the server for that rack's report and uses it to rebuild the results view, then navigates to the rack's own address with the report already loaded (so the page does not have to fetch it a second time). If you instead arrive at a rack's results by a direct link — with no report pre-loaded — the results screen quietly fetches the rack's saved data on its own before showing it. Either way, what you get back is the saved record, so it comes back precisely as it was left.

**Who can see which scans.** The list is scoped by your role. An **owner** sees every rack across the whole platform. An **organization admin** sees every rack belonging to their organization's sites. A **member** (or site manager) sees only the racks they themselves scanned or claimed. This is why two people looking at their own Profile can see different-sized lists — each person sees exactly what is theirs to see.

**Shortcuts are role-gated too.** The Administration and Data Sources sections are shown only to owners and organization admins. This keeps the screen honest: it never offers a shortcut to a place your role is not allowed to open.

## 6. Under the hood (endpoints)

A short technical note for support and engineering.

- **`GET /api/scans`** (authenticated) — returns the Recent Scans list for the signed-in user. Each entry carries `rackId`, `timestamp`, `deviceCount`, `unitCount`, `portCount`, `lastPortAt`, an `image` path for the thumbnail, and any `qualityWarning`. Results are filtered by role (owner → all racks; org admin → their organization's sites; member → only racks they claimed) and sorted by `timestamp`, newest first.
- **`GET /api/scan/:rackId/report?format=json`** — the endpoint the Profile row tap calls. It returns the rack's report data (its `devices` and `units_detected`), which the app wraps into a result object and passes to the results screen. The same endpoint also serves `format=html`, `format=csv`, and `format=pdf` for the report's other views.
- **`GET /api/scan/:rackId`** (authenticated) — returns the full cached scan payload (devices with per-port arrays, `units_detected`, `originalExt`, etc.). This is the path the results screen uses to rehydrate itself on a cold deep link when no report data was pre-loaded. A missing rack returns `404`.
- **`POST /api/auth/avatar`** (authenticated) — saves the chosen avatar preset index and returns the refreshed user. After saving, the app refreshes the current user via **`GET /api/auth/me`**.
- **Route `/history`** — kept only as a redirect. It now sends the browser to `/profile`; the old standalone history screen is no longer a destination.

The per-rack detail lives on the server under each rack's own folder (its `device_unit_map.json`, port identifications, and original image), which is why the list can stay small while the full report is only assembled when a scan is opened.

## 7. Edge cases

- **No scans yet.** You see "No scans yet." and a "Start your first scan" button instead of an empty list.
- **The list fails to load.** A red banner shows the error; the rest of Profile (identity, shortcuts) still works.
- **A scan will not open.** If the rack was removed on the server, tapping it shows a short error instead of a broken report. On a direct link to a missing rack, RackTrack routes you back to the scan screen.
- **No username.** The name area shows "Guest".
- **No email or no join date.** Those lines simply do not appear; nothing looks broken.
- **Avatar save fails.** The picker stays open so you can try again, rather than closing on an error.
- **You see fewer scans than a colleague.** That is role visibility working as intended — members see only their own scans, admins and owners see more.
- **Only five scans showing.** That is the default. Tap "Show all …" to reveal the rest, "Show less" to collapse.
- **Looking for dark mode.** There is no theme setting — RackTrack is a single light theme everywhere.
- **The old `/history` link.** Any old bookmark to `/history` now lands on Profile automatically.

## 8. Common questions

**Q: Where do I find my past scans?**
Open the **Profile** tab and look at the **Recent Scans** list. Everything you have scanned is there, newest first.

**Q: There used to be a separate "Scan history" page — where did it go?**
It has been folded into Profile. The old `/history` address now opens Profile automatically, and your history shows as the Recent Scans list.

**Q: If I scan on my phone, will the scan show up on my tablet?**
Yes. Your scan history is stored on the server against your account, so it appears wherever you sign in.

**Q: How do I reopen an old scan?**
Tap its row in Recent Scans. RackTrack loads that rack's saved report and opens it in full — no re-scanning needed.

**Q: Why do I only see five scans?**
Five is just the default view to keep things tidy. If you have more, tap **"Show all …"** to see them all, and **"Show less"** to collapse the list again.

**Q: What do the numbers like "8 dev · 42 units · 3 ports" mean?**
They are quick counts from that scan: how many devices were found, how many rack units were detected, and how many ports have been identified so far.

**Q: Can I change my profile picture?**
Yes. Tap your avatar and pick one of the preset gradient avatars — it saves immediately. There is nothing to upload, and they work offline.

**Q: Can I switch to dark mode?**
No. RackTrack uses a single light theme, so there is no theme or dark-mode setting.

**Q: Why don't I see the Administration or Data Sources shortcuts?**
Those appear only for owners and organization admins. If your role is member or site manager, your Profile shows just your identity and your scans.

**Q: Why does a colleague see more scans than I do?**
Visibility depends on your role. Owners see every rack, organization admins see their organization's racks, and members see only the racks they scanned themselves.

**Q: How do I sign out?**
Tap the sign-out icon at the top right of Profile, then confirm on the "Sign out?" card. You will be returned to the start screen and will need to sign in again to scan.

**Q: I tapped a scan and it wouldn't open — what happened?**
Most often the rack was removed on the server. RackTrack shows a short error instead of a broken report, and on a direct link to a missing rack it sends you back to the scan screen.
