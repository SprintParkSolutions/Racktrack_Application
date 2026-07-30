# Getting Started with RackTrack

*Point your phone at a rack and RackTrack turns it into live, searchable inventory — but first, here is exactly how to get the app, sign in, and take your very first scan.*

Onboarding · New users · Last verified: 26 July 2026 against the live code.

---

## On this page

1. In simple terms — what you need to begin
2. At a glance
3. Getting the app
4. Getting into RackTrack — account, invite, sign-in, forgotten password, and the waiting room
5. The home screen and how to get around
6. Running your very first scan
7. Where to find each feature
8. Edge cases
9. Common questions

---

## 1. In simple terms — what you need to begin

RackTrack is an app for taking a photo of a network rack and getting back a neat, labelled list of everything in it — every switch, patch panel, server, and port — in a few seconds. This page is for someone who has never opened it before and just wants to know how to start.

To begin, you need three things, and that is genuinely all:

1. **A way to open the app.** RackTrack runs as a real app on an iPhone or iPad, as a real app on an Android phone or tablet, and as a normal website in a web browser on a computer. You do not download it from the Apple App Store or the Google Play Store — it is not published there yet. Instead, you are sent an invitation to install it (or a web link to open it). Section 3 walks through each way.

2. **An account, and a way to sign in.** RackTrack always asks you to sign in first. There is no "try it without an account" mode — every part of the app that does real work is behind the sign-in screen. Getting an account happens in one of two ways: you either **create a brand-new organization** for your company, or you **accept an invitation** from someone whose organization already exists. Section 4 covers both, plus signing back in later and resetting a forgotten password.

3. **Something to photograph.** Once you are in, you point the camera at a rack (or upload a photo you already have) and press one button. That is the whole first scan, and Section 6 takes it slowly, one tap at a time.

If you only remember one sentence: **get the invite, install or open RackTrack, sign in, and press "Start a scan."** Everything below is just that same journey, explained in full.

## 2. At a glance

| | |
|---|---|
| **What it is** | An app that photographs a network rack and turns it into a labelled inventory of devices and ports. |
| **Where it runs** | As an app on iPhone/iPad and on Android, and as a website in a computer's web browser. |
| **How you get it** | By invitation — TestFlight for iPhone/iPad, Firebase App Distribution for Android, or a web link. **Not** on the public App Store or Play Store. |
| **Do I need an account?** | Yes, always. You must sign in; there is no anonymous or guest use. |
| **Two ways to get an account** | Create a new organization yourself, or accept an invitation to join an existing one. |
| **First thing you do after signing in** | Press "Start a scan," pick a photo or open the camera, and press "Analyze Rack." |
| **What you get back** | A results screen listing the rack's devices and ports, with more views (Ports, Topology, Network, Switches) a tap away. |

## 3. Getting the app

RackTrack is the same product in three places — the phone app, the tablet app, and the website — so whichever one you use, you sign in with the same account and see the same features. The only difference is how you first open it.

**On an iPhone or iPad — through TestFlight.** RackTrack is delivered to Apple devices using Apple's official tester programme, TestFlight. You will receive an email invitation. The steps are: install the free **TestFlight** app from the App Store, open the invitation email or link on that device, accept it in TestFlight, and then install RackTrack from inside TestFlight. After that, RackTrack has its own icon on your home screen just like any other app.

**On an Android phone or tablet — through Firebase App Distribution.** RackTrack is delivered to Android devices using Google's tester-delivery service, Firebase App Distribution. You will receive an email invitation, accept it, and follow the link to install RackTrack. Because it does not come from the Play Store, your phone may ask you to confirm that you trust the installation — that is expected for a tester build.

**On a computer — through the web link.** RackTrack also runs as an ordinary website. If you were given a web address, open it in a normal browser (Chrome, Safari, Edge, and so on). Nothing to install; you land straight on the RackTrack home screen and sign in there. This is the quickest way to try it, and it is also a reliable fallback if the phone app is ever giving you trouble (see Section 8).

