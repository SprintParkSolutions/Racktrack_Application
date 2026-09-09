# Social sign-in setup — Google, Apple, Facebook

"Continue with Google / Apple / Facebook" on the sign-in page and the invite
acceptance page. The code is already in the repo and inert: a provider with no
credentials configured simply never renders its button. Everything below is the
console work needed to switch one on.

**What it does NOT do:** create a new organization. Self-signup mints an org,
requires a company name, and parks the account in `pending` until the platform
owner approves it — none of which a one-tap button can shortcut. `/signup` keeps
its existing form.

---

## How the flow works

```
app ──► GET /api/auth/oauth/<provider>/start
             │  server stores a single-use `state`, 302s onward
             ▼
        provider consent screen  (system browser — never the app WebView)
             │
             ▼
        GET/POST /api/auth/oauth/<provider>/callback   ◄── the ONLY URL the
             │  server redeems the code with its client secret,      provider
             │  resolves the user, mints the normal 30-day JWT       ever sees
             ▼
   web    https://<app>/auth/callback#token=…&user=…
   native com.racktrack.app://auth/callback#token=…&user=…
```

Two things follow from this shape, and both save work:

- **The custom scheme is never registered with any provider.** Google, Apple and
  Facebook only ever see the HTTPS redirect URI pointing at our own server. The
  hop from server to phone is strictly between our backend and the device.
- **No SHA-1 fingerprint of the Android keystore is needed.** That requirement
  comes from the native Google Sign-In SDK, which this does not use. Losing or
  rotating `~/keys/racktrack-release.jks` does not break social login.

The session travels in the URL **fragment**, not the query string — a fragment is
stripped by the browser before the request is sent, so the token never reaches an
access log, a proxy, or a `Referer` header.

Why the system browser rather than native SDKs: Google rejects OAuth attempted
inside an embedded WebView (`disallowed_useragent`), which is exactly what
Capacitor is. Apple and Facebook both need a client *secret* to redeem the code,
and anything shipped inside an `.ipa`/`.apk` is extractable.

---

## 1. Server env vars

Set these wherever the server's environment lives (the Windows production box,
the demo VPS `.env`). Restart the server afterwards — provider config is read at
request time, so no rebuild of the mobile app is needed to turn one on or off.

### Always required

| Var | Example | Notes |
|---|---|---|
| `OAUTH_REDIRECT_BASE` | `https://api.racktrack.ai` | Public HTTPS origin the providers redirect back to. Must match each console entry **byte for byte** — a trailing slash difference is a `redirect_uri_mismatch`. |
| `OAUTH_WEB_ORIGIN` | `https://racktrack.ai` | Where the web app is served. Defaults to `OAUTH_REDIRECT_BASE` if unset. |
| `OAUTH_NATIVE_SCHEME` | `com.racktrack.app` | Optional. Only change it if you also change `Info.plist` and `AndroidManifest.xml`. |

### Google

| Var | Where it comes from |
|---|---|
| `GOOGLE_CLIENT_ID` | Google Cloud Console → APIs & Services → Credentials |
| `GOOGLE_CLIENT_SECRET` | same |

### Apple

| Var | Where it comes from |
|---|---|
| `APPLE_CLIENT_ID` | The **Services ID**, e.g. `com.racktrack.app.web` — *not* the app bundle ID |
| `APPLE_TEAM_ID` | Apple Developer → Membership |
| `APPLE_KEY_ID` | The Key ID of the Sign in with Apple key |
| `APPLE_PRIVATE_KEY` or `APPLE_PRIVATE_KEY_PATH` | Contents of the `.p8` (newlines written as literal `\n`), or a path to it |

### Facebook

| Var | Where it comes from |
|---|---|
| `FACEBOOK_APP_ID` | Meta for Developers → App settings → Basic |
| `FACEBOOK_APP_SECRET` | same |
| `FACEBOOK_TRUST_EMAIL` | Optional, `1` to enable. **Read the warning below first.** |

---

## 2. Google Cloud Console

1. <https://console.cloud.google.com> → select or create the RackTrack project.
2. **APIs & Services → OAuth consent screen.** External. Fill in app name,
   support email, and the developer contact. Add the scopes `openid`, `email`,
   `profile` — nothing else, so the app stays out of Google's verification queue.
3. **Credentials → Create credentials → OAuth client ID → Web application.**
   - Authorized redirect URI:
     `https://api.racktrack.ai/api/auth/oauth/google/callback`
   - Add one per environment you use (production, demo VPS, local tunnel).
4. Copy the client ID and secret into the env vars above.

A single **Web application** client covers web, iOS and Android, because the
provider only ever talks to our server. Do not create Android/iOS OAuth clients.

---

## 3. Apple Developer

Sign in with Apple is fiddlier than the other two — four separate objects.

1. **Certificates, Identifiers & Profiles → Identifiers → App ID**
   `com.racktrack.app` → enable the **Sign in with Apple** capability.
2. **Identifiers → new → Services ID**, e.g. `com.racktrack.app.web`. This is
   what goes in `APPLE_CLIENT_ID`. Configure it:
   - Primary App ID: `com.racktrack.app`
   - Domains: `api.racktrack.ai`
   - Return URL: `https://api.racktrack.ai/api/auth/oauth/apple/callback`
3. **Keys → new key** → enable Sign in with Apple → download the `.p8`.
   **It downloads exactly once.** Store it next to the release keystore. Note
   the Key ID.
4. Team ID is on the Membership page.

