/**
 * The write to NetBox, and the two ways out of a write that failed.
 *
 * Every guard lives in lib/approvals/write.js and lib/approvals/service.js;
 * this file is the door. An organization admin and the owner write, nobody
 * else, and the role is checked again inside the service for callers that do
 * not come through a route.
 */
const express = require('express');

const service = require('../../lib/approvals/service');
const write = require('../../lib/approvals/write');
const machine = require('../../lib/approvals/machine');

const router = express.Router();

const only = (roles, message) => (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Authentication required' });
  if (!roles.includes(req.user.role)) return res.status(403).json({ error: message });
  return next();
};
const writer = only(machine.ROLES.writer,
  'An admin approves and writes. Send this plan to yours to review.');

const answer = (res, out) => (out && out.error
  ? res.status(service.httpStatus(out)).json(out)
  : res.json({ ok: true, ...out }));

/**
 * POST /plans/:id/write
 *
 * Compares NetBox once more, writes only what was approved, reads the objects
 * before and after, and then checks that what was written is really there. A
 * plan whose write failed is retried through this same route, under the same
 * approval, while the hash still stands.
 */
router.post('/plans/:id/write', writer, async (req, res) => {
  try {
    const out = await write.run(req.params.id, {
      actor: req.user, req, reason: (req.body || {}).reason || null,
    });
    return answer(res, out);
  } catch (err) {
    return res.status(502).json({ error: `the write could not run: ${err.message}` });
  }
});

/** GET /plans/:id/write - the last write, with the before and after snapshots. */
router.get('/plans/:id/write', (req, res) => {
  const out = write.of(req.params.id, req.user);
  if (!out) return res.status(404).json({ error: 'no such plan' });
  return res.json({ ok: true, ...out });
});

/** POST /plans/:id/manual-review { reason } - a stuck write handed to a person. */
router.post('/plans/:id/manual-review', writer, (req, res) => {
  const out = write.toManualReview(req.params.id, {
    reason: (req.body || {}).reason, actor: req.user, req,
  });
  return answer(res, out);
});

module.exports = router;
