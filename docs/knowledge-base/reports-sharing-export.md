# Reports, Sharing & Export

*How a finished scan turns into a shareable report — what a report contains, how you view it, how you send it to a colleague through Teams, Outlook or Slack, and which file formats RackTrack can produce.*

Reference · All users · Last verified: 26 July 2026 against the live code.

---

## 1. In simple terms

A **report** is your scan written up as a single, tidy document. When RackTrack finishes looking at a rack photo, all the things it worked out — the list of devices, where each one sits in the rack, how many ports it has, which ports are patched, any live switch readings you captured, the annotated rack picture — are scattered across the results screen. A report gathers all of that into one page you can read top to bottom, keep, print, or hand to someone else.

You never have to "build" a report by hand. RackTrack assembles it on demand from the scan you already have. On the results screen there is a small row of buttons under the rack. One of them, **View**, opens the report. Another, **Share**, sends it to a colleague. That is the whole idea: the scan is the work; the report is the scan made presentable and portable.

There are two everyday things people want to do with a report. The first is **look at it** — open it on screen to check everything is captured. The second is **send it to someone** — email it, or drop it into a Teams or Slack conversation, so a teammate who wasn't standing at the rack can see what you found. RackTrack supports both directly from the results screen.

## 2. At a glance

| | |
|---|---|
| **What a report is** | Your scan gathered into one document: inventory, ports, live switch readings, and the annotated rack image. |
| **Where you find it** | The button row under the rack on the results screen: **View**, **Share**, **Change Device**, **New Scan**. |
| **View** | Opens the report as a web page inside the app (an in-app window titled "Scan Report"). |
| **Share** | Opens a small menu — **Teams**, **Outlook**, **Slack** — then asks for a recipient email and sends the report to them. |
| **What Share sends** | A PDF of the report, attached to a message/email addressed to the recipient you type in. |
| **File formats the report can produce** | HTML (web page), JSON (raw data), CSV (opens in Excel), and PDF (real print-ready file). |
| **Who can do it** | Any signed-in user who can open the scan. Sharing needs the recipient's email address. |
| **Data source** | REAL — everything in a report comes from your actual scan and any live switch readings you captured. Nothing is invented. |

## 3. What a report contains

A report is built from one scan, so it only ever shows what that scan found. Grounded in the code that assembles it (`buildScanReportData` in `server/app.js`), a report carries:

- **Header facts** — the rack's ID, the date and time the scan was taken, the range of rack units that were detected (for example "U01–U24"), and a note about photo quality if one was recorded.
- **Device inventory** — every device the scan detected, each with: a generated label (like `U05-SW01`), its type (Switch, Patch Panel, Firewall, Router, Server, PDU, and so on), its position in the rack, and its port counts broken down into RJ45 ports, SFP ports, console ports and other (USB) ports. It also records how many of those ports are patched (connected).
- **Make / model / firmware** — when the scan read a device's printed label with OCR, the report shows the real make and model (for example "Cisco C9300-48P") instead of just the generic type. If OCR never ran or couldn't read a label, the device still appears with its type.
- **PDU power** — for a PDU, the report includes its power-outlet counts: total outlets, how many are in use, and how many are free.
- **Port findings** — the most recent port identification, including the cable's colour, connector and type where those were detected.
- **Live switch readings** — if you opened the console on a switch port and ran commands, the report includes that transcript: the host, the interface, and every command with its output (or error). This is the same live data you saw in the app.
- **Accuracy feedback** — if anyone gave feedback on this scan (marking detections right or wrong), the report shows the totals and the measured accuracy, plus the individual feedback entries.
- **Images** — the annotated rack image (device and unit overlay) is used as the report's hero picture, and per-port pictures appear alongside the port findings.

The on-screen HTML version also computes a small **inventory rollup** at the top — how many switches, how many ports in total, how many are patched, and how many devices were positively identified by make/model.

## 4. Viewing a report, and the report link/token

To view a report, open the scan's results screen and tap **View** in the button row. RackTrack opens the report as a web page inside the app, in a window titled "Scan Report · <scan ID>". You can scroll the whole thing there without leaving the app.

Behind that simple tap is a small security step worth understanding, because it explains a couple of things users sometimes ask about.

The report is shown inside an embedded web frame (an iframe). A frame like that can't send the app's normal login header, so RackTrack instead mints a **short-lived report token** the moment you tap View. That token is a narrow key that says "the holder may read this one rack's report" — nothing else, and only for a short time. In the code the token lasts **300 seconds (5 minutes)**. The report page is loaded with that token attached, proving you're allowed to see it without exposing the report to anyone who doesn't have the key.

Two practical consequences:

- **Report links expire.** A report URL carries that 5-minute token. It is deliberately not a permanent public link. If you left a report window open for a long time and something needed to reload, RackTrack simply mints a fresh token — you don't manage this yourself.
- **A report token only unlocks the one rack it was minted for.** It can't be reused to peek at other scans.

If you land on the results screen for a **ticket-mode** scan (one opened to investigate a specific incident), the **View** button opens the incident report view for that ticket instead of the standard scan report.

