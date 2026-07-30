# Accounts, Sign-in & Sessions

*Everything about getting into RackTrack and staying in — creating an account, using an invite, signing in, resetting a forgotten password, signing out, and how long a sign-in lasts.*

Reference · All users · Last verified: 26 July 2026 against the live code.

---

## On this page

1. In simple terms
2. At a glance
3. Getting in — the four ways
   - Creating your own organization (self sign-up)
   - Joining a team with an invite link
   - Signing in
   - Forgot / reset password
   - Pending approval (the waiting room)
4. How to sign out — mobile and desktop/iPad
5. Sessions — how long a sign-in lasts and why you might get signed out
6. Under the hood — accounts, tokens, and email codes
7. Edge cases
8. Common questions (atomic Q&A)

---

## 1. In simple terms

RackTrack is behind a login. You cannot scan a rack, open your profile, view results, or use any real feature until you are signed in. When you open the app without being signed in, you land on a welcome/home screen with a **Sign in** button — tapping anything that actually does work sends you to the sign-in page.

There are only two ways to get an account in the first place:

1. **You create a brand-new organization.** You sign up with your email, pick a username and password, and name your company. This makes you the admin of a new organization. A new organization has to be **approved by the RackTrack platform owner** before you can use it, so right after signing up you wait on an approval screen.
2. **You are invited into an existing organization.** Someone who already runs a team in RackTrack sends you an **invite link**, or hands you a **username and password** they created for you. A brand-new person cannot join an existing organization on their own — there is no "request to join" button. It is invite-only.

Once you are in, your sign-in lasts a long time — **30 days on that device** — so you are not asked to log in every time you open the app.

---

## 2. At a glance

| Thing | The truth |
|---|---|
| Is login required? | Yes. Every real feature (scan, profile, results, connections, etc.) is behind login. The public home/welcome screen is the only thing you can see logged out. |
| Can I use it without an account? | No — not for anything useful. You can look at the welcome screen, but any action sends you to sign-in. |
| How do I get an account? | Either **create an organization** (self sign-up) or **accept an invite** from an existing team. You cannot join an existing team on your own. |
| What email can I sign up with? | **Only a `@gmail.com` address** for self sign-up. (Invited users use whatever email they were invited with.) |
| Username rules | 3 to 32 characters; letters, digits, and `. _ -` only. |
| Password rules | At least 8 characters, with an uppercase letter, a lowercase letter, a digit, and a special character. |
| Sign-up needs a company name? | Yes — a company/organization name is required (at least 2 characters). It creates a new organization. |
| How do I sign in? | Username **or** email + password. Organization field is optional. |
| Forgot password? | Enter your email, get a 6-digit code by email, type it in, then either set a new password or just go straight into the app. |
| How long does a code last? | About **1 minute**. Sign-up codes and password-reset codes both expire after roughly 60 seconds. |
| How long does a sign-in last? | **30 days**, per device. |
| Where do I sign out on a phone? | **Profile** page → the sign-out icon (top right) → confirm. |
| Where do I sign out on desktop/iPad? | The **Sign out** button at the **bottom of the left sidebar**. |
| What does "pending approval" mean? | Your newly created organization hasn't been approved by the platform owner yet. You wait on a screen that checks automatically. |

---

## 3. Getting in — the four ways

### 3a. Creating your own organization (self sign-up)

This is the path for someone setting up RackTrack for their own company for the first time.

**Where to start:** on the welcome screen tap **Sign in**, then on the sign-in page tap **Create an organization** (under "New here?"). You can also reach it directly at `/signup`.

Sign-up happens in **two steps**, shown as two dots at the top of the screen.

**Step 1 — your details.** You fill in four things:

- **Email.** Must be a valid email **and** must end in `@gmail.com`. If you type any other kind of address, you get: *"Please use a @gmail.com email address to create an account."* This Gmail-only rule is enforced by both the app and the server, so there is no way around it for self sign-up.
- **Username.** 3 to 32 characters, using letters, digits, and the symbols `.` `_` `-`. Anything outside that is rejected with *"Username 3–32 chars (letters, digits, . _ -)."*
- **Organization.** The name of your company. Required, at least 2 characters. This is important: signing up **creates a new organization**, and you become its admin. There is a note under the field that says "Creates a new organization."
- **Password** and **Confirm password.** The password must be strong (see the rules below). As you type, a strength bar fills up and tells you the one thing still missing (for example "Need a digit"). When all five rules are met it shows "✓ Strong password." The confirm box shows "✓ matches" or "✗ no match" live. The **Continue** button stays greyed out until the password is strong and the two passwords match.

