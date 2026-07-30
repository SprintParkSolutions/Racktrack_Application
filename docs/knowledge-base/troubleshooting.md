# Troubleshooting & Common Messages

*Every warning, error and coaching message RackTrack can show you — what it means in plain words, why it happened, and exactly what to do next.*

Reference · All users · Last verified: 26 July 2026 against the live code.

---

## 1. In simple terms

RackTrack turns a photo of a server rack into a labelled map of what is inside it, and then lets you dig into individual switches and ports. Because it leans on a camera, a photo model, and (for live switches) a network connection, there are a handful of places where it will stop and tell you something. Almost every message you will ever see falls into one of six buckets:

1. **Scanning problems** — the photo or video you fed in is too blurry, too dark, tilted, taken from the side or the back, buried under cables, or simply is not a rack.
2. **Results problems** — the scan finished but RackTrack could not read something it needs, such as how many ports a device has, or which make and model a switch is.
3. **Sign-in problems** — you cannot log in on the phone app even though the website works, or you were signed out on your own.
4. **Live-switch problems** — a switch you are auditing over the network is offline, or some of its columns are blank.
5. **App and update problems** — you cannot find RackTrack in the App Store or Play Store, or it will not update.
6. **Everything else** — the atomic question-and-answer list at the end, phrased the way people actually type them.

A few ground rules that make the rest of this document make sense:

- **RackTrack rarely blames you without saying why.** Where a message can name the actual problem (tilt, side angle, cables, framing), it does. A bland "try a clearer photo" message is now reserved for genuinely unreadable images, and true server-side failures say plainly that the fault was *ours*, not your photograph.
- **Retryable warnings give you a choice.** When a scan is stopped by a *quality* problem, you are offered **Retake** and **Proceed anyway**. Proceeding is always allowed — RackTrack will accept whatever the photo produces, even if that is a thin or empty result.
- **Two layers of checking.** Your phone runs some quick checks on the photo *before* it is uploaded (resolution, blur), and the server runs deeper checks *after* (tilt, side angle, cables, framing, "is this even a rack"). That is why the exact wording differs depending on which check caught the problem.

---

## 2. Scanning problems

### 2.1 The live camera quality gate (photo mode)

When you open the in-app camera in **Photo** mode, RackTrack watches the live picture about three times a second and decides whether the shot is good enough. The shutter button stays **disabled** until three checks all pass:

- **Sharp** — the picture is in focus (not motion-blurred).
- **Framed** — enough rack detail fills the guide, i.e. the rack is close enough.
- **Lit** — the scene is neither too dark nor blown out with light.

While it is deciding, the hint line under the guide box tells you the *one* thing to fix, in this order:

| What you see on the hint line | What it means | What to do |
|---|---|---|
| **Starting camera…** | The camera has not finished turning on yet. | Wait a second. If it never changes, see 2.4 (black screen). |
| **Move closer so the rack fills the frame** | Not enough rack detail in view — you are too far back or aimed at a blank surface. | Step closer, or aim at the device faces, until the rack fills the guide. |
| **Move to better lighting** | Too dark or too bright. | Turn on the aisle light, or move out of glare. |
| **Hold steady — keep still for focus** | The picture is not sharp — usually hand shake. | Brace your arms, hold still for a moment, let it focus. |
| **Align full rack within the frame** | The three checks are on the edge of passing. | Line the whole rack up inside the corner brackets. |
| **Looks great — tap the shutter below** | All three checks passed. | Tap the shutter — the corner brackets turn green. |

The corner brackets are a readiness light: they turn **green** when everything passes (photo mode) and **red** while a video is recording. In **Video** mode the gate does not apply — you can start recording as soon as the camera is ready.

### 2.2 Photos rejected before upload (your phone's own checks)

Before a photo or video leaves your phone, RackTrack runs a fast local check. If it fails, you get a **Retake / Proceed anyway** choice with one of these messages:

