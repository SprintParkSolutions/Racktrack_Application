# Operations Console & Logs

*The admin's live window into everything happening across RackTrack — who is scanning, what is working, what is failing, and what the server itself is quietly writing down as it runs.*

Admin feature · Owners/admins · Last verified: 26 July 2026 against the live code.

---

## 1. In simple terms

Most of RackTrack is built for the person doing the work: scanning a rack, locating a port, checking a switch. The **Operations Console** is different. It is built for the person running the show. It answers one question, continuously and in plain sight: *what is happening across the whole platform right now?*

Open it and you get a single live screen. Across the top sit a row of headline numbers — how many scans happened today, how many people are active, how accurate the model is, how many things have failed. Below that, a feed scrolls the most recent actions as they happen, like a news ticker for the product: "Priya scanned a rack," "someone signed in," "a scan failed." Down one side you see who is scanning the most, which organizations are busiest, and what people are actually doing with the app. Further down there is a table of every user and every organization on the platform, with their activity totals. The whole page refreshes itself every few seconds, so it is always current without you touching anything.

There is a second half to the console, on its own tab: **Logs**. If the Operations tab is "what the *people* did," the Logs tab is "what the *server* did." Every time RackTrack sends an email, handles a web request, or hits an error, it writes a line to its own diary. The Logs tab is a searchable, filterable view of that diary — the place you go when you need to know *why* something happened, not just *that* it happened. You can filter to just the warnings and errors, search for a word, click any line to expand its full technical detail, and — if you want a clean slate — wipe the stored log entirely.

The two tabs draw on two different records. The Operations tab reads the **audit log** — a permanent trail of every meaningful thing a signed-in person did. The Logs tab reads the **application log** — the server's own running commentary. They are kept in separate places and serve different purposes, and it is worth keeping the distinction in mind: one is about people and actions, the other is about the machine and its plumbing.

Because signing in is now required to use RackTrack, almost everything you see is tied to a real, named person. That is a recent and deliberate change. You may still spot a few rows attributed to "anonymous" or "no org" — those are leftovers from before login was mandatory, and section 8 explains exactly what they are.

## 2. At a glance

