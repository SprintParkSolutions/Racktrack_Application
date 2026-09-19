/**
 * HTTP API for connection profiles — per-user encrypted credentials for
 * external data sources (ServiceNow, NetBox, SolarWinds Orion, etc.).
 *
 * All routes require auth (req.user populated by requireAuth). Profiles
 * are scoped to req.user.id; no user can see or touch another user's
 * profiles.
 *
 * Routes:
 *   GET    /api/connections              → list metadata for this user
 *   GET    /api/connections/active       → metadata for the active profile
 *   POST   /api/connections              → create {name, type, secret, make_active?}
 *   GET    /api/connections/:id          → metadata for one profile
 *   PATCH  /api/connections/:id          → update {name?, secret?}
 *   POST   /api/connections/:id/activate → make this profile active
 *   POST   /api/connections/deactivate   → clear active (no source for this user)
 *   DELETE /api/connections/:id          → delete one profile
 */
const express = require('express');
const { requireAuth } = require('./auth');
const profiles = require('./lib/connection_profiles');
const { logger } = require('./lib/observability');

const router = express.Router();

/**
 * A NetBox login becomes a NetBox token before anything is stored.
 *
 * Applied to every create and update, for both the per-user and the
 * organisation routes: if the secret carries a username and password and no
 * token, ask that NetBox for a token now. The login is kept (encrypted, like
 * everything else in the blob) so a revoked token can be minted again without
 * asking anyone to type it in twice. Fails loudly — a wrong password should
 * be reported at Save, not discovered at the first Export.
 */
async function withNetboxToken(type, secret) {
  if (type !== 'netbox' || !secret || secret.token) return secret;
  if (!(secret.username && secret.password)) return secret;
  const { provisionToken, cleanBase } = require('./lib/netbox/provision');
  const { token } = await provisionToken(secret.base_url, secret.username, secret.password);
  return { ...secret, base_url: cleanBase(secret.base_url), token, provisioned_at: new Date().toISOString() };
}

function safeAsync(handler) {
  return async (req, res) => {
    try { await handler(req, res); }
    catch (err) {
      logger.error(`[connections] ${req.method} ${req.originalUrl} — ${err.message}`);
      const status = err.status || (err.message?.startsWith('unsupported') ? 400 : 500);
      res.status(status).json({ ok: false, error: err.message || 'request failed' });
    }
  };
}

router.use('/api/connections', requireAuth);

// GET /api/connections — list
// What is at this address? Asked from the Data sources form before any
// credentials exist, so nobody has to know whether what they run is called
// NetBox or ServiceNow to connect to it. Nothing is stored; the answer fills in
// the form and the person can still change it, and signing in confirms it.
// The address is checked before anything is sent to it (lib/safe_address.js):
// never a cloud metadata address, never a private one unless this installation
// says so, never plain http to a public host, and every redirect judged too.
const { detect } = require('./lib/netbox/connectors/detect');
// The connector registry's names, as this page's profile types.
const PROFILE_TYPE = { netbox: 'netbox', servicenow: 'servicenow', rest: 'generic_rest' };
router.post('/api/connections/detect', safeAsync(async (req, res) => {
  const address = String((req.body || {}).address || '').trim();
  if (!address) return res.status(400).json({ error: 'Enter the address of your system.' });
  try {
    const found = await detect(address, {
      allowPrivate: process.env.RT_CONNECTORS_ALLOW_PRIVATE === '1',
      allowed: String(process.env.RT_CONNECTORS_ALLOWED_HOSTS || '')
        .split(',').map((h) => h.trim()).filter(Boolean),
    });
    const type = PROFILE_TYPE[found.type] || 'generic_rest';
    const fields = {};
    if (type === 'servicenow') {
      // This page asks ServiceNow for its instance id, not a URL.
      const host = new URL(found.url).hostname;
      const m = host.match(/^([a-z0-9-]+)\.service-?now\.com$/i);
      fields.instance = m ? m[1] : host;
    } else {
      fields.base_url = found.url;
    }
    return res.json({ type, url: found.url, why: found.why, fields });
  } catch (err) {
    if (err && err.code === 'address_refused') return res.status(400).json({ error: err.message, code: err.code });
    if (err && err.code === 'no_answer') return res.status(502).json({ error: err.message, code: err.code });
    return res.status(502).json({ error: `That address could not be checked: ${err.message}` });
  }
}));

router.get('/api/connections', safeAsync(async (req, res) => {
  res.json({
    ok: true,
    profiles: profiles.list(req.user.id),
    supported_types: profiles.SUPPORTED_TYPES,
  });
}));

// GET /api/connections/active — currently-active profile (no secrets)
router.get('/api/connections/active', safeAsync(async (req, res) => {
  const active = profiles.getActive(req.user.id);
  res.json({ ok: true, active });
}));