- **"The image looks blurry. Results may be inaccurate."** — the photo is out of focus. Retake holding the phone still; or Proceed if you know the shot is fine.
- **"Image resolution is low (W×H). Results may be inaccurate."** — the picture is smaller than 480 pixels on its short side. This mostly happens with heavily cropped or downscaled images pulled from chat apps. Use the original photo.
- **"Video resolution is low (W×H). Results may be inaccurate."** — same idea for a video clip.
- **"Video is too short (Ns). Record at least 1.0s panning across the racks."** — the clip is under a second.
- **"Video is too long (Ns). Keep the multi-rack pan under 120s."** — the clip is over two minutes; trim it or re-record a shorter pan.
- **"Unsupported file type. Upload an image or video."** — the file you picked is not a photo or a video at all.
- **"No file selected."** — nothing was picked.

Two important "fail-open" behaviours here, so you are not surprised:

- **HEIC / HEIF photos (the iPhone default) are not checked on the phone.** Most phone browsers cannot open a HEIC file in the page, so RackTrack skips the local checks and lets the *server* normalise and validate it. A HEIC photo will never be rejected locally for blur or resolution — any problem with it surfaces after upload instead.
- **A full-resolution phone photo that the phone browser cannot open is also passed straight through** to the server rather than being blocked. RackTrack does not reject a photo just for being large or high-resolution — the upload cap is very high (hundreds of megabytes), so a normal photo is never "too big". If a huge or odd image really is unreadable, it fails *on the server* with "That image could not be read." (see 2.5), not locally.

### 2.3 Server-side quality checks (after upload)

Once the photo reaches the server, deeper checks run. These also come back as **Retake / Proceed anyway** choices:

- **"The image appears tilted. Please hold the phone straight and retake."** — the rack lines are noticeably rotated. Hold the phone level and square to the rack.
- **"The image appears to be taken from a side angle. Results may not be accurate."** — this is a *soft warning*, not a hard stop; the scan still runs. Stand square-on to the rack for a cleaner result.
- **"This rack is heavily covered by cables — … . For better accuracy, take additional photos from the left and right sides of the rack so we can see behind the cable bundles, or proceed with this image (results may miss devices)."** — so many cables are in front of the equipment that devices are hidden. Either shoot extra angles, or Proceed knowing some devices may be missed. (A milder version appears as a non-blocking note: *"Cables cover much of the rack — some devices behind cable bundles may not be detected. Side-angle photos would improve accuracy."*)
- **"Please upload a clearer photo of the rack — keep the camera steady and make sure the full rack fits in the frame."** — the framing check found dark bands (letterboxing) top and bottom, i.e. the rack does not fill the frame, or the image could not be read at all. Fill the frame with the rack.

### 2.4 "This doesn't look like a server rack"

Full message:

> **This doesn't look like a server rack. Point the camera at the front of a rack so its devices and ports are visible.**

Before running the full (slower) analysis, RackTrack does a one-second pre-check: does the photo contain *any* rack equipment at all? If it finds nothing rack-shaped, it stops immediately with this message rather than making you wait through a spinner that returns nothing.

It is **not** a judgement that your rack is wrong — it means nothing rack-like was found in *that frame*. The usual causes:

- The photo is of the **back or side** of the rack, not the front faces.
- The rack **door is closed**, or the front is completely hidden behind cable bundles.
- You are **too far away** for individual device faces to be made out.
- The rack is **largely empty**, so there are no device faces to find.

Fix: shoot the **front** of the rack, close enough that individual devices and their ports are visible, with the whole rack in frame and the camera level with its middle. This pre-check is **skipped entirely** if you used **Proceed anyway** on an earlier quality warning — in that case the photo goes through and you may get an empty or thin result instead of this message.

### 2.5 Other post-upload rejections

- **"Please take the photo from the front of the rack — we need to see the devices and ports face-on."** — the analysis ran all the way through but found **zero devices**. Same root cause as "doesn't look like a server rack", just caught later. Open the front door, stand square-on, reshoot.
- **"Only N rack units could be made out in that photo. Move back so the whole rack fits in the frame, or get closer if the rack is small — we need to see at least three units to map it."** — devices were found, but fewer than three rack units, so only a sliver of the rack is in shot. Step back until the whole cabinet fits.
- **"That image could not be read. Try a JPG or PNG taken straight from the camera."** — the file itself was corrupt, an unsupported format, or otherwise unreadable. Use an original JPG or PNG.
- **"Something went wrong on our side analysing that photo — it is not a problem with your image. It has been logged; please try again."** — this one is explicitly **not your fault**. A worker crashed, timed out, or hit a bug. Retaking a clear photo will not help; just try again, and if it keeps happening, report it.