| | |
|---|---|
| **What it is** | A live, self-refreshing operations screen (the "Operations Console") with two tabs: **Operations** (activity, health, people) and **Logs** (the server's own log). |
| **Who can open the page** | Signed-in **org admins and owners** can reach the page. |
| **Who actually sees data** | **Owners**, plus any username on the server's admin allow-list (`AUDIT_ADMINS`). An org admin who is not on that list reaches the page but sees an "Owner access required" message instead of data. |
| **How you reach it** | The web address is `/dashboard`. On desktop it appears as **"Operations Console — Live activity, health & server logs."** The old `/logs` address still works but now redirects to `/dashboard`, because logs became a tab here. |
| **Operations tab shows** | Headline stats, a live activity feed, recent errors, top scanners, scans by organization, an action breakdown, sign-in activity, and full tables of every user and every organization. |
| **Logs tab shows** | Level tiles (total / info / warn / error), a level filter, a search box, a scrollable table of log lines, per-line expandable detail, and a "Clear log" button. |
| **How fresh it is** | It polls itself automatically: the Operations tab every **5 seconds**, the Logs tab every **4 seconds**, while "Live" is on. Only the tab you are looking at polls. |
| **Data sources** | REAL. Operations reads the **audit log** (`audit_log`, in `auth.db`) and feedback tallies; Logs reads the **application log** (`app_logs`, in `logs.db`). |
| **Controls** | A **Live / Paused** toggle (auto-refresh on/off) and a **Refresh** button, shared across both tabs. |

## 3. What you see on screen

The page has a shared frame around two tabs. The frame owns the title **"Operations Console,"** a one-line subtitle that changes with the tab, a **Live / Paused** button (a green dot pulses while auto-refresh is on), and a **Refresh** button for an instant reload. Below the frame is a tab switcher: **Operations** and **Logs**. Only the visible tab does any work, so switching tabs also switches which data is being polled.

### The Operations tab

**Headline stats (the top row of cards).** Eight numbers summarise the health of the platform at a glance:

- **Scans today** — successful rack scans since the start of the day.
- **Active users today** — how many distinct people have done *anything* today.
- **Total scans** — all successful scans ever. If any scans have failed, a small "N failed" note appears underneath.
- **Success rate** — the share of *all* recorded actions that succeeded, as a percentage. It turns amber if it drops below 90%.
- **Accuracy (feedback)** — how often the model was judged right by a human, from Ground Truth feedback, shown as "N right · M wrong." It turns amber below 80%, and reads "no feedback yet" until someone has given some.
- **Users** — total number of user accounts.
- **Organizations** — total number of organizations.
- **Failures (all)** — every recorded action that failed. It is highlighted whenever it is above zero.

**Live activity (the feed).** The heart of the page: the 80 most recent actions, newest first, updating live. Each row shows a small green **ok** or red **fail** pill, the person's name (or "guest" if the action happened before they were signed in), the person's short public ID when known, a plain-English label for what they did (for example "Scanned a rack," "Located a port," "Signed in"), and the organization when it can be worked out. Failed rows show the error text; successful rows that acted on something show what they acted on. Each row is timestamped in relative terms ("just now," "3m ago"), and those ages tick upward on their own. The card header shows how long ago the whole snapshot was refreshed.

**Recent errors.** A focused list of the last 30 failures, each with its plain-English action, when it happened, the error message, and who hit it (name and organization, or "anonymous" if there is no name on the row). When there are none, it cheerfully says "No errors."

**Top scanners.** A ranked bar chart of the ten people who have run the most successful scans, each with their scan count.

**Scans by organization.** The same idea for organizations: the ten busiest, ranked by successful scans.

**What users are doing (the action mix).** A breakdown of *every* kind of action people have taken, ordered by how common it is. Each row has a little meter split into a "worked" portion and a "failed" portion, plus the total count and, if any failed, how many.

**Authentication.** A compact row of sign-in numbers: successful logins, failed logins, sign-ups, invites accepted, and password resets.

**All users.** A full table of every account: short ID, name (flagged "inactive" if the account is disabled), role, organization, successful scans, total events, failures, and when they were last active ("never" if they have done nothing yet).

**All organizations.** A full table of every organization: name, status, member count, and total successful scans.

### The Logs tab

**Level tiles.** Four counts across the top: **Total kept** (how many log lines are currently stored), **Info**, **Warn**, and **Error** (the error tile also folds in the rarer "fatal" lines).

**Level filter.** Four buttons — **All**, **Info**, **Warnings**, **Errors**. Picking a level shows that level *and everything more serious*. So "Warnings" shows warnings, errors, and fatals; "Errors" shows errors and fatals. This mirrors how you triage: dial up the severity to cut out the noise.

**Search.** A box that searches across each line's message, its web address, its event name, its error text, and its full raw detail. Type a term and press Enter to apply it; an ✕ clears it. It matches any part of the text, so searching "smtp" finds every line that mentions SMTP anywhere.

**The count line.** A short summary reading, for example, "Showing 300 of 4,120 entries matching 'smtp' · kept 7 days." The "kept N days" part tells you the current retention window. Next to it sits the **Clear log** button.

**The log table.** One row per stored line, newest first. Each row shows the local clock time and a relative age, a coloured severity **badge**, and the message. For lines that came from a web request, a second grey line shows the HTTP method, a shortened address, the response status, and how long it took in milliseconds. If the line carried an error, its text is shown in red. Rows are tinted by severity so errors stand out. **Click any row to expand it** — RackTrack then fetches that one line's complete detail and shows its request ID (so you can trace every line belonging to the same web request) and the full, pretty-printed technical record.

**Clear log.** Wipes every stored log line and starts fresh. Because it cannot be undone, it asks you to confirm first ("Delete all N stored log entries and start fresh? This cannot be undone."). It clears only the server's application log — it does **not** touch the audit trail or any business data, and the act of clearing is itself recorded in the audit trail.

## 4. How it works — step by step

```
You open /dashboard              →   the page checks you are an admin/owner and loads
        ↓
Operations tab loads             →   one snapshot from /api/admin/dashboard
        ↓
Numbers, feed, tables render      →   headline stats, live feed, rankings, user & org tables
        ↓
"Live" keeps it fresh            →   re-fetches every 5s (Operations) or 4s (Logs)
        ↓
Switch to the Logs tab           →   fetches log lines + level counts from /api/logs
        ↓
Filter / search / expand         →   narrow by level, search text, click a row for full detail
        ↓
Clear log (optional)             →   confirm → wipes the application log → recorded in the audit trail
```

1. **You open the console at `/dashboard`.** The page first checks, in the browser, that you are signed in, your organization is active, and your role is org admin or owner. If not, it sends you to the login page, the "pending" page, or the home page as appropriate.
2. **The Operations tab loads a snapshot.** It calls the server once for a single bundle of everything — totals, the feed, errors, rankings, the action mix, sign-in numbers, and the full user and organization tables. If the server replies that you lack access, the tab shows "Owner access required to view this dashboard" instead.
3. **Everything renders from that one snapshot.** No part of the page fetches separately; it is one call, drawn into many cards.
4. **"Live" keeps it current.** While the Live toggle is on, the Operations tab quietly re-fetches every 5 seconds. A second, once-a-second timer re-renders the relative timestamps so "3m ago" keeps counting even between fetches. Press **Paused** to stop the auto-refresh, or **Refresh** to force one immediately.
5. **The Logs tab works the same way, on its own rhythm.** When you switch to it, it fetches the most recent log lines together with the level counts, and re-fetches every 4 seconds while Live. Changing the level filter or committing a search re-fetches straight away.
6. **Expanding a log line fetches its full detail on demand.** The table itself carries only the summary columns; the complete record for a line is only pulled from the server when you actually click to expand it.
7. **Clearing the log is deliberate and one-way.** It prompts for confirmation, wipes the stored application log, reclaims the space, and writes one fresh line recording who cleared it — and it records the clear in the audit trail too.

## 5. The logic behind it (where the numbers come from)

Almost everything on the Operations tab is counted from a single record called the **audit log** — a running, append-only list of every meaningful action a signed-in person took, each stamped with who did it, what it was, whether it worked, and when. The console just asks that record different questions:

- **Scans today** counts audit entries where the action is a successful scan and the timestamp is on or after the start of the day. (The "start of day" is measured in UTC, so "today" is a UTC day rather than your local one.)
- **Active users today** counts the distinct people who have any audit entry since the start of the (UTC) day.
- **Total scans** counts all successful scan entries ever; the failed-scans note counts any scan-family action that failed.
- **Success rate** is one minus (all failed entries ÷ all entries), as a rounded percentage. It is measured across *every* kind of action, not scans alone — so a spate of failed logins pulls it down just as a failed scan would.
- **Failures (all)** is simply every entry marked failed.
- **Accuracy (feedback)** does not come from the audit log at all. It comes from the model-feedback record (the `right` vs `wrong` answers people give in Ground Truth) — right ÷ (right + wrong). To keep the fast-polling dashboard cheap, this tally is only re-computed when the feedback file actually changes; otherwise a cached figure is reused.
- **The live feed** is the 80 newest entries. Where an entry has no signed-in name — which happens for sign-in, sign-up and password-reset actions, because there is no session yet — the feed falls back to the identifier the person *typed* and flags the row as a guest.
- **Top scanners** and **Scans by organization** group successful scans by person and by organization. Crucially, the person's real name and the organization are resolved by looking up the account the entry belongs to, not just the name stored on the entry itself — which is why owner and admin scans now show the right name and organization instead of falling into "anonymous" / "no org" (see section 8).
- **The action mix** groups every entry by its action type and splits each into worked-versus-failed.
- **All users** and **All organizations** join the audit log against the account and organization tables to produce per-person and per-organization totals (scans, events, failures, last-seen; members and scans per org).
- **Authentication** counts the login, sign-up, invite-accepted and password-reset actions directly.

The **Logs tab** counts differently, because it reads a different record — the **application log** (the server's own runtime diary). Its tiles are a simple histogram: total lines kept, and how many are info, warn, or error/fatal. The "kept N days" figure is the server's retention window. The list itself is just the most recent lines, filtered by the level and search term you choose.

## 6. Under the hood

**Two records, two databases.** The console draws on two entirely separate stores. This is the single most important technical fact about it.

- The **audit log** lives in a table called `audit_log` inside `server/data/auth.db` (the same database as accounts, so a backup captures both together). Each row records: a UTC timestamp (`YYYY-MM-DD HH:MM:SS`), the acting user's id and a snapshotted username, the tenant, a dotted action key (for example `scan.create`, `auth.login`, `feedback.submit`), an optional target type and id, a status of `ok` or `fail`, the caller's IP and user-agent, an optional JSON payload (capped at 8 KiB), and an error message when it failed. Writes are best-effort and append-only: a logging failure is caught and swallowed so it can never break the action being recorded, and the username is snapshotted at write time so deleting a user later does not erase their trail. Actions are also mirrored to the structured log stream, so the same trail is queryable outside SQLite.
- The **application log** lives in a table called `app_logs` inside `server/data/logs.db` — its own separate file, deliberately kept apart from the auth database so the high churn of logging does not disturb the accounts data. It is a durable mirror of the server's live log stream: as the server writes each already-serialised, already-redacted JSON log line, a copy is captured into `app_logs`. Each row pulls out the columns worth filtering on — timestamp, numeric level and its label (info/warn/error/fatal), message, event name, request id, HTTP method/URL/status/duration, and any error message — and keeps the entire original line (truncated at 8 KiB) in a `meta` column for the expand view. Because the mirror receives the same line pino already redacted, no secret pino hides can leak into this table. Writes are best-effort: a malformed line or a busy database is dropped silently rather than surfaced as an error.

**Retention and pruning (application log only).** The application log prunes itself. By default it keeps **7 days** of lines (configurable via `LOG_RETENTION_DAYS`) and hard-caps the table at **200,000 rows** (`LOG_MAX_ROWS`) so a burst of logging cannot fill the disk — whichever limit bites first wins. Pruning runs when the store starts and roughly once every thousand inserts thereafter. The audit log is *not* pruned this way; it is a permanent record.

**Endpoints.** All of these require the caller to be signed in first.

| Endpoint | Method | Purpose | Who |
|---|---|---|---|
| `/api/admin/dashboard` | GET | The whole Operations snapshot in one JSON object. | Owner, or an allow-listed admin username. Returns 403 "Owner access required" otherwise. |
| `/api/logs` | GET | Recent log lines, filterable by `level`, `q` (search), `requestId`, time range, and paging. | Owner or allow-listed admin ("Admin access required" otherwise). |
| `/api/logs/stats` | GET | The level histogram and totals behind the tiles, plus the retention window. | Same as above. |
| `/api/logs/:id` | GET | One log line with its full parsed JSON detail (used by the expand view). | Same as above. |
| `/api/logs/clear` | POST | Wipes every stored application-log line and reclaims the space. Records the clear in the audit trail and writes a fresh line noting who did it. | Same as above. |
| `/api/audit` | GET | The raw audit trail. Returns only *your own* events by default; a tenant-wide or cross-tenant view is gated to allow-listed admins and silently downgraded for everyone else. | Any signed-in user (own events); wider scopes admin-gated. |

**The admin allow-list.** Both the dashboard and the log endpoints treat "owner" as an admin, and additionally honour a server-side allow-list of usernames (the `AUDIT_ADMINS` environment variable, comma-separated). A username on that list gets the same access as an owner. This is a server setting, not something toggled in the UI.

## 7. Access (who can open it)

There are two gates, and they are not identical — this is worth understanding because it explains a confusing case.

**The page gate (in the browser).** The `/dashboard` route is wrapped so that only a signed-in user whose organization is active and whose role is **org admin or owner** can reach it. Anyone not signed in is sent to login; an inactive organization is sent to the "pending" page; any other role is sent home. So org admins *can* open the page.

**The data gate (on the server).** The data behind the page is stricter. The Operations snapshot is served only to **owners** and to usernames on the **`AUDIT_ADMINS`** allow-list; everyone else gets a 403. The log endpoints use the same bar. The practical consequence: an **org admin who is not on the allow-list can open the console but will see "Owner access required to view this dashboard"** on the Operations tab and "Admin access required to view logs" on the Logs tab, rather than any data. In effect, the console is an owner tool, with an explicit allow-list escape hatch for trusted admins.

A couple of related notes:

- The old **`/logs`** web address still exists but now simply redirects to `/dashboard`, because the logs viewer became a tab inside the console rather than a page of its own.
- The raw audit trail at `/api/audit` is available to any signed-in user for *their own* events; only the cross-user and cross-tenant views are admin-gated.

## 8. Edge cases (why some rows say "anonymous")

Signing in is now required to use RackTrack, so from here on every action is attributed to a real, named person. But the audit log is a historical record, and it contains rows from before that was true. That produces a few things worth explaining:

- **"anonymous" in Top scanners, "(no org)" in Scans by organization.** These are almost always **pre-authentication leftovers** — actions recorded back when RackTrack did not require login, so there is no account to attribute them to. The console resolves names and organizations by looking up the *account* an action belongs to, which fixed a related quirk where owner and admin scans (whose stored name was often blank) used to fall into "anonymous" and "(no org)" even though the person was known. Those now resolve correctly. What remains under "anonymous" / "(no org)" is genuinely un-attributable historic data, not a live problem.
- **"guest" / "not signed in" in the live feed.** Some actions legitimately happen *before* there is a signed-in session — signing in, signing up, resetting a password. For those, the feed shows the identifier the person typed (their email or username) and marks the row as a guest with a "not signed in" tag. This is expected and correct, not a sign that authentication is broken.
- **"anonymous" in Recent errors.** If a failed action has no name on it (again, typically an auth-gate failure or a historic row), the errors card labels it "anonymous." The error text itself is still shown.
- **"today" is a UTC day.** "Scans today" and "Active users today" count from the start of the day in UTC, not your local midnight. Near the end of your local day the "today" figures may look like they roll over early or late compared with your wall clock.
- **Clearing the log does not erase history.** The **Clear log** button empties only the *application* log (`app_logs`). It leaves the audit trail — the record behind the entire Operations tab — completely intact, and it adds one audit entry recording that the clear happened.

## 9. Common questions

**Who is allowed to open the Operations Console?**
Signed-in org admins and owners can open the page at `/dashboard`. But only owners — and any username the server has on its admin allow-list — actually see the data. An org admin who is not on that list will reach the page and see an "Owner access required" message instead of the dashboard.

**What is the difference between the Operations tab and the Logs tab?**
The Operations tab shows what *people* did: a live trail of business actions (scans, sign-ins, feedback) drawn from the audit log. The Logs tab shows what the *server* did: its own runtime diary of web requests, email results and errors, drawn from the application log. Different records, different purposes.

**Does the page update on its own?**
Yes. While the **Live** toggle is on, the Operations tab refreshes every 5 seconds and the Logs tab every 4 seconds. Only the tab you are viewing refreshes. Press **Paused** to stop it, or **Refresh** to force an immediate update. The relative times ("3m ago") also tick every second on their own.

**Why does someone show up as "anonymous" or "(no org)"?**
Those rows are almost always leftovers from before login was required, so there is no account to attribute them to. Everything recorded now is tied to a real, named person. See section 8.

**What does "guest" or "not signed in" mean in the feed?**
It marks an action that genuinely happened before a session existed — signing in, signing up, or resetting a password. The feed then shows the identifier the person typed rather than a stored name. It is expected behaviour.

**What exactly counts as a "scan" in these numbers?**
A successfully recorded rack-scan action. "Scans today" and "Total scans" count those; the failed-scans figures count scan-family actions that failed.

**How is "Success rate" worked out?**
It is the share of *all* recorded actions that succeeded — one minus (failed actions ÷ all actions). It is not limited to scans, so failed logins or other failures lower it too. It turns amber below 90%.

**Where does "Accuracy (feedback)" come from?**
From the model-feedback answers people give in Ground Truth — right ÷ (right + wrong). It reads "no feedback yet" until any has been given, and turns amber below 80%. It is not part of the audit log.

**Can I find every log line that belongs to one web request?**
Yes. Expand any log row to see its **request id**, then search for that id to pull every line RackTrack wrote while handling that single request.

**What does "Clear log" do, and can I undo it?**
It permanently wipes the stored application log and starts fresh — it cannot be undone, so it asks you to confirm. It only clears the server's runtime log; it does **not** touch the audit trail or any business data, and the clear itself is recorded in the audit trail.

**How long are logs kept?**
The application log keeps about 7 days by default and is capped at 200,000 rows, pruning itself as it goes — whichever limit is reached first wins. The retention window is shown on the count line ("kept N days"). The audit trail behind the Operations tab is a permanent record and is not pruned this way.

**Could a password or secret end up in the logs?**
No. The application log mirrors the exact line the server has already redacted before writing it, so anything the logger hides stays hidden in this view too.

**Is the old `/logs` page gone?**
The address still works but now redirects to `/dashboard`. The logs viewer is now the **Logs** tab inside the Operations Console rather than a separate page.