**What you will not find:** RackTrack is not in the public Apple App Store or Google Play Store, so searching those stores for "RackTrack" will not find it. Access is by invitation only. If you do not have an invitation, ask whoever runs RackTrack for your team to send you one.

> **Technical note.** The phone and tablet apps are built with Capacitor — the same web app you would open in a browser, wrapped so it can be installed natively (the app is identified internally as `com.racktrack.app`). Because of that wrapper, the installed app has to reach the RackTrack server over the network to sign you in and to analyse a photo; the web version is served from that same server directly. This is why, if a device cannot reach the server, the installed app can fail to sign in while the website keeps working — see Section 8.

## 4. Getting into RackTrack — account, invite, sign-in, forgotten password, and the waiting room

Everything real in RackTrack lives behind the sign-in screen. If you ever try to open a working page without being signed in, RackTrack quietly sends you to the sign-in screen first and then, once you are in, carries you on to where you were heading. So the very first thing to sort out is your account. There are two front doors.

### Front door 1 — Create a new organization (you are the first person from your company)

Choose this if nobody at your company uses RackTrack yet and you are setting it up. On the sign-in screen, tap **Create an organization** (the home screen also offers this directly). Then:

1. **Fill in your details.** You provide an email address, a username, the name of your organization, and a password. A few rules are checked as you type so you are not surprised later:
   - The email currently must be a **@gmail.com** address (the server insists on this too).
   - The username is 3 to 32 characters and may use letters, digits, and the symbols `.` `_` `-`.
   - The organization name must be at least a couple of characters — this is the private space your whole company will share, so it needs a name.
   - The password must be strong: at least 8 characters, and include an uppercase letter, a lowercase letter, a digit, and a special character. A little bar under the box fills up as your password gets stronger, and a "matches" note confirms your two password entries agree before you can continue.
2. **Prove the email is yours.** RackTrack emails you a six-digit code. Type it into the row of boxes (you can also paste the whole code at once, or let your phone fill it in). Press **Verify**.
3. **Wait for approval.** Creating a new organization does not switch it on instantly. It is handed to the RackTrack platform owner for a quick review, and until they approve it you are held on a friendly waiting screen (described below). You do not need to do anything else, and you do not need to sign in again to find out — the screen checks for you.

### Front door 2 — Accept an invitation (your organization already exists)

Choose this if someone at your company already runs RackTrack and has sent you an invite link. This is the fast path: no code to type, and no waiting room.

1. **Open the invite link** that was emailed to you. RackTrack loads the invitation and shows which organization and site you are joining, and what your role will be (for example, Site Manager or Member).
2. **Your email is already filled in and locked**, so you cannot accidentally join under the wrong address.
3. **Choose a username and a password**, then press **Join**.
4. You are **signed in immediately** and dropped straight onto the Scan screen, already attached to the correct organization, site, and role.

Invitations are meant to be used once, and the role and site come from the person who invited you — you cannot give yourself a higher level of access than you were offered.

### Signing back in when you return

On the sign-in screen, enter your **username or email** and your **password**, then press **Sign in**. There is also an optional **Organization** field; you can leave it blank, and it is only useful in the rare case where the same username exists in more than one organization. When you sign in, RackTrack sends you straight into the app — most people land on the **Scan** screen, ready to work, while organization owners and admins land on the **Home** screen. If you had followed a link to a specific page before being asked to sign in, it takes you on to that page instead.

RackTrack remembers your sign-in on the device, so you do not have to log in every single time you open it.

### Forgotten your password

On the sign-in screen, tap **Forgot password?** Then:

1. Enter your email and press **Send reset code**. For your privacy, RackTrack always shows the same reassuring message — "if an account exists for that email, a six-digit code is on its way" — so the screen never reveals whether a given address is registered.
2. Enter the six-digit code from your inbox. Note that this reset code is short-lived — it is only good for about a minute — so do it promptly, and use **Resend** if it lapses.
3. RackTrack then asks whether you actually want to change your password. You are signed in either way: choose **Yes** to set a new password, or **No, take me to the app** to go straight in without changing anything.