### 2.6 "Camera access denied" and the black screen

If RackTrack cannot open the camera, the whole camera view is replaced by an error card reading:

> **Camera access denied. Allow camera permission or use Upload.**

This means the operating system refused the camera — permission was denied, or is off for RackTrack. Fix it in your phone settings (allow Camera for RackTrack), or sidestep it entirely by using the **Upload** tab to pick a photo from your gallery.

A **black screen with no error** is different. If the hint line is stuck on **"Starting camera…"** and the picture never appears, the camera was granted but never actually started streaming — most often because **another app is still holding the camera** (a video call, another camera app), or the app was backgrounded while the permission dialog was open. Close other camera apps, then reopen the RackTrack camera. As a fallback, **Upload** never needs the camera at all.

Two more camera messages you can hit in **Video** mode:

- **"Video recording is not supported in this browser. Use Upload instead."**
- **"Could not start video recording on this device."**

Both mean this particular phone/browser cannot record in-app. Record with your normal camera app and bring the clip in through **Upload**.

### 2.7 If the upload itself drops

A rack photo is several megabytes over a phone connection, and a single blip can kill the send. RackTrack retries once on its own — you will briefly see **"Connection dropped — retrying…"**. If the retry also fails, you get:

> **Upload failed — the connection dropped while sending the photo. Check your signal and try again.**

Move somewhere with better signal and retry. The retry is safe and will not create a duplicate scan.

---

## 3. Results problems

### 3.1 "We couldn't read how many ports this device has"

Full message, shown when you try to pick a port on a device:

> **We couldn't read how many ports this device has. Set the port count below, then pick a port.**

RackTrack knows *this is a switch/patch panel* but never got a reliable count of its ports from the photo — so it has no upper limit to check your chosen port number against. Rather than silently accept "port 34" on what might be a 24-port switch, it stops and asks you to set the real count first.

**What to do:** use the port-count control right below the message to enter the true number of ports (count them on the chassis), then pick your port. Once you set it, port numbering lines up exactly with the physical device.

Two related port messages:

- **"This device has N ports — enter a number between 1 and N."** — you asked for a port higher than the device actually has.
- **"Enter a valid whole port number"** — you typed something that is not a plain whole number (no decimals, no letters).

### 3.2 "We couldn't identify this device from the rack photo"

On the **Switches** tab, expand a device. Under the **Identification** heading you may see a **"Not detected"** chip and the line:

> **We couldn't identify this device from the rack photo.**

RackTrack reads a switch's make and model off the label in your photo. A device shot at an angle, in shadow, with its label hidden behind cables, or with no printed model on the front, comes back blank — and without a make and model, the specifications and firmware checks have nothing to work with.

**What to do — type it in yourself:**

1. On the **Switches** tab, expand the device (its title reads **"Unidentified device"** when nothing was read).
2. Tap **"Enter make / model"** to the right of the **Identification** heading.
3. Fill in **Make / Vendor** and **Model** — both are required, so **Save** stays greyed out until both are filled. Type the model exactly as printed on the chassis, hyphens and `+` signs included.
4. Tap **Save**. RackTrack re-runs the spec lookup with your values and the chip changes to **"Manual entry"**. The firmware check re-runs too, provided RackTrack already knows the device's OS version.

If only *one* of the two fields came back blank, you will instead see one of:

- **"We identified \"<vendor>\" but couldn't read the model. Specs and firmware checks need both."** — the button reads **"Add model"**.
- **"We read a model but couldn't identify the vendor."** — the button reads **"Add vendor"**.

To undo a manual entry, tap **Edit** to correct it or **Clear** to go back to whatever the photo produced.

