/**
 * Accepted drift and known exceptions.
 *
 * Writing one down is an admin's decision, because it stops a question being
 * asked at all. Reading them is open to anyone who reads plans: an exception
 * that only admins can see is a way of hiding drift, which is the opposite of
 * what it is for.
 */
const express = require('express');

const service = require('../../lib/approvals/service');
const exceptions = require('../../lib/approvals/exceptions');
const store = require('../../lib/approvals/store');
const machine = require('../../lib/approvals/machine');

const router = express.Router();

const only = (roles, message) => (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Authentication required' });
  if (!roles.includes(req.user.role)) return res.status(403).json({ error: message });
  return next();
};
const admin = only(machine.ROLES.triage,
  'Writing down an accepted difference is for an organization admin or a site manager.');

const answer = (res, out, code = 200) => (out && out.error
  ? res.status(service.httpStatus(out)).json(out)
  : res.status(code).json({ ok: true, ...out }));

/** GET /exceptions - every exception of the organization. */
router.get('/exceptions', (req, res) => answer(res, exceptions.list({
  actor: service.actorOf(req.user), tenantId: req.query.tenantId, rackId: req.query.rackId,
  includeRevoked: ['1', 'true'].includes(String(req.query.includeRevoked || '')),
})));

/** GET /exceptions/expiring - the ones that lapse or need a review soon. */
router.get('/exceptions/expiring', (req, res) => answer(res, exceptions.expiringSoon({
  actor: service.actorOf(req.user), days: req.query.days,
})));

/** POST /exceptions - write one down. */
router.post('/exceptions', admin, (req, res) => answer(res,
  exceptions.create(req.body || {}, { actor: service.actorOf(req.user), req }), 201));

/** DELETE /exceptions/:id - stop it now. What it already marked stays marked. */
router.delete('/exceptions/:id', admin, (req, res) => answer(res,
  exceptions.revoke(req.params.id, { actor: service.actorOf(req.user), req })));

/**
 * POST /plans/:id/exceptions/apply
 *
 * For a plan that was filed before an exception was written down: mark
 * everything the live exceptions now cover, so nobody is asked about it.
 */
router.post('/plans/:id/exceptions/apply', admin, (req, res) => {
  const who = service.actorOf(req.user);
  const plan = store.getPlan(req.params.id, { heavy: false });
  if (!plan || !service.canTouch(plan, who)) return res.status(404).json({ error: 'no such plan' });
  const out = exceptions.applyToPlan(plan.id, { actor: who });
  return res.json({ ok: true, applied: out.applied, plan: out.plan });
});

module.exports = router;
