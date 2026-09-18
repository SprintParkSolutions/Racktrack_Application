/**
 * Verification: the second scan, and what it proves.
 *
 * Mounted under /api/approvals with the rest of the sub-application's routes,
 * behind auth.requireAuth. Who may run a verification is not decided here - it
 * is decided in lib/approvals/verify.js, for every caller, because a route is
 * not the only way in.
 */
const express = require('express');

const service = require('../../lib/approvals/service');
const verify = require('../../lib/approvals/verify');
const store = require('../../lib/approvals/store');
// Mounting the routes is what puts the clocks and the notices on the bus.
require('../../lib/approvals/notify').subscribe();
require('../../lib/approvals/sla').start();

const router = express.Router();

const answer = (res, out, code = 200) => (out && out.error
  ? res.status(service.httpStatus(out)).json(out)
  : res.status(code).json({ ok: true, ...out }));

/**
 * POST /plans/:id/verify  { scanId }
 *
 * Runs the comparison of a newer scan of the same rack and records what it
 * proves: a pass sends the plan on for approval, a fail reopens it.
 */
router.post('/plans/:id/verify', async (req, res) => {
  try {
    const out = await verify.run(req.params.id, {
      scanId: (req.body || {}).scanId, kind: 'post_fix', actor: req.user, req,
    });
    return answer(res, out);
  } catch (err) {
    return res.status(502).json({ error: `the verification could not run: ${err.message}` });
  }
});

/** GET /plans/:id/verifications - every verification this plan has had. */
router.get('/plans/:id/verifications', (req, res) => {
  const who = service.actorOf(req.user);
  const plan = store.getPlan(req.params.id, { heavy: false });
  if (!plan || !service.canRead(plan, who)) return res.status(404).json({ error: 'no such plan' });
  return res.json({ ok: true, verifications: verify.historyOf(plan.id) });
});

module.exports = router;
