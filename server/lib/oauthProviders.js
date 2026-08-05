/**
 * OAuth 2.0 / OIDC provider adapters — Google, Apple, Facebook.
 *
 * Every provider is reduced to the same two operations so socialAuth.js never
 * has to branch on which one it's talking to:
 *
 *   authorizeUrl(state, redirectUri)  → the URL to send the browser to
 *   exchange(code, redirectUri)       → { provider, subject, email,
 *                                         emailVerified, name }
 *
 * WHY THE AUTHORIZATION-CODE FLOW AND NOT NATIVE SDKs
 * ---------------------------------------------------
 * Two constraints force it. Google rejects OAuth attempted inside an embedded
 * WebView (`disallowed_useragent`), which is exactly what Capacitor is — so the
 * system browser is mandatory regardless. And Apple and Facebook both require a
 * client SECRET to redeem the code; anything shipped inside an .ipa/.apk is
 * extractable, so the redemption has to happen here. The upshot is one flow
 * that serves web, iOS and Android identically.
 *
 * ON NOT VERIFYING id_token SIGNATURES
 * ------------------------------------
 * The id_token is not fetched from the browser — it comes straight back from
 * the provider's token endpoint over TLS, in exchange for our client secret.
 * OIDC Core §3.1.3.7 explicitly permits skipping signature validation in this
 * case. We still check iss / aud / exp, because those catch a misconfigured
 * client ID (e.g. pointing at the wrong Google project) rather than forgery.
 *
 * Configuration lives entirely in env vars — see docs/SOCIAL-LOGIN-SETUP.md.
 * A provider with no credentials configured is simply reported as disabled and
 * its button never renders; it is never a boot error.
 */

const fs = require('fs');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const env = (k) => {
  const v = process.env[k];
  return v && String(v).trim() ? String(v).trim() : null;
};

// ── Apple client secret ──────────────────────────────────────
// Apple is the odd one out: instead of a static secret string it wants a
// short-lived ES256 JWT signed with a .p8 key downloaded from the developer
// portal. Apple caps the lifetime at 6 months; we mint a 50-minute one per
// exchange and cache it, so a key rotation takes effect without a restart.
let _appleSecretCache = null;   // { token, expiresAt }

function applePrivateKey() {
  const inline = env('APPLE_PRIVATE_KEY');
  // Env vars can't hold real newlines through most process managers, so the
  // conventional escape is a literal "\n" — restore them before signing.
  if (inline) return inline.replace(/\\n/g, '\n');
  const p = env('APPLE_PRIVATE_KEY_PATH');
  if (p && fs.existsSync(p)) return fs.readFileSync(p, 'utf8');
  return null;
}

function appleClientSecret() {
  const now = Date.now();
  if (_appleSecretCache && _appleSecretCache.expiresAt > now + 60_000) {
    return _appleSecretCache.token;
  }
  const key = applePrivateKey();
  const teamId = env('APPLE_TEAM_ID');
  const keyId = env('APPLE_KEY_ID');
  const clientId = env('APPLE_CLIENT_ID');
  if (!key || !teamId || !keyId || !clientId) return null;

  const iat = Math.floor(now / 1000);
  const exp = iat + 50 * 60;
  const token = jwt.sign(
    { iss: teamId, iat, exp, aud: 'https://appleid.apple.com', sub: clientId },
    key,
    { algorithm: 'ES256', keyid: keyId }
  );
  _appleSecretCache = { token, expiresAt: exp * 1000 };
  return token;
}

// ── id_token helpers ─────────────────────────────────────────
function decodeIdToken(idToken) {
  const payload = jwt.decode(idToken);
  if (!payload || typeof payload !== 'object') {
    throw new Error('Provider returned an unreadable identity token');
  }
  return payload;
}

function assertClaims(payload, { issuers, audience, provider }) {
  const iss = String(payload.iss || '');
  if (!issuers.includes(iss)) {
    throw new Error(`${provider}: unexpected token issuer`);
  }
  // `aud` is a string for a single audience, an array when the token is shared.
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!aud.includes(audience)) {
    throw new Error(`${provider}: identity token was not issued for this app`);
  }
  if (payload.exp && Date.now() / 1000 > Number(payload.exp)) {
    throw new Error(`${provider}: identity token has expired`);
  }
}

// Apple sends email_verified as the STRING "true" in some responses and a real
// boolean in others. Google always sends a boolean. Normalize both.
function truthy(v) {
  return v === true || v === 'true' || v === 1 || v === '1';
}

async function postForm(url, params, label) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = null; }
  if (!res.ok || !data) {
    // Provider error bodies name the misconfiguration precisely
    // (redirect_uri_mismatch, invalid_client…), so surface them to the log.
    const detail = data?.error_description || data?.error || text.slice(0, 200);
    throw new Error(`${label} token exchange failed (${res.status}): ${detail}`);
  }
  return data;
}

