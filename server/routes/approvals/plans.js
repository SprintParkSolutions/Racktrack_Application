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
 * the SPOC the check is with, the person who sent it and so may not decide it.
 * That is why deciding and approving are open to every reader at the door: the
 * SPOC of a Site may be a site manager or a member, and only the plan says so.
 *
 * The order of the routes matters in one place: a fixed path has to be
 * declared before '/:planId' or express reads the word as an id.
 */
const express = require('express');

const service = require('../../lib/approvals/service');
const store = require('../../lib/approvals/store');
const incidents = require('../../lib/approvals/incidents');
const write = require('../../lib/approvals/write');
const scans = require('../../lib/netbox/store');
const tenant = require('../../lib/tenant');
const writer = require('../../lib/netbox/writer');
const { netboxFor } = require('../../lib/approvals/connections');
const { canAccessRack, isValidRackId } = require('../../lib/rack_access');
const gates = require('../netbox/gates');
const { answer, fail, refused, wrap, filtersOf, LIST_FILTERS } = require('./http');

const router = express.Router();

const ADMIN_GATE = gates.only(gates.WRITERS, 'This is for an organization admin.');
const PLAN_FILTERS = [...LIST_FILTERS, 'holder'];

/** The check's one incident, as much of it as an answer to a decision carries. */
const incidentBrief = (plan) => {
  const inc = plan && plan.incident;
  if (!inc || inc.system === 'none') return null;
  return { number: inc.number || null, state: inc.state || null,
    pushed: Boolean(inc.pushedState), error: inc.error || null };
};

/**
 * The same, once ServiceNow has heard the outcome. Reject, rework and cancel
 * have nothing to wait for, so they `push` at once; an approval is pushed by
 * incidents.js when its write finishes, and is only waited for here. Never
 * long: past ten seconds the answer says `pending` and the push lands later.
 */
const incidentAfter = async (plan, opts) => {
  if (!plan || !plan.incident || plan.incident.system === 'none') return incidentBrief(plan);
  return (await incidents.answerFor(plan.id, opts)) || incidentBrief(plan);
};

const idOf = (req) => req.params.planId;
const bodyOf = (req) => req.body || {};

/**
 * Plans, newest first, scoped to what the caller may read.
 *
 * Filters: status (one or a comma list), tenantId, rackId, scanId, priority,
 * risk, assignee ('me' works), createdBy ('me' works), holder ('me' works: the
 * checks that are with me), since, until, q, sla, open=1 for everything not
 * yet written or closed, limit and cursor. The whole set, so
 * `?rackId=RK-1&open=1` finds the plan a rack already has open.
 */
