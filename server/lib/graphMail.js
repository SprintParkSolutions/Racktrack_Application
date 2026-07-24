/**
 * Microsoft Graph email sender.
 *
 * Sends mail FROM the RackTrack Microsoft 365 mailboxes instead of an
 * individual employee's Gmail:
 *   • 'racktrack' → racktrackteam@sprintpark.com  (verification codes, invites)
 *   • 'support'   → support@racktrack.ai          (contact form / support bot)
 *
 * Token acquisition, in order:
 *   1. CLIENT CREDENTIALS (app-only) — CLIENT_ID + CLIENT_SECRET + TENANT_ID.
 *      This is the "once admin consent is granted, it just works" path: the
 *      app requests its own token and auto-refreshes it. Needs the Mail.Send
 *      APPLICATION permission consented by a tenant admin, and the sender
 *      mailboxes in that tenant.
 *   2. A cached per-mailbox access token written to token/<name>_outlook_cache
 *      .json ({access_token, expires_at}) — used for local testing before the
 *      secret/consent are in place. Short-lived; not for production.
 *
 * If no token can be obtained, sendGraphMail returns false and the caller
 * falls back to SMTP (see auth.js) — so mail delivery never hard-fails here.
 *
 * Config (env overrides the file so production needn't ship token/):
 *   MS_CLIENT_ID, MS_TENANT_ID   (else parsed from token/mailid.md)
 *   MS_CLIENT_SECRET             (enables the client-credentials path)
 *   MAIL_FROM_RACKTRACK, MAIL_FROM_SUPPORT   (override the sender addresses)
 */
const fs = require('fs');
const path = require('path');

let _logger;
function logger() {
  if (_logger) return _logger;
  try { _logger = require('./observability').logger; }
  catch { _logger = console; }
  return _logger;
}

const TOKEN_DIR = path.resolve(__dirname, '..', '..', 'token');

function readIds() {
  let clientId = process.env.MS_CLIENT_ID;
  let tenantId = process.env.MS_TENANT_ID;
  if (!clientId || !tenantId) {
    try {
      const md = fs.readFileSync(path.join(TOKEN_DIR, 'mailid.md'), 'utf8');
      clientId = clientId || (md.match(/CLIENT_ID\s*=\s*"?([0-9a-f-]{36})"?/i) || [])[1];
      tenantId = tenantId || (md.match(/TENANT_ID\s*=\s*"?([0-9a-f-]{36})"?/i) || [])[1];
    } catch { /* no file — env only */ }
  }
  return { clientId, tenantId };
}

const SENDERS = {
  racktrack: {
    address: process.env.MAIL_FROM_RACKTRACK || 'racktrackteam@sprintpark.com',
    cache: 'racktrack_outlook_cache.json',
  },
  support: {
    address: process.env.MAIL_FROM_SUPPORT || 'support@racktrack.ai',
    cache: 'support_outlook_cache.json',
  },
};

// App-only token via client credentials, cached in memory until ~1 min before
// expiry so we refresh proactively.
let _appToken = { token: null, exp: 0 };
async function appToken() {
  const now = Date.now() / 1000;
  if (_appToken.token && _appToken.exp - 60 > now) return _appToken.token;

  const { clientId, tenantId } = readIds();
  const secret = process.env.MS_CLIENT_SECRET;
  if (!clientId || !tenantId || !secret) return null;

  try {
    const body = new URLSearchParams({
      client_id: clientId,
      client_secret: secret,
      scope: 'https://graph.microsoft.com/.default',
      grant_type: 'client_credentials',
    });
    const r = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!r.ok) {
      logger().error(`[graphMail] client-credentials token failed: ${r.status} ${await r.text().catch(() => '')}`);
      return null;
    }
    const j = await r.json();
    _appToken = { token: j.access_token, exp: now + (j.expires_in || 3600) };
    return _appToken.token;
  } catch (err) {
    logger().error(`[graphMail] token request error: ${err.message}`);
    return null;
  }
}

// Fallback: a cached per-mailbox access token (local testing only).
function cachedToken(cacheFile) {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(TOKEN_DIR, cacheFile), 'utf8'));
    const notExpired = !j.expires_at || Number(j.expires_at) > Date.now() / 1000 + 30;
    if (j.access_token && notExpired) return j.access_token;
  } catch { /* no cache */ }
  return null;
}

async function tokenFor(senderKey) {
  const app = await appToken();
  if (app) return app;
  const s = SENDERS[senderKey];
  return s ? cachedToken(s.cache) : null;
}

// True when at least one path could produce a token — lets callers decide
// whether to even attempt Graph before falling back to SMTP.
function isConfigured() {
  const { clientId, tenantId } = readIds();
  if (clientId && tenantId && process.env.MS_CLIENT_SECRET) return true;
  return !!(cachedToken(SENDERS.racktrack.cache) || cachedToken(SENDERS.support.cache));
}

/**
 * Send an email FROM one of the configured mailboxes via Microsoft Graph.
 * Returns true on delivery (HTTP 202), false if not configured or on failure —
 * the caller then falls back to SMTP.
 */
async function sendGraphMail({ sender = 'racktrack', to, subject, html, text, replyTo }) {
  const s = SENDERS[sender];
  if (!s) throw new Error(`graphMail: unknown sender "${sender}"`);

  const token = await tokenFor(sender);
  if (!token) return false;

  const recipients = (Array.isArray(to) ? to : [to])
    .filter(Boolean)
    .map((address) => ({ emailAddress: { address } }));
  if (!recipients.length) throw new Error('graphMail: no recipients');

  const message = {
    subject: subject || '',
    body: { contentType: html ? 'HTML' : 'Text', content: html || text || '' },
    toRecipients: recipients,
    ...(replyTo ? { replyTo: [{ emailAddress: { address: replyTo } }] } : {}),
  };

  try {
    const r = await fetch(
      `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(s.address)}/sendMail`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, saveToSentItems: true }),
      },
    );
    if (r.status === 202) {
      logger().info(`[graphMail] sent from ${s.address} to ${recipients.map((x) => x.emailAddress.address).join(', ')}`);
      return true;
    }
    logger().error(`[graphMail] sendMail from ${s.address} failed: ${r.status} ${await r.text().catch(() => '')}`);
    return false;
  } catch (err) {
    logger().error(`[graphMail] sendMail from ${s.address} error: ${err.message}`);
    return false;
  }
}

module.exports = { sendGraphMail, isConfigured, SENDERS };