// ── Google ───────────────────────────────────────────────────
const google = {
  name: 'google',
  label: 'Google',
  get clientId() { return env('GOOGLE_CLIENT_ID'); },
  get clientSecret() { return env('GOOGLE_CLIENT_SECRET'); },
  isEnabled() { return !!(this.clientId && this.clientSecret); },

  // Verified Google emails are safe to auto-link to an existing password
  // account — Google owns the namespace and asserts verification.
  trustsEmail: true,

  authorizeUrl(state, redirectUri) {
    const q = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      state,
      // Force the chooser: without it a shared device silently reuses whichever
      // Google account happens to be signed in, which reads as "the app logged
      // me in as my colleague".
      prompt: 'select_account',
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
  },

  async exchange(code, redirectUri) {
    const data = await postForm('https://oauth2.googleapis.com/token', {
      code,
      client_id: this.clientId,
      client_secret: this.clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }, 'Google');

    const payload = decodeIdToken(data.id_token);
    assertClaims(payload, {
      issuers: ['https://accounts.google.com', 'accounts.google.com'],
      audience: this.clientId,
      provider: 'Google',
    });
    return {
      provider: 'google',
      subject: String(payload.sub),
      email: payload.email ? String(payload.email).toLowerCase() : null,
      emailVerified: truthy(payload.email_verified),
      name: payload.name || null,
    };
  },
};

// ── Apple ────────────────────────────────────────────────────
const apple = {
  name: 'apple',
  label: 'Apple',
  // NOTE: this is the Services ID (e.g. com.racktrack.app.web), NOT the app
  // bundle ID. The browser flow is a "web" client to Apple even when it is a
  // phone driving it, so one Services ID covers web, iOS and Android.
  get clientId() { return env('APPLE_CLIENT_ID'); },
  isEnabled() { return !!(this.clientId && appleClientSecret()); },

  trustsEmail: true,

  authorizeUrl(state, redirectUri) {
    const q = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'name email',
      state,
      // Requesting any scope obliges Apple to POST the result as a form rather
      // than redirect with a query string. The callback route accepts both.
      response_mode: 'form_post',
    });
    return `https://appleid.apple.com/auth/authorize?${q}`;
  },

  async exchange(code, redirectUri) {
    const data = await postForm('https://appleid.apple.com/auth/token', {
      code,
      client_id: this.clientId,
      client_secret: appleClientSecret(),
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }, 'Apple');

    const payload = decodeIdToken(data.id_token);
    assertClaims(payload, {
      issuers: ['https://appleid.apple.com'],
      audience: this.clientId,
      provider: 'Apple',
    });
    return {
      provider: 'apple',
      subject: String(payload.sub),
      email: payload.email ? String(payload.email).toLowerCase() : null,
      emailVerified: truthy(payload.email_verified),
      // Apple returns the human name ONCE, on the very first authorization,
      // and in the form body rather than the token. We don't rely on it.
      name: null,
      // Hide-My-Email addresses (@privaterelay.appleid.com) still deliver, but
      // they'll never match an invite sent to a work address — the caller uses
      // this to explain that specific failure rather than say "no account".
      isPrivateEmail: truthy(payload.is_private_email),
    };
  },
};

// ── Facebook ─────────────────────────────────────────────────
const facebook = {
  name: 'facebook',
  label: 'Facebook',
  get clientId() { return env('FACEBOOK_APP_ID'); },
  get clientSecret() { return env('FACEBOOK_APP_SECRET'); },
  isEnabled() { return !!(this.clientId && this.clientSecret); },

  // DELIBERATELY off by default, and the one real security difference between
  // the providers. Google and Apple own their email namespaces and tell us
  // whether the address was verified. Facebook's Graph API returns an email
  // with no verification claim attached, so treating it as proof of identity
  // would let a Facebook account created against someone else's address take
  // over their RackTrack login. Set FACEBOOK_TRUST_EMAIL=1 only if you accept
  // that. With it off, Facebook still works for sign-in once linked, and on the
  // invite path (where the invite itself proves who owns the address).
  get trustsEmail() { return env('FACEBOOK_TRUST_EMAIL') === '1'; },

  authorizeUrl(state, redirectUri) {
    const q = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'email public_profile',
      state,
    });
    return `https://www.facebook.com/v21.0/dialog/oauth?${q}`;
  },

  async exchange(code, redirectUri) {
    const token = await postForm('https://graph.facebook.com/v21.0/oauth/access_token', {
      code,
      client_id: this.clientId,
      client_secret: this.clientSecret,
      redirect_uri: redirectUri,
    }, 'Facebook');

    // appsecret_proof stops a leaked user access token from being replayed
    // against the Graph API from anywhere but this server.
    const proof = crypto.createHmac('sha256', this.clientSecret)
      .update(token.access_token).digest('hex');
    const url = `https://graph.facebook.com/v21.0/me?fields=id,name,email`
      + `&access_token=${encodeURIComponent(token.access_token)}`
      + `&appsecret_proof=${proof}`;

    const res = await fetch(url);
    const me = await res.json().catch(() => null);
    if (!res.ok || !me || !me.id) {
      throw new Error(`Facebook profile lookup failed: ${me?.error?.message || res.status}`);
    }
    return {
      provider: 'facebook',
      subject: String(me.id),
      // Absent whenever the account was registered with a phone number, or the
      // user unticked the email permission on the consent screen.
      email: me.email ? String(me.email).toLowerCase() : null,
      emailVerified: false,   // Facebook makes no verification assertion
      name: me.name || null,
    };
  },
};

const PROVIDERS = { google, apple, facebook };

function getProvider(name) {
  const p = PROVIDERS[String(name || '').toLowerCase()];
  return p && p.isEnabled() ? p : null;
}

// Which buttons should the sign-in page draw? Configuration lives on the
// server, so turning a provider on is an env change plus a restart — no
// rebuild-and-resubmit of the mobile app.
function enabledProviders() {
  return Object.values(PROVIDERS)
    .filter(p => p.isEnabled())
    .map(p => ({ name: p.name, label: p.label }));
}

module.exports = { getProvider, enabledProviders, PROVIDERS };
