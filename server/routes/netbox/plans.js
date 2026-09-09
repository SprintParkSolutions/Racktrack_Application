/**
 * The push workflow: compare, identify, pass to the admin.
 *
 * Everything a rack scan would change goes to one person, who approves it,
 * rejects it, or sends it to somebody to go and look. A resolved ticket comes
 * back here rather than writing anything itself, so however many people are
 * involved there is one name against every change that reaches the customer's
 * record.
 *
 * The write itself lives in netbox.js, gated on a plan from here.
 */
const express = require('express');

const plans = require('../../lib/netbox/plans');

const router = express.Router();

const who = (req) => (req.user && (req.user.username || req.user.email)) || null;
const isAdmin = (req) => ['owner', 'org_admin', 'site_manager'].includes(req.user?.role);

/** Everything in one place for a report or a board. */
router.get('/', (req, res) => {
  res.json({
    plans: plans.list({
      scanId: req.query.scanId ?? null,
      rackId: req.query.rackId ?? null,
      limit: Math.min(Number(req.query.limit) || 50, 200),
    }),
  });
});

router.get('/:planId', (req, res) => {
  const plan = plans.get(req.params.planId);
  if (!plan) return res.status(404).json({ error: 'no such plan' });
  res.json({ ...plan, settled: plans.isSettled(plan), summary: plans.summarise(plan.items) });
});

/** Just the tickets, for whoever has to work them. */
router.get('/:planId/tickets', (req, res) => {
  const plan = plans.get(req.params.planId);
  if (!plan) return res.status(404).json({ error: 'no such plan' });
  const tickets = plan.items
    .filter((i) => i.ticket)
    .filter((i) => !req.query.assignee || i.ticket.assignee === req.query.assignee)
    .filter((i) => !req.query.status || i.ticket.status === req.query.status)
    .map((i) => ({ ...i.ticket, uid: i.uid, type: i.type, name: i.name,
                   action: i.action, diff: i.diff }));
  res.json({ planId: plan.id, tickets });
});

/**
 * The admin decides. Three ways per item, and nothing is all-or-nothing.
 *
 *   { decisions: [ { uid, decision: 'approved'|'rejected'|'ticketed',
 *                    note, assignee } ] }
 */
router.post('/:planId/decide', (req, res) => {
  if (!isAdmin(req)) {
    return res.status(403).json({
      error: 'Only an admin decides what gets written. Ask yours to review this plan.',
    });
  }
  const { decisions } = req.body || {};
  if (!Array.isArray(decisions) || !decisions.length) {
    return res.status(400).json({ error: 'send { decisions: [ { uid, decision } ] }' });
  }
  const out = plans.decide(req.params.planId, decisions, { by: who(req) });
  if (out.error) return res.status(out.error === 'no such plan' ? 404 : 409).json(out);
  res.json({
    planId: out.plan.id,
    applied: out.applied,
    refused: out.refused,
    summary: plans.summarise(out.plan.items),
    settled: plans.isSettled(out.plan),
  });
});

/**
 * Whoever the ticket went to has been and looked.
 *
 * Their answer returns the item to the admin as undecided. A finished ticket
 * is not an approval, and this route deliberately cannot approve anything.
 */
router.post('/:planId/tickets/:uid/resolve', (req, res) => {
  const { finding, outcome } = req.body || {};
  const plan = plans.get(req.params.planId);
  if (!plan) return res.status(404).json({ error: 'no such plan' });

  const item = plan.items.find((i) => i.uid === req.params.uid);
  if (!item || !item.ticket) return res.status(404).json({ error: 'no ticket on that item' });

  // The person it was assigned to can resolve it; so can an admin.
  const me = who(req);
  if (item.ticket.assignee !== me && !isAdmin(req)) {
    return res.status(403).json({
      error: `this ticket is assigned to ${item.ticket.assignee}`,
    });
  }

  const out = plans.resolveTicket(req.params.planId, req.params.uid,
                                  { by: me, finding, outcome });
  if (out.error) return res.status(409).json(out);
  res.json({
    planId: out.plan.id,
    uid: out.item.uid,
    ticket: out.item.ticket,
    decision: out.item.decision,
    note: 'Back with the admin. A resolved ticket writes nothing on its own.',
  });
});

module.exports = router;