The five password rules are:

1. At least **8 characters**
2. an **uppercase** letter
3. a **lowercase** letter
4. a **digit**
5. a **special character** (anything that isn't a letter or number)

**Step 2 — verify your email.** After you tap **Continue**, RackTrack emails a **6-digit code** to the address you entered and shows a six-box code entry. Type (or paste) the code and tap **Verify**. Notes:

- The code **expires in about 1 minute.** If you are too slow, you will be told the code has expired and you have to sign up again.
- If it didn't arrive, tap **Resend** ("Didn't get it?") to send a fresh code.
- The back arrow at this step takes you back to the details step, not out of sign-up.

**What happens when you verify:** RackTrack creates your organization, gives it a starter site called **"Main Site"**, and makes you the organization's admin. **But the organization starts as "pending"** — it is a *request* that the platform owner has to approve. So instead of dropping you into the app, you land on the **waiting-for-approval screen** (see 3e).

---

### 3b. Joining a team with an invite link

This is the path for an employee being added to a company that already uses RackTrack.

An admin (or a site manager) on your team creates an invite for your email address and sends you a link that looks like `/invite/<code>`. When you open it:

- The page loads the invite and shows who invited you — for example *"Join Acme · Main Site as Member."* Your email is shown already filled in and locked (you can't change it — the invite is tied to that address).
- You **choose a username** and **create a password**, then tap **Join**.
- The username still has to be 3–32 characters (letters, digits, `. _ -`), and the password still has to be strong (the same 8/upper/lower/digit/special rules).
- The moment you tap Join, you are signed in and taken straight into the app. There is **no email code step** for invites — accepting the link is the verification, because only the person with the invite could open it.

Good to know about invites:

- **Invites expire after 7 days.** Open an older link and you'll see "This invite has expired."
- **Invites are single-use.** Once accepted, the same link can't be used again ("This invite has already been used").
- **Invites don't require a Gmail address.** The Gmail-only rule is only for self sign-up. Your invited email can be any address your admin used.
- The role you get (for example **Member** or **Site Manager**) is decided by whoever invited you — you can't pick it yourself.
- An invited user joins an organization that is **already approved**, so there's no waiting room — you go straight in.

**You cannot invite yourself.** There is no public "join this company" form. If you need access to an existing team, ask that team's admin to send you an invite link or to create a username and password for you.

---

### 3c. Signing in

Once you have an account, go to the sign-in page (`/login`) — from the welcome screen it's the **Sign in** button.

You fill in:

- **Organization** — *optional.* Leave it blank in almost every case. It only matters if the same username somehow exists in more than one organization, in which case typing your organization's name (or the site name) narrows it down. Owners of the whole platform leave it blank.
- **Username or email** — you can type **either** your username **or** your email address; both work.
- **Password.** There's an eye icon to show/hide what you typed.

Tap **Sign in**. If it works, you're taken into the app (normally the scan screen, or wherever you were trying to go before you got bounced to login). If it fails you'll see one of:

- *"Enter your username and password."* — you left a field blank.
- *"Invalid username or password."* — the username/email or password was wrong.
- *"Invalid organization or credentials."* — you typed an organization name that doesn't exist, or the credentials didn't match within it.
- *"This account has been deactivated. Contact your administrator."* — your admin has switched your account off.

There's a **Forgot password?** link right on this page.

---

### 3d. Forgot / reset password

If you can't remember your password, tap **Forgot password?** on the sign-in page (or go to `/forgot-password`). This is a short flow:

1. **Enter your email.** RackTrack sends a **6-digit reset code** to that address. For privacy, it always says *"If an account exists for that email, a 6-digit code is on its way"* — it will not tell you whether the email is registered or not. So a real account gets a code; a wrong email silently gets nothing.
2. **Enter the code.** Type the 6-digit code from your email. It **expires in 1 minute** — the screen even says "expires in 1 min." If it's gone, tap **Resend** for a fresh one. The code is only *checked* here, not used up yet.
3. **Choose what to do.** After the code is accepted you see "Code verified" with two choices:
   - **Yes, change password** — go set a new password.
   - **No, take me to the app** — you're signed in **without changing your password.** The code proved it's really you (you got the email), so RackTrack just lets you in with your existing password unchanged.
4. **New password (only if you chose "Yes").** Type a new strong password (same 8/upper/lower/digit/special rules) and confirm it. Tap **Reset password** and you're signed in with the new password.

Either way you end up signed in — resetting the password does **not** make you log in again afterwards.

---

### 3e. Pending approval (the waiting room)

When you **create a new organization** by self sign-up, that organization starts as **"pending."** Until the RackTrack platform owner approves it, you can't scan or use the app — so you're held on the **"Waiting for approval"** screen.

What this screen does:

- It explains that your request to create your organization has been sent to the platform owner, and that you'll be let in as soon as they approve it.
- It **checks automatically every few seconds** — the exact moment the owner approves your organization, you're moved straight into the app with no action from you.
- There's a **Check now** button if you're impatient, and a **Sign out** button if you want to leave.

The same screen also covers two other states, with different wording:

- **"Request not approved"** — the platform owner declined your request to create the organization. If you think that's a mistake, contact them.
- **"Organization deactivated"** — your organization was switched off by the platform owner, so the app is paused. It comes back automatically if they turn it back on (this screen keeps checking too).

Owners of the whole platform and users who join by invite are **never** shown this screen — only members of an organization that isn't currently "active."

---

## 4. How to sign out

Signing out clears your saved sign-in **on that device** and returns you to the welcome screen. You'll need to sign in again to use the app.

### On a phone (mobile)

1. Go to the **Profile** tab (bottom navigation, far right).
2. Tap the **sign-out icon in the top-right corner** of the Profile header.
3. A confirmation box appears: **"Sign out? You'll need to sign in again to scan racks."**
4. Tap **Sign out** to confirm (or **Cancel** to stay).

That confirm step is deliberate — a single accidental tap won't sign you out.

### On desktop or iPad (the sidebar layout)

On a wider screen (roughly 1024px and up) RackTrack shows a **left sidebar**. Sign out lives at the **bottom of that sidebar**, under the navigation links, next to the light/dark theme toggle.

1. Look at the **bottom-left of the screen**, below the list of nav links.
2. Click **Sign out**.

There's no confirmation box on the desktop sidebar — it signs you out immediately and takes you to the welcome screen.

### Other places you can sign out

- **The waiting-for-approval screen** has its own **Sign out** button (useful because you can't reach Profile from there).
- **The desktop/iPad welcome screen** shows a **Sign out** button in its top corner when you're already signed in.

---

## 5. Sessions — how long a sign-in lasts and why you might get signed out

### How long a sign-in lasts

A sign-in lasts **30 days**. During that time you can close the app, restart your phone, come back tomorrow or next week, and you'll still be signed in — RackTrack remembers you on that device. After 30 days the sign-in expires and you'll be asked to sign in again.

### It's per device

Your sign-in is stored **on the device you signed in on.** Signing in on your phone does not sign you in on your laptop, and vice versa — each device keeps its own separate 30-day sign-in. In the same way, **signing out on one device does not sign you out on your other devices** — you'd sign out on each one separately.

### Why you might get signed out

You can be sent back to the sign-in screen for a few reasons:

- **Your 30 days ran out.** The sign-in simply expired; sign in again.
- **You signed out** (on this device).
- **Your account was deleted or deactivated.** If an admin removes or switches off your account, the app notices the next time it talks to the server and signs you out.
- **You cleared your browser data / reinstalled the app / are using private browsing.** Your saved sign-in lives in the device's local storage. If that gets wiped — clearing site data, a fresh install, or a private/incognito window that forgets everything on close — the sign-in is gone and you'll log in again.
- **Storage is blocked.** On a browser that blocks local storage, RackTrack can't save your sign-in, so it works for that session but asks you to sign in again next time you open it. (This won't crash the app — it's handled gracefully.)

Being signed out never loses your data — your scans and your organization are stored on the server, not on the device. Signing back in brings everything back.

---

## 6. Under the hood — accounts, tokens, and email codes

This section is for the curious; you don't need it to use RackTrack.

- **Accounts** are stored on the server in a small database, with passwords kept only as secure **bcrypt hashes** — RackTrack never stores your actual password text.
- **Signing in gives you a token** (a JWT — a signed "you are logged in" pass). That token is what's saved on your device and sent with every request. It's valid for **30 days**, then it stops working and you sign in again. There are no separate "refresh tokens" — one 30-day token per sign-in.
- The token carries who you are, your role, and which organization/site you belong to, so the server doesn't have to look it up every time.
- **Rack images** use a second, short-lived pass (about 12 hours) that RackTrack refreshes automatically in the background, so pictures keep loading even after the app has been open a long time. You never see or manage this.
- **Email codes** (both the sign-up verification code and the password-reset code) are **6 digits** and expire in about **1 minute.** The code itself is never written to logs, for security.
- **New organizations start "pending"** and only the platform owner can approve them. The server enforces this — a pending organization can't scan or add members even if someone tried to bypass the app.
- **Invite codes** are long random strings, are good for **7 days**, and work only once.

---

## 7. Edge cases

**"I signed in but I'm stuck on a waiting screen."** Your organization is pending the platform owner's approval (or was deactivated/rejected). This only happens to organizations created by self sign-up. The screen checks automatically — leave it open, or tap **Check now**. See section 3e.

**"I can't sign in on the app, but the website works" (or the reverse).** Your sign-in is per device and per install. The website and the installed app can each hold their own separate sign-in. If one is signed in and the other isn't, just sign in again on the one that isn't — your account and data are the same on both. Also check you're using the same username/email and password on both.

**"I got signed out for no reason."** The most common causes are: your 30-day sign-in expired, your browser or app storage was cleared (or you're in a private window), or an admin changed your account. Just sign in again — nothing is lost. See section 5.

**"The app went to a blank/white screen right after I signed in."** This was a known problem on browsers that block storage and has been handled — sign-in now works even when the device won't save it (you'd just sign in again next time). If you still see it, close and reopen the app.

**"My verification code / reset code doesn't work."** Codes expire after about a minute, so a code from a couple of minutes ago is already dead. Use **Resend** to get a new one and type it quickly. Make sure you're entering the newest code — an older email's code won't work once you've requested a fresh one.

**"It says my email is already registered."** An account already exists for that email. Use **Sign in**, or **Forgot password?** if you don't remember the password. You can't sign up twice with the same email.

**"It won't accept my Gmail."** Self sign-up requires a `@gmail.com` address. If you're trying to use a work or other email, you can't self-sign-up with it — you'd need to be **invited** on that address by an existing team instead.

**"My account was deactivated."** An administrator has switched your account off. Signing in shows "This account has been deactivated. Contact your administrator." Only your admin (or the platform owner) can turn it back on.

---

## 8. Common questions (atomic Q&A)

**How do I sign out?**
On a phone: open **Profile** (bottom-right tab), tap the **sign-out icon** at the top-right, then confirm **Sign out**. On desktop/iPad: click **Sign out** at the **bottom of the left sidebar**.

**How do I log out?**
Same as signing out. On mobile it's **Profile → sign-out icon → confirm**. On desktop/iPad it's the **Sign out** button at the bottom of the sidebar.

**How to logout?**
Phone: **Profile** tab → top-right sign-out icon → **Sign out**. Bigger screen: the **Sign out** button at the bottom of the left sidebar.

**Where is the sign-out button?**
On a phone it's on the **Profile** page, top-right corner. On desktop or iPad it's at the **bottom of the left sidebar**. The waiting-for-approval screen and the desktop welcome screen also have their own Sign out buttons.

**How do I create an account?**
If you're starting your own team, tap **Sign in** then **Create an organization**, and fill in your Gmail, username, company name, and password, then enter the 6-digit code we email you. If you're joining an existing team, you can't create your own account — ask that team's admin for an **invite link**.

**How do I sign up?**
Go to **Create an organization** from the sign-in page (`/signup`). Enter a `@gmail.com` email, a username (3–32 chars), your organization name, and a strong password. Then verify the 6-digit code sent to your email. Note your new organization then waits for the platform owner to approve it.

**Do I need a Gmail to sign up?**
For creating your own organization, **yes** — self sign-up only accepts `@gmail.com` addresses. If you're **invited** to an existing team, no — the invite can be for any email address.

**What are the password rules?**
At least **8 characters**, and it must include an **uppercase** letter, a **lowercase** letter, a **digit**, and a **special character**. The sign-up screen shows a live strength bar telling you what's still missing.

**What are the username rules?**
**3 to 32 characters**, using only letters, digits, and the symbols `.` `_` `-`.

**I forgot my password.**
Tap **Forgot password?** on the sign-in screen. Enter your email, get the 6-digit code by email, type it in, then either set a new password or choose "No, take me to the app" to get in without changing it.

**How do I reset my password?**
Sign-in page → **Forgot password?** → enter email → enter the 6-digit code from your email → **Yes, change password** → set a new strong password. You're signed in right after.

**How do I change my password?**
Use the **Forgot password?** flow on the sign-in page — that's how you set a new password (enter email, enter the emailed code, then choose "Yes, change password"). There is no separate "change password" screen inside the app.

**Why was I signed out?**
Usually one of: your 30-day sign-in expired, you (or the app) cleared saved data, you're in a private/incognito window, or an admin deactivated/removed your account. Just sign in again — no data is lost.

**How long does a sign-in last?**
**30 days** on that device. After that you sign in again.

**How long do I stay logged in?**
About a month — **30 days** per device — unless you sign out or your saved data is cleared.

**Do I have to log in every time I open the app?**
No. You stay signed in for **30 days**, so you can close and reopen the app freely without logging in again.

**How do I use an invite code?**
Open the **invite link** your admin sent you (it looks like `/invite/…`). It shows the team you're joining; **choose a username and password**, tap **Join**, and you're in. No email code needed. Invite links expire after 7 days and work once.

**Someone sent me an invite — what do I do?**
Tap the link, pick a username and a strong password on the page that opens, and tap **Join**. You'll be signed into their organization immediately.

**My invite link doesn't work / says expired.**
Invite links last **7 days** and can only be used **once**. If yours has expired or was already used, ask your admin to send a new one.

**What does "pending approval" mean?**
You created a new organization and it hasn't been approved by the RackTrack platform owner yet. You wait on a screen that checks automatically and lets you in the moment they approve it. This only happens for self-created organizations.

**How long does approval take?**
The screen says it "usually doesn't take long" and it checks every few seconds automatically. The exact timing is up to the platform owner — you're let in as soon as they approve.

**Do I need an account?**
Yes. RackTrack is behind a login — you can't scan or use any real feature without signing in.

**Can I use it without logging in?**
No. Logged out, you only see the welcome screen; every real action sends you to sign in. You need an account (created by you, or via an invite) to actually use it.

**Can I sign in with my email instead of my username?**
Yes. On the sign-in screen the "Username or email" field accepts **either** — type whichever you remember.

**What do I put in the Organization box when signing in?**
Usually **nothing** — leave it blank. It's optional and only needed in the rare case where the same username exists in more than one organization.

**Can I join a company that already uses RackTrack?**
Only if they invite you. There's no public "join" button — ask that company's admin for an invite link or for a username and password.

**Why won't it let me create an account with my work email?**
Self sign-up only accepts `@gmail.com` addresses. To use a work email, get **invited** to a team on that address instead.

**I never got my verification / reset code.**
Codes are emailed and expire in about a minute, so check straight away (and your spam folder). If it didn't arrive or expired, tap **Resend** for a fresh code and enter it quickly.

**Does signing out on my phone sign me out on my laptop?**
No. Sign-ins are per device. Signing out on one device leaves your other devices signed in until they expire or you sign out on each.

**Will I lose my scans if I sign out or get signed out?**
No. Your scans and organization live on the server, not on your device. Signing back in brings everything back.

**Can I stay signed in on more than one device?**
Yes. Each device keeps its own 30-day sign-in, so you can be signed in on your phone, tablet, and computer at the same time.

**How do I get back in after being signed out?**
Just go to the sign-in screen and enter your username (or email) and password. If you've forgotten the password, use **Forgot password?**.