### The waiting room (pending approval)

If you founded a new organization, you will see a calm holding screen after verifying your email. It is honest about exactly which state you are in:

- **Waiting for approval** — your request has been sent to the platform owner and is being reviewed. This screen re-checks by itself every few seconds, so the moment you are approved the app opens on its own. There is also a **Check now** button if you are impatient.
- **Request not approved** — the platform owner declined the new organization. If you think that is a mistake, contact them.
- **Organization deactivated** — the organization was switched off for now; it will come back automatically if it is reactivated.

You can sign out from this screen at any time. Invited members never see this waiting room — only people founding a brand-new organization do.

## 5. The home screen and how to get around

When you open RackTrack you arrive on the **home screen**: a full-screen image of a data centre with the headline **"See every port. Know every rack."** and a short line explaining what the app does. What the buttons say depends on whether you are signed in:

- **Before you sign in**, the main button reads **"Sign in →"** and a second button offers **"Create an organization."** There is also a **Sign in** link in the top corner.
- **After you sign in**, the main button becomes **"Start a scan →"** (this takes you straight to the Scan screen) and the second button becomes **"Past scans"** (your previous scans, on the Profile screen). The top corner now offers **Sign out**.

So from a standing start, the single most useful button is the big one: **Sign in**, and then **Start a scan**.

Once you are inside the app, how you move around depends on your screen size, and RackTrack automatically picks the right layout:

**On a phone (a narrow screen), you get a bottom bar.** Along the bottom you will always see **Home**, **Scan**, and **Profile**, plus a **Menu** button at the far end. The three fixed buttons are the everyday ones; the **Menu** button opens a sheet containing everything else you are allowed to use (things like Two racks, Ask DOT, Contact support, and — if your role includes them — Organizations, Marketplace, and more). This bottom bar only appears once you are signed in.

**On a tablet or computer (a wider screen), you get a sidebar instead.** Down the left edge sits a list titled **Workflow** with the same set of destinations, a theme (light/dark) switch, and a **Sign out** button at the bottom. Across the top is a bar showing the name of the page you are on with a back button. After you have run a scan, an extra section appears in the sidebar for that specific rack, with quick links to its Overview, Ports, Topology, Network, and Switches. (The full-screen home page is the one exception — it fills the whole window rather than sitting inside the sidebar.)

The important thing for a newcomer: whether you see a bottom bar or a sidebar, the destinations are the same, so instructions like "open the Scan screen" or "go to Profile" work everywhere.

## 6. Running your very first scan

This is the heart of RackTrack, and it is genuinely a few taps. Here is the whole thing, slowly.

1. **Start from Home and press "Start a scan → " (or tap the Scan button).** You must be signed in; if you are not, RackTrack sends you to sign in first and then brings you back here.

2. **Choose how to capture the rack.** At the top of the Scan screen are two choices: **Upload** (use a photo or video already on your device) and **Camera** (take one right now).

3. **If you chose Upload, pick a mode.** Three little buttons let you choose:
   - **SINGLE** — one photo of the rack. This is the normal choice, and the right one for your first try.
   - **MULTI** — for a tall rack that will not fit in one shot: take 2 to 8 overlapping photos and RackTrack stitches them together for you. You do not have to get the order perfect; it arranges them automatically.
   - **VIDEO** — upload a short video of the rack instead of a still photo.
   Then tap the drop zone to browse for your file. Accepted formats include JPG, PNG, HEIC, and MP4.

4. **If you chose Camera, line up the shot.** The camera fills the screen with a viewfinder and four corner brackets to help you frame the rack. As you aim, RackTrack coaches you in real time — it will say things like "Move closer so the rack fills the frame," "Move to better lighting," or "Hold steady — keep still for focus," and the brackets turn green when the shot looks good. You can switch between **Photo** and **Video** here, and you press the round shutter button to capture. (While you aim, you may also see live labels pop up on devices it already recognises — that is normal.)