Apple returns the user's real name only on the *very first* authorization, and
only in the form body — the code deliberately does not depend on it.

### Two Apple behaviours worth knowing about

- **Hide My Email.** Users can hand over a `@privaterelay.appleid.com` address
  instead of their real one. Mail still delivers, but it will never match an
  invite sent to a work address. The invite path detects this and says so
  explicitly rather than reporting a generic mismatch.
- **App Store Guideline 4.8.** Offering Google or Facebook sign-in on iOS
  *obliges* you to offer Sign in with Apple too. Ship all three or none; a build
  with only Google will likely be rejected on the next review.

---

## 4. Meta / Facebook

1. <https://developers.facebook.com> → Create App → **Authenticate and request
   data from users with Facebook Login** → Business type.
2. Add the **Facebook Login** product. Settings → Valid OAuth Redirect URIs:
   `https://api.racktrack.ai/api/auth/oauth/facebook/callback`
3. App settings → Basic: copy App ID and App Secret. Add the **Privacy Policy
   URL** and a **Data Deletion** URL or callback — Meta will not let the app
   leave Development mode without both.
4. **Business verification** is required before anyone outside your dev/tester
   list can use the button. Budget several days; it needs company documents.
5. Switch the app **Live**.

### ⚠️ `FACEBOOK_TRUST_EMAIL` — the one real security decision here

Google and Apple own their email namespaces and tell us whether an address was
verified. Facebook's Graph API returns an email with **no verification claim
attached**.

So by default Facebook is *not* trusted to match an email to an existing
RackTrack account. Concretely:

| Path | Google / Apple | Facebook (default) |
|---|---|---|
| Already-linked account | signs in | signs in |
| Verified email matches an existing account | links automatically, signs in | **refused** (`link_required`) |
| Invite whose email matches | creates the account | creates the account |
| Unknown email | refused | refused |

The invite row is what makes the third case safe for Facebook: an admin already
sent an invite to that specific address, so requiring the social account to
assert the *same* address means the organization has already vouched for whoever
controls it.

Setting `FACEBOOK_TRUST_EMAIL=1` enables the second row for Facebook too. It also
means anyone who can register a Facebook account against a colleague's email
address inherits that colleague's RackTrack account. Leave it off unless you have
a specific reason.

Facebook also frequently returns **no email at all** — accounts registered with a
phone number, or a user who unticks the email permission on the consent screen.
Those attempts fail with a message pointing them back at the password form.

---

## 5. Native app config

Already committed, listed here so it isn't mistaken for missing setup:

- `client/ios/App/App/Info.plist` — `CFBundleURLTypes` registering the
  `com.racktrack.app` scheme.
- `client/android/app/src/main/AndroidManifest.xml` — a `VIEW` intent-filter for
  the same scheme. `MainActivity` was already `launchMode="singleTask"`, which is
  what makes the deep link arrive at the *running* activity via `onNewIntent`
  instead of starting a second copy.
- `@capacitor/browser@6` added to `client/package.json`.

After pulling these changes, run `npx cap sync` in `client/`.

> **Mac note:** `pod install` on this machine fails with
> `uninitialized constant ActiveSupport::LoggerThreadSafeLevel::Logger` — a
> system-Ruby 2.6 / concurrent-ruby ≥ 1.3.5 incompatibility unrelated to this
> feature (plain `pod --version` fails too). Workaround:
> `RUBYOPT="-rlogger" pod install`.

---

## 6. Verifying it works

```bash
# Which providers does the server think are configured?
curl -s https://api.racktrack.ai/api/auth/providers
# → {"ok":true,"providers":[{"name":"google","label":"Google"}, …]}
```

An empty list means the env vars aren't reaching the process — that is the check
to run first when the buttons don't appear.

Then, in a browser, open
`https://api.racktrack.ai/api/auth/oauth/google/start?platform=web`. You should
land on Google's account chooser. Cancelling returns you to `/login` with an
explanatory message rather than a blank form.

Audit rows land under the actions `auth.social.login` and
`auth.social.invite_accept`, with the provider and whether the account was newly
created in the payload.

---

## 7. What changed in the database

Additive only; the existing migration style in `server/auth.js` applies it at
boot, so there is nothing to run by hand.

- **`social_identities`** — `(provider, subject)` primary key → `user_id`. The
  provider's stable subject is matched *before* email, so a user who later
  changes their Google address keeps their account.
- **`oauth_states`** — short-lived single-use CSRF nonces, swept opportunistically.
- **`users.password_set`** — `0` means the account has no password its owner
  knows. `password_hash` is `NOT NULL` and SQLite cannot drop that without
  rebuilding the table, so social-created accounts store a bcrypt hash of 32
  random bytes that is immediately discarded. Existing rows default to `1`, which
  is correct — they all signed up with a password.

A user with `password_set = 0` can gain a real password through the normal
Forgot Password flow; the emailed code proves inbox control, and that path sets
the flag to `1`.

---

## 8. Files

| File | Role |
|---|---|
| `server/lib/oauthProviders.js` | Per-provider adapters — authorize URL, code exchange, identity normalization |
| `server/socialAuth.js` | Routes, schema, and the account resolution/linking rules |
| `client/src/components/SocialSignIn.jsx` | The buttons; asks the server which to draw |
| `client/src/pages/AuthCallbackPage.jsx` | Web landing route |
| `client/src/utils/socialSession.js` | Fragment parsing, shared by web and native |
| `client/src/App.jsx` | `SocialDeepLinkHandler` — the native `appUrlOpen` listener |
