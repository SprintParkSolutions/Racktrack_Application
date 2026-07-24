# Accounts & Onboarding

**Feature Reference** · *Two ways into a team — found a brand-new organization, or accept an invitation and start scanning.*

**Category:** Access & identity — the front door · **Audience:** Everyone — new founders, invited members, and returning users · **Document date:** 24 July 2026 · Part of the RackTrack documentation set.

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

Before anyone can photograph a rack, they need an account — and there are exactly two ways to get one.

The first way is to **found a new organization**. You are the first person from your company to arrive, so you set the whole thing up: your email, a username, the name of your organization, and a strong password. RackTrack emails you a short code to prove the address is really yours, and then it hands your request to the platform owner for a quick approval. Until that approval lands, you wait in a friendly holding screen — you are not stuck, and you never have to sign in again to find out; the screen checks for you and lets you straight through the moment you are approved.

The second way is to **accept an invitation**. Someone who already runs an organization sends you a link. The link already knows who you are — your email is filled in and locked — and it already knows which site you belong to and what your role will be. You simply pick a username, choose a password, and press Join. There is no waiting room and no approval step for invitees, because the person who invited you has already vouched for you. Within a minute you are signed in and ready to scan.

Around these two front doors sit the everyday essentials: **signing back in** when you return, **recovering a forgotten password** with a one-time emailed code, and being **sent to the right place** automatically once you are in — owners and admins land in their management console, everyone else lands on the Scan screen, ready to work.

## 2. At a glance

| | |
|---|---|
| **Category** | Access and identity — the very first screen, and the gate to everything else. |
| **Who uses it** | Founders standing up a new organization, invited members joining an existing one, and returning users signing back in. |
| **Where input comes from** | Details you type (email, username, organization name, password), a six-digit code emailed to you, or an invitation link that carries your fixed details. |
| **What it outputs** | A signed-in session that is routed automatically to the right screen for your real role. |
| **Data source** | REAL — genuine accounts, organizations, invitations, and time-limited codes, all kept safely on the server. |

## 3. How it works — step by step

```
Choose a path              →  found an organization, or open an invite link
        ↓
Provide your details       →  email + username + org + password  ·  or  username + password
        ↓
Verify it's you            →  type the six-digit code we email (founders only)
        ↓
Account created            →  a signed-in session is issued and remembered
        ↓
Approval gate              →  founders wait to be approved; invitees skip straight through
        ↓
Into the app               →  owners/admins → the console  ·  everyone else → Scan
```

**Walkthrough — founding a new organization**

1. Choose to create an organization, then enter your email, a username, the name of your organization, and a strong password. A live meter shows how strong the password is as you type.
2. Check your inbox for a six-digit code and enter it to prove the email address is yours. You can type it, paste it, or let your phone fill it in for you.
3. Your organization is created with you as its first member, and you are taken to a waiting screen. The platform owner reviews new organizations before they go live.
4. Wait on the approval screen. It re-checks by itself every few seconds, so the moment you are approved the app opens on its own — you never need to sign in again to find out.

**Walkthrough — joining by invitation**

1. Open the invitation link that was emailed to you. Your email address is already filled in and cannot be changed, so you always join the right organization.
2. Choose a username and a password, then press Join. There is no code to enter and no waiting room.
3. You are signed in immediately, already attached to the correct organization, site, and role.

**Walkthrough — returning or locked out**

1. To come back, simply sign in with your username or email and password. An optional organization field is there if you need it. You are then sent to the right screen for your role.
2. If you have forgotten your password, choose Forgot Password. We email a short-lived code; enter it, and either set a new password or just sign in.

## 4. Where the input comes from

- **Founder details** — your email address, a chosen username, the name of your new organization, and a password that is checked against sensible strength rules as you type.
- **The email code** — a six-digit verification code (for founders) or reset code (for password recovery), delivered to your inbox. It can be typed, pasted, or auto-filled by your device.
- **The invitation link** — carries the fixed email address, the organization, the specific site, and the role you have been given, so none of that is left to guesswork.
- **Sign-in credentials** — your username or email and your password, with an optional organization field for the rare case where it is needed.

