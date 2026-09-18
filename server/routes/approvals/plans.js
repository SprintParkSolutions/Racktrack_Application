/**
 * One plan, and everything a person does to it.
 *
 * Mounted at /api/approvals/plans. Every rule lives in lib/approvals - the
 * status table in machine.js, the operations in service.js - and this file is
 * the translation between an HTTP request and one of those calls: read the
 * body, name the caller, hand back what the service answered.
 *
 * Two gates guard every route. The mount authenticates and this file names
 * the roles per route, so a member who reaches the sub-application at all is
 * still refused triage by the door rather than by a rule twelve calls deep.
 * The service then applies the rule that needs the plan in hand - the creator,
 * the assignee, the person who resolved a ticket and so may not approve it.
 *
 * The order of the routes matters in one place: a fixed path has to be
 * declared before '/:planId' or express reads the word as an id.
 */
const express = require('express');

const service = require('../../lib/approvals/service');
const scans = require('../../lib/netbox/store');
const tenant = require('../../lib/tenant');
const writer = require('../../lib/netbox/writer');
const { netboxFor } = require('../../lib/approvals/connections');
const { canAccessRack, isValidRackId } = require('../../lib/rack_access');
const gates = require('../netbox/gates');
const { answer, fail, refused, wrap, filtersOf } = require('./http');

const router = express.Router();

const TRIAGE_GATE = gates.only(gates.ADMINS,
  'Triage and assignment are for an organization admin or the site manager of this Site.');
const ADMIN_GATE = gates.only(gates.WRITERS, 'This is for an organization admin.');

const idOf = (req) => req.params.planId;
const bodyOf = (req) => req.body || {};

/**
 * Plans, newest first, scoped to what the caller may read.
 *
 * Filters: status (one or a comma list), tenantId, rackId, scanId, priority,
 * risk, assignee ('me' works), createdBy ('me' works), since, until, q, sla,
 * open=1 for everything not yet written or closed, limit and cursor. The
 * whole set, so `?rackId=RK-1&open=1` finds the plan a rack already has open.
 */
router.get('/', gates.readers, (req, res) => {
  const out = service.list(req.user, filtersOf(req.query));
  return answer(res, out);
});

/**
 * Compare a rack against NetBox again, from the desk.
 *
 * The phone's route takes a SCAN id, which a screen that is looking at a rack
 * does not have, so this takes the rack and finds its latest scan itself. It
 * then runs exactly the comparison the preview route runs - the same
 * snapshot, from routes/netbox/netbox.js, and the same writer.plan() - and
 * files the answer as a plan.
 *
 * Comparing twice does not pile up plans: when this organization already holds
 * an open plan for the rack with the same fingerprint, to the byte, that plan
 * comes back with `reused: true`.
 *
 * A technician compares from the phone, so this is for an admin and the site
 * manager of the Site. Rack access is checked for every one of them: a rack
 * the caller may not reach is, to them, not there.
 */
router.post('/compare', gates.only(gates.ADMINS,
  'Comparing from here is for an organization admin or the site manager of this Site.'),
wrap(async (req, res) => {
  const rackId = String(bodyOf(req).rackId || '').trim();
  if (!isValidRackId(rackId)) {
    return res.status(400).json({ code: 'bad_request', error: 'send { rackId }' });
  }
  if (!canAccessRack(req.user, rackId, tenant)) {
    return res.status(404).json({ code: 'not_found', error: 'no such rack' });
  }
  // The rack's own scans, newest first, the adopted one preferred: that is
  // what the phone compares and what Review has reconciled.
  const rows = scans.scansForRack(rackId);
  const scan = rows.find((r) => r.source === 'adopted') || rows[0];
  if (!scan) {
    return res.status(409).json({ code: 'guard',
      error: 'This rack has not been scanned yet. Scan it from the RackTrack app, then compare.' });
  }
  const { snapshotFor, tenantOfScan } = require('../netbox/netbox');
  const got = snapshotFor(scan.id);
  if (got.error) return res.status(got.status).json({ code: 'guard', error: got.error });
  const client = netboxFor({ orgId: req.user?.organization_id ?? null, userId: req.user?.id });
  if (!client) {
    return res.status(428).json({ code: 'guard',
      error: 'No NetBox connection for this organisation yet. An admin adds one under Data Sources.' });
  }
  const report = await writer.plan(got.snap, client);
  scans.recordStage(got.scan.id, 'preview', 'ok',
    Object.entries(report.counts || {}).sort().map(([k, v]) => `${k}=${v}`).join(' \u00b7 '));
  const filed = service.createFromPreview({
    scan: got.scan, snap: got.snap, report, actor: req.user,
    tenantId: tenantOfScan(got.scan, req.user), reuse: true,
  });
  return res.json({ ok: true, planId: filed.plan.id, reused: Boolean(filed.reused),
    fingerprint: filed.plan.fingerprint, counts: report.counts || {},
    summary: filed.plan.summary });
}));

/** One plan with its items, tickets, decisions, history and what you may do next. */
router.get('/:planId', gates.readers, (req, res) => {
  const out = service.get(idOf(req), req.user);
  if (!out) return res.status(404).json({ error: 'no such plan', code: 'not_found' });
  return res.json({ ok: true, ...out });
});

/** A technician hands the comparison to the admin, with their note. */
router.post('/:planId/submit', gates.readers, (req, res) => answer(res,
  service.submit(idOf(req), { note: bodyOf(req).note, actor: req.user, req })));

/** The admin sizes it up: category, priority, risk, disposition, duplicate, exception. */
router.post('/:planId/triage', TRIAGE_GATE, (req, res) => answer(res,
  service.triage(idOf(req), bodyOf(req), { actor: req.user, req })));

