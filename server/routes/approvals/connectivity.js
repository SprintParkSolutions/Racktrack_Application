/**
 * The ports section of a drift check, for the desk.
 *
 * GET /api/approvals/plans/:planId/connectivity - the same answer the phone
 * gets from /api/nb/plans/:planId/connectivity, from the same function
 * (lib/approvals/connectivity). Whoever may read the check may read its ports:
 * service.get applies canRead, and a plan the caller may not read is 404, the
 * answer for a plan that does not exist.
 *
 * A router of its own, mounted in app.js on /api/approvals/plans BEFORE the
 * sub-application and behind the same login gate. It answers this one path and
 * nothing else, so every other request falls through to routes/approvals.
 */
const express = require('express');

const service = require('../../lib/approvals/service');
const connectivity = require('../../lib/approvals/connectivity');
const { netboxFor } = require('../../lib/approvals/connections');
const gates = require('../netbox/gates');
const { wrap } = require('./http');

const router = express.Router();

router.get('/:planId/connectivity', gates.readers, wrap(async (req, res) => {
  const out = service.get(req.params.planId, req.user);
  if (!out) return res.status(404).json({ error: 'no such plan', code: 'not_found' });
  const client = netboxFor({ orgId: out.plan.orgId ?? req.user?.organization_id ?? null, userId: req.user?.id });
  return res.json(await connectivity.forPlan(out.plan, out.items, { client }));
}));

module.exports = router;