## 5. What it produces (output)

- **A new organization** — created with the founder as its first member, held in a pending state until the platform owner approves it.
- **A joined account** — bound to the organization, site, and role that the invitation specified, ready to use straight away.
- **A signed-in session** — remembered on your device so you stay logged in, and quietly re-checked each time the app loads.
- **Role-based routing** — the destination screen is chosen for you by the account itself, not picked from a menu.

## 6. What you see on screen

- **A password strength meter and a match indicator** — live feedback as you type, so you know your password is strong and that the two entries agree before you continue.
- **A six-digit code grid** — a neat row of boxes that accepts typing, pasting a whole code at once, or your device's autofill.
- **A waiting-for-approval room** — a calm holding screen with clear, different messages depending on whether your organization is still pending, has been rejected, or has been switched off.
- **Privacy-safe recovery wording** — when you ask to reset a password, the message reads "if an account exists, a code is on its way," so no one can learn from the screen whether a given email is registered.

## 7. The logic behind it

- **Organization status decides access.** As long as an organization is anything other than active — pending, rejected, or deactivated — its people are held in the waiting room. That screen re-checks every few seconds, so once approval comes through, access opens without anyone having to sign in again.
- **Invitations are single-use and fix your role.** An invite can be used once, and it carries the role and site set by the person who sent it. That means an invitee can never quietly hand themselves a higher level of access than they were offered.
- **No picking your own role.** Signing in routes you by the real role attached to your account, not by anything you choose on the way in. The screen you land on always matches what you are actually allowed to do.

## 8. Detailed technical explanation

**Staying signed in.** When you create an account or sign in, RackTrack issues a session and remembers it on your device so you do not have to log in every time. On each load, it quietly re-checks that the session is still valid. If the account has been firmly turned away — for example, deactivated — the session is cleared and you are returned to sign-in. But if the only problem is that your device briefly cannot reach the internet, RackTrack keeps the remembered session so the parts of the app that work offline still open.

**Keeping passwords and codes safe.** Your password is never kept in a readable form; it is stored only in a scrambled way that cannot be turned back into the original. The emailed codes — both the verification code for new founders and the reset code for password recovery — are short-lived and good for one purpose only. A reset code cannot be reused, and it stops working after a short window, so an old email can never be used to get back in.

**Recovery that gives nothing away.** When you ask to recover a password, RackTrack shows the same reassuring message whether or not the email belongs to a real account. That way, the recovery screen can never be used to fish for which addresses are registered.

**The role ladder.** Every account sits somewhere on a fixed ladder — platform owner at the top, then organization admin, then site manager, then member. Where you sit is decided when your account is made and is enforced behind the scenes on every request, not on your device where it could be tampered with. The overall lifecycle of an organization — approving it, renaming it, switching it off — stays firmly in the hands of the platform owner.

## 9. Real data vs. synthetic

| Thing on screen | Real or synthetic |
|---|---|
| Accounts, organizations, and invitations | **REAL** — genuinely created and stored on the server. |
| Email verification and password-reset codes | **REAL** — time-limited codes sent to your own inbox. |
| Your role and where you are routed | **REAL** — decided by the account itself, never chosen by you. |
| The "if an account exists" recovery message | **REAL wording, deliberately neutral** — identical whether or not the email is registered, to protect privacy. |

## 10. Use cases

- **A new customer signs up.** A founder creates their organization, proves their email with a six-digit code, and waits briefly on the approval screen. The moment the platform owner approves them, the app opens on its own.
- **Onboarding a whole field team.** An admin emails an invitation link to each technician. Every person just sets a username and password and presses Join — no codes, no waiting — and is scanning within a minute.
- **Getting back in after a lockout.** A user who has forgotten their password requests a one-time code, enters it, and either sets a fresh password or simply signs straight in.

---

— Accounts & Onboarding —
