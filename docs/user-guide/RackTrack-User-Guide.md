*Canonical words for the RackTrack user guide (device-agnostic). The iPhone/iPad HTML editions are generated from these words plus per-device screenshots.*

# RackTrack User Guide

Point your camera at a rack. RackTrack maps every unit, device, switch and port — then checks it against your records.

*Every screenshot in the published editions was captured from the running application.*

## What do you want to do?

Find the job you have in front of you, tap it, and jump straight to the steps. Each task is written to stand on its own, so you do not have to read the guide in order.

**Getting in**

1. [Create an organization](#create-org)
2. [Join a team you were invited to](#invite)
3. [Sign in](#signin)
4. [Reset a forgotten password](#forgot)
5. [You are stuck on “Waiting for approval”](#pending)

**Scanning a rack**

6. [Find your way around](#nav)
7. [Take a photo the app can read](#good-photo)
8. [Scan a rack](#scan-single)
9. [Scan a rack too tall for one photo](#scan-tall)
10. [Scan a whole row of racks](#scan-row)
11. [The app rejected your photo](#rejected)

**Using your results**

12. [Read the rack overview](#overview)
13. [Find a specific port](#find-port)
14. [Correct the app when it is wrong](#correct)
15. [Share a result, or open the switch console](#share)
16. [Register the rack in your CMDB](#cmdb)

**Going deeper on the equipment**

17. [See what is plugged in right now](#ports)
18. [See what is on the end of each cable](#cables)
19. [Check whether something is reachable](#trace)
20. [Check a switch's firmware](#firmware-switch)
21. [Choose the right SFP module](#sfp)
22. [See the rack as a diagram](#topology)
23. [See what the network says about the rack](#network)
24. [Find out what changed, and when](#drift)

**Looking things up**

25. [Look up a datasheet](#specs)
26. [Check any firmware version](#firmware-tool)

**Your account**

27. [Reopen a scan you did earlier](#history)

**For administrators**

28. [Connect your CMDB](#connect)
29. [Add people to your team](#people)
30. [Approve a new organization](#approve)
31. [Sell surplus gear](#marketplace)
32. [Verify what the model detected (Ground Truth)](#ground-truth)

**Reference**

- [Where each screen gets its data](#data-sources)
- [Troubleshooting — find your symptom](#troubleshooting)
- [Glossary](#glossary)
- [Limits and timings](#limits)


---

## Getting in

### 1. Create an organization
*New company on RackTrack*

Use this the very first time your company touches RackTrack. Whoever creates the organization becomes its administrator, so it is usually the person who will look after the account, invite the rest of the team, and connect it to your other systems. You only ever do this once per company — everyone who joins afterwards uses an invitation (task 2), not this screen.

1. On the welcome screen, tap **Get Started**.
2. Fill in your **Email**, a **Username**, your **Organization** name (this is your company, and it is what your teammates will see), and a **Password**, which you type twice so a slip of the finger cannot lock you out.
3. Watch the little meter under the password box as you type. It never nags you with a list — it names the single thing still missing, one step at a time: “Need a digit”, then “Need a special character”, and so on. When the meter finally reads “✓ Strong password” and the second box reads “✓ matches”, the **Continue** button switches on.
4. Tap **Continue**. RackTrack sends a six-digit verification code to the email address you entered.
5. Type that code into the six boxes and tap **Verify**. This proves the email is really yours.
6. You land on the **Waiting for approval** screen. Your organization now exists, but a real person still has to approve it before anyone can scan — see task 5 for exactly what that screen is telling you.

> **IMPORTANT** — The code expires after **one minute**. Open your email inbox *before* you tap **Continue** so you are ready to read the code the moment it arrives. If the minute runs out, tap **Resend** and use the fresh code straight away.

> **TIP** — A password that RackTrack will accept needs all five of these at once: at least **8 characters**, one **uppercase** letter, one **lowercase** letter, one **digit**, and one **special character** (such as `!`, `?` or `#`). The meter is just checking off that list for you.


![Create an organization](../screenshots/iPhone/signup.png)
*The password meter must read “Strong password” before **Continue** turns on.*

### 2. Join a team you were invited to
*You got an invitation link*

This is how almost everyone gets into RackTrack. An administrator at your company creates an invitation link and sends it to you. You are joining *their* organization — you do not create a new one, and you do not need an organization name.

1. Open the link the administrator sent you. It shows exactly what you are joining, for example “Join Acme · London as Member”, so you can check it is the right team and the right role before you go any further.
2. Your email address is already filled in and cannot be changed — the invitation was issued specifically to that address, which is how RackTrack knows the link is meant for you.
3. Choose a **username** you will remember, create a **password** (the same five-part strength rule from task 1 applies here), and tap **Join**.
4. That is it. You are signed in immediately and dropped straight onto the scan screen, ready to work.

> **IMPORTANT** — An invitation link works **once** and stops working **seven days** after it was created. If yours has already been used or has gone stale, it cannot be revived — ask your administrator for a brand-new link.

> **NOTE** — RackTrack does not send invitation emails itself. Your administrator generates the link and passes it to you personally, so it might reach you by email, by chat, or even read out over a call. If you were expecting an invitation and nothing arrived in your inbox, ask them to send you the link directly.

### 3. Sign in
*Everyone*

1. Enter your **Username or email** and your **Password**.
2. Leave the **Organization** box empty. You only need to fill it in on the rare occasion that the same username exists in more than one organization and RackTrack needs you to say which one you mean.
3. Tap **Sign in**.

Where you land depends on who you are:

| Where you land | Who |
|---|---|
| The Organizations console | Administrators and the platform owner |
| The scan screen | Everyone else |

> **TIP** — Once you are in, you stay signed in for **30 days**, so you will not be typing your password every visit. Losing signal does not sign you out either — RackTrack keeps working in the parts of a datacenter where there is no reception, and syncs back up when you have a connection again.

> **NOTE** — If you see the words `rate_limited`, it simply means the app has seen more than ten sign-in attempts from you in a single minute and is asking you to slow down. Wait a full 60 seconds and try again — nothing is broken and your account is not locked.


![Sign in](../screenshots/iPhone/login.png)
*The **Organization** box is optional — most people leave it empty.*

### 4. Reset a forgotten password
*Everyone*

If you cannot remember your password, you do not need an administrator — you can sort it out yourself from the sign-in screen.

1. On the sign-in screen tap **Forgot password?** and enter the email address on your account.
2. RackTrack emails you a six-digit code. Type it in and tap **Verify code**.
3. Now choose what you actually want:
   - **Yes, change password** lets you set a brand-new password there and then.
   - **No, take me to the app** simply signs you in and leaves your existing password exactly as it was.

> **TIP** — **No, take me to the app** is the quick escape hatch for the common case where you had the right password all along but fat-fingered it a few times. You get straight in without the bother of inventing and memorising a new password.

> **IMPORTANT** — The code expires **one minute** after it is sent — and that clock keeps ticking even while you are sitting on the “Code verified” screen deciding what to do. Do not wander off at that point; finish the reset promptly or you will have to request a fresh code.


![Reset a forgotten password](../screenshots/iPhone/forgot-password.png)
*RackTrack always says a code is on its way — check your spelling.*

### 5. You are stuck on “Waiting for approval”
*New organizations*

A brand-new organization cannot scan until the platform owner (the person who runs RackTrack for everyone) has approved it. This is a one-time gate that only ever affects a freshly created organization. The good news is that the screen watches for you: it re-checks every few seconds on its own and lets you straight through the instant you are approved — you do not need to refresh anything or sign in again.

Here is what the screen might be telling you, and what to do about each:

| What it says | What it means | What to do |
|---|---|---|
| **Waiting for approval** | Nobody has looked at your request yet. | Wait. The screen will let you in by itself the moment it is approved. |
| **Request not approved** | The platform owner has declined the request. | Contact them to discuss it. Nothing you tap in the app will change this decision. |
| **Organization deactivated** | Your organization was switched off after previously being active. | Contact the platform owner. It comes back on its own if and when they switch it back on. |

> **IMPORTANT** — **Nobody is emailed when you sign up.** The platform owner only discovers a pending organization by opening their console and looking. So if you are stuck waiting, the fastest fix is almost always to message them directly and ask them to approve you — do not assume an automatic alert has told them you are there.


---

## Scanning a rack

### 6. Find your way around
*Everyone*

RackTrack has a small, steady set of navigation that never moves, plus a few extra links that appear only once you have a rack open.

Three tabs sit along the bottom of every screen at all times: **HOME**, **SCAN** and **PROFILE**.

> **IMPORTANT** — **The middle SCAN tab is also the camera shutter.** There is no separate round shutter button anywhere on the screen — you press SCAN itself to take the photo. This is the single thing new users hunt for and cannot find, so if you are staring at the camera wondering how to take the picture, that is your answer.

> **NOTE** — The extra rack links vanish when you refresh the page, and RackTrack clears them on purpose when you start a new scan, so they always point at whatever you are working on *now*. To reopen a rack you scanned earlier, go to **Profile → Recent Scans** (task 27) — that is the permanent record.

Once you open a rack, six more links appear that relate just to that rack: **Overview**, **Ports**, **Topology**, **Network**, **Switches** and **Drift**. On a small screen they sit in a strip across the top of the result, with the less-used **Network** and **Drift** tucked behind a **More** button so the strip stays tidy.


![Find your way around](../screenshots/iPhone/scan.png)
*The scan screen. Three tabs sit along the bottom at all times.*

### 7. Take a photo the app can read
*Everyone*

The quality of your photo decides the quality of your result — a clear photo gives a clean, complete map of the rack, and a poor one leaves devices missing. To make a good photo easy, the camera puts a guide box over the picture and shows one short line of text that tells you the single most important thing to fix right now.

| If it says | Do this |
|---|---|
| “Move closer so the rack fills the frame” | Step forward until the rack fills the guide box. |
| “Move to better lighting” | Move yourself, or change your angle, so a bright light behind the rack is no longer washing out the picture. |
| “Hold steady — keep still for focus” | Brace your elbows against your body and wait a beat for the camera to settle. |
| “Looks great — tap the shutter below” | You are ready — take the photo. |

> **IMPORTANT** — **The shutter will not fire until all three checks (framing, lighting and steadiness) pass at once.** So if tapping **SCAN** seems to do nothing at all, the app is not frozen — read the hint line, because it is telling you exactly which of the three still needs fixing.

**Rules of thumb for a photo that reads cleanly:**

- Stand square to the rack, straight in front of it, not off to one side.
- Hold the camera level with the middle of the rack, not tilted up or down.
- Get the *whole* rack in the frame, from the top rail to the bottom rail.
- If cables are draped across the front and hide the equipment, take a couple of extra photos from the left and from the right, so the app can see past the bundles.

### 8. Scan a rack
*Everyone · the main job*

This is the core of RackTrack: one photo in, a fully mapped rack out.

1. Open **SCAN**.
2. Choose **Camera** to take a photo right now, or **Upload** → **SINGLE** to use a photo you already have saved.
3. If you are using the camera, line the rack up until the hint reads “Looks great”, then tap the middle **SCAN** tab to fire the shutter (remember, SCAN *is* the shutter).
4. Tap **Analyze Rack**.
5. Wait a few seconds. When it finishes you land on the rack's **Overview** — your photo, with every device boxed and named.

> **NOTE** — The progress bar is an estimate of how long things usually take, not a live measurement of the actual work. It climbs briskly to about 88% and then holds there while the real analysis finishes off. Sitting at 88% for a few seconds is completely normal — it is not stuck.

> **TIP** — Scanning the **same rack twice costs you nothing**. RackTrack recognises when you have handed it an identical photo and instantly returns the earlier result — with any corrections you made last time still applied — instead of doing all the work again.


![Scan a rack](../screenshots/iPhone/scan.png)
***Upload** takes a photo you already have; **Camera** takes one now.*

### 9. Scan a rack too tall for one photo
*Everyone*

Some racks are simply too tall to capture in a single frame without standing so far back that the labels become unreadable. For those, take several photos and let RackTrack stitch them into one.

1. Open **SCAN** → **Upload** → **MULTI**.
2. Tap **Select photos** and add between **2 and 8** photos that overlap each other, together covering the whole rack from top to bottom.
3. Tap **Stitch & Analyze**. RackTrack joins the photos into one tall image and then reads it as a single rack.

> **TIP** — Aim for **20–40% overlap** between each photo and the next — that shared strip of detail is what lets the app line them up correctly. You do **not** have to take or select them in order; RackTrack works out the sequence for you.

> **NOTE** — MULTI mode is for one **tall** rack. To capture a whole **row** of separate racks in one go, record a video instead — that is the next task.


![Scan a rack too tall for one photo](../screenshots/iPhone/scan-multi.png)
***MULTI** mode. Order does not matter — RackTrack works it out.*

### 10. Scan a whole row of racks
*Everyone*

Instead of photographing racks one by one down an aisle, record a single video that pans across the whole row. RackTrack finds each rack in the footage, picks the sharpest frame for each one, and analyses them separately — so every rack ends up with its own full result.

1. Open **SCAN** → **Upload** → **VIDEO**.
2. Upload a steady pan across the row, anywhere from **1 to 120 seconds** long. Walk slowly and keep the camera level.
3. Tap **Analyze Rack**.
4. You land on the first rack, and a **rack strip** now runs across the top of the screen — one button per rack the video found.

Tap any rack in the strip to jump straight to it. As you move between racks, RackTrack keeps you on the same sub-page you were viewing, so you can, for example, compare the **Ports** of one rack against the next without re-navigating. **Combined 3D** is worth trying too — it draws **every rack in the row together in one scene**.

> **IMPORTANT** — Linking a scan to an incident (a support ticket) **turns multi-rack off**. A ticket is about one specific rack, so when a scan is tied to one, RackTrack analyses only that single rack rather than the whole row.

### 11. The app rejected your photo
*Everyone*

Before it spends time reading a photo, RackTrack checks that the photo is actually good enough to read. When a photo is too small, too blurry, tilted, or so buried in cables that the equipment is hidden, it stops and offers you two buttons: **Retake** and **Proceed anyway**.

| Message | What it means and what to do |
|---|---|
| “Please take the photo from the front of the rack…” | You are shooting side-on, or it is too dark to make out the rack. Stand square to the front and retake. |
| “Please upload a clearer photo of the rack…” | Fewer than three rack units were readable — usually the rack is too far away. Get the whole rack to fill the frame and retake. |
| “The image appears tilted…” | The camera was not level. Hold it straight and retake. |
| “This rack is heavily covered by cables…” | Cabling is hiding the equipment. Add extra photos taken from the left and right of the rack. |
| “Camera access denied…” | RackTrack has not been given permission to use the camera. Allow camera permission in your device settings, or use **Upload** instead. |

> **IMPORTANT** — **Proceed anyway** switches the safety checks **off** and analyses the photo exactly as it is. If the photo really was bad, the result will show it — devices will be missing, or the rack may even come back empty. Nine times out of ten, **Retake** is the faster route to a correct answer than pushing a poor photo through and then trying to fix the gaps.


---

## Using your results

### 12. Read the rack overview
*Everyone*

Every scan lands you here — this is the results hub, and it is the doorway to every deeper view. Your own photo comes back with a coloured box drawn around each device the app found, and each box carries the device's name.

1. **Tap a box** to select that device and see its details.
2. **Tap it a second time** to zoom right into it and hide everything else, so you can study just that one device. **Back to rack** returns you to the full picture.
3. Pinch, scroll, or use the on-screen zoom buttons to get closer. Once you are zoomed in, drag to move around the image.

> **NOTE** — Empty units, blank panels, and anything the app could not confidently identify are deliberately left unboxed. This is on purpose — it keeps the picture clean so that the boxes you *do* see all mean something, rather than cluttering the rack with question marks.

From this one screen you can branch out to every other view of the rack — live ports, cable tracing, the 3D map, firmware, change history and the shareable report — all built from this same reading of your photo.


![Read the rack overview](../screenshots/iPhone/results.png)
*Your own photo, with every device the app found boxed and named.*

### 13. Find a specific port
*Everyone · the job you came for*

Often you arrive at a rack already knowing a port number — “I need port 12 on the top switch” — and you just need to put your hand on the right socket. This is the task for that.

1. Choose the device from the **Device** list — or simply tap it in the photo.
2. Pick the port type: **RJ45** (copper), **SFP** (fibre), **Console**, or **USB**. RackTrack only offers the types that device actually has, and shows the count of each, so you cannot pick a type the device does not own.
3. Type the port number you are after.
4. Tap **Find Port**.

RackTrack then zooms your photo straight to that exact port and dims everything around it, so the socket you want is the only thing lit up. Tap the picture to cycle between three views: the whole rack, the single device, and the tight close-up of the port. What it tells you about the port:

| Reading | What it means |
|---|---|
| **Status** | **Connected** (a cable is in it), **Empty**, or **Unknown**. |
| **Cable** / **Color** | The connector type and the cable's colour — genuinely useful when you are trying to follow a run by eye across a messy rack. |
| **Linked endpoint** | What is on the **other end** of the cable, asked of the switch itself rather than guessed from the photo. It is marked **LIVE** precisely because it was read from the live network. |

> **NOTE** — When the app is not certain, it says so plainly, for example *“Not fully sure about this cable (42% confidence)…”*. Treat that as an honest hedge: trust your own eyes over a low-confidence reading, and then correct it (the next task) so RackTrack gets it right for you next time.


![Find a specific port](../screenshots/iPhone/results.png)
*Pick the device, pick the port type, type the number.*

### 14. Correct the app when it is wrong
*Everyone*

RackTrack does not ask you to trust it blindly. It checks its own work by asking you plain, single questions like **“Port 7 on Switch. Right?”** with simple **Yes** / **No** buttons. Answering **No** does two good things at once: it fixes *your* result on the spot, and it teaches the model so it is more accurate on your equipment next time.

| The question | Answer **No** when… | What happens |
|---|---|---|
| **Port N on <device>. Right?** | The highlight landed on the wrong port. | Type the real port number. The app re-numbers the device and moves the highlight to match. |
| **Cable color is <colour>. Right?** | The colour is wrong. | Pick the real colour from twelve swatches. |
| **Detected as <type>. Right?** | It called a firewall a switch, or similar. | Choose the real device type from the list. |
| **Detected N ports. Right?** | The port count is off. | Type the real number. The app re-counts the device and redraws it. |

Any value you have fixed is flagged with a **“Your correction”** badge, so you can always tell your input apart from the app's guess. Your corrections are sticky — RackTrack remembers them and reuses them, so you never have to make the same fix twice for the same rack.

> **TIP** — It is worth the ten seconds. A correction fixes **your** result immediately, and it is also fed back into training so the model steadily gets better at recognising the exact kit you work with.

> **NOTE** — Correcting a port number does not change the number you originally asked for. If you say “the port you highlighted as 7 is really port 5”, RackTrack learns the offset for that device and then shows you where **port 7** truly sits — it does not simply relabel the socket in front of you.

### 15. Share a result, or open the switch console
*Everyone*

Along the bottom of a result sits a row of action buttons for getting the result out to other people, or getting hands-on with the switch.

| Button | What it does |
|---|---|
| **View** | Opens the full scan report without leaving the page. |
| **Report** | Opens the report in a new tab, ready to save as a PDF or print. |
| **Share** | Sends it out by **Teams**, **Outlook** or **Slack**. Your address is remembered so you are not re-typing it every time. |
| **Console** | Opens a live SSH session to the switch, already focused on the port you were looking at. |
| **Find** | Locates another port on the same device. |
| **New Scan** | Starts a fresh scan from scratch. |

The **Console** is designed so you do not have to remember switch command syntax. Instead of a blank prompt, it gives you a **menu of plain-English questions** — pick one and it runs the right command for you. When you are done, tap **Done** and RackTrack assembles a **Port Report** with a plain-language verdict, such as *“Link is DOWN — no device connected (or cable unplugged at the far end).”*

### 16. Register the rack in your CMDB
*Needs a connected CMDB*

If your organization has connected a configuration database (see task 28), RackTrack quietly compares every scan against it. When it finds a rack your official records have never heard of, it offers to do the paperwork for you rather than making you file it by hand.

1. After the scan, a message appears: **“Rack not registered in CMDB”**. Tap **Raise Ticket**.
2. RackTrack opens a request that describes everything it found in the rack, and shows you the reference number so you can track it.
3. Tap **Approve** to register the equipment.
4. **Successfully registered** appears, listing every device, port and cable that was written into your records.

> **NOTE** — The offer appears **once**, only on a fresh scan, and only for about half a minute. If you tap **Not now**, RackTrack will not nag you about it again — but the rack stays unregistered until you scan it again and take the offer.

> **IMPORTANT** — If no CMDB is connected, RackTrack simply never makes this offer, and your scan is completely unaffected. The feature only exists when there is a database for it to check against.


---

## Going deeper on the equipment

### 17. See what is plugged in right now
*Needs switch access*

Every other screen in RackTrack is built from your photo. **This one is different.** It logs in to the switch over the network and asks the device itself, right now, which ports are in use, which are talking, and which are genuinely free — so the answer is live fact, not a reading of a picture. The moment you open the Ports view a loader ticks up the seconds, so you can see it is really out probing the switch, not stuck.

At the top, an identity card shows the switch's model, firmware, uptime, management address and even its live power draw, with a small “live” dot. Below that, three summary tiles give you the headline numbers:

| Tile | Meaning |
|---|---|
| **In use** | Ports with a live link, out of the total. |
| **Available** | Ports you can actually plug into today. |
| **Identified** | Ports where the far-end device announced itself, so RackTrack knows what is on the other end. |

RackTrack sorts free capacity into copper and fibre for you — a separate count of free **Ethernet** ports and free **SFP** slots — because “5 ports free” is not enough to know if your uplink will fit. A **utilisation bar** shows at a glance how full the switch already is. And each port is given one plain verdict:

- **Available** — the link is down and the port has no description. Nothing is plugged in and nothing is holding it.
- **In use** — the link is up.
- **Reserved** — the port is shut or error-disabled, *or* it is down but still carries a description, which is a sign that somebody labelled it on purpose.

> **IMPORTANT** — A port with a **description on the switch but nothing plugged in** reads as **Reserved**, not **Available**. Somebody named it for a reason — check before you take it. RackTrack deliberately never counts a reserved port as spare, because capacity you cannot actually use is not really spare.

> **NOTE** — This screen can fail even when your scan was perfect — for example if the switch is unreachable from where you are, or its sign-in details have not been saved. That is a network or credentials problem, not a scanning problem, and the loader will turn into a short, readable reason with a **Retry** button rather than a raw error.

The **faceplate** is a map of the physical front of the switch, so a port on your screen sits exactly where it sits on the metal. Green is up, a distinct colour marks an uplink carrying many devices, and faint means free. The filter pills — **All**, **In Use**, **Available**, **Linked** and **Errors** — narrow the list below (the **Errors** pill only appears when there are reserved ports to show).

> **TIP** — The last good reading is remembered on your device, so the next time you open this view it appears instantly while a fresh read runs in the background. You are never staring at a blank screen waiting.


![See what is plugged in right now](../screenshots/iPhone/ports.png)
*The faceplate mirrors the physical front of the switch.*

### 18. See what is on the end of each cable
*Needs switch access*

1. Open **Ports** and choose the **Cables** tab.
2. Click any row to expand it into a trace that shows both ends of that cable.
3. Where a single port feeds a whole downstream network, the trace lists every device sitting behind it, each resolved to the manufacturer that made it — so you can see not just “something is connected” but roughly *what* is connected.

> **IMPORTANT** — RackTrack can only see what the switch can see. **A patch panel or wall socket in the middle of a run has no electronics of its own**, so it is completely invisible here — the cable appears to run straight from the switch to the far-end device, as if the panel were not there. That is physics, not a gap in the app.


![See what is on the end of each cable](../screenshots/iPhone/ports-cables.png)
*Every live cable, listed as *this port → that device*.*

### 19. Check whether something is reachable
*Needs switch access*

This runs the reachability test **from the switch**, not from your laptop or phone. That distinction matters: it tests the path your *equipment* actually takes across the network, rather than the path your phone takes over the office Wi-Fi, so the answer reflects the real world of the rack.

1. Open **Ports** → **Trace**.
2. Type an IP address or a hostname.
3. Tap **Ping** to ask a simple “can you reach it?”, or **Traceroute** to see every router along the way and spot which hop is slow.

> **TIP** — Two shortcut chips save you typing. The `8.8.8.8` chip tests the whole path all the way out to the internet, and the **gateway** chip tests just the first hop out of your rack. If the gateway answers but `8.8.8.8` does not, you have learned something useful: the problem is upstream of your rack, not inside it.


![Check whether something is reachable](../screenshots/iPhone/ports-trace.png)
*Ping and traceroute, run from the switch itself.*

### 20. Check a switch's firmware
*Everyone*

This tells you one thing clearly: **is this switch on the newest firmware the vendor ships, or is it behind?** It is a *currency* check — how your version compares to the latest — and nothing more.

1. Open the rack → **Switches** and pick the switch's tab.
2. If the card says **Not detected**, tap **Enter make / model** and type them in — the lookup needs both to know which product to check.
3. Open the **Firmware** tab. If no version is recorded, tap **Enter version** and type the one the switch is running.
4. Read the coloured status.

| Status | What it means |
|---|---|
| **Up to date** (green) | Your version matches the newest RackTrack could verify from the vendor. |
| **Upgrade available** (amber) | The vendor ships a newer version than the one you are on. |
| **Couldn't confirm** (neutral grey) | RackTrack could not read the vendor's latest version this time — it is **not** telling you that you are current. |

The latest version is read **live from the vendor's own site**, and RackTrack understands version numbers as versions rather than as text — so it correctly knows that `16.12.1` is older than `16.12.10`, which a plain letter-by-letter comparison would get wrong.

> **IMPORTANT** — **A grey “couldn't confirm” is never the same as a green “up to date”.** It only means RackTrack could not verify the newest version — often because the vendor's page needs a login or blocks automated reading. When that happens, follow the vendor link and check the version yourself.

> **NOTE** — This is a currency check, not a security scan. RackTrack does **not** list specific vulnerabilities, does not tell you whether a model has reached end-of-life, and does not try to summarise what changed between versions. For the real release notes, follow the link to the vendor's own page — that is where accurate detail lives, and RackTrack would rather send you there than show you an unreliable summary.

> **IMPORTANT** — The make, model and version you type here are saved **in this browser only**. They do not reach the server, your CMDB or your colleagues, and they are lost if you clear your browsing data or move to another device.


![Check a switch's firmware](../screenshots/iPhone/switch-firmware.png)
*Your current version next to the newest one the vendor ships.*

### 21. Choose the right SFP module
*Everyone*

Given the empty SFP slots on your switch, this recommends transceivers that will fit — with a **★ TOP PICK**, the price, and a link to buy.

> **IMPORTANT** — Always check the recommendation against your switch's own compatibility list before you buy. When RackTrack cannot get a definitive answer for your exact model, it falls back to a **general catalogue**, and a general suggestion may not be the right brand for your particular switch.

It also suggests **direct-attach cables** (DACs), which replace the transceiver-and-fibre pair entirely for short runs inside a rack and are usually the cheaper choice for connecting two nearby switches.


![Choose the right SFP module](../screenshots/iPhone/switch-optics.png)
*A top pick, alternatives, and direct-attach cables.*

### 22. See the rack as a diagram
*Everyone*

Sometimes a clean diagram beats a photo. **2D** draws the rack as an elevation — a numbered column of U slots, just like the drawing taped inside the cabinet door. **3D** puts the same rack into space, so you can drag to orbit around it and scroll to zoom.

1. Click any device and the panel below fills in with its details.
2. **Peer chips** show its neighbours — `2×` means two separate cables run to that neighbour.
3. The **Ports** table lists every port on the device: whether it is connected, which cable is in it, and what is on the other end.

The colours are consistent across the diagram:

| Colour | Meaning |
|---|---|
| Green | A connected RJ45 (copper) port. |
| Cyan | An SFP (fibre) port. |
| Amber | An uplink — traffic leaving this rack. |
| Grey | Free. |

> **NOTE** — The diagram is drawn in the background just after a scan finishes, so it can lag by a few seconds behind the rest of the result. If you see **“Topology is being prepared”**, wait a moment and tap **Retry** — it is building, not broken.


![See the rack as a diagram](../screenshots/iPhone/topology.png)
*Every device drawn where it physically sits, with its cables.*

### 23. See what the network says about the rack
*Needs Netdisco*

The scan tells you what is *physically* in the rack. This view tells you what is *electrically alive*: which ports are genuinely up right now, which VLAN each one is on, and how many devices are talking through each.

1. Open the rack → **Network**.
2. Check the pill at the top right reads **Network View online** — that confirms the network source is answering.
3. Click a device that shows an IP address. Devices marked *not in Network View* cannot be opened, because the network has no record of them.
4. Filter a device's ports with **Live**, **Up**, **Down** or **All**.

> **NOTE** — **Patch panels never appear here.** A passive panel has no electronics and so cannot announce itself to the network. Its absence is expected and correct, not a fault.

> **IMPORTANT** — This view needs a **Netdisco** server, set up by an administrator. Without one, the page shows *“Network view is being prepared”* forever — and in that case the message means “not configured”, not “try again shortly”. If you never see it come online, ask your administrator whether Netdisco is set up.


![See what the network says about the rack](../screenshots/iPhone/netdisco.png)
*Devices the live network recognises. Two here are “not in Network View”.*

### 24. Find out what changed, and when
*Needs a monitored switch*

For a switch RackTrack watches continuously, a background job logs in **on a schedule** and records the state of every port. **Drift** is the record of what changed between one reading and the next — the gap between how the rack was left and how it is now. Because it only writes down real changes, you see the moments that mattered instead of a wall of identical readings.

1. Open **Drift**. The switch appears at the top with a **Streaming / Paused** status and a live dot, alongside its model, serial and firmware.
2. Click the port you care about in the interface grid (each cell is coloured by that port's current state; disabled ports are dimmed).
3. Open the **Specs** tab for the port's current values — operational state, admin state, speed, duplex, flow control, medium and description.
4. Open the **Timeline** tab and pick a window — **1 hour, 3 hours, 12 hours, 1 day or 1 week**. Each tracked value is drawn as coloured segments across time, so a change shows up as a visible seam. This is how you tell a one-off outage from a port that has been flapping for a fortnight.
5. Open the **History** tab for the plain-English change log and a “what was this value an hour / a day / a week ago” table.
6. Need a reading right now? Tap **Poll now** to trigger an immediate check instead of waiting for the next scheduled pass.

| Change | What it usually means |
|---|---|
| **Link went down / came up** | Something was plugged in, unplugged, or failed. |
| **Port administratively disabled** | A person, or a config push, deliberately shut the port. |
| **Speed changed 1 Gbps → 100 Mbps** | Negotiation dropped — very often a damaged cable or a dying optic. |
| **LLDP neighbour changed: X → Y** | **The important one.** The cable now goes to a *different device* — somebody re-patched it. |

Neighbour changes are given their own colour on the timeline, so a re-cable jumps out as a colour change without you having to read a single word.

> **TIP** — A silent **LLDP neighbour changed** is the classic cause of “but it worked yesterday”. If a service broke overnight and nobody admits to touching anything, look here first — the switch remembers the re-patch even when the person who did it does not mention it.

> **IMPORTANT** — Drift must be set up on the server by an administrator, and today it works with **TP-Link** switches. A brand-new monitored switch looks sparse at first because the history is built up over several polling passes — that is expected, not broken. If it is stuck on **“Waiting for first poll…”**, no switch is being monitored yet; ask an administrator to set one up.


![Find out what changed, and when](../screenshots/iPhone/drift-detail.png)
*One port opened up: its state, its timeline, its change history.*


---

## Looking things up

### 25. Look up a datasheet
*Everyone · no scan needed*

You do not need a scan, or even a rack, to look up the specifications of a piece of equipment.

1. Open **Specifications**.
2. Type the **Make / Vendor** and the **Model**.
3. Tap **Get specifications**.

> **TIP** — As you type the vendor, pick it from the suggestions rather than typing the whole name freehand. Choosing from the list guarantees the name exactly matches the one RackTrack searches under, which gives you a cleaner result.

You get back the port count, throughput, PoE support, power draw and form factor, along with a link to the vendor's product page so you can read the full datasheet.


![Look up a datasheet](../screenshots/iPhone/specs-result.png)
*Pulled from the vendor's own product page.*

### 26. Check any firmware version
*Everyone · no scan needed*

This is the standalone version of the firmware check — use it to check any make, model and version without scanning anything. Like the switch firmware tab, it is a *currency* check: it tells you how your version compares to the latest the vendor ships, and nothing more.

1. Open **Firmware Check**.
2. Type the **make** (suggestions appear as you type), the **model**, and the **current version** you are running — for example `16.12.1` or `22.4R3`.
3. Tap **Check firmware**. The button reads “Checking…” while it works.

You get a single coloured headline that is the whole answer at a glance:

- **“You're up to date.”** (green) — you are on the newest version the vendor ships.
- **“An upgrade is available.”** (amber) — there is a newer version.
- **“We couldn't confirm the latest version.”** (neutral grey) — RackTrack could not read the vendor's latest version this time. This is *not* the same as a green all-clear.

Open **Show details** for the version-status card: your current version next to the latest detected, a status pill, and a **source** link straight to the vendor page the answer came from. If the latest could not be confirmed, ready-made search links give you a one-click path to go and find it yourself.

> **NOTE** — RackTrack reads the **real** latest version from the vendor's own site and never invents one. It is a currency check only — it does **not** list specific vulnerabilities, does not flag end-of-life, and does not show a changelog of what changed between versions. When a vendor's page needs a login or blocks automated reading, RackTrack hands you the real vendor link to check yourself rather than pretending it knows. For actual release notes, follow the link to the vendor's page.


![Check any firmware version](../screenshots/iPhone/firmware-result.png)
*The headline is the answer; the detail sits behind **Show details**.*


---

## Your account

### 27. Reopen a scan you did earlier
*Everyone*

**Profile** holds your account details, and — the real reason you will open it — your **Recent Scans**.

1. Open **Profile**.
2. Scroll to **Recent Scans**. Every rack you have scanned is listed here, newest first, each showing its ID, how many devices and units it found, and how long ago you scanned it.
3. Tap any one to reopen the full result exactly as it was, corrections and all. **Show all** reveals the older ones further down the list.

> **TIP** — This is the way back to a rack you scanned last week or last month. The rack links in the navigation only ever remember your **current** rack and are cleared when you start a new scan — so Recent Scans is the permanent history, and the navigation is just a shortcut to whatever you are working on now.

> **NOTE** — What you see here depends on your role. Members see their own scans. Administrators see every scan across the whole organization.


![Reopen a scan you did earlier](../screenshots/iPhone/profile.png)
*Recent Scans — newest first.*


---

## For administrators

### 28. Connect your CMDB
*Administrators only*

Tell RackTrack where your equipment records live, so it can compare what it sees in a rack against what you believe is in that rack. This is done on the **Data Sources** screen.

1. Open **Data Sources** — you will find it in the menu (it is visible to owners and organization admins only).
2. Tap **Add connection**.
3. Give it a **Name** you will recognise (for example “My ServiceNow Dev”), choose the **Type** of system, and fill in the sign-in details.
4. Tap **Save & use**. The connection is stored and becomes your active source right away.

| System | What you need |
|---|---|
| **ServiceNow / CMDB** | Your instance ID (the part before `.service-now.com`), a username, a password. |
| **NetBox** | The base URL, and an API token from your NetBox profile. |
| **SolarWinds Orion** | The host, a username, a password. |
| **CA / DX Spectrum** | The base URL, a username, a password. |
| **Your own SQL database** | A PostgreSQL or MySQL connection string. |
| **Your own REST API** | A base URL, and a token if it needs one. |

> **NOTE** — There is **no “Test connection” button — saving is the test.** Watch the message that appears right after you save. If the credentials are wrong, that is where RackTrack tells you.

> **IMPORTANT** — **Only one connection is active at a time**, and every screen reads from that one active source. Switching the active connection switches the source of *all* your data at once — RackTrack does not merge two systems together. This makes it easy to keep, say, a “Dev” and a “Prod” connection saved and flip between them, but it means there is only ever one source of truth at any moment.

> **NOTE** — Credentials are stored encrypted and are **never shown to you again** — not even masked. When you edit a connection the fields open **empty**; leave a field empty to keep the saved value, or type a new value to replace it. That is also the clean way to rotate a password.

> **TIP** — For a ServiceNow source, an active connection shows a **Refresh data from this source** button that pulls the latest incidents on demand. And separately from these personal connections, an organization admin can set one shared credential per system for the whole organization in the admin console, so every member's scans reconcile against the same source without each person configuring it.


![Connect your CMDB](../screenshots/iPhone/connections-add.png)
*The fields change to match the system you pick.*

### 29. Add people to your team
*Administrators only*

RackTrack is arranged in three layers: an **Organization** (your company) contains **Sites** (your buildings), and each site contains **Members** (your people).

1. Open the console, find the Site row you want, and tap **Invite**.
2. Enter the person's email and pick their **Role** — `Member` or `Site Manager`.
3. Tap **Create invite link**, then **Copy**.
4. **Send them the link yourself**, by email or chat.

There are two ways to bring someone in:

| Method | How it works | Use it when |
|---|---|---|
| **Invite** | RackTrack generates a link; the person sets their own username and password. | The normal case — nobody has to share a password. |
| **+ Add member** | You set their username and password yourself and hand them over. | A shared or contractor account, or someone with no reachable email. |

> **IMPORTANT** — **RackTrack does not send the invitation for you.** If you do not copy the link and send it, nothing reaches the person. Each link works **once** and expires after **seven days**.

> **NOTE** — The console doubles as a filter. Click any person to narrow the scans grid to just their work, or click a site to narrow it to that site.


![Add people to your team](../screenshots/iPhone/organizations.png)
*People, sites and scans in one console.*

### 30. Approve a new organization
*Platform owner only*

When a new company signs up, it appears under **Pending approvals** and **cannot use the app until you act**.

| Button | What happens |
|---|---|
| **Approve** | They get in immediately — their waiting screen lets them through on its own. |
| **Reject** | They are told the request was not approved, but their account survives. |
| **Remove** | The organization and all its people, sites and invitations are **deleted permanently**. |

> **IMPORTANT** — **Remove cannot be undone.** **Reject** is the reversible choice — use it unless you are absolutely certain you want the organization gone for good.

> **NOTE** — **Nobody emails you about a pending signup.** You only find out by opening this console and looking, so make a habit of checking it — a new customer could be sitting on the waiting screen right now.

### 31. Sell surplus gear
*Administrators only*

1. Open **Marketplace** and tap **+ Sell something**.
2. Type the **Vendor** and **Model** — the listing title fills itself in.
3. Choose a **Category** and **Condition**.
4. Set a **Price**, or leave it blank so buyers see *Make an offer*.
5. Upload a photo (JPG, PNG or WebP, up to 8 MB) and wait for **Photo ready**.
6. Tap **Publish listing**.

> **NOTE** — There is no checkout and no messaging inside RackTrack. A buyer contacts you through your username, and the two of you agree price and shipping between yourselves.

> **TIP** — Use **Post a want** for equipment you are **looking for**, so colleagues sitting on decommissioned kit can find you.


![Sell surplus gear](../screenshots/iPhone/marketplace-new.png)
*Creating a listing.*

### 32. Verify what the model detected (Ground Truth)
*Platform owner only — for now*

RackTrack's model looks at a rack photo and makes a best guess about each device — “that's a switch”, “that's a patch panel”. It is right most of the time, but not always, and the tricky part is that the app cannot see *which* of its own guesses are wrong. **Ground Truth** fixes that by asking a real person who knows the kit. You confirm the guesses that are right and correct the ones that are wrong, and every answer either builds confidence in the model or becomes a training example that makes it smarter. In short, it turns “we think” into “we know”.

It has two ways to work: a fast **Worklist** that hands you devices one at a time, and a **Browse** view for going through a whole scan.

**Using the Worklist (the fast way):**

1. Open **Ground Truth** from the menu and stay on the **Worklist** tab.
2. A strip along the top shows your progress: how many devices still need checking, how many you have done, and the model's current accuracy.
3. One device is shown at a time — a tight close-up of the real device cut from the photo, the model's guess (for example “Patch Panel”), and a colour-coded confidence chip (green is high, amber medium, red low).
4. If the guess is right, press **Correct** to confirm it. If it is wrong, press **Not this**, choose the real device type from the list, and press **Save truth**.
5. The card automatically advances to the next device — always the one the model was *least* sure about — so your time goes where the model is weakest, not on the devices it already nails.
6. When you have cleared the batch, load the next one or switch to Browse.

**Using Browse (going through a whole rack):**

1. Switch to the **Browse scans** tab.
2. Pick any scan from the grid. Each card shows a thumbnail and a small progress bar of how much of that rack has already been verified.
3. Inside a scan you see the rack image and a row for each device. Confirm or correct any of them right there. A device you have already ruled on shows a **Confirmed** (green) or **Corrected → Router** (red) badge, with a **Change** link if you need to revisit it.

> **NOTE** — Saving a truth here goes through the very same correction path as fixing a device on the results screen, so a truth given in Ground Truth behaves exactly like a correction given anywhere else: it updates the stored scan, records a permanent training example with the image, and feeds the model. Devices the model could not classify at all sit right at the front of the queue, so a human can put a name to them.

> **IMPORTANT** — Ground Truth is **owner-only for now**, while the feature is being proven out. It is built so it can be opened up to any technician later — at which point a member would simply see and verify their own site's scans — but today it is limited to the platform owner.


---

## Reference

### Where each screen gets its data

Some screens read your photo, some read the live network, one is owner-only training, and one is a demonstration with invented data. Knowing which is which saves you from acting on the wrong thing.

| Screen | Source | Needs setting up? |
|---|---|---|
| Scan · Overview · Find a port | **Your photo**, analysed by RackTrack. | No |
| Topology · 3D views | **Your photo** — the devices and cables it found. | No |
| Switches · Firmware · Specifications | **Your photo** for the model, then the **vendor's own public site** for specs and the latest firmware version. | No |
| Ports (live switch) | **The switch itself**, over SSH, right now. | Yes — switch credentials |
| Drift / Port history | **The switch itself**, polled by a background job **on a schedule** (about once an hour by default). | Yes — a monitored switch (TP-Link) |
| Network view | **Netdisco**, your network discovery server. | Yes — a Netdisco server |
| CMDB registration | **Your configuration database**, chosen on the Data Sources screen. | Yes — a connected CMDB |
| Ground Truth | **The model's own detections** plus a human's verified answer. | No — but owner-only for now |
| Marketplace | RackTrack's own records. Real listings. | No |
| `/demo/topology` | **A demonstration.** The racks, devices and IPs on that page are **invented** to show what an estate-wide view looks like. | No — but it is not your data |

### Troubleshooting — find your symptom

#### Getting in

| Symptom | Cause | Fix |
|---|---|---|
| Stuck on **Waiting for approval** | Your organization is not approved yet. | Tell the platform owner directly — they are not emailed about it. |
| You see `rate_limited` | Too many attempts in a minute. | Wait 60 seconds. |
| “This account has been deactivated.” | An administrator switched you off. | Contact your administrator. |
| The six-digit code does not work | It expired — codes last **one minute**. | Tap **Resend** and use the new one at once. |
| Your invitation link fails | It has been used, or is over seven days old. | Ask for a fresh invitation. |

#### Scanning

| Symptom | Cause | Fix |
|---|---|---|
| Tapping **SCAN** does not take the photo | The three quality checks have not all passed. | Read the hint under the guide box and fix the one thing it names. |
| No shutter button on a big screen | The shutter is the bottom **SCAN** tab, which does not exist on a large screen. | Use **Upload** on a tablet or computer. |
| Devices missing from the result | Photographed at an angle, or cables hide them. | Retake square-on; add side photos. |
| The rack came back empty | A bad photo was pushed through with **Proceed anyway**. | Rescan properly. |
| Progress sits at 88% | Normal — the bar is an estimate, not a measurement. | Wait. |

#### The live switch screens

| Symptom | Cause | Fix |
|---|---|---|
| “The switch didn't respond” | You are not on the same network as the switch. | Get off guest Wi-Fi and onto the right network. |
| “Lost the SSH session” | Most switches allow one session at a time and someone (or a background read) has it. | Tap **Retry** in a moment. |
| Network view never loads | No Netdisco server is configured. | Ask an administrator. It will never load without one. |
| Drift says “Waiting for first poll…” forever | No switch is being monitored. | Ask an administrator to set one up. |
| Drift looks sparse on a new switch | History builds up over several scheduled polls. | Give it time, or tap **Poll now** to add a reading. |
| A free-looking port says **Reserved** | It has a description, so somebody has claimed it. | Check with the switch's owner before taking it. |

#### Data that looks wrong

| Symptom | Cause | Fix |
|---|---|---|
| A switch shows **Not detected** | The label was unreadable in the photo. | Type the make and model in yourself. |
| “Couldn't confirm the latest version” | RackTrack could not read the vendor's newest version. **This is not “you are current”.** | Follow the vendor link and check the version yourself. |
| A cable seems to skip a patch panel | Passive panels are invisible to the switch. Physics, not a bug. | Nothing to fix. |
| The make/model you typed vanished | It was saved in that browser only. | Re-enter it. It does not travel between devices. |

### Glossary

| Term | Plain meaning |
|---|---|
| **U / rack unit** | The standard height slot in a rack. A 42U rack has 42 slots. |
| **CMDB** | Your official record of what equipment you own and where it is. |
| **Data Sources** | The screen where you connect RackTrack to your CMDB and other systems, and choose which one is active. |
| **Drift** | The gap between what your records say and what is actually there — or what changed on a port since RackTrack last looked. |
| **Ground Truth** | The confirmed, human-verified identity of a device — the “truth” used to measure and improve the model. Owner-only for now. |
| **LLDP** | How a device announces itself to its neighbours. It is how RackTrack knows what is on the far end of a cable. |
| **MAC address** | The unique hardware address of a network card. Seeing one on a port means something is alive there. |
| **SFP / SFP+ / QSFP** | Slots that take a plug-in transceiver, usually for fibre. SFP+ is 10G; QSFP is faster. |
| **DAC** | Direct-attach cable — transceivers built into both ends. Cheaper than optics for short runs. |
| **Firmware currency** | Whether a device is on the newest firmware the vendor ships. RackTrack checks currency only — not vulnerabilities or end-of-life. |
| **PoE** | The switch powering a device through the same cable that carries its data. |
| **VLAN** | A logical network. Two devices on one switch but different VLANs cannot talk directly. |
| **Uplink** | The port carrying traffic out of this switch to the rest of the network. |

### Limits and timings

| Thing | Limit |
|---|---|
| Photo or video upload size | 340 MB per file |
| Photos in a **MULTI** stitch | 2 to 8 |
| Video length | 1 to 120 seconds |
| Scans per minute | 20 |
| Sign-up and password-reset codes | Expire after **1 minute** |
| Invitation links | Single use · expire after **7 days** |
| How long you stay signed in | 30 days |
| How often drift polls the switch | On a schedule — about **once an hour** by default |
| Manual **Poll now** presses | 5 per minute |
| Marketplace photo | JPG, PNG or WebP · up to 8 MB |