## 5. Sharing to Teams, Outlook or Slack

The **Share** button is how you get a report to someone else. Tapping it opens a small menu with three destinations, in this order:

1. **Teams**
2. **Outlook**
3. **Slack**

Pick one and RackTrack opens a **recipient dialog**. This is the key thing to know about sharing: **every share is addressed to a person by email.** The dialog asks for:

- **Recipient email** (required) — the address the report goes to. It's validated, so an empty or malformed address is rejected before anything is sent. RackTrack remembers the last address you used *for that channel* on this device, so the next time you share via, say, Teams, the field is pre-filled with whoever you sent to last.
- **A short note** (optional) — labelled to match the channel: for **Teams** and **Slack** it's a **Message**; for **Outlook** it's the **Subject**. Leave it blank and RackTrack uses a sensible default line like "Rack scan report for <rack>".

When you confirm, RackTrack builds a **PDF of the report** and sends it as an attachment to the recipient through the channel you chose. The button shows "Sending…", then "Sent to <recipient> via <channel>" when it succeeds. If it fails, you get a plain-English reason — for example that the connection has expired and needs reconnecting under Data Sources, that the recipient isn't a member of your organisation, that RackTrack doesn't have permission to post there, or that the address couldn't be reached — rather than a raw technical error.

A few honest details:

- **All three channels attach the same PDF.** Teams, Outlook and Slack differ in *where* the report lands and what the optional note is called, but the document itself is the PDF report.
- **All three need a recipient email.** There is no "post to a channel with no address" option in this flow — sharing is always to a named recipient.
- Teams and Outlook go through your organisation's Microsoft connection, which is why the errors mention things like organisation membership, expired connections, and administrator approval.

## 6. Export formats — what exists

This is the section people ask about most, so here is the verified, honest picture.

**A report can be produced in four formats.** All four come from the same underlying scan data, so they contain the same facts in different shapes:

| Format | What it is | How it behaves |
|---|---|---|
| **HTML** | A self-contained web page, with the images embedded inside it. | This is what **View** shows. It's saved on the server as `report.html`. |
| **PDF** | A real, print-ready PDF, rendered server-side (A4 pages). | This is the file that **Share** attaches when you send to Teams / Outlook / Slack. |
| **JSON** | The raw structured data — every device, port, reading and feedback entry as machine-readable fields. | Good for feeding another system. RackTrack itself uses this internally to re-open a scan from your history. |
| **CSV** | A comma-separated table. | **Opens directly in Excel** (or any spreadsheet). It lists port identifications, any console-command transcripts, and feedback entries. |

So, plainly:

- **Yes, a CSV/spreadsheet export exists.** The report can be produced as CSV, and CSV opens straight into Excel. (Verified in code: `renderCSVReport`, served as a `.csv` download.)
- **Yes, a PDF exists.** The report can be produced as a genuine PDF, and that PDF is exactly what gets emailed when you Share.
- **Yes, JSON and HTML exist too.**

**One important nuance about the buttons.** The report button row on the results screen exposes **View** (which opens the HTML report) and **Share** (which emails the PDF). It does **not** currently show a separate one-tap "Download CSV", "Download PDF" or "Download JSON" button. In other words: the *formats* are real and the *report engine* produces all four, but the app's report row surfaces them as **View** and **Share** rather than as a set of download buttons. If you need the raw CSV, JSON or a standalone PDF in hand, the most reliable everyday route inside the app is **Share** — which puts the PDF in someone's inbox (you can send it to yourself). The CSV, JSON and PDF are generated from the report endpoint (see the next section) rather than from a labelled button in the results row.

There is nothing beyond these four. There is no separate "asset register" or bespoke spreadsheet builder — the CSV *is* the spreadsheet export, and it's driven off the same scan data as everything else.

## 7. Under the hood (endpoints)

For support and debugging, these are the real endpoints in `server/app.js`. Users don't type these; the app calls them.

- **`GET /api/scan/:rackId/report-token`** — mints the short-lived (300-second) token that lets the in-app report frame prove access without a login header. The token is scoped to exactly one rack.
- **`GET /api/scan/:rackId/report`** — the report endpoint. Its `format` query decides what comes back:
  - *(no format)* → JSON **metadata**: the rack ID, timestamp, a summary (device count, unit range, feedback total, accuracy), and the URLs for each format.
  - `?format=html` → the **standalone HTML** report (regenerated and also saved to disk as `report.html`).
  - `?format=pdf` → a **real PDF**, rendered by headless Chromium, served inline as `rack-report-<rackId>.pdf`.
  - `?format=json` → the **JSON** data (the full structured report).
  - `?format=csv` → the **CSV** file, delivered as a download named `<rackId>_report.csv`.
- **`POST /api/scan/:rackId/report`** — regenerates the HTML file on disk and returns fresh metadata.
- **`POST /api/scan/:rackId/slack`**, **`/teams`**, **`/outlook`** — the three share channels. Each takes the recipient `email` plus an optional note (`comment` for Slack, `message` for Teams, `subject` for Outlook), builds the report **PDF**, and emails it as an attachment to the recipient. These are what the Share dialog calls.
- **`GET /api/rack-group/:groupId/report?format=html`** — a bonus for rack groups: one combined HTML document that stacks every rack in the group, each rack's standard report one after another under a cover page.

