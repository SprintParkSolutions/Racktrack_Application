/**
 * Maintenance windows, per datacentre.
 *
 * A window is a promise that things are expected to move between these hours.
 * A plan raised inside one is flagged with it, and its SLA clocks pause while
 * it is open: nobody is late for a change everyone agreed to.
 */
const express = require('express');

const service = require('../../lib/approvals/service');
const exceptions = require('../../lib/approvals/exceptions');
const machine = require('../../lib/approvals/machine');

const router = express.Router();

const only = (roles, message) => (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Authentication required' });
  if (!roles.includes(req.user.role)) return res.status(403).json({ error: message });
  return next();
};
const admin = only(machine.ROLES.triage,
  'Change windows are set by an organization admin or the site manager of the Site.');

const answer = (res, out, code = 200) => (out && out.error
  ? res.status(service.httpStatus(out)).json(out)
  : res.status(code).json({ ok: true, ...out }));

/** GET /windows - the change windows of the organization, newest first. */
router.get('/windows', (req, res) => answer(res, exceptions.listWindows({
  actor: service.actorOf(req.user), tenantId: req.query.tenantId,
})));

/** POST /windows { tenantId, startsAt, endsAt, note } */
router.post('/windows', admin, (req, res) => answer(res,
  exceptions.createWindow(req.body || {}, { actor: service.actorOf(req.user), req }), 201));

/** DELETE /windows/:id */
router.delete('/windows/:id', admin, (req, res) => answer(res,
  exceptions.deleteWindow(req.params.id, { actor: service.actorOf(req.user), req })));

module.exports = router;