5. **Optionally link an incident.** If your organization has connected a ticket system and there are open tickets, a picker lets you attach this scan to a specific incident so RackTrack jumps straight to the device and port that ticket is about. If you do not have or want that, leave it on **Manual scan** — you will simply choose the device and port yourself afterwards. For a first scan, ignore this entirely.

6. **Press the big button to analyse.** For a single photo it reads **"Analyze Rack."** For a multi-photo tall rack it reads **"Stitch & Analyze."** Press it.

7. **Watch it work.** A short animated overlay shows the progress and the stage it is on — preprocessing the image, detecting the rack's boundaries, identifying components, mapping the ports, and locating the target. This takes only a few seconds.
   - If the photo is too blurry, too dark, or badly framed, RackTrack tells you and offers a choice: **Retake** a better photo, or **Proceed anyway** if you are confident.

8. **You land on the results.** When it finishes, RackTrack drops you on the scan's results screen, showing the devices and ports it found. From there you can explore the rack's Ports, Topology, Network, and Switches views. Your scan is also saved, so you can find it again later under **Past scans** on your Profile.

That is a complete first scan. Repeat it as often as you like — each new scan starts fresh.

## 7. Where to find each feature

Everything you are allowed to use lives in the same menu — the bottom bar's **Menu** button on a phone, or the sidebar on a tablet or computer. Some entries only appear for certain roles, which is why two people may see slightly different lists.

**Everyone sees:**

- **Home** — the welcome screen and your starting point.
- **Scan** — take or upload a rack photo and analyse it (Section 6).
- **Two racks** — scan two racks together and see the cabling that runs between them.
- **Ask DOT** — RackTrack's built-in help assistant, answering questions from verified documentation.
- **Contact** — email the RackTrack support team directly.
- **Profile** — your account and your past scans.

**Owners and organization admins also see:**

- **Organizations** — manage organizations, their members, sites, and pending approvals.
- **Data Sources** — connect outside systems such as ServiceNow and NetBox.
- **Marketplace** — buy, sell, and swap surplus hardware.

**Owners only also see:**

- **Console** — the live operations dashboard and server logs.
- **Lab** — live switches in the test lab.

**After you run a scan**, that rack gets its own set of views, reachable from the results screen (and, on a tablet or computer, from a dedicated section in the sidebar): **Overview**, **Ports**, **Topology**, **Network**, **Switches**, and **Drift** (owners additionally get **Ground Truth**, for verifying what the model detected).

## 8. Edge cases

**"I can sign in on the website, but the installed app won't let me in."** This almost always means the installed app cannot currently reach the RackTrack server over the network, while the website — which is served from that server directly — still can. Try these in order: make sure the device has a working internet connection; switch networks (for example, from office Wi-Fi to mobile data, or vice versa); close and reopen the app; and in the meantime, use the **web link** on a computer or phone browser, which will keep working. If it persists, contact support (Section 7) — the server or its connection may be temporarily down.

**"I created an organization and I'm stuck on a waiting screen."** That is expected. A brand-new organization has to be approved by the RackTrack platform owner before it switches on, so you are held on the **Waiting for approval** screen until they do. You do not need to sign in again — the screen re-checks itself every few seconds and lets you straight in the moment you are approved. If the screen instead says the request was not approved, or that the organization was deactivated, reach out to the platform owner. Invited members skip this entirely.

**"My invite link says it's invalid or expired."** Invitations are single-use and do not last forever. If yours no longer works — because it was already used, or has aged out — ask your organization's admin to send you a fresh one. You cannot join an existing organization by signing up on your own; joining always goes through an invite link (or a username and password your admin gives you).

**"I tried to sign up but it rejected my email."** Account creation currently requires a **@gmail.com** address, and the server enforces this. Use a Gmail address to create the account, or, if you are joining a team that already exists, use the invite link instead — an invite does not have this restriction.