### 3.3 "Why are there no ports?" / "No components detected"

If the **All Components** view shows **"No components detected."**, the scan produced nothing to inspect — the same underlying problem as sections 2.4–2.5 (rear shot, side-on, too dark, door closed, too far away). Reshoot the front of the rack, square-on, with the whole cabinet in frame.

If a *single device* shows a dash (**—**) where its port count should be, that is the "couldn't read how many ports" case from 3.1 — set the count by hand.

---

## 4. Sign-in problems

### 4.1 "I can't sign in on the app, but the website works"

This is the single most common sign-in complaint, and it is almost never your password. The installed phone app has the **RackTrack server address baked in at build time**. If that address has changed since your copy of the app was built, the app is calling a server that no longer exists — so sign-in can never succeed, no matter how correct your details are.

How to recognise it:

- Sign-in fails **instantly** with a network-style message like **"Load failed"** or **"Failed to fetch"** — never "Invalid username or password".
- The **same account signs in fine in a normal browser** pointed at the current address.
- **Everyone** on that app build fails; nobody using the browser does.
- It worked yesterday and broke today with no change to your account (typical after the server restarted onto a new temporary address).

What to do:

1. Ask your administrator for the **current** RackTrack address and open it in your phone browser as a stopgap.
2. The real fix is a **new app build** with the current address — Android testers get it as a Firebase App Distribution update, iOS testers via TestFlight.
3. **Do not** uninstall and reinstall the old build; it has the same dead address baked in.

(RackTrack does try to self-heal one narrow version of this: if a build was accidentally pointed at `localhost` but is being served from a real web address, the web app quietly falls back to talking to whatever host is serving it. That safety net only covers the browser, not the packaged app.)

### 4.2 "I was signed out unexpectedly"

If any request comes back saying your token is no longer valid, RackTrack clears your session and bounces you to the login screen rather than leaving you on a silently-broken page. This is deliberate. Just sign in again. It typically means your login simply expired (sessions last about 30 days), or you signed out on another device.

### 4.3 "The app opens but the scan images are broken/blank"

The pictures in your scans are loaded with a short-lived access token that lasts about **12 hours**, while your login lasts about **30 days**. If you leave the app resident and come back the next day, the login is still fine (so menus and data work) but the image token has expired — which shows up as **scan images that stopped loading** while everything else works. RackTrack re-mints that token automatically when the app returns to the foreground; if images are stuck, fully close and reopen the app to force it.

---

## 5. Live-switch problems

These apply to the live audit views (the Ports/Switch views over the network, and the owner-only **Lab** page).

### 5.1 "The switch shows Offline"

On the Lab page a switch that stops answering shows a banner:

> **Offline — the switch isn't answering (N failed attempts).** It's likely stopped or unreachable; polling recovers on its own once it's back.

The status pill can read one of five things:

- **Live** — a poll has succeeded and data is fresh.
- **Offline** — the last poll failed (the switch is not answering).
- **No data** — enabled, no failures recorded, but a poll has never succeeded (often missing credentials).
- **Disabled** — polling is turned off for this device (**"Polling disabled. The poller skips this device entirely, so its data goes stale and no drift is recorded. Enable it to resume."**).
- **Connecting…** — an audit is running right now.

For the lab switches specifically, RackTrack translates the raw network error into plain guidance:

- **"The switch isn't answering on SSH at all."** — most likely the (virtual EVE-NG) node is stopped, or rebooted and came back without its config. Start the node and re-apply its config; polling recovers by itself.
- **"The switch is up, but nothing is listening on SSH."** — the node is running but its SSH server is not; re-apply the switch config.
- **"No network route to the switch."** — the node has no management IP.
- **"Reached the switch, but the login was rejected."** — the stored username/password does not match the switch's account; fix the credentials.

If an audit fails while older data is on screen, you get **"Last audit failed. <reason> — showing the previous result below."** — RackTrack never throws away the last good result just because a refresh failed; it annotates it and keeps showing it, stamped with how old it is.

### 5.2 "Why are the LINK, SPEED and PoE columns empty?"