/**
 * The admin hands items to a person.
 *
 *   { items: [uid], assignee, assigneeId, question }   named items
 *   { items: '*', assignee, assigneeId, question }     everything still waiting
 *   { rows: [{ uid, assignee, assigneeId, question }] } different people at once
 *
 * The two forms are not mixed. A list that carries '*' beside real uids would
 * either drop the uids or assign everything, and neither is what was meant, so
 * it is refused before anything is written.
 */
router.post('/:planId/assign', TRIAGE_GATE, wrap(async (req, res) => {
  const body = bodyOf(req);
  if (Array.isArray(body.items) && body.items.some((u) => String(u) === '*')) {
    return res.status(400).json({
      code: 'bad_request',
      error: "send the whole-rack assign on its own as items: '*', not mixed with single items",
    });
  }
  if (body.items === '*' && Array.isArray(body.rows) && body.rows.length) {
    return res.status(400).json({
      code: 'bad_request',
      error: "send the whole-rack assign on its own as items: '*', not mixed with single items",
    });
  }
  return answer(res, await service.assign(idOf(req), body, { actor: req.user, req }));
}));

/**
 * The four moves on one ticket. Accept and start say somebody has it; pending
 * parks it with a reason from the list; resolve brings it back to the admin
 * with what was found - and a finding is not optional, because "resolved" with
 * nothing said tells the admin nothing they can decide on.
 */
const TICKET_MOVES = {
  accept: (id, uid, body, opts) => service.acceptTicket(id, uid, opts),
  start: (id, uid, body, opts) => service.startTicket(id, uid, opts),
  pending: (id, uid, body, opts) => service.holdTicket(id, uid, body, opts),
  resolve: (id, uid, body, opts) => service.resolveTicket(id, uid, body, opts),
};
for (const [move, call] of Object.entries(TICKET_MOVES)) {
  router.post(`/:planId/tickets/:uid/${move}`, gates.readers, (req, res) => answer(res,
    call(idOf(req), req.params.uid, bodyOf(req), { actor: req.user, req })));
}

/**
 * Approve or reject items, one by one:
 * { decisions: [{ uid, decision, note, reasonCode }] }.
 *
 * Refused per item, never all-or-nothing: what went through is in `applied`
 * and what did not is in `refused` with the reason, so a screen can say which
 * row is still waiting on somebody.
 */
router.post('/:planId/decide', gates.approver, (req, res) => {
  const decisions = bodyOf(req).decisions;
  if (!Array.isArray(decisions) || !decisions.length) {
    return res.status(400).json({ code: 'bad_request',
      error: 'send { decisions: [ { uid, decision } ] }' });
  }
  if (decisions.some((d) => d && String(d.uid) === '*')) {
    return res.status(400).json({ code: 'bad_request',
      error: 'The whole rack can only be assigned to somebody. Approve or reject each device on its own.' });
  }
  return answer(res, service.decideItems(idOf(req), decisions, { actor: req.user, req }));
});

/** One name against what will be written. Twice, when the risk asks for two. */
router.post('/:planId/approve', gates.approver, (req, res) => answer(res,
  service.approve(idOf(req), { comment: bodyOf(req).comment, actor: req.user, req })));

/** Rejected, or sent back for rework. Both need a reason code and a comment. */
router.post('/:planId/reject', gates.approver, (req, res) => answer(res,
  service.reject(idOf(req), { ...bodyOf(req), actor: req.user, req })));
router.post('/:planId/rework', gates.approver, (req, res) => answer(res,
  service.rework(idOf(req), { ...bodyOf(req), actor: req.user, req })));

/**
 * Move past the verification re-scan without one.
 *
 * The real check - a second scan, compared again - is POST /plans/:id/verify
 * in verify.js. This is the escape hatch beside it: an organization admin
 * only, a reason is mandatory, and the reason is written onto the plan, into
 * its event log and into the audit trail, so a plan that skipped the evidence
 * step says so for ever.
 */
router.post('/:planId/verify/skip', ADMIN_GATE, (req, res) => answer(res,
  service.skipVerification(idOf(req), { reason: bodyOf(req).reason, actor: req.user, req })));

/**
 * A write NetBox refused part of, taken out of the retry loop and put in front
 * of a person: somebody has to look at the objects by hand before anything
 * else is tried. The reason is mandatory and is on the record.
 */
router.post('/:planId/manual-review', ADMIN_GATE, (req, res) => answer(res,
  service.moveByHand(idOf(req), { to: 'manual_review', reason: bodyOf(req).reason,
    actor: req.user, req })));

/** A finished plan opened again, with a reason from the list and the count kept. */
router.post('/:planId/reopen', ADMIN_GATE, (req, res) => answer(res,
  service.reopen(idOf(req), { ...bodyOf(req), actor: req.user, req })));

/** Nothing here will be done. The open tickets go with it. */
router.post('/:planId/cancel', gates.readers, (req, res) => answer(res,
  service.cancel(idOf(req), { reason: bodyOf(req).reason, actor: req.user, req })));

/**
 * The thread on a plan. An internal comment is between the people handling it;
 * a shared one is readable by the technician who raised it, and a technician's
 * own words are always shared, because they never see the internal thread.
 */
router.get('/:planId/comments', gates.readers, (req, res) => answer(res,
  service.listComments(idOf(req), { actor: req.user })));

router.post('/:planId/comments', gates.readers, (req, res) => answer(res,
  service.addComment(idOf(req), { ...bodyOf(req), actor: req.user })));

/** Who this rack's ticket should go to, read from NetBox as it stands now. */
router.get('/:planId/contacts', gates.readers, wrap(async (req, res) => {
  const out = await service.contacts(idOf(req), { actor: req.user });
  if (refused(out)) return fail(res, out);
  return res.json({ ok: true, ...out });
}));

module.exports = router;