The pieces that build the content are `buildScanReportData` (gathers the facts), `renderHTMLReport` (the web page), `renderJSONReport` (the JSON), `renderCSVReport` (the spreadsheet), and `buildScanReportPDF` (renders the HTML to PDF with headless Chromium).

## 8. Common questions

**How do I share a scan?**
Open the scan's results screen, tap **Share** in the button row, pick **Teams**, **Outlook** or **Slack**, type the recipient's email, and confirm. RackTrack builds a PDF of the report and sends it to that person.

**How do I send a report to someone?**
Same as sharing: tap **Share**, choose a channel, enter their email, optionally add a short message or subject, and send. They receive the report as a PDF.

**How do I email a scan?**
Use **Share**. All three options (Teams, Outlook, Slack) are addressed to an email address and deliver the report PDF to that recipient — so "email a scan" and "share a scan" are the same action here. To email it to yourself, put your own address in the recipient field.

**Can I export to CSV?**
Yes. The report can be produced as a CSV file (`report?format=csv`, delivered as `<rackId>_report.csv`). It lists the port identifications, any console-command transcripts, and the feedback entries.

**Can I export to Excel?**
Yes — the CSV is designed to open directly in Excel or any spreadsheet program. There isn't a separate `.xlsx` format; the CSV is the spreadsheet export.

**Can I download a PDF?**
A PDF absolutely exists — it's the exact file that **Share** emails to your recipient, and the report engine renders it as a real A4 PDF. The simplest way to get the PDF in the app is to **Share** the report to an email address (including your own). There is no dedicated "Download PDF" button in the results row; sharing is the in-app path to the PDF.

**Can I get a JSON of the scan?**
Yes. The report is available as JSON (`report?format=json`), containing the full structured data — devices, ports, live readings and feedback. The app itself uses this format internally when it re-opens a scan from your history.

**How do I share to Teams?**
Tap **Share → Teams**, enter the recipient's email and an optional message, and send. It goes through your organisation's Microsoft connection.

**How do I share to Outlook?**
Tap **Share → Outlook**, enter the recipient's email and an optional **subject**, and send. The report PDF is attached to the email.

**How do I share to Slack?**
Tap **Share → Slack**, enter the recipient's email and an optional message, and send. As with the others, it delivers the report PDF to that recipient.

**What's in a report?**
The scan's device inventory (type, position, port counts, and make/model where it was read), how many ports are patched, PDU power counts, the latest port findings with cable details, any live switch console readings you captured, accuracy feedback, and the annotated rack image. See section 3 for the full list.

**How do I view a report?**
Tap **View** in the results button row. The report opens as a web page inside the app.

**Do report links expire?**
Yes. A report is opened with a short-lived token that lasts 5 minutes (300 seconds). It's not a permanent public link, and the token only unlocks the one rack it was minted for.

**Why did the report ask for a token / why can't I just paste the link to a colleague?**
Because report access is deliberately time-limited and rack-scoped for security. To give a colleague the report, use **Share** (which sends them the PDF) rather than passing a link.

**Do I need the recipient's email to share?**
Yes. Every share — Teams, Outlook or Slack — is addressed to a specific email. The dialog won't send without a valid address.

**Does RackTrack remember who I shared with last time?**
Yes, per channel and per device. When you open the Share dialog for a channel, the recipient field is pre-filled with the last address you used for that same channel.

**Can I add a message when I share?**
Yes, it's optional. For Teams and Slack it's a **Message**; for Outlook it's the **Subject**. Leave it blank and a default line is used.

**Which format does Share actually send?**
A PDF. All three channels attach the same PDF of the report.

**The share failed — what do the error messages mean?**
RackTrack translates the common failures into plain English: the connection has expired (reconnect it under Data Sources), the recipient isn't in your organisation, RackTrack lacks permission to post there (an admin needs to approve it), the destination couldn't be reached, or the email address was rejected. The raw technical detail is kept in the server log, not shown to you.

**Is there a "Download" button on the results screen?**
The results button row shows **View**, **Share**, **Change Device** and **New Scan**. There is no separate labelled download button there. To view, use **View**; to get a file out (PDF), use **Share**.

**Can I export the whole thing as one document for a group of racks?**
Yes, for a rack group there's a combined HTML report that stacks every rack in the group into one document.

**Can I print a report?**
Yes — open it with **View** and use your device's normal print/share sheet on the web page. Separately, the server can render the same report to a real PDF, which is what Share attaches.

**What do "Change Device" and "New Scan" do (the other two buttons)?**
They're not export actions. **Change Device** takes you back to picking a different device in the same scan; **New Scan** starts a brand-new scan. They sit in the same button row as View and Share.

**Is any of a report made up or estimated?**
No. Everything in a report comes from your real scan and any live switch readings you captured. If OCR couldn't read a device's printed model, that field is simply left generic rather than guessed.