The live ports table has these columns: **Port · Link · Admin · Speed · Duplex · Type · PoE (W) · Neighbour**. A blank cell always shows as a dash (**—**), which means *"no value"*, not *"error"*.

On **routed or virtual switches, an empty Speed / Duplex / PoE column is the correct, truthful answer, not a bug.** The lab switches are Cisco IOL — a *virtual* switch. It never negotiates a physical link and has no PoE hardware, so Speed, Duplex and PoE genuinely read **—**. A real physical switch (for example the TP-Link) fills those columns in. So:

- **Speed / Duplex / PoE blank** → the device has no such physical hardware (virtual or routed switch). Expected.
- **A routed (Layer-3) switch** also legitimately shows **no VLANs**: *"None. Expected on CoreSW — it runs the L3 IOL image, where interfaces are routed and there are no switchports to put in a VLAN."*
- **No LLDP neighbours** on such a switch: *"None. IOS needs `lldp run` globally, and the IOL l2-ipbase image may not support LLDP at all — Cisco defaults to CDP."*

In short: on virtual/routed gear, blank columns are the switch honestly reporting that it has nothing to show, not RackTrack failing to read it.

### 5.3 The port report verdict (when a port shows no device)

When you run a port report, the one-line verdict tells you what is on the port. Two of these read like problems but are just facts:

- **"Link is DOWN — no device connected (or cable unplugged at the far end)."** — nothing is plugged in, or the far end is unplugged.
- **"Link is UP but no MAC learned yet and no LLDP neighbour — device is silent."** — something is connected but has not spoken yet.

---

## 6. App and update problems

### 6.1 "It's not in the App Store / Play Store"

RackTrack is a **beta** and is **not on the public App Store or Play Store**. It is distributed directly to testers:

- **iPhone / iPad** — through Apple's **TestFlight** app. Install TestFlight from the App Store first, then open your Apple invitation email *on the phone* and tap **View in TestFlight** (or **Redeem** a code by hand). The invite is matched to the Apple ID email it was sent to, so if TestFlight cannot find your invitation, you are probably signed into a different Apple ID than the one the invite went to — ask your administrator to re-issue it to the right address.
- **Android** — as an **APK** (often via Firebase App Distribution). Install the file your team sends you.

### 6.2 "The app won't update"

Because RackTrack is not on the stores, it does **not** update through them.

