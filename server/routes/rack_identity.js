/**
 * Rack identity routes: which of the customer's racks a scan is.
 *
 *   GET  /api/scan/:rackId/identity           the answer, with the evidence
 *   POST /api/scan/:rackId/identity/confirm   a person says which rack it is
 *
 * A factory, not a bare router, because three things it needs live in app.js
 * and must not be loaded twice: auth.requireAuth, the audit log (which opens
 * the real auth.db at a fixed path, so a test hands in a stand-in), and the one
 * function that builds the physical layer report, shared with
 * GET /api/scan/:rackId/physical-layer so python is never started twice for
 * one rack.
 *
 * Scoped the way the other /api/scan routes are: lib/rack_access decides who
 * may touch the rack (the owner, an admin of the rack's organisation, a member
 * of the Site that holds it) and everybody else is told 404, never 403. The
 * guard runs after requireAuth on each route, not as router.param, because a
 * param runs before the route's own middleware and would see no user; and
 * requireAuth is not mounted on the /api/scan prefix, because that prefix also
 * serves routes a report link may read with no session.
 *
 * GET writes nothing. It reads the cached physical layer report, building it
 * only when there is none. It states a rack ('matched', with the rackKey) only
 * from the record or from a label that equals one rack in the scan's space;
 * every inference comes back as 'suggested' with no rack and no key. POST is
 * the one write, and what turns a suggestion into a rack. Only these may make
 * it: an admin of the Site (owner, its organisation's admin, its site manager)
 * or the technician who scanned this rack. It answers with the rackKey of the
 * rack the scan is now bound to.
 */
const express = require('express');
const estate = require('../lib/estate');
const tenantLib = require('../lib/tenant');
const rackIdentity = require('../lib/rack_identity');
const { rackOwnershipParam } = require('../lib/rack_access');
const { clientForUser } = require('../lib/netbox/client_for');
const { logger } = require('../lib/observability');

module.exports = function rackIdentityRouter({ requireAuth, audit = null, physicalLayer = null, netboxClientFor = clientForUser } = {}) {
  if (typeof requireAuth !== 'function') throw new Error('rack_identity routes need requireAuth');
  const router = express.Router();
  const guard = rackOwnershipParam({ tenant: tenantLib, logger });
  const guardRack = (req, res, next) => guard(req, res, next, req.params.rackId);

  /** Run a handler; an IdentityError or EstateError becomes its status, anything else 500. */
  const wrap = (fn) => async (req, res) => {
    try {
      await fn(req, res);
    } catch (err) {
      if (err instanceof rackIdentity.IdentityError || err instanceof estate.EstateError) {
        return res.status(err.status).json({ error: err.message, ...(err.extra || {}) });
      }
      logger.error({ event: 'rack_identity.error', err: err.message, route: req.originalUrl }, 'rack identity route failed');
      return res.status(500).json({ error: 'Rack identity request failed' });
    }
  };

  /** The Site this caller sees the scan under; 404 when there is none. */
  function tenantOf(req) {
    const asked = req.query.tenantId ?? req.body?.tenantId ?? null;
    if (asked != null && asked !== '' && !/^\d+$/.test(String(asked))) {
      throw new rackIdentity.IdentityError(400, 'Invalid site id');
    }
    const tenantId = rackIdentity.tenantForRack(req.user, req.params.rackId, asked);
    if (!tenantId) throw new rackIdentity.IdentityError(404, 'Rack not found');
    return tenantId;
  }

  function clientOf(req) {
    try { return netboxClientFor(req.user) || null; } catch { return null; }
  }

  /** The report, from the cache or built through app.js's one builder. Null when it cannot be had. */
  const reportFor = async (rackId) => {
    const cached = rackIdentity.io.readPhysicalLayer(rackId);
    if (cached || !physicalLayer) return cached;
    const built = await physicalLayer(rackId);
    return built && built.status === 200 ? built.body : null;
  };

  router.get('/api/scan/:rackId/identity', requireAuth, guardRack, wrap(async (req, res) => {
    const { rackId } = req.params;
    const tenantId = tenantOf(req);
    let spaceId;
    if (req.query.spaceId !== undefined && req.query.spaceId !== '') {
      if (!/^\d+$/.test(String(req.query.spaceId))) throw new rackIdentity.IdentityError(400, 'Invalid space id');
      spaceId = Number(req.query.spaceId);
    }
    const result = await rackIdentity.identify(rackId, {
      tenantId, spaceId, netboxClient: clientOf(req), physicalLayer: reportFor,
    });
    res.setHeader('Cache-Control', 'no-store');
    res.json({ ok: true, ...result });
  }));

  router.post('/api/scan/:rackId/identity/confirm', requireAuth, guardRack, wrap(async (req, res) => {
    const { rackId } = req.params;
    const tenantId = tenantOf(req);
    const level = estate.accessLevel(req.user, tenantId);
    const scannedIt = !!req.user?.id && tenantLib.tenantUserRackIds(tenantId, req.user.id).has(rackId);
    if (level !== 'write' && !(level === 'read' && scannedIt)) {
      return res.status(403).json({ error: 'Only an admin of this Site or the technician who scanned this rack can confirm it' });
    }
    const body = req.body || {};
    let bound;
    try {
      bound = await rackIdentity.confirm(rackId, {
        tenantId,
        userId: req.user.id,
        knownRackId: body.knownRackId,
        netboxRackId: body.netboxRackId,
        name: body.name,
        netboxClient: clientOf(req),
      });
    } catch (err) {
      audit?.log({ req, action: 'rack.identity.confirm', status: 'fail', targetType: 'rack', targetId: rackId,
        error: err.message, payload: { tenantId } });
      throw err;
    }
    audit?.log({ req, action: 'rack.identity.confirm', status: 'ok', targetType: 'rack', targetId: rackId,
      payload: {
        tenantId, knownRackId: bound.knownRackId, netboxRackId: bound.netboxRackId,
        name: bound.name, rackKey: bound.rackKey, created: bound.created, source: bound.source,
        by: level === 'write' ? 'admin' : 'technician',
      } });
    // What the ladder says now: rung 1, the record. No NetBox client is handed
    // in: the answer is already known, and the confirm should not wait on NetBox.
    const identity = await rackIdentity.identify(rackId, { tenantId });
    res.json({ ok: true, rackKey: bound.rackKey, bound, identity });
  }));

  return router;
};
