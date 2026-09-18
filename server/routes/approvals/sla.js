/**
 * The clocks, as a screen reads them.
 *
 * Nothing here starts or stops a clock: that happens on the bus, where a
 * status change is. These routes show where a clock stands, list the ones
 * about to run out, and let an admin have a plan measured again after its
 * priority changed.
 */
const express = require('express');

const service = require('../../lib/approvals/service');
const store = require('../../lib/approvals/store');
const sla = require('../../lib/approvals/sla');
const machine = require('../../lib/approvals/machine');

// Reading the clocks is also what starts them ticking on a fresh process.
sla.start();
require('../../lib/approvals/notify').subscribe();

const router = express.Router();

const scopeOf = (who) => {
  if (!who || who.role === 'owner') return {};
  const scope = { orgId: who.orgId ?? null };
  if (who.role === 'site_manager') scope.tenantId = who.tenantId ?? -1;
  return scope;
};

/**
 * GET /sla - every plan in one SLA state.
 *
 * `state` is one of the five words a screen uses - on_track, at_risk,
 * breached, paused, none - and defaults to breached, because that is the list
 * somebody opens this for. A plan is in the worst state any of its live clocks
 * is in, so it appears in exactly one of the five.
 */
router.get('/sla', (req, res) => {
  const who = service.actorOf(req.user);
  const state = String(req.query.state || 'breached');
  if (!sla.STATES.includes(state)) {
    return res.status(400).json({ error: `state is one of ${sla.STATES.join(', ')}` });
  }
  const plans = store.listPlans({ ...scopeOf(who),
    status: machine.OPEN.filter((s) => s !== 'written'), limit: 500 })
    .filter((p) => service.canRead(p, who))
    .map((p) => ({ plan: p, sla: sla.of(p.id) }))
    .filter((row) => row.sla.state === state);
  return res.json({ ok: true, state, states: sla.STATES,
    plans: plans.map(({ plan, sla: clocks }) => ({
      id: plan.id, rackId: plan.rackId, rackName: plan.rackName, status: plan.status,
      priority: plan.priority, risk: plan.risk, createdAt: plan.createdAt,
      sla: clocks.state, clocks: clocks.clocks.filter((c) => c.state === state),
    })) });
});

/** GET /sla/:planId - the four clocks of one plan, with how far through each is. */
router.get('/sla/:planId', (req, res) => {
  const who = service.actorOf(req.user);
  const plan = store.getPlan(req.params.planId, { heavy: false });
  if (!plan || !service.canRead(plan, who)) return res.status(404).json({ error: 'no such plan' });
  return res.json({ ok: true, ...sla.of(plan.id) });
});

/**
 * POST /sla/:planId/recalculate - measure the clocks again.
 *
 * For after a priority change: both targets go into the plan's history, so the
 * one that was in force at the time can still be read.
 */
router.post('/sla/:planId/recalculate', (req, res) => {
  const who = service.actorOf(req.user);
  const plan = store.getPlan(req.params.planId, { heavy: false });
  if (!plan || !service.canRead(plan, who)) return res.status(404).json({ error: 'no such plan' });
  if (!machine.ROLES.triage.includes(who.role)) {
    return res.status(403).json({ error: 'Measuring the clocks again is for an admin or the site manager.' });
  }
  const out = sla.recalculate(plan.id, { actor: who });
  return res.json({ ok: true, changed: out.changed, ...sla.of(plan.id) });
});

module.exports = router;