**"I have to sign in every time I open it."** RackTrack normally remembers your sign-in on the device. If it keeps forgetting, your browser or device may be blocking the app from storing that information — common in private/incognito windows or with strict privacy settings. Using a normal (non-private) browser window, or the installed app, keeps you signed in between visits.

**"Nothing works until I sign in."** That is by design. RackTrack has no anonymous mode; the home screen and the sign-in, sign-up, invite, and password-reset pages are the only things you can reach signed out. Everything else waits until you are in.

## 9. Common questions

**How do I start?**
Get your invitation (or web link) from whoever runs RackTrack for your team, open the app, sign in, and press **Start a scan**. If you do not have an account yet, see Section 4.

**How do I start the app?**
On an iPhone or iPad, tap the RackTrack icon that TestFlight installed. On Android, tap the RackTrack icon that Firebase App Distribution installed. On a computer, open the web link in your browser. Then sign in — RackTrack always opens on the home screen, and the main button takes you from there.

**How do I get RackTrack?**
By invitation, not from an app store. For iPhone/iPad you are invited through TestFlight; for Android, through Firebase App Distribution; for a computer, you are simply given a web link. It is not listed in the public App Store or Play Store, so searching there will not find it. Ask your team's RackTrack administrator for an invitation.

**How do I run my first scan?**
Sign in, press **Start a scan**, choose **Upload** or **Camera**, pick or take a photo of the rack, and press **Analyze Rack**. A few seconds later you land on the results. Section 6 has the full walkthrough.

**Why do I need to log in?**
RackTrack has no guest mode — every feature that does real work sits behind the sign-in screen, and your scans belong to your account and your organization. Signing in is also what keeps each company's data private and shows you only the features your role allows.

**What can I do in RackTrack?**
At its core, you photograph a rack and get back a labelled inventory of its devices and ports, then explore views like Ports, Topology, Network, and Switches. You can also scan two racks together to see the cabling between them, revisit your past scans, ask the built-in **Ask DOT** assistant for help, and contact support. Owners and admins can additionally manage their organization and members, connect outside systems, and use the Marketplace.

**Do I need to download anything from the App Store or Play Store?**
No. RackTrack is not published in either public store. You install it from a tester invitation (TestFlight on Apple devices, Firebase App Distribution on Android) or just open the web link in a browser.

**Can I use RackTrack in a normal web browser?**
Yes. It runs as a full website on a computer with nothing to install — open the web link and sign in. This is also a handy fallback if the installed app ever has trouble reaching the server.

**Do I need an account, or can I try it first?**
You need an account; there is no try-before-you-sign-in mode. You get an account either by creating a new organization or by accepting an invitation.

**What is the difference between "Create an organization" and using an invite code?**
Creating an organization makes a brand-new private space for your company, with you as its first member — and it waits for the platform owner's approval before switching on. An invite link joins you to an organization that already exists, with your role and site already set, and it lets you in immediately with no waiting.

**I created an organization but can't get past the "Waiting for approval" screen — is something broken?**
No. New organizations are reviewed and approved by the platform owner before they go live. The screen checks automatically and lets you in the instant you are approved; you do not need to sign in again.

**My invite link doesn't work — what now?**
Invites are single-use and can expire. Ask your organization's admin to send a new one. You cannot join an existing organization by signing yourself up.

**I forgot my password. How do I get back in?**
On the sign-in screen tap **Forgot password?**, enter your email, and type the six-digit code that is emailed to you (it only lasts about a minute, so be quick, and use **Resend** if needed). You can then set a new password or simply choose to go straight into the app.

**Where did my scan go / how do I see past scans?**
Open **Profile** (in the bottom bar or the sidebar), which keeps your account details and your history of scans. Every scan you run is saved there automatically.

**Do I need internet to use it?**
Yes, for the important parts. Signing in and analysing a photo both need the app to reach the RackTrack server, so a working connection is required. If the installed app cannot connect but you need in urgently, the web link on a connected device is your fallback.

---

— Getting Started with RackTrack —