router.get('/', gates.readers, (req, res) => {
  const out = service.list(req.user, filtersOf(req.query, PLAN_FILTERS));
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

/**
 * Send the check, with a note and, when only some of what differs is being
 * sent, { items: [uid] }. It goes straight to the SPOC of its Site: the answer
 * carries `holder`, or `needsAdmin` when it is waiting for an admin instead,
 * and the check's `incident`.
 */
router.post('/:planId/submit', gates.readers, wrap(async (req, res) => {
  const chosen = bodyOf(req).items;
  const out = await service.submitAndDispatch(idOf(req), { note: bodyOf(req).note,
    items: Array.isArray(chosen) ? chosen.map(String) : null, actor: req.user, req });
  return answer(res, out, (o) => ({ plan: o.plan, already: Boolean(o.already),
    holder: o.holder || null, needsAdmin: o.needsAdmin || null, incident: o.incident || null }));
}));

/** The admin sizes it up: category, priority, risk, disposition, duplicate, exception. */
router.post('/:planId/triage', ADMIN_GATE, (req, res) => answer(res,
  service.triage(idOf(req), bodyOf(req), { actor: req.user, req })));

/**
 * An organization admin gives the check to somebody: { userId, reason }, or a
 * NetBox contact as { assignee | assigneeId, reason }. A check goes to one
 * person as a whole, so the per-item forms are refused.
 */
router.post('/:planId/assign', ADMIN_GATE, wrap(async (req, res) => {
  const body = bodyOf(req);
  if (body.items !== undefined || body.rows !== undefined) {
    return res.status(400).json({ code: 'bad_request',
      error: 'Send { userId, reason }. A check goes to one person as a whole.' });
  }
  return answer(res, await service.assign(idOf(req), body, { actor: req.user, req }));
}));

/**
 * Who an admin may give a ticket to, on this check.
 *
 * Everybody in the organization who works racks: the technicians, the site
 * managers, and the single point of contact of this check's site. An admin is
 * choosing a person to go and look at something, so the list is people, not
 * roles, and each one carries the address the ticket will reach them at.
 */
router.get('/:planId/people', ADMIN_GATE, wrap(async (req, res) => {
  const plan = store.getPlan(idOf(req), { heavy: false });
  if (!plan) return res.status(404).json({ code: 'not_found', error: 'No such check.' });
  const people = store.usersOfOrg(plan.orgId)
    .filter((u) => u && u.active !== 0 && (u.email || u.username))
    .map((u) => ({
      userId: u.id, username: u.username, email: u.email || null, role: u.role || null,
      site: u.tenantId != null ? (store.tenantById(u.tenantId) || {}).name || null : null,
      isSpocHere: Number(u.id) === Number(plan.spocUserId || 0),
    }))
    .sort((a, b) => Number(b.isSpocHere) - Number(a.isSpocHere) || String(a.username).localeCompare(String(b.username)));
  return res.json({ ok: true, people });
}));

/**
 * Raise a ticket on this check and give it to somebody:
 * { userId, summary, note }.
 *
 * The owner asked for this on 23 September 2026: an admin reading a check
 * decides a person should go and look at something, writes what they want
 * done, and hands it over. RackTrack raises it in the organization's own
 * ticketing tool, records it on the check, and tells the person.
 */
router.post('/:planId/raise', ADMIN_GATE, wrap(async (req, res) => {
  const plan = store.getPlan(idOf(req), { heavy: false });
  if (!plan) return res.status(404).json({ code: 'not_found', error: 'No such check.' });
  const body = bodyOf(req);
  const summary = String(body.summary || '').trim();
  if (!summary) return res.status(400).json({ code: 'bad_request', error: 'Say what you want done.' });
  const who = body.userId != null ? store.userById(body.userId) : null;
  if (!who) return res.status(400).json({ code: 'bad_request', error: 'Choose who the ticket goes to.' });
  if (Number(who.organizationId ?? who.orgId) !== Number(plan.orgId)) {
    return res.status(400).json({ code: 'bad_request', error: 'That person is not in this organization.' });
  }
  const r = await incidents.raiseTaskFor(plan, {
    assignee: { userId: who.id, username: who.username, email: who.email || null },
    summary,
    note: String(body.note || '').trim() || null,
    raisedBy: req.user && (req.user.username || req.user.name) ? (req.user.username || req.user.name) : null,
  });
  if (!r.ok) return res.status(502).json({ code: 'servicenow', error: r.error });
  return res.json({ ok: true, ...r });
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
 * row is still waiting on somebody. For the SPOC the check is with or an
 * organization admin, never the person who sent it; the service holds that.
 *
 * A row may also change a value before approving it: { uid, decision:
 * 'modified', modified: { serial, asset_tag, description }, note }. The check
 * is then compared with NetBox again, `replanned` says so, and the row comes
 * back approved with `modified: true`.
 */
router.post('/:planId/decide', gates.readers, wrap(async (req, res) => {
  const decisions = bodyOf(req).decisions;
  if (!Array.isArray(decisions) || !decisions.length) {
    return res.status(400).json({ code: 'bad_request',
      error: 'send { decisions: [ { uid, decision } ] }' });
  }
  if (decisions.some((d) => d && String(d.uid) === '*')) {
    return res.status(400).json({ code: 'bad_request',
      error: 'The whole rack can only be assigned to somebody. Approve or reject each device on its own.' });
  }
  return answer(res, await service.decide(idOf(req), decisions, { actor: req.user, req }));
}));

/**
 * What RackTrack suggests about a check, acted on: accept it, or put it away.
 * `:sid` is the suggestion's id, URL-encoded. Body { note }. Accepting may
 * change the check and compare it with NetBox again, so the answer is the
 * whole check as GET /:planId gives it, items and all. 409 when the suggestion
 * no longer applies, when NetBox could not be compared, or when the fresh
 * comparison does not show the change - with the writer's own reason.
 */
router.post('/:planId/suggestions/:sid/accept', gates.readers, wrap(async (req, res) => answer(res,
  await service.acceptSuggestion(idOf(req), req.params.sid, { note: bodyOf(req).note, actor: req.user, req }))));

router.post('/:planId/suggestions/:sid/dismiss', gates.readers, (req, res) => answer(res,
  service.dismissSuggestion(idOf(req), req.params.sid, { note: bodyOf(req).note, actor: req.user, req })));

/** Take back a change a person made on the check. The answer is the whole check again. */
router.delete('/:planId/overrides/:overrideId', gates.readers, wrap(async (req, res) => answer(res,
  await service.revokeOverride(idOf(req), req.params.overrideId, { actor: req.user, req }))));

/**
 * One name against what will be written: { comment, incidentState }. Twice,
 * when the organization asks for two.
 *
 * The final approval writes at once: the server does it, as the system, on
 * this person's word, and the answer waits for it. `write` says what became of
 * it - written, nothing_to_write, failed, bounced (the check is back with its
 * holder, with why), not_started, or writing when it is still going after
 * twenty-five seconds and the screen should poll the check. It is null while
 * the check still waits for its second approval.
 */
router.post('/:planId/approve', gates.readers, wrap(async (req, res) => {
  const out = service.approve(idOf(req), { comment: bodyOf(req).comment,
    incidentState: bodyOf(req).incidentState, actor: req.user, req });
  if (refused(out)) return fail(res, out);
  const done = out.final
    ? await write.runAfterApproval(out.plan.id, { approver: req.user, req })
    : { plan: out.plan, write: null };
  const plan = done.plan || out.plan;
  // The write first, then the incident: the push starts when the write ends,
  // and this only waits for it.
  const incident = await incidentAfter(plan);
  return res.json({ ok: true, ...out, plan, write: done.write, incident });
}));

/** Rejected, or sent back for rework: { reasonCode, comment, incidentState }. */
for (const [path, call] of [['reject', service.reject], ['rework', service.rework]]) {
  router.post(`/:planId/${path}`, gates.readers, wrap(async (req, res) => {
    const out = call(idOf(req), { ...bodyOf(req), actor: req.user, req });
    const incident = refused(out) ? null : await incidentAfter(out && out.plan, { push: true });
    return answer(res, out, (o) => ({ ...o, incident }));
  }));
}

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

/**
 * Nothing here will be done. The open tickets go with it. Whoever made a draft
 * may cancel it; once a check is sent, cancelling is an organization admin's.
 */
router.post('/:planId/cancel', gates.readers, wrap(async (req, res) => {
  const out = service.cancel(idOf(req), { reason: bodyOf(req).reason, actor: req.user, req });
  const incident = refused(out) ? null : await incidentAfter(out && out.plan, { push: true });
  return answer(res, out, (o) => ({ ...o, incident }));
}));

/**
 * The thread on a plan. An internal comment is between the people handling it;
 * a shared one is readable by the technician who raised it, and a technician's
 * own words are always shared, because they never see the internal thread.
 */
router.get('/:planId/comments', gates.readers, (req, res) => answer(res,
  service.listComments(idOf(req), { actor: req.user })));

router.post('/:planId/comments', gates.readers, (req, res) => answer(res,
  service.addComment(idOf(req), { ...bodyOf(req), actor: req.user })));

/** Who this check goes to: the SPOC of its Site, and for an admin who else it could go to. */
router.get('/:planId/contacts', gates.readers, wrap(async (req, res) => {
  const out = await service.contacts(idOf(req), { actor: req.user });
  if (refused(out)) return fail(res, out);
  return res.json({ ok: true, ...out });
}));

module.exports = router;