- **iPhone:** updates come through **TestFlight**. Do this once: open TestFlight, tap RackTrack, and turn on **Automatic Updates** — new builds then install by themselves. By hand, open TestFlight and tap **Update** if a build is waiting. Note that **TestFlight builds expire after 90 days** (Apple's rule); when one lapses, RackTrack stops opening and TestFlight says the build has expired — nothing is lost, just install the current build.
- **Android:** install the newest APK your team distributes. If Android says **"App not installed"** when you try to install a new APK over the old one, it is a signing mismatch — uninstall the old RackTrack first, then install the new APK.

Reinstalling **does not lose your scans** — they live on the server, not on the phone. You just sign in again.

---

## 7. Common questions — answered the way people ask them

**"It says this doesn't look like a server rack."**
RackTrack found nothing rack-shaped in that frame. You are probably shooting the back or side, the door is shut, or you are too far away. Shoot the front, close enough to see device faces, whole rack in frame. Full message: *"This doesn't look like a server rack. Point the camera at the front of a rack so its devices and ports are visible."* See 2.4.

**"But it IS a rack — why does it say that?"**
The check judges one frame, not your rack. A closed door, a rear/side shot, an empty rack, or too much distance all read as "no rack here". Retake the front, square-on. See 2.4.

**"My photo isn't good enough."**
Depends which message you got. *"The image looks blurry"* → hold still and refocus. *"Image resolution is low"* → use the original, not a shrunken copy. *"The image appears tilted"* → hold the phone level. *"…side angle…"* → stand square-on. *"…heavily covered by cables…"* → shoot extra angles or Proceed anyway. See 2.2 and 2.3.

**"It says the image is blurry but it looks fine to me."**
Your phone measures focus, not what looks fine at thumbnail size. If you are sure, tap **Proceed anyway** — RackTrack will accept it. See 2.2.

**"Camera access denied."**
The phone refused the camera. Allow Camera permission for RackTrack in your phone settings, or use the **Upload** tab instead. Full message: *"Camera access denied. Allow camera permission or use Upload."* See 2.6.

**"I see a black screen."**
If the hint says **"Starting camera…"** and never changes, another app (a video call, another camera app) is probably holding the camera, or the app was backgrounded during the permission prompt. Close other camera apps and reopen; or use **Upload**. See 2.6.

**"The camera doesn't work."**
Two cases: a red *"Camera access denied"* card (fix permissions or use Upload), or a black screen stuck on *"Starting camera…"* (another app has the camera; reopen). Video-only errors like *"Video recording is not supported in this browser"* mean this phone can't record in-app — record normally and Upload the clip. See 2.6.

**"The shutter button is greyed out and I can't take the photo."**
In Photo mode the shutter unlocks only when the picture is Sharp, Framed and Lit. Read the hint line — it names the one thing to fix (move closer, better lighting, hold steady). When it says *"Looks great — tap the shutter below"* the button is live and the brackets turn green. See 2.1.

**"What does 'Move closer so the rack fills the frame' mean?"**
You are too far back (or aimed at a blank surface) for the camera to see enough rack detail. Step closer until the rack fills the guide. See 2.1.

**"It says 'Hold steady — keep still for focus.'"**
The live picture is not sharp, usually from hand shake. Brace your arms and hold still for a moment. See 2.1.

**"It says it couldn't read how many ports."**
RackTrack knows it's a switch but never got a port count from the photo, so it won't guess. Enter the real port count with the control below the message, then pick your port. Full message: *"We couldn't read how many ports this device has. Set the port count below, then pick a port."* See 3.1.

**"It says this device has N ports, enter a number between 1 and N."**
You picked a port number higher than the device has. Choose one within range. See 3.1.

**"Why are there no ports?"**
Either the whole scan found nothing (*"No components detected."* — reshoot the front, square-on), or one device's count could not be read (a dash **—**; set it by hand). See 3.3 and 3.1.

**"Why does it say couldn't identify this device?"**
RackTrack reads make/model off the label in the photo; an angled, shadowed, cable-hidden or unlabelled front comes back blank. Type the make and model in yourself via **Enter make / model** on the Switches tab. Full message: *"We couldn't identify this device from the rack photo."* See 3.2.

**"The switch card says 'Not detected' and there are no specs."**
Same as above — no make/model was read, so specs and firmware have nothing to look up. Tap **Enter make / model**, fill in both fields, Save. The chip changes to **"Manual entry"** and specs reload. See 3.2.

**"It found the vendor but not the model" (or vice versa).**
You'll see *"We identified \"<vendor>\" but couldn't read the model…"* with an **Add model** button, or *"We read a model but couldn't identify the vendor."* with **Add vendor**. Both need filling in for specs/firmware to work. See 3.2.

**"I can't sign in on the app."**
If it fails *instantly* with "Load failed" / "Failed to fetch" (not "invalid password") and the website works fine, your app build points at an old server address and needs rebuilding. Use the current address in a browser meanwhile; ask your admin for a fresh build. See 4.1.

**"Sign-in works in my browser but not the app."**
Exactly the case above — the app has an out-of-date server address baked in. A new build fixes it; reinstalling the old one does not. See 4.1.

**"I got signed out on my own."**
Your session expired or was ended elsewhere, so RackTrack sent you back to login rather than leaving a broken page. Just sign in again. Sessions last about 30 days. See 4.2.

**"My scan images are broken / blank but the app otherwise works."**
The 12-hour image access token expired while your 30-day login stayed valid — classic "next-morning" symptom. Close and reopen the app to re-mint it. See 4.3.

**"Did I lose my scans when I reinstalled?"**
No. Scans live on the server. Reinstall, sign in, and they're all there. See 6.2.

**"The switch shows offline."**
The last poll to it failed — it's stopped, unreachable, or (for lab nodes) came back without its config. RackTrack recovers on its own once the switch answers again. Banner: *"Offline — the switch isn't answering…"*. See 5.1.

**"A switch says 'No data' but there are no failures."**
It's enabled and hasn't failed, but a poll has never succeeded — usually missing credentials. Add the switch's login. See 5.1.

**"Why are the LINK and SPEED columns empty?"**
On a virtual or routed switch that's the honest answer: it has no physical link to negotiate and no PoE hardware, so Speed/Duplex/PoE read **—**. A real physical switch fills them in. Blank means "nothing to report", not "error". See 5.2.

**"Why does the switch show no VLANs / no neighbours?"**
A routed (Layer-3) switch has no switchports to put in a VLAN, and may not run LLDP at all (Cisco defaults to CDP). Both empty states are expected on that kind of device. See 5.2.

**"Why did a port report say 'Link is DOWN'?"**
Nothing is plugged into that port, or the far end is unplugged. Not an error — just the port's real state. See 5.3.

**"The app won't update."**
It doesn't update through the stores because it isn't on them. iPhone: turn on **Automatic Updates** in TestFlight, or tap **Update** there. Android: install the newest APK (uninstall the old one first if you get "App not installed"). See 6.2.

**"RackTrack isn't in the App Store / I can't find it."**
It's a beta, delivered through **TestFlight** on iPhone and as an **APK** on Android — not the public stores. Install TestFlight first, then open your invite email on the phone. See 6.1.

**"TestFlight can't find my invitation."**
The invite is tied to the Apple ID email it was sent to. If your phone is signed into a different Apple ID, TestFlight won't see it. Ask your administrator to re-issue the invite to the address you actually use. See 6.1.

**"RackTrack suddenly won't open and TestFlight says the build expired."**
TestFlight builds expire after 90 days. Nothing is lost — open TestFlight and install the current build. See 6.2.

**"Android says 'App not installed' when I try the new APK."**
It's a signing mismatch with the old copy. Uninstall the existing RackTrack, then install the new APK. See 6.2.

**"It told me to take the photo from the front of the rack."**
The scan finished but found zero devices — a rear or side shot, a closed door, or too much distance. Open the front, stand square-on, reshoot. Full message: *"Please take the photo from the front of the rack — we need to see the devices and ports face-on."* See 2.5.

**"It says only N rack units could be made out."**
Only a sliver of the rack was in frame. Step back until the whole cabinet fits inside the guide. See 2.5.

**"It says that image could not be read."**
The file was corrupt or an unsupported format. Use an original JPG or PNG straight from the camera. Full message: *"That image could not be read. Try a JPG or PNG taken straight from the camera."* See 2.5.

**"It says something went wrong on your side."**
That message is RackTrack owning the failure — a crash or timeout, not your photo. Retaking won't help; just try again, and report it if it persists. Full message: *"Something went wrong on our side analysing that photo — it is not a problem with your image. It has been logged; please try again."* See 2.5.

**"My upload keeps failing."**
Over a weak connection the send can drop; RackTrack retries once (*"Connection dropped — retrying…"*). If it still fails you'll see *"Upload failed — the connection dropped while sending the photo. Check your signal and try again."* Move to better signal and retry — no duplicate scan is created. See 2.7.

**"My iPhone photos are HEIC — will that be a problem?"**
No. HEIC/HEIF photos skip your phone's local checks and are validated on the server instead, so they're never wrongly rejected for blur or resolution on the phone. See 2.2.

**"It said the rack is covered by cables."**
Too many cables are hiding the equipment. Shoot extra photos from the left and right of the rack, or tap **Proceed anyway** knowing some devices may be missed. See 2.3.

**"It warned about a side angle but still scanned."**
The side-angle notice is a soft warning, not a stop — the scan runs anyway. For a cleaner result, stand square-on to the rack. See 2.3.

**"What's the difference between Retake and Proceed anyway?"**
**Retake** clears the photo so you can shoot a better one. **Proceed anyway** tells RackTrack to accept the photo as-is and skip the quality gate — it will analyse whatever it can, even if the result ends up thin or empty. See 1 and 2.