// POST /api/connections — create
router.post('/api/connections', safeAsync(async (req, res) => {
  const { name, type, secret, make_active } = req.body || {};
  if (!name || !type || !secret) {
    return res.status(400).json({ ok: false, error: 'name, type, secret are required' });
  }
  const meta = profiles.create(
    req.user.id,
    { name, type, secret: await withNetboxToken(type, secret) },
    { makeActive: make_active !== false }   // default true
  );
  res.json({ ok: true, profile: meta });
}));

// GET /api/connections/:id — metadata for one profile
router.get('/api/connections/:id', safeAsync(async (req, res) => {
  const meta = profiles.get(req.user.id, req.params.id);
  if (!meta) return res.status(404).json({ ok: false, error: 'not found' });
  res.json({ ok: true, profile: meta });
}));

// PATCH /api/connections/:id — update name and/or secret
router.patch('/api/connections/:id', safeAsync(async (req, res) => {
  const { name, secret } = req.body || {};
  if (name === undefined && secret === undefined) {
    return res.status(400).json({ ok: false, error: 'nothing to update' });
  }
  const existing = profiles.get(req.user.id, req.params.id);
  const meta = profiles.update(req.user.id, req.params.id, {
    name, secret: existing ? await withNetboxToken(existing.type, secret) : secret,
  });
  if (!meta) return res.status(404).json({ ok: false, error: 'not found' });
  res.json({ ok: true, profile: meta });
}));

// POST /api/connections/:id/activate — set as active
router.post('/api/connections/:id/activate', safeAsync(async (req, res) => {
  const meta = profiles.activate(req.user.id, req.params.id);
  if (!meta) return res.status(404).json({ ok: false, error: 'not found' });
  res.json({ ok: true, profile: meta });
}));

// POST /api/connections/deactivate — clear active
router.post('/api/connections/deactivate', safeAsync(async (req, res) => {
  profiles.deactivateAll(req.user.id);
  res.json({ ok: true });
}));

// DELETE /api/connections/:id — remove
router.delete('/api/connections/:id', safeAsync(async (req, res) => {
  const removed = profiles.remove(req.user.id, req.params.id);
  if (!removed) return res.status(404).json({ ok: false, error: 'not found' });
  res.json({ ok: true });
}));

// ── Org-scoped connections (admin-set, org-wide, write-only) ──────────
// An org_admin configures external access ONCE for the whole organization
// (their CMDB/ITSM DB, live network sources, etc.). Every member's pipeline
// uses them. Secrets are stored AES-256-GCM and are NEVER returned by any of
// these routes — not even to the admin who set them. Only the server-side
// pipeline decrypts them for outbound calls.
function requireOrgAdmin(req, res, next) {
  if (!req.user || !['org_admin', 'owner'].includes(req.user.role)) {
    return res.status(403).json({ ok: false, error: 'organization admin only' });
  }
  const orgId = req.user.organization_id;
  if (!orgId) {
    return res.status(400).json({ ok: false, error: 'no organization is associated with your account' });
  }
  req._orgId = orgId;
  next();
}
router.use('/api/org-connections', requireAuth, requireOrgAdmin);

// GET /api/org-connections — list what's configured for the org (metadata only)
router.get('/api/org-connections', safeAsync(async (req, res) => {
  res.json({
    ok: true,
    profiles: profiles.listForOrg(req._orgId),
    supported_types: profiles.SUPPORTED_TYPES,
  });
}));

// POST /api/org-connections — set/replace an org credential of a type
router.post('/api/org-connections', safeAsync(async (req, res) => {
  const { name, type, secret } = req.body || {};
  if (!type || !secret) {
    return res.status(400).json({ ok: false, error: 'type and secret are required' });
  }
  const meta = profiles.createForOrg(req._orgId, req.user.id, {
    name: name || type, type, secret: await withNetboxToken(type, secret),
  });
  res.json({ ok: true, profile: meta });   // metadata only — no secret echoed back
}));

// PATCH /api/org-connections/:id — update name and/or secret
router.patch('/api/org-connections/:id', safeAsync(async (req, res) => {
  const { name, secret } = req.body || {};
  if (name === undefined && secret === undefined) {
    return res.status(400).json({ ok: false, error: 'nothing to update' });
  }
  const existing = profiles.getForOrg(req._orgId, req.params.id);
  const meta = profiles.updateForOrg(req._orgId, req.params.id, req.user.id, {
    name, secret: existing ? await withNetboxToken(existing.type, secret) : secret,
  });
  if (!meta) return res.status(404).json({ ok: false, error: 'not found' });
  res.json({ ok: true, profile: meta });
}));

// DELETE /api/org-connections/:id — remove an org credential
router.delete('/api/org-connections/:id', safeAsync(async (req, res) => {
  const removed = profiles.removeForOrg(req._orgId, req.params.id);
  if (!removed) return res.status(404).json({ ok: false, error: 'not found' });
  res.json({ ok: true });
}));

module.exports = router;
