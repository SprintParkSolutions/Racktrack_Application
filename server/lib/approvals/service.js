/**
 * RackTrack Approvals: the operations.
 *
 * Every route under /api/approvals, and every /api/nb route the phone app
 * still calls, ends in one of these functions. They hold the rules that are
 * about more than one row: who may act, which status follows, what is written
 * down when it does. The tables are store.js, the status table is machine.js,
 * the shape of a plan is shape.js.
 *
 * WHAT EVERY CHANGE DOES. It runs in one transaction on the shared auth.db
 * handle, bumps the plan's version, and appends an approval_events row. Once
 * the transaction has committed - never before - it writes an audit_log row
 * (action approval.<action>, target approval_plan) and emits on the bus. The
 * audit module holds its own handle on auth.db, so writing it from inside
 * our transaction would wait on our own lock; and a listener must never hear
 * about a change that was rolled back. `run()` is that order, in one place.
 *
 * WHO IS ASKING. A route hands over req.user and the rules apply in full. The
 * old library functions in lib/netbox/plans.js were called with a name and
 * nothing else (`{ by: 'meera' }`), by unit tests and scripts that had
 * already decided the caller was allowed; they arrive here as a `trusted`
 * actor, and for them the item rules still hold (assign first, a port follows
 * its device, a rebind is never sent to the rack) while the status table and
 * the role checks stand aside.
 *
 * WHO A CHECK IS WITH. A check sent from the phone goes straight to the SPOC
 * of its Site (spoc.js) and is theirs to decide and approve as a whole; it
 * carries that person as its holder (spocUserId, spoc). With nobody valid to
 * give it to it waits in triage, flagged needsAdmin, until an organization
 * admin names somebody. The person who sent a check decides nothing on it. A
 * check filed before this has no holder, and every older move still works.
 *
 * A refusal is a value, not an exception: { error, code, why, from, to } with
 * code not_found, bad_request, role, guard or transition. httpStatus() turns
 * the code into 404, 400, 403 or 409.
 */
const store = require('./store');
const shape = require('./shape');
const machine = require('./machine');
const bus = require('./bus');
const spoc = require('./spoc');
const registry = require('./registry');

const { WORKING, REASONS, ROLES, SYSTEM } = machine;

// -- Small things -------------------------------------------------------
const text = (v) => (typeof v === 'string' ? v.trim() : '');
const refuse = (code, why, extra = {}) => ({ error: why, code, why, ...extra });
const NOT_FOUND = () => refuse('not_found', 'no such plan');
const httpStatus = (out) => ({ not_found: 404, bad_request: 400, role: 403 }[out && out.code] || 409);

/** req.user, or an actor already, as the one shape the rules read. */
function actorOf(user) {
  if (!user) return null;
  if (user.system || user.trusted || Object.prototype.hasOwnProperty.call(user, 'orgId')) return user;
  return {
    id: user.id ?? null,
    username: user.username || user.email || null,
    email: user.email ?? null,
    role: user.role ?? null,
    orgId: user.organization_id ?? null,
    tenantId: user.tenant_id ?? null,
    netboxContactId: user.netbox_contact_id ?? null,
  };
}

/** The caller of an old library function: a name, already trusted by whoever called. */
const trustedActor = (by) => ({ id: null, username: by ?? null, email: null, role: 'trusted',
  orgId: null, tenantId: null, trusted: true });

const isStrict = (actor) => !(actor && (actor.trusted || actor.system));

// -- After the commit: the audit row and the bus ------------------------
function writeAudit(e) {
  // A throwaway test database has no business in the real audit_log.
  if (store.isolated()) return;
  const audit = require('../../audit');
  const a = e.actor || {};
  audit.log({
    req: e.req || undefined,
    // The row's tenant is the plan's own: the Site the rack was scanned under,
    // which for an owner or an org admin is not their own row's.
    user: a.system ? { id: null, username: a.username || 'system', tenant_id: e.plan?.tenantId ?? null }
      : { id: a.id ?? null, username: a.username ?? null, tenant_id: e.plan?.tenantId ?? a.tenantId ?? null },
    action: `approval.${e.action}`,
    status: e.status || 'ok',
    error: e.error || null,
    targetType: 'approval_plan',
    targetId: e.plan?.id ?? null,
    payload: e.payload ?? null,
  });
}

function flush(effects) {
  for (const e of effects) {
    try {
      if (e.kind === 'audit') writeAudit(e);
      else bus.emit(e.event, e.payload);
    } catch { /* the trail and the listeners never break the request */ }
  }
  effects.length = 0;
}

/** One transaction, then its audit rows and events. `fn(effects)` does the work. */
function run(fn) {
  const effects = [];
  const out = store.tx(() => fn(effects));
  flush(effects);
  return out;
}

const audit = (effects, plan, action, { actor, req, status, payload, error } = {}) => effects.push({
  kind: 'audit', plan, action, actor, req, status, payload, error,
});
const emit = (effects, event, payload) => effects.push({ kind: 'bus', event, payload });

/** The named event a status stands for, where the contract has one. */
const NAMED = {
  submitted: 'submitted', resolved: 'resolved', approval_pending: 'approval_requested',
  approved: 'approved', rejected: 'rejected', rework: 'rejected', completed: 'completed',
  write_failed: 'write_failed',
};

// -- Reading a plan with what its rules need ------------------------------
function settingsFor(orgId) {
  const risks = orgId != null ? store.getSetting(orgId, 'dual_approval_risks') : undefined;
  return { dualApprovalRisks: Array.isArray(risks) ? risks : DEFAULT_SETTINGS.dual_approval_risks };
}

/** What machine.can() reads, loaded fresh. `extra` is what the request brought. */
function ctxFor(plan, extra = {}) {
  const items = store.itemsOf(plan.id);
  return {
    items,
    tickets: store.ticketsOf(plan.id),
    decisions: store.decisionsOf(plan.id),
    settings: settingsFor(plan.orgId),
    payloadHash: shape.payloadHash(items),
    toWrite: shape.approvedCount(items),
    ...extra,
  };
}

/**
 * Move a plan from one status to the next, inside the caller's transaction.
 *
 * Checks the table unless `force` (the plan following its tickets, or an old
 * library caller), writes the plan, appends the event, and queues the audit
 * row, the `transition` event and the named event for after the commit.
 */
function move(effects, plan, to, opts = {}) {
  const { actor = SYSTEM, action = to, reason = null, item = null, patch = {}, payload = null,
          force = false, ctx = null, req = null, auditPayload = null, heard: more = null } = opts;
  const from = plan.status;
  if (!force) {
    const ok = machine.can(plan, to, actor, ctx || ctxFor(plan));
    if (!ok.ok) return { refused: refuse(ok.code, ok.why, { from, to }) };
  }
  const updated = store.updatePlan(plan.id, { ...patch, status: to });
  store.addEvent(plan.id, {
    itemUid: item, action, actorId: actor.id ?? null, actorName: actor.username ?? null,
    fromStatus: from, toStatus: to, reason, payload,
  });
  audit(effects, updated, action, {
    actor, req, payload: { from, to, reason, ...(auditPayload || {}) },
  });
  const heard = { plan: updated, from, to, actor, reason, item, ...(more || {}) };
  emit(effects, 'transition', heard);
  if (NAMED[to] && from !== to) emit(effects, NAMED[to], heard);
  return { plan: updated, from, to };
}

/** An event that is not a change of status: something happened to an item or a ticket. */
function note(plan, action, { actor = SYSTEM, item = null, reason = null, payload = null } = {}) {
  store.addEvent(plan.id, {
    itemUid: item, action, actorId: actor.id ?? null, actorName: actor.username ?? null,
    fromStatus: plan.status, toStatus: plan.status, reason, payload,
  });
}

/**
 * Let the plan catch up with its tickets, and make the moves the contract
 * calls automatic. Runs after anything that touched an item or a ticket:
 *
 *   submitted            -> assigned, when submit() found the SPOC of the Site
 *                           and made them the holder; else triage, where the
 *                           check waits for an admin (needsAdmin says why)
 *   triage               -> assigned, once it has a holder; for a check from
 *                           before the SPOC change, once nothing is left to
 *                           hand out and an admin has acted on the plan
 *                           (assigned something, or triaged it)
 *   a working status     -> the working status its tickets now add up to - but
 *                           a check with a holder does not follow its tickets:
 *                           it stays with that person until they decide it
 *   resolved             -> verification_pending
 *
 * These are the server's own moves: the person whose action caused them was
 * checked when they acted, and is named in the event as `causedBy`.
 */
function settle(effects, planId, causedBy = null) {
  const by = causedBy && !causedBy.system
    ? { causedBy: { id: causedBy.id ?? null, username: causedBy.username ?? null } } : {};
  for (let hop = 0; hop < 6; hop += 1) {
    const plan = store.getPlan(planId, { heavy: false });
    if (!plan) return null;
    const tickets = store.ticketsOf(planId);
    let to = null;
    let patch = {};
    let reason = 'follows its tickets';
    const held = plan.spocUserId != null;
    if (plan.status === 'submitted') {
      to = held ? 'assigned' : 'triage';
      reason = held ? 'goes to the site SPOC' : (plan.needsAdmin && plan.needsAdmin.why) || 'no_spoc';
    } else if (plan.status === 'triage') {
      if (held) {
        to = 'assigned';
        reason = 'an admin chose who it goes to';
      } else {
        const left = machine.unassigned({ items: store.itemsOf(planId), tickets }).length;
        if (!left && (tickets.length || plan.triagedAt)) to = 'assigned';
      }
      // Out of triage, nothing is waiting on an admin any more.
      if (to && plan.needsAdmin) patch = { needsAdmin: null };
    } else if (WORKING.includes(plan.status)) {
      if (held) return plan;
      const target = machine.workingStatus(tickets) || 'resolved';
      if (target !== plan.status) {
        to = target;
        const held = tickets.find((t) => t.status === 'pending');
        patch = { pendingReason: target === 'pending' && held ? held.pendingReason : null };
      }
    } else if (plan.status === 'resolved') {
      to = 'verification_pending';
    }
    if (!to) return plan;
    move(effects, plan, to, { actor: SYSTEM, action: `auto.${to}`, force: true, patch,
      reason, payload: by, auditPayload: by });
  }
  return store.getPlan(planId, { heavy: false });
}

// -- Who may see what -----------------------------------------------------
/**
 * THE VISIBILITY RULE. One function, used by every read, every list, the
 * queue, the dashboard, the ticket list and every write.
 *
 *   A plan belongs to the organization that raised it, and only that
 *   organization sees it. There is no owner bypass: "the owner sees
 *   everything" is exactly the cross-tenant leak this closes.
 *
 *   When the account that raised the plan has no organization, the plan
 *   belongs to that ACCOUNT and only that account sees it. Two different
 *   accounts that both happen to have no organization are still two people,
 *   so the test compares the RAISER and never the absence of an organization.
 *
 * Measured on the live server on 18 September 2026: signed in as the platform
 * owner (no organization), GET /api/nb/plans listed four plans and every one
 * of them answered "no such plan" when opened, because the list scoped one way
 * and the read another. There is one rule now, and store.planWhere's `seenBy`
 * is the same test written as SQL, so a row that cannot be opened is never
 * listed. An empty list is the honest answer when there is nothing to show.
 */
function canSee(plan, actor) {
  if (!plan || !actor) return false;
  if (actor.trusted || actor.system) return true;
  if (plan.orgId != null) return Number(plan.orgId) === Number(actor.orgId);
  return machine.isCreator(plan, actor);
}

/** The same rule as a list filter, so the list and the read cannot disagree. */
const seenByOf = (actor) => ({ orgId: actor.orgId ?? null, userId: actor.id ?? null,
  username: actor.username ?? null });

/**
 * May this person read the plan? The visibility rule first, then which people
 * inside that organization: an admin, an approver and an auditor read all of
 * it; a technician reads their own and what their Site is being asked to
 * verify; anybody reads a check that is with them, or that has a ticket
 * assigned to them.
 */
function canRead(plan, actor, tickets = null) {
  if (!canSee(plan, actor)) return false;
  if (actor.trusted || actor.system) return true;
  if (plan.orgId == null) return true;          // their own, by the rule above
  if (['owner', 'org_admin', 'approver', 'auditor'].includes(actor.role)) return true;
  if (machine.isCreator(plan, actor)) return true;
  const sameSite = plan.tenantId != null && Number(plan.tenantId) === Number(actor.tenantId);
  if (actor.role === 'site_manager' && sameSite) return true;
  if (actor.role === 'member' && sameSite && plan.status === 'verification_pending') return true;
  if (machine.isHolder(plan, actor)) return true;
  return machine.isAssignee(tickets || store.ticketsOf(plan.id), actor);
}

/** May this person change the plan at all? The same rule; nothing is looser for a write. */
function canTouch(plan, actor, tickets = null) {
  return canSee(plan, actor) && canRead(plan, actor, tickets);
}

/** The plan for a write, or a refusal. Another organization's plan is, to the caller, not there. */
function open(planId, actor) {
  const plan = store.getPlan(planId, { heavy: false });
  if (!plan || !canTouch(plan, actor)) return { refused: NOT_FOUND() };
  return { plan };
}

/** The list filter that keeps a person to what they may read. */
function scopeFor(actor) {
  if (!actor || actor.trusted || actor.system) return {};
  const scope = { seenBy: seenByOf(actor) };
  if (['member', 'site_manager'].includes(actor.role)) {
    scope.visibleTo = { role: actor.role, username: actor.username, userId: actor.id, tenantId: actor.tenantId };
  }
  return scope;
}

// -- Filing a plan ------------------------------------------------------
/**
 * File a comparison as a plan.
 *
 * `report` is exactly what writer.plan() returned. Nothing is interpreted
 * beyond splitting it into rows: the plan is a faithful record of what the
 * comparison said at that moment, and the moment is part of the point.
 *
 * Comparing a rack again does not pile up plans. When the organization
 * already holds an open plan for the same rack with the same fingerprint -
 * the same differences, to the byte - that plan comes back with reused: true.
 * A technician is only ever handed back a plan of their own.
 */
function create({ scanId = null, rackId = null, rackUid = null, rackName = null, report, actor,
                  orgId = null, tenantId = null, parentPlanId = null, reuse = false, ownOnly = false }) {
  const who = actorOf(actor) || trustedActor(null);
  const fingerprint = shape.fingerprint(report.changes);
  if (reuse && rackId != null) {
    const match = store.listPlans({ seenBy: { orgId, userId: who.id ?? null, username: who.username ?? null },
      rackId, status: machine.OPEN, limit: 200 })
      // A check a person changed signs a new fingerprint; what it was filed as
      // is kept beside it, so the same comparison still finds the same check.
      .filter((p) => p.fingerprint === fingerprint || p.baseFingerprint === fingerprint)
      .filter((p) => !isStrict(who) || canRead(p, who))
      // ownOnly: a person gets their own check back, never somebody else's. A
      // comparison an admin runs is a second plan, theirs, as it always was.
      .filter((p) => !ownOnly || (who.username != null && p.createdBy === who.username)
        || (who.id != null && p.createdById != null && String(p.createdById) === String(who.id)))
      // The same scan first; then a check somebody has already sent over one
      // that is still a draft, so a person who comes back to the screen is
      // shown the check that is in progress, not a newer empty copy of it.
      .sort((a, b) => Number(b.scanId === scanId) - Number(a.scanId === scanId)
        || Number(b.status !== 'draft') - Number(a.status !== 'draft') || b.id - a.id)[0];
    if (match) return { ...get(match.id, who), reused: true };
  }
  const items = (report.changes || []).map(shape.toItem);
  return run(() => {
    const plan = store.insertPlan({
      orgId, tenantId, scanId, rackId, rackName,
      rackUid: rackUid ?? report.rackUid ?? null,
      netboxUrl: report.netboxUrl ?? null,
      status: 'draft', fingerprint,
      counts: report.counts || {}, warnings: report.warnings || [], orphans: report.orphans || [],
      customField: report.customField ?? null,
      // What the comparison found beside its changes, and what it compared:
      // every record of the rack and every box of the photo. Suggestions are
      // worked out from these on each read. A report that carries neither
      // (an older caller) leaves no evidence, and the check says so.
      findings: report.findings || [],
      evidence: report.records || report.boxes
        ? { records: report.records || [], boxes: report.boxes || [] } : null,
      createdBy: who.username ?? null, createdById: who.id ?? null,
      parentPlanId,
    }, items);
    note(plan, 'create', { actor: who,
      payload: { what: 'compared', detail: shape.summarise(items) } });
    // What the organization has already decided it does not want to be asked
    // about again: an accepted drift or a known exception sets its item aside,
    // and a rack inside a change window is flagged as one. Idempotent, and a
    // side effect like any other here - a plan is filed whether or not this
    // works, because losing a comparison is worse than losing an exception.
    try {
      require('./exceptions').onPlanCreated(plan.id, { actor: who });
    } catch (err) {
      try {
        require('../observability').logger.warn(
          { event: 'approvals.exceptions.on_create_failed', plan: plan.id, err: err && err.message },
          'the exceptions pass over a new plan did not run');
      } catch { /* the log is not the point */ }
    }
    return { ...get(plan.id, who), reused: false };
  });
}

/** What the preview route does: the scan, its snapshot, the comparison, the person. */
function createFromPreview({ scan, snap, report, actor, tenantId = null, parentPlanId = null, reuse = true }) {
  const who = actorOf(actor);
  return create({
    scanId: scan.id, rackId: scan.rackId, rackUid: snap && snap.rackUid,
    // The name lives in the scan's payload, where the adopt step writes what
    // the rack ladder decided. Read from the index record alone it was always
    // empty, so every drift in RackTrack Changes was headed by the hash of the
    // photograph instead of the id on the cabinet.
    rackName: scan.rackName || (scan.payload && scan.payload.rackName) || null, report, actor: who,
    orgId: who ? who.orgId : null, tenantId, parentPlanId, reuse,
  });
}

// -- Submit ---------------------------------------------------------------
/** Who a check is with, as the record kept on the plan. */
const holderRecord = (holder, { source, by, reason = null, previous = [] }) => ({
  userId: holder.userId, username: holder.username, email: holder.email ?? null, source,
  assignedAt: store.nowIso(), assignedBy: by.username ?? null, assignedById: by.id ?? null,
  reason, previous,
});

/** One ticket per item still waiting, all to the holder: the check goes to one person as a whole. */
const holderRows = (uids, holder, question) => uids.map((uid) => ({
  uid, assignee: holder.username, assigneeUserId: holder.userId, assigneeEmail: holder.email ?? null,
  scope: 'check', question: text(question) || 'Review this against the drift report.',
}));

/**
 * A technician sends the comparison: draft, submitted, and straight on to the
 * SPOC of the Site, who becomes its holder with a ticket for each item sent,
 * all in this one transaction. With nobody valid to give it to - no Site, no
 * SPOC, or the SPOC is the sender - it waits in triage, flagged needsAdmin,
 * and the admins are told. Their note travels with it, because "three of these
 * look wrong to me" is worth more than the diff on its own. Sending it twice
 * is not an error; the second time says `already`.
 *
 * Nothing here reaches a network: the incident and the notice to the holder
 * are dispatch(), after the commit.
 */
function submit(planId, { note: said = null, items: chosen = null, actor, req = null } = {}) {
  const who = actorOf(actor);
  const found = open(planId, who);
  if (found.refused) return found.refused;
  const { plan } = found;
  const legacy = shape.legacyStatus(plan.status);
  if (legacy === 'applied') return refuse('transition', 'this plan has already been written');
  if (legacy === 'write_failed') {
    return refuse('transition', 'this plan was already sent, and its write did not finish');
  }
  if (plan.status !== 'draft') return { plan: get(plan.id, who).plan, already: true };

  // Who it goes to is settled before the transaction opens. The Site's record
  // is read through estate.js's own database handle, and a handle that had to
  // wait on the write lock we are about to take would stall the send.
  const goesTo = spoc.resolve(plan, { sender: who });

  return run((effects) => {
    // The person at the rack may send some of what differs and leave the rest.
    // What they leave is not hidden: it stays on the check, marked as not sent
    // with their name on it, so the admin can see it was seen and set aside -
    // it simply asks nothing of anybody. Sending nothing at all is refused.
    const all = store.itemsOf(plan.id);
    const open = all.filter((i) => i.decidable && i.decision === 'pending');
    let left = [];
    if (Array.isArray(chosen)) {
      const want = new Set(chosen.map(String));
      const sending = open.filter((i) => want.has(i.uid));
      if (!sending.length) return refuse('bad_request', 'choose at least one difference to send');
      left = open.filter((i) => !want.has(i.uid));
      for (const i of left) {
        store.updateItem(plan.id, i.uid, {
          decision: 'not_applicable', decidedBy: who.username ?? null, decidedAt: store.nowIso(),
          note: `Not sent by ${who.username || 'the technician'}: left for a later check.`,
        }, { touch: false });
      }
    }
    const items = store.itemsOf(plan.id);
    const leftNames = left.map((i) => i.name);
    const moved = move(effects, plan, 'submitted', {
      actor: who, action: 'submit', req, force: !isStrict(who), ctx: ctxFor(plan),
      patch: { submittedAt: store.nowIso(), submittedBy: who.username ?? null,
               submittedById: who.id ?? null, submittedNote: text(said) || null },
      payload: { what: 'sent', detail: { note: text(said) || null,
        ...(leftNames.length ? { notSent: leftNames } : {}), ...shape.summarise(items) } },
      auditPayload: { note: text(said) || null, ...(leftNames.length ? { notSent: leftNames } : {}) },
    });
    if (moved.refused) return moved.refused;
    if (goesTo.ok) {
      store.updatePlan(plan.id, { spocUserId: goesTo.holder.userId, needsAdmin: null,
        spoc: holderRecord(goesTo.holder, { source: 'site', by: SYSTEM }) });
      ticketRows(moved.plan, holderRows(assignableUids(plan.id), goesTo.holder, said), SYSTEM);
    } else {
      store.updatePlan(plan.id, { needsAdmin: { why: goesTo.why, text: goesTo.text, at: store.nowIso() } });
    }
    const settled = settle(effects, plan.id, who);
    if (settled && settled.status === 'triage') {
      emit(effects, 'reassign_needed', { plan: settled, actor: who, why: goesTo.why,
        text: goesTo.text, rackId: settled.rackId });
    }
    return { plan: store.getPlan(plan.id, { heavy: false }) };
  });
}

/** The check's one incident as a caller is shown it, or null. */
const incidentOf = (plan) => (plan && plan.incident) || null;

// How long a send waits for ServiceNow before it goes on without the number.
const RAISE_WAIT_MS = 12000;
const raiseWait = () => Number(process.env.RT_INCIDENT_WAIT_MS) || RAISE_WAIT_MS;

/**
 * Raise the check's incident and tell the holder the check is theirs. Async
 * and idempotent: a check whose holder has been told is left alone unless
 * `again`. Never throws; a failure is a value on the plan. Answers
 * { holder, needsAdmin, incident }.
 *
 * The ServiceNow incident comes first, before anybody is told, so the answer
 * to the send and the notice to the holder can both carry its number. It is
 * raised once per check and stamped on the plan by incidents.js. But nobody
 * waits long for it: a ServiceNow that is slow or dead is given RAISE_WAIT_MS,
 * then the holder is told and the send is answered with the incident still
 * `raising`. The raise carries on by itself and lands on the plan when it
 * lands; one that fails is recorded there, the admins are told, and the poller
 * tries it again.
 */
async function dispatch(planId, { actor, req = null, again = false } = {}) {
  const who = actorOf(actor) || SYSTEM;
  let plan = store.getPlan(planId, { heavy: false });
  if (!plan) return { holder: null, needsAdmin: null, incident: null };
  if (plan.spocUserId == null || !plan.spoc) {
    return { holder: null, needsAdmin: plan.needsAdmin || null, incident: null };
  }
  if (plan.spoc.toldAt && !again) return { holder: plan.spoc, needsAdmin: null, incident: incidentOf(plan) };
  try {
    const incidents = require('./incidents');
    await incidents.within(incidents.raiseFor(plan.id, { again }), raiseWait());
  } catch { /* the check is with its holder whatever ServiceNow did */ }
  plan = store.getPlan(planId, { heavy: false });
  if (!plan || plan.spocUserId == null || !plan.spoc) return { holder: null, needsAdmin: null, incident: null };
  // Two sends at once share one raise, and only the first of them tells the holder.
  if (plan.spoc.toldAt && !again) return { holder: plan.spoc, needsAdmin: null, incident: incidentOf(plan) };
  try {
    const effects = [];
    plan = store.updatePlan(plan.id, { spoc: { ...plan.spoc, toldAt: store.nowIso() } });
    const items = store.itemsOf(plan.id);
    const site = plan.tenantId != null ? store.tenantById(plan.tenantId) : null;
    audit(effects, plan, 'assign', { actor: who, req, payload: {
      holder: plan.spoc.username, incident: (incidentOf(plan) || {}).number || null,
      source: plan.spoc.source } });
    emit(effects, 'assigned', { plan, actor: who, to: 'assigned',
      holder: { userId: plan.spoc.userId, username: plan.spoc.username, email: plan.spoc.email ?? null },
      source: plan.spoc.source, sender: { userId: plan.submittedById ?? null, username: plan.submittedBy ?? null },
      rackName: plan.rackName || plan.rackId || null, siteName: (site && site.name) || null,
      // What the notice is written from: each item sent, in its own words.
      targets: items.filter((i) => i.decidable && !i.following && i.decision !== 'not_applicable')
        .map((i) => ({ uid: i.uid, type: i.type, name: i.name, action: i.action })),
      note: plan.submittedNote || null, incident: incidentOf(plan) });
    flush(effects);
  } catch { /* telling somebody never undoes the assignment */ }
  return { holder: plan.spoc, needsAdmin: null, incident: incidentOf(plan) };
}

/** submit(), then dispatch(). -> submit()'s answer plus { holder, needsAdmin, incident }. */
async function submitAndDispatch(planId, opts = {}) {
  const out = submit(planId, opts);
  if (!out || out.error) return out;
  const sent = await dispatch(planId, { actor: opts.actor, req: opts.req || null });
  return { ...out, plan: store.getPlan(planId, { heavy: false }) || out.plan, ...sent };
}

// -- Triage ---------------------------------------------------------------
const TRIAGE_OPEN = ['triage', ...WORKING, 'reopened', 'rework'];

/**
 * The admin sizes the plan up: category, priority, risk, disposition. An
 * organization admin only: a site manager reads their Site's checks and no
 * longer triages them. Two ways out from here: a duplicate of another plan,
 * or covered by a known exception.
 */
function triage(planId, body = {}, { actor, req = null } = {}) {
  const who = actorOf(actor);
  const found = open(planId, who);
  if (found.refused) return found.refused;
  const { plan } = found;
  if (isStrict(who) && !machine.isAdmin(who)) {
    return refuse('role', 'Triage is for an organization admin.');
  }
  if (!TRIAGE_OPEN.includes(plan.status)) {
    return refuse('transition', `a plan that is ${plan.status.replace(/_/g, ' ')} cannot be triaged`,
      { from: plan.status, to: 'triage' });
  }
  const patch = {};
  if (body.priority !== undefined) {
    if (!machine.PRIORITIES.includes(body.priority)) return refuse('bad_request', `priority has to be one of ${machine.PRIORITIES.join(', ')}`);
    patch.priority = body.priority;
  }
  if (body.risk !== undefined) {
    if (!machine.RISKS.includes(body.risk)) return refuse('bad_request', `risk has to be one of ${machine.RISKS.join(', ')}`);
    patch.risk = body.risk;
  }
  if (body.disposition !== undefined && body.disposition !== null && body.disposition !== '') {
    if (!REASONS.disposition.includes(body.disposition)) return refuse('bad_request', `disposition has to be one of ${REASONS.disposition.join(', ')}`);
    patch.disposition = body.disposition;
  }
  if (body.category !== undefined) patch.category = text(String(body.category ?? '')).slice(0, 80) || null;
  if (body.note !== undefined) patch.triageNote = text(String(body.note ?? '')).slice(0, 2000) || null;

  let to = null;
  if (body.disposition === 'duplicate' || (body.duplicateOf != null && body.duplicateOf !== '')) {
    const other = body.duplicateOf != null ? store.getPlan(body.duplicateOf, { heavy: false }) : null;
    if (body.duplicateOf != null && body.duplicateOf !== ''
        && (!other || Number(other.orgId) !== Number(plan.orgId))) {
      return refuse('bad_request', 'the plan this one duplicates was not found');
    }
    to = 'duplicate';
    patch.duplicateOf = other ? other.id : null;
    patch.disposition = 'duplicate';
  } else if (body.disposition === 'known_exception' || (body.exceptionId != null && body.exceptionId !== '')) {
    const ex = body.exceptionId != null ? store.getException(body.exceptionId) : null;
    if (body.exceptionId != null && body.exceptionId !== ''
        && (!ex || ex.revokedAt || Number(ex.orgId) !== Number(plan.orgId))) {
      return refuse('bad_request', 'that exception was not found, or it has been revoked');
    }
    to = 'known_exception';
    patch.exceptionId = ex ? ex.id : null;
    patch.disposition = 'known_exception';
  }

  return run((effects) => {
    const urgentBefore = ['P1', 'P2'].includes(plan.priority);
    patch.triagedAt = store.nowIso();
    patch.triagedBy = who.username ?? null;
    if (to) {
      const moved = move(effects, plan, to, {
        actor: who, action: to, req, patch, force: !isStrict(who),
        ctx: ctxFor(plan, { duplicateOf: patch.duplicateOf, exceptionId: patch.exceptionId }),
        reason: patch.triageNote || null,
        auditPayload: { duplicateOf: patch.duplicateOf ?? null, exceptionId: patch.exceptionId ?? null },
      });
      if (moved.refused) return moved.refused;
      closeOpenTickets(plan.id, who, to);
      return { plan: store.getPlan(plan.id, { heavy: false }) };
    }
    const updated = store.updatePlan(plan.id, patch);
    const fields = { category: updated.category, priority: updated.priority, risk: updated.risk,
                     disposition: updated.disposition, note: updated.triageNote };
    note(updated, 'triage', { actor: who, payload: fields });
    audit(effects, updated, 'triage', { actor: who, req, payload: fields });
    if (!urgentBefore && ['P1', 'P2'].includes(updated.priority)) {
      emit(effects, 'p1_p2_created', { plan: updated, actor: who, priority: updated.priority });
    }
    return { plan: settle(effects, plan.id, who) };
  });
}

/** A plan that is over takes its open tickets with it, so nothing keeps asking after them. */
function closeOpenTickets(planId, actor, why) {
  for (const t of store.ticketsOf(planId)) {
    if (!shape.isOpenTicket(t)) continue;
    store.updateTicket(planId, t.itemUid, { status: 'closed', closedBy: actor.username ?? null,
      closedAt: store.nowIso(), closedWith: why }, { touch: false });
  }
}

// -- Assign ---------------------------------------------------------------
const ASSIGN_OPEN = ['triage', ...WORKING, 'reopened', 'rework', 'rejected'];

/** What an incident description says an item is. */
const whatDiffers = (item) => (item.action === 'create'
  ? 'found in the rack, not in NetBox' : 'does not match NetBox');

/** "Device "Sw1" - found in the rack, not in NetBox (48 ports follow it)" */
function itemLine(items, item) {
  const ports = shape.childrenOf(items, item.uid).length;
  return `${item.type} "${item.name}" - ${whatDiffers(item)}`
    + (ports ? ` (${ports} port${ports === 1 ? '' : 's'} follow it)` : '');
}

/**
 * Everyone NetBox knows for this rack, once, with the SPOC first.
 *
 * The rack is recognised by its real name (rack_match), so the SPOC, the
 * incident and the email all name the customer's rack, not the photo hash.
 * The roster is de-duplicated on the contact id: the SPOC is in the
 * assignment list and in the contact list, and is one person.
 */
async function rosterFor(plan, actor) {
  const scans = require('../netbox/store');
  const rackMatch = require('../netbox/rack_match');
  const spoc = require('../netbox/spoc');
  const { netboxFor } = require('./connections');
  const scan = plan.scanId ? scans.getScan(plan.scanId) : null;
  const fallbackName = (scan && (scan.rackName || scan.rackId)) || plan.rackName || plan.rackId;
  const client = netboxFor({ orgId: plan.orgId ?? actor?.orgId, userId: actor?.id });
  const resolved = await rackMatch.resolveRack(client, {
    tenantId: plan.tenantId ?? null, rackId: plan.rackId,
    scanName: scan && scan.rackName, fallbackName,
  });
  let people = null;
  let everyone = [];
  if (client) {
    try { people = await spoc.forRack(client, resolved.name); } catch { people = null; }
    try { everyone = await spoc.everyone(client); } catch { everyone = []; }
  }
  const seen = new Set();
  const roster = [people && people.spoc, ...((people && people.others) || []), ...everyone]
    .filter(Boolean)
    .filter((p) => {
      const key = p.netboxId != null ? `id:${p.netboxId}` : `name:${p.name}|${p.email || ''}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  return { client, resolved, rackName: resolved.name, roster, people, everyone,
           spoc: (people && people.spoc) || null, siteName: people?.site?.name || null };
}

/**
 * The one contact the admin meant.
 *
 * By NetBox contact id when the screen sent one, otherwise by the exact name
 * picked from the roster. No match, or two contacts with that name, is a
 * refusal: a ticket assigned to the wrong person is worse than no ticket.
 */
function contactFor(roster, d) {
  if (d.assigneeId != null && d.assigneeId !== '') {
    const byId = roster.filter((p) => String(p.netboxId) === String(d.assigneeId));
    if (byId.length === 1) return { person: byId[0] };
    return { error: byId.length
      ? `more than one NetBox contact has id ${d.assigneeId}`
      : `no NetBox contact has id ${d.assigneeId}` };
  }
  const name = String(d.assignee || '').trim();
  const byName = roster.filter((p) => p.name === name);
  if (byName.length === 1) return { person: byName[0] };
  if (byName.length > 1) {
    return { error: `more than one NetBox contact is named "${name}"; choose by contact id` };
  }
  return { error: `no NetBox contact is named "${name}"` };
}

/** The items a whole-rack assign would take: undecided, checkable at the rack, never assigned. */
const assignableUids = (planId) => machine
  .unassigned({ items: store.itemsOf(planId), tickets: store.ticketsOf(planId) }).map((i) => i.uid);

/**
 * Put a ticket on each row's item, inside the caller's transaction. The item
 * rules live here, for every caller: the item is on the plan, it is one a
 * person decides, it can be checked at the rack, and the ticket names
 * somebody. A device's ports go with it. An item assigned again starts a
 * fresh ticket, and what the last person found moves into its history.
 */
function ticketRows(plan, rows, actor) {
  const applied = [];
  const refused = [];
  const items = store.itemsOf(plan.id);
  for (const d of rows) {
    if (!d || typeof d !== 'object') { refused.push({ uid: null, why: 'not a decision' }); continue; }
    const item = items.find((i) => i.uid === d.uid);
    if (!item) { refused.push({ uid: d.uid, why: 'not in this plan' }); continue; }
    if (!item.decidable) { refused.push({ uid: d.uid, why: 'not a decidable item' }); continue; }
    if (!machine.isTicketable(item)) {
      refused.push({ uid: d.uid, why: machine.traitsOf(item.action).notTicketable
        || 'there is nothing to check at the rack for this item; approve or reject it' });
      continue;
    }
    if (!d.assignee && (d.assigneeId == null || d.assigneeId === '')) {
      refused.push({ uid: d.uid, why: 'a ticket has to be assigned to somebody' });
      continue;
    }
    const before = store.getTicket(plan.id, item.uid);
    const history = before
      ? [...(before.history || []), { ...before, history: undefined, replacedAt: store.nowIso() }]
      : [];
    const question = text(d.question ?? d.note) || 'Check this against the rack and report back.';
    store.putTicket(plan.id, item.uid, {
      assignee: d.assignee ?? null, assigneeId: d.assigneeId ?? null,
      assigneeEmail: d.assigneeEmail ?? null, assigneeUserId: d.assigneeUserId ?? null,
      spoc: d.spoc ?? null, scope: d.scope ?? null,
      raisedBy: actor.username ?? null, raisedById: actor.id ?? null, raisedAt: store.nowIso(),
      status: 'open', question, history,
    }, { touch: false });
    const decided = { decision: 'ticketed', decidedBy: actor.username ?? null,
      decidedById: actor.id ?? null, decidedAt: store.nowIso(), note: text(d.note ?? d.question) || null };
    store.updateItem(plan.id, item.uid, decided, { touch: false });
    for (const child of shape.childrenOf(items, item.uid)) {
      store.updateItem(plan.id, child.uid, decided, { touch: false });
    }
    note(plan, 'assign', { actor, item: item.uid,
      payload: { assignee: d.assignee ?? null, assigneeId: d.assigneeId ?? null,
                 assigneeUserId: d.assigneeUserId ?? null, scope: d.scope ?? null,
                 again: Boolean(before) } });
    applied.push({ uid: d.uid, decision: 'ticketed' });
  }
  if (applied.length) store.touchPlan(plan.id);
  return { applied, refused };
}

/**
 * One email to one person about everything just assigned to them. The email
 * is a courtesy on top of the ServiceNow incident, not the record - a failure
 * here never blocks the assignment. Sent to their own address, read from NetBox.
 */
function notifyAssignee(plan, items, { person, targets, incidents, rackName, siteName, by, question, wholeRack }) {
  const where = [rackName, siteName].filter(Boolean).join(', ');
  const n = targets.length;
  const subject = wholeRack
    ? `RackTrack: please check rack ${rackName} (${n} item${n === 1 ? '' : 's'})`
    : n === 1
      ? `RackTrack: please check ${targets[0].type} "${targets[0].name}" in ${rackName}`
      : `RackTrack: please check ${n} items in ${rackName}`;
  const incLines = incidents.flatMap((ext) => [
    ext.number ? `ServiceNow incident: ${ext.number}` : null,
    ext.url || null,
  ]).filter(Boolean);
  const body = [
    `Hello ${person.name},`,
    '',
    `A rack scan of ${where} found ${n === 1 ? 'something' : `${n} things`} that `
      + `${n === 1 ? 'does' : 'do'} not match NetBox, and ${by || 'an admin'} has asked you `
      + `to check ${n === 1 ? 'it' : 'them'} at the rack.`,
    '',
    ...targets.map((i) => `  ${itemLine(items, i)}`),
    question ? `\nThey ask: ${question}` : '',
    incLines.length ? `\n${incLines.join('\n')}` : '',
    '',
    'Nothing has been written to NetBox. Please check the rack and resolve the '
      + `incident${incidents.length === 1 ? '' : 's'} with what you find; it then comes back for approval.`,
    '',
    '- RackTrack',
  ].join('\n');

  const stamp = (patch) => {
    try {
      for (const t of targets) store.updateTicket(plan.id, t.uid, patch, { touch: false });
    } catch { /* a courtesy; never the reason a request fails */ }
  };
  return Promise.resolve()
    .then(() => require('../../auth').sendNotice({ to: person.email, subject, text: body }))
    .then((ok) => stamp(ok ? { emailedAt: new Date().toISOString() }
      : { emailNote: 'no mail transport configured' }))
    .catch(() => stamp({ emailNote: 'the notice could not be sent' }));
}

/**
 * An organization admin gives the check to somebody: the first holder of a
 * check that is waiting in triage, or a different one later (the SPOC is on
 * leave, or says it is not theirs).
 *
 *   userId      the RackTrack user it goes to, one of spoc.assignableUsers(), or
 *   assignee /  a NetBox contact picked from the roster, resolved to the
 *   assigneeId  RackTrack user with that contact's email
 *   reason      why; needed unless the check is still waiting in triage
 *
 * A check goes to one person as a whole, so there is no per-item form any
 * more. The person is settled BEFORE anything is written: somebody who cannot
 * open the check, an auditor, or the person who sent it refuses the request
 * with nothing changed. Then, in one transaction, the plan gets its new holder
 * (the old one kept under `previous`), every item still waiting gets a fresh
 * ticket to them with the old one in its history, and the plan is `assigned`.
 * After the commit the new holder is told, and the old one that it has gone.
 */
async function assign(planId, body = {}, { actor, req = null } = {}) {
  const who = actorOf(actor);
  const found = open(planId, who);
  if (found.refused) return found.refused;
  const { plan } = found;
  const strict = isStrict(who);
  if (strict && !machine.isAdmin(who)) {
    return refuse('role', 'Reassigning is for an organization admin.');
  }
  if (!ASSIGN_OPEN.includes(plan.status)) {
    return refuse('transition', plan.status === 'draft'
      ? 'this check has not been sent yet'
      : `a plan that is ${plan.status.replace(/_/g, ' ')} cannot be given to somebody`,
    { from: plan.status, to: 'assigned' });
  }
  const ONE_PERSON = 'Send { userId, reason }. A check goes to one person as a whole.';
  if (body.items !== undefined || body.rows !== undefined) return refuse('bad_request', ONE_PERSON);

  // Who it goes to, settled before anything is written on the plan.
  const allowed = spoc.assignableUsers(plan);
  const notThem = (user) => (user && Number(user.orgId) === Number(plan.orgId) && machine.isSender(plan, user)
    ? `${user.username} sent this check, so it cannot go to them.`
    : 'That person cannot be given this check. Choose an organization admin or somebody on its site.');
  let target = null;
  if (body.userId != null && body.userId !== '') {
    target = allowed.find((u) => Number(u.id) === Number(body.userId)) || null;
    if (!target) return refuse('bad_request', notThem(store.userById(body.userId)));
  } else if (body.assignee || (body.assigneeId != null && body.assigneeId !== '')) {
    const people = await rosterFor(plan, who);
    if (!people.client) {
      return refuse('bad_request',
        'No NetBox is configured for this account, so nobody can be looked up. Choose a RackTrack user.');
    }
    const hit = contactFor(people.roster, body);
    if (hit.error) return refuse('bad_request', hit.error);
    const user = hit.person.email ? store.userByEmail(plan.orgId, hit.person.email) : null;
    if (!user) {
      return refuse('bad_request', 'That contact has no RackTrack account, so they cannot open the check. '
        + 'Choose a RackTrack user.');
    }
    target = allowed.find((u) => Number(u.id) === Number(user.id)) || null;
    if (!target) return refuse('bad_request', notThem(user));
  } else {
    return refuse('bad_request', ONE_PERSON);
  }
  const reason = text(body.reason);
  if (!reason && plan.status !== 'triage') {
    return refuse('bad_request', 'Say why this check is going to somebody else.');
  }
  if (plan.spocUserId != null && Number(plan.spocUserId) === Number(target.id) && WORKING.includes(plan.status)) {
    return refuse('guard', `This check is already with ${target.username}.`, { from: plan.status, to: 'assigned' });
  }
  const holder = { userId: target.id, username: target.username, email: target.email ?? null };
  if (strict) {
    const ok = machine.can(plan, 'assigned', who, ctxFor(plan, { reason, holderUserId: holder.userId }));
    if (!ok.ok) return refuse(ok.code, ok.why, { from: plan.status, to: 'assigned' });
  }

  const old = plan.spoc && plan.spoc.userId != null ? plan.spoc : null;
  const out = run((effects) => {
    const previous = [...((plan.spoc && plan.spoc.previous) || []),
      ...(old ? [{ userId: old.userId, username: old.username, until: store.nowIso(),
        by: who.username ?? null, reason: reason || null }] : [])];
    store.updatePlan(plan.id, { spocUserId: holder.userId, needsAdmin: null,
      spoc: holderRecord(holder, { source: 'admin', by: who, reason: reason || null, previous }) });
    // Everything still waiting on a person goes with the check; what was
    // already approved or rejected stays decided.
    const waiting = store.itemsOf(plan.id).filter((i) => i.decidable && machine.isTicketable(i)
      && ['pending', 'ticketed'].includes(i.decision)).map((i) => i.uid);
    const rows = ticketRows(plan, holderRows(waiting, holder, plan.submittedNote), who);
    // A fresh ticket carries no incident pointer. Once a check has its one
    // incident, the pointer is stamped back onto the new tickets here, inside
    // this transaction, by the one helper that writes it.
    if (plan.incident) require('./incidents').stamp(plan.id, {});
    const moved = move(effects, store.getPlan(plan.id, { heavy: false }), 'assigned', {
      actor: who, action: plan.status === 'assigned' ? 'reassign' : 'assign', req, force: true,
      reason: reason || null, payload: { from: old ? old.username : null, to: holder.username, reason: reason || null },
      auditPayload: { from: old ? old.username : null, to: holder.username },
    });
    return { ...rows, plan: moved.plan };
  });

  // After the commit. A check that has its incident moves it to the new holder
  // rather than raising another; with none yet, dispatch() is where one starts.
  // Neither holds the admin's request up for longer than a send is held.
  if (plan.incident && plan.incident.sysId) {
    const incidents = require('./incidents');
    await incidents.within(incidents.reassign(plan.id, holder, { by: who.username ?? null, reason: reason || null }),
      raiseWait());
  }
  const sent = await dispatch(plan.id, { actor: who, req, again: true });
  if (old) {
    const effects = [];
    emit(effects, 'reassigned', { plan: out.plan, previous: { userId: old.userId, username: old.username,
      email: old.email ?? null }, holder, actor: who });
    flush(effects);
  }
  return { plan: store.getPlan(plan.id, { heavy: false }), holder: sent.holder, previous: old,
    incident: sent.incident, applied: out.applied, refused: out.refused };
}

/**
 * Put tickets on items without going anywhere: the synchronous half of
 * assign().
 *
 * assign() resolves the assignee against NetBox, raises a ServiceNow incident
 * per item and emails each person, all of which have to be awaited. The old
 * library in lib/netbox/plans.js is called synchronously and was always given
 * a name that its caller had already settled - a unit test, a script, the
 * decide route once it has looked the contact up itself - so it needs the
 * other half on its own: the item rules (the item is on the plan, it is one a
 * person decides, it can be checked at the rack, it names somebody), the
 * ticket, the ports that follow, and the plan catching up afterwards.
 *
 * Nothing here reaches the network, so nothing here can fail slowly.
 */
function assignLocal(planId, rows, { actor, req = null } = {}) {
  const who = actorOf(actor);
  const found = open(planId, who);
  if (found.refused) return found.refused;
  const { plan } = found;
  if (shape.legacyStatus(plan.status) === 'applied') {
    return refuse('transition', 'this plan has already been written');
  }
  const out = run(() => ticketRows(plan, Array.isArray(rows) ? rows : [], who));
  const after = run((effects) => {
    const now = store.getPlan(plan.id, { heavy: false });
    if (out.applied.length && ['reopened', 'rework', 'rejected'].includes(now.status)) {
      const moved = move(effects, now, 'assigned', {
        actor: who, action: 'assign_again', req, force: !isStrict(who),
        ctx: ctxFor(now, { reason: 'assigned again' }), reason: 'assigned again',
      });
      if (moved.refused) return moved;
    }
    return { plan: settle(effects, plan.id, who) };
  });
  return { ...out, plan: after.plan || store.getPlan(plan.id, { heavy: false }) };
}

// -- Tickets --------------------------------------------------------------
const TICKET_OPEN = ['triage', ...WORKING, 'reopened', 'rework'];

function ticketAction(planId, uid, action, body = {}, { actor, req = null } = {}) {
  const who = actorOf(actor);
  const found = open(planId, who);
  if (found.refused) return found.refused;
  const { plan } = found;
  const strict = isStrict(who);
  const item = store.getItem(plan.id, uid);
  // A port's ticket is a reference to its device's. Acting on the reference
  // alone would leave the device, and the other ports, waiting on a ticket
  // that had in fact been answered.
  if (item && item.following && store.getTicket(plan.id, item.parentUid)) {
    return refuse('guard', 'this port follows its device; resolve the device ticket instead');
  }
  const ticket = store.getTicket(plan.id, uid);
  if (!item || !ticket) return refuse('not_found', 'no ticket on that item');

  // A written plan is closed: what somebody finds at the rack now belongs on
  // a new comparison, not on a record NetBox already took.
  if (['written', 'completed'].includes(plan.status)) {
    return refuse('transition', 'this plan has already been written');
  }
  if (strict && !TICKET_OPEN.includes(plan.status)) {
    return refuse('transition', `a plan that is ${plan.status.replace(/_/g, ' ')} has no tickets to work on`);
  }
  const finding = text(body.finding);
  const ask = { pendingReason: body.reason ?? body.pendingReason, finding, disposition: body.disposition };
  if (strict || who.system) {
    const ok = machine.canTicket(ticket, action, who, ask);
    if (!ok.ok) return refuse(ok.code, ok.why);
  } else {
    // The old library: the ticket has to be open, and resolving needs a finding.
    if (!shape.isOpenTicket(ticket)) return refuse('transition', 'that ticket is not open');
    if (action === 'resolve' && !finding) {
      return refuse('guard', 'say what you found before resolving the ticket');
    }
  }

  return run((effects) => {
    const now = store.nowIso();
    const items = store.itemsOf(plan.id);
    let patch;
    if (action === 'accept') patch = { status: 'accepted', acceptedAt: now };
    else if (action === 'start') {
      patch = { status: 'in_progress', acceptedAt: ticket.acceptedAt || now,
                pendingReason: null, pendingSince: null };
    } else if (action === 'pending') {
      patch = { status: 'pending', pendingReason: ask.pendingReason, pendingSince: now,
                acceptedAt: ticket.acceptedAt || now };
    } else {
      patch = {
        status: 'resolved', resolvedBy: who.username ?? null, resolvedById: who.id ?? null,
        resolvedAt: now, finding: finding || ticket.finding || null,
        disposition: body.disposition || ticket.disposition || null,
        outcome: text(body.outcome) || 'checked',
        acceptedAt: ticket.acceptedAt || now, pendingReason: null, pendingSince: null,
      };
    }
    const updated = store.updateTicket(plan.id, uid, patch, { touch: false });
    if (action === 'resolve') {
      // Back to the admin. A resolved ticket is not an approval.
      const back = { decision: 'pending', decidedBy: null, decidedById: null, decidedAt: null };
      store.updateItem(plan.id, uid, back, { touch: false });
      for (const child of shape.childrenOf(items, uid)) {
        if (child.decision === 'ticketed') store.updateItem(plan.id, child.uid, back, { touch: false });
      }
    }
    store.touchPlan(plan.id);
    const detail = action === 'resolve'
      ? { uid, outcome: updated.outcome, finding: updated.finding, disposition: updated.disposition }
      : { uid, reason: updated.pendingReason || null };
    note(plan, `ticket.${action}`, { actor: who, item: uid,
      reason: action === 'pending' ? updated.pendingReason : null,
      payload: action === 'resolve' ? { what: 'ticket resolved', detail } : { detail } });
    audit(effects, plan, action === 'resolve' ? 'resolve' : `ticket.${action}`, {
      actor: who, req, payload: { ...detail, assignee: updated.assignee } });
    if (action === 'pending') {
      emit(effects, 'pending', { plan, actor: who, item: uid, reason: updated.pendingReason, ticket: updated });
    }
    const settled = settle(effects, plan.id, who);
    return { plan: settled, ticket: updated, item: store.getItem(plan.id, uid) };
  });
}

const acceptTicket = (planId, uid, opts) => ticketAction(planId, uid, 'accept', {}, opts);
const startTicket = (planId, uid, opts) => ticketAction(planId, uid, 'start', {}, opts);
const holdTicket = (planId, uid, body, opts) => ticketAction(planId, uid, 'pending', body, opts);
const resolveTicket = (planId, uid, body, opts) => ticketAction(planId, uid, 'resolve', body, opts);

/**
 * Apply what ServiceNow now says about the incidents we raised.
 *
 * ServiceNow owns whether an incident is open or closed - we read it and never
 * argue with it. A closed incident returns its item to the admin as UNDECIDED,
 * exactly as a person resolving it by hand would. Its close notes are the
 * finding; an incident closed with no notes is resolved with no finding, and
 * approve and reject stay shut until somebody records one.
 *
 * `states` is what tickets.statusOf() returned, keyed by sys_id.
 */
function applyTicketStates(planId, states, { by = 'ServiceNow' } = {}) {
  const plan = store.getPlan(planId, { heavy: false });
  if (!plan || !states) return { plan, changed: [] };
  if (['written', 'completed'].includes(plan.status)) return { plan, changed: [] };
  // A check with a holder has one incident of its own, heard through
  // incidents.applyState(): somebody closing it in ServiceNow is flagged on
  // the check and is never a finding, an approval or a reason to move it.
  if (plan.spocUserId != null) return { plan, changed: [] };
  const changed = [];
  const out = run((effects) => {
    const items = store.itemsOf(plan.id);
    for (const t of store.ticketsOf(plan.id)) {
      const ext = t.external;
      // A copy of the check's one incident is not this ticket's to resolve,
      // even on a check that has since lost its holder.
      if (!ext || !ext.sysId || ext.planLevel) continue;
      const now = states[ext.sysId];
      if (!now) continue;
      const was = ext.state;
      const external = { ...ext, state: now.state, number: now.number || ext.number };
      if (now.closed && shape.isOpenTicket(t)) {
        const who = { ...SYSTEM, username: `${by} (${now.state})` };
        const stamp = store.nowIso();
        store.updateTicket(plan.id, t.itemUid, {
          external, status: 'resolved', resolvedBy: who.username, resolvedById: null,
          resolvedAt: stamp, outcome: now.state, finding: now.notes || t.finding || null,
          acceptedAt: t.acceptedAt || stamp, pendingReason: null, pendingSince: null,
        }, { touch: false });
        const back = { decision: 'pending', decidedBy: null, decidedById: null, decidedAt: null };
        store.updateItem(plan.id, t.itemUid, back, { touch: false });
        for (const child of shape.childrenOf(items, t.itemUid)) {
          if (child.decision === 'ticketed') store.updateItem(plan.id, child.uid, back, { touch: false });
        }
        changed.push({ uid: t.itemUid, number: external.number, state: now.state, finding: now.notes || null });
        audit(effects, plan, 'resolve', { actor: who, payload: {
          uid: t.itemUid, outcome: now.state, finding: now.notes || null, assignee: t.assignee,
          via: 'servicenow', incident: external.number || null } });
      } else if (was !== now.state) {
        store.updateTicket(plan.id, t.itemUid, { external }, { touch: false });
        changed.push({ uid: t.itemUid, number: external.number, state: now.state });
      }
    }
    if (!changed.length) return plan;
    store.touchPlan(plan.id);
    note(plan, 'servicenow.sync', { actor: { ...SYSTEM, username: by },
      payload: { what: 'heard back from ServiceNow', detail: { changed: changed.length } } });
    return settle(effects, plan.id, SYSTEM);
  });
  return { plan: out, changed };
}

/** Every open incident this plan is waiting on, as sys_ids. */
const openSysIds = (planId) => [...new Set(store.ticketsOf(planId)
  .filter((t) => shape.isOpenTicket(t) && t.external && t.external.sysId && !t.external.planLevel)
  .map((t) => t.external.sysId))];

/**
 * Ask ServiceNow about every incident still open, across every plan, and
 * apply what it says. The poller calls this every five minutes, so an SLA
 * clock is truthful without an admin having to open the plan.
 */
async function syncServiceNow() {
  const waiting = store.ticketsWaitingOnServiceNow();
  const byOrg = new Map();
  for (const t of waiting) {
    const key = `${t.orgId ?? 'none'}|${t.orgId == null ? t.raisedById ?? '' : ''}`;
    const group = byOrg.get(key) || { orgId: t.orgId, userId: t.raisedById, tickets: [] };
    group.tickets.push(t);
    byOrg.set(key, group);
  }
  const { serviceNowFor } = require('./connections');
  const ticketsLib = require('../netbox/tickets');
  let asked = 0;
  let changed = 0;
  for (const group of byOrg.values()) {
    const sn = serviceNowFor({ orgId: group.orgId, userId: group.userId });
    if (!sn) continue;
    const sysIds = [...new Set(group.tickets.map((t) => t.external.sysId))];
    asked += sysIds.length;
    let r;
    try { r = await ticketsLib.statusOf(sn, sysIds); } catch { r = null; }
    if (!r || !r.ok) continue;
    for (const planId of new Set(group.tickets.map((t) => t.planId))) {
      try { changed += applyTicketStates(planId, r.states).changed.length; } catch { /* next plan */ }
    }
  }
  // The checks that have one incident of their own: what ServiceNow says about
  // each is heard, and whatever RackTrack still owes it is tried again.
  let held = { asked: 0, changed: 0, retried: 0 };
  try { held = await require('./incidents').sync(); } catch { /* the next pass asks again */ }
  return { asked: asked + held.asked, changed: changed + held.changed, retried: held.retried };
}

// -- Item decisions -------------------------------------------------------
const DECIDE_OPEN = ['triage', ...WORKING, 'resolved', 'verification_pending', 'approval_pending',
  'rework', 'reopened'];

/** True when the item has come back from whoever was asked to look, with something said. */
const hasFinding = (ticket) => Boolean(ticket && ticket.status === 'resolved' && text(ticket.finding));

/**
 * May this person decide the items of this check? Null when they may, else a
 * refusal. It is for the SPOC the check is with, whatever their role, or an
 * organization admin in their place; an approver only signs a check that is
 * waiting for its approval. And never for the person who sent it.
 */
function mayDecide(plan, who) {
  if (!isStrict(who)) return null;
  // The sender first, so whoever they are they read the sentence that is about them.
  if (machine.isSender(plan, who)) return refuse('role', machine.SENDER_WHY);
  const theirs = machine.isAdmin(who) || machine.isHolder(plan, who)
    || (who.role === 'approver' && plan.status === 'approval_pending');
  if (!theirs) return refuse('role', 'Deciding this check is for its SPOC or an organization admin.');
  return null;
}

/**
 * Approve or reject items, one by one.
 *
 * The person a check is with decides it with the drift report beside them, so
 * their decision is itself the finding: an item whose ticket is still open is
 * decided, and the ticket closes in the same step with what they said.
 *
 * The old library (a trusted caller) still assigns before it decides: approve
 * and reject are refused there on an item nobody has been asked to check, on
 * one whose ticket is still open, and on one that came back with nothing said.
 * The one exception is an item that cannot be checked at the rack at all (a
 * rebind): it is decided as it stands.
 *
 * A decision on a device is a decision on the ports that follow it, and it
 * closes the device's ticket, keeping the finding beside the close.
 */
function decideItems(planId, decisions, { actor, req = null } = {}) {
  const who = actorOf(actor);
  const found = open(planId, who);
  if (found.refused) return found.refused;
  const { plan } = found;
  const strict = isStrict(who);
  const barred = mayDecide(plan, who);
  if (barred) return barred;
  if (shape.legacyStatus(plan.status) === 'applied') {
    return refuse('transition', 'this plan has already been written');
  }
  if (strict && !DECIDE_OPEN.includes(plan.status)) {
    return refuse('transition', plan.status === 'draft'
      ? 'this check has not been sent yet'
      : `a plan that is ${plan.status.replace(/_/g, ' ')} is closed to item decisions; send it back for rework first`);
  }

  // Assign first is the old library's rule, and only its.
  const assignFirst = !strict;
  return run((effects) => {
    const applied = [];
    const refused = [];
    const items = store.itemsOf(plan.id);
    for (const d of decisions || []) {
      if (!d || typeof d !== 'object') { refused.push({ uid: null, why: 'not a decision' }); continue; }
      const item = items.find((i) => i.uid === d.uid);
      if (!item) { refused.push({ uid: d.uid, why: 'not in this plan' }); continue; }
      if (!item.decidable) { refused.push({ uid: d.uid, why: 'not a decidable item' }); continue; }
      if (!['approved', 'rejected'].includes(d.decision)) {
        refused.push({ uid: d.uid, why: `unknown decision '${d.decision}'` });
        continue;
      }
      if (d.reasonCode != null && d.reasonCode !== '' && !REASONS.reject.includes(d.reasonCode)) {
        refused.push({ uid: d.uid, why: `unknown reason code '${d.reasonCode}'` });
        continue;
      }
      const ticket = store.getTicket(plan.id, item.uid);
      const found2 = hasFinding(ticket);
      if (assignFirst && machine.needsAssignFirst(item) && !found2) {
        refused.push({ uid: d.uid, why: 'assign first' });
        continue;
      }
      const decided = { decision: d.decision, decidedBy: who.username ?? null,
        decidedById: who.id ?? null, decidedAt: store.nowIso(),
        note: text(d.note) || null, reasonCode: d.reasonCode || null };
      store.updateItem(plan.id, item.uid, decided, { touch: false });
      for (const child of shape.childrenOf(items, item.uid)) {
        store.updateItem(plan.id, child.uid, decided, { touch: false });
      }
      if (ticket && ticket.status === 'resolved') {
        // The admin has decided with the finding in hand, so the ticket is
        // done. Its finding, who resolved it and when stay as they were left.
        store.updateTicket(plan.id, item.uid, { status: 'closed', closedBy: who.username ?? null,
          closedAt: store.nowIso(), closedWith: d.decision }, { touch: false });
      } else if (strict && shape.isOpenTicket(ticket)) {
        // Decided while the ticket was still out: the decision is the finding.
        const now = store.nowIso();
        store.updateTicket(plan.id, item.uid, { status: 'closed', closedBy: who.username ?? null,
          closedAt: now, closedWith: d.decision,
          finding: text(d.note) || ticket.finding || 'Decided at the desk with the drift report.',
          resolvedBy: who.username ?? null, resolvedById: who.id ?? null, resolvedAt: now }, { touch: false });
      }
      applied.push({ uid: d.uid, decision: d.decision });
      audit(effects, plan, 'decide', { actor: who, req, payload: {
        uid: d.uid, decision: d.decision, note: text(d.note) || null,
        action: item.action, hadFinding: found2, reasonCode: d.reasonCode || null } });
    }
    if (applied.length) store.touchPlan(plan.id);
    note(plan, 'decide', { actor: who,
      payload: { what: 'decided', detail: { applied: applied.length, refused: refused.length }, applied } });
    return { plan: store.getPlan(plan.id, { heavy: false }), applied, refused };
  });
}

// -- A change before approving: overrides, the re-plan, suggestions -------
/**
 * A person may change a check before they approve it: accept what RackTrack
 * suggests (a record is on the wrong shelf, a record not seen is marked
 * offline) or type a serial number, an asset tag or a description by hand.
 *
 * The write is driven by the scan, so a change is never kept on the item
 * alone. It is stored as an override, laid over the scan by snapshot.forPlan
 * for every comparison of this check from then on, and the check is compared
 * again IN PLACE: the same check number, the same incident, fresh items, a
 * fresh fingerprint. Whatever somebody had signed before no longer matches.
 * Nothing is kept unless the fresh comparison really shows the change, so what
 * a person reads on the check afterwards is what the write will do.
 */
const overridesLib = require('./overrides');
const suggestLib = require('./suggest');

const CHANGE_OPEN = WORKING;
const NETBOX_DOWN = 'NetBox could not be compared, so the change was not applied.';
const GONE = 'That suggestion no longer applies.';
const changeKey = (i) => `${i.uid} ${i.action} ${shape.stable(i.diff)}`;

/** Tests hand in the NetBox and the writer a re-plan compares with: { client, writer }. */
let _compare = null;
function _setCompare(deps) { _compare = deps || null; }

/** An override as a screen is shown it. */
const overrideBrief = (o) => ({ id: o.id, kind: o.kind, itemUid: o.itemUid, netboxId: o.netboxId,
  recordName: o.recordName, fields: o.fields, source: o.source, rule: o.rule, note: o.note,
  createdBy: o.createdBy, createdAt: o.createdAt });

/** May this person change this check, here and now? Null when they may. */
function mayChange(plan, who) {
  const barred = mayDecide(plan, who);
  if (barred) return barred;
  if (!CHANGE_OPEN.includes(plan.status) || (isStrict(who) && plan.spocUserId == null)) {
    return refuse('transition', plan.status === 'draft'
      ? 'this check has not been sent yet'
      : 'A check can be changed only while it is with the person deciding it.');
  }
  return null;
}

/**
 * Did the fresh comparison really take this change? Null when it did, else the
 * sentence a person is refused with - the writer's own reason where it gave one.
 */
function tookOf(report, o) {
  const rows = report.changes || [];
  const sameValue = (a, b) => (Number.isFinite(Number(a)) && Number.isFinite(Number(b)) && a !== '' && b !== ''
    && a !== null && b !== null ? Number(a) === Number(b) : String(a ?? '') === String(b ?? ''));
  if (o.kind === 'move') {
    const row = rows.find((c) => c.uid === o.itemUid) || null;
    const want = o.fields.position;
    const got = row && row.diff && row.diff.position;
    if (!row) return 'The scan no longer has that box, so the record was not moved.';
    if (!['rebind', 'update'].includes(row.action) || Number(row.netboxId) !== Number(o.netboxId)) {
      return row.reason || 'NetBox would not take that record for this box, so it was not moved.';
    }
    if (!got) return 'The record is already on that shelf in NetBox, so there is nothing to move.';
    if (!sameValue(got.from, want.from) || !sameValue(got.to, want.to)) {
      return 'The record moved since this was suggested, so it was not moved again. Compare the rack again.';
    }
    if ((report.orphans || []).some((r) => Number(r.netboxId) === Number(o.netboxId))) {
      return 'NetBox still lists that record as not seen, so the move was not applied.';
    }
    if (rows.some((c) => shape.ACTIONABLE.has(c.action) && shape.parentUidOf(c) === o.itemUid)) {
      return 'The move would add ports the camera counted to the customer\'s record, so it was not applied.';
    }
    return null;
  }
  if (o.kind === 'offline') {
    const row = rows.find((c) => c.uid === `nb:device:${o.netboxId}`) || null;
    if (row && row.action === 'update' && row.diff && row.diff.status && row.diff.status.to === 'offline') return null;
    if (row && row.action === 'noop') return 'The record is already offline in NetBox.';
    return (row && row.reason) || 'NetBox would not mark that record offline, so nothing was changed.';
  }
  const row = rows.find((c) => c.uid === o.itemUid) || null;
  if (!row) return 'The scan no longer has that box, so the value was not changed.';
  if (row.action === 'rebind') {
    return 'This box is being matched to the customer\'s own record, and that writes nothing else on it. '
      + 'Approve and write it first, then change the value on the next check.';
  }
  for (const [field, pair] of Object.entries(o.fields)) {
    // A create has no diff. Its payload, where the comparison reports one, says what would be made.
    if (row.action === 'create') {
      if (row.created && Object.prototype.hasOwnProperty.call(row.created, field)
        && !sameValue(row.created[field], pair.to)) return 'NetBox would not be given that value, so it was not applied.';
      continue;
    }
    const got = row.diff && row.diff[field];
    if (row.action === 'update' && got && sameValue(got.to, pair.to)) continue;
    const held = (report.findings || []).find((f) => f && f.uid === o.itemUid && f.kind === 'held-back'
      && (f.fields || []).some((x) => x.field === field));
    if (held) return held.why;
    return row.reason || 'The record already holds that value, or NetBox would not take it, so nothing was changed.';
  }
  return null;
}

/** Close the open ticket on an item a person has just decided by changing it. */
function closeDecidedTicket(planId, uid, who, how, said = null) {
  const ticket = store.getTicket(planId, uid);
  if (!shape.isOpenTicket(ticket)) return;
  const now = store.nowIso();
  store.updateTicket(planId, uid, { status: 'closed', closedBy: who.username ?? null,
    closedAt: now, closedWith: how,
    finding: text(said) || ticket.finding || 'Decided at the desk with the drift report.',
    resolvedBy: who.username ?? null, resolvedById: who.id ?? null, resolvedAt: now }, { touch: false });
}

/** The item an override shows up as on the check. */
const itemUidOf = (o) => (o.kind === 'offline' ? `nb:device:${o.netboxId}` : o.itemUid);

/**
 * Compare the check again, in place, with `tentative` overrides laid over its
 * scan and the stored overrides in `revoke` left out.
 *
 * Nothing is stored unless NetBox answered and every tentative override shows
 * in the fresh comparison. Then, in one transaction: the overrides are kept (or
 * revoked), the items are replaced - a decision stands where the item is the
 * same change to the byte, and everything else is asked again - and the plan
 * takes the fresh fingerprint, counts, warnings, orphans, findings and
 * evidence. An item born from an override is approved by the person who made
 * it, and says so in `modified`. `also(effects, { overrideIds })` runs inside
 * that transaction, for the caller's own bookkeeping.
 */
async function replan(planId, { actor, req = null, why = 'change', tentative = [], revoke = [], also = null } = {}) {
  const who = actorOf(actor);
  const found = open(planId, who);
  if (found.refused) return found.refused;
  const { plan } = found;
  const barred = mayChange(plan, who);
  if (barred) return barred;

  const now = store.nowIso();
  const fresh = [];
  for (const t of tentative || []) {
    try { overridesLib.validate(t.kind, t.fields); } catch (err) { return refuse('bad_request', err.message); }
    fresh.push({ ...t, createdBy: who.username ?? null, createdById: who.id ?? null, createdAt: now });
  }
  const standing = store.overridesOf(plan.id).map((o) => o.id);

  const loaded = require('./snapshot').forPlan(plan, { extra: fresh, without: revoke });
  if (loaded.error) return refuse('guard', `${loaded.error}, so the change was not applied.`);
  // A client for each comparison: a client remembers what it preloaded, and a
  // second comparison through the same one reads its own memory as a duplicate.
  const given = _compare && _compare.client;
  const clientFor = () => (typeof given === 'function' ? given() : given) || require('./connections').netboxFor({
    orgId: plan.orgId ?? who.orgId, userId: who.id ?? null });
  const W = (_compare && _compare.writer) || require('../netbox/writer');
  const nb = clientFor();
  if (!nb) return refuse('guard', NETBOX_DOWN);
  let report;
  try {
    report = await W.plan(loaded.snap, nb);
  } catch {
    return refuse('guard', NETBOX_DOWN);
  }
  for (const o of fresh) {
    const refusedBy = tookOf(report, o);
    // A change the comparison will not show is a change the write will not make.
    if (refusedBy) return refuse('guard', refusedBy);
  }
  // The system comparing a check again (NetBox moved under an approval) cannot
  // refuse: a person's change that NetBox no longer takes is taken back, the
  // check is compared without it, and its suggestion is open again for them.
  const lost = who.system
    ? store.overridesOf(plan.id).filter((o) => !(revoke || []).map(Number).includes(o.id) && tookOf(report, o))
    : [];
  if (lost.length) {
    revoke = [...(revoke || []), ...lost.map((o) => o.id)];
    const again = require('./snapshot').forPlan(plan, { extra: fresh, without: revoke });
    try {
      report = await W.plan(again.snap, clientFor());
    } catch {
      return refuse('guard', NETBOX_DOWN);
    }
  }

  return run((effects) => {
    // NetBox was asked outside any transaction. If somebody else changed this
    // check meanwhile, what was compared is no longer what the check holds.
    const current = store.getPlan(plan.id, { heavy: false });
    const still = store.overridesOf(plan.id).map((o) => o.id);
    if (!current || current.status !== plan.status || still.join() !== standing.join()) {
      return refuse('guard', 'This check was changed by somebody else just now. Open it again and repeat the change.');
    }
    for (const id of revoke || []) store.revokeOverride(id, who.username ?? null, { touch: false });
    if (lost.length) {
      const gone = new Set(lost.map((o) => o.id));
      store.updatePlan(plan.id, { suggestionState: Object.fromEntries(Object.entries(current.suggestionState || {})
        .filter(([, said]) => !(said && gone.has(Number(said.overrideId))))) });
    }
    const kept = fresh.map((o) => store.addOverride(plan.id, o, { touch: false }));
    const live = store.overridesOf(plan.id);

    const before = store.itemsOf(plan.id);
    const beforeByKey = new Map(before.map((i) => [changeKey(i), i]));
    const beforeByUid = new Map(before.map((i) => [i.uid, i]));
    const ticketed = new Set(store.ticketsOf(plan.id).filter(shape.isOpenTicket).map((t) => t.itemUid));
    const bornOf = new Map(live.map((o) => [itemUidOf(o), o]));   // the latest change on an item names it

    const items = (report.changes || []).map(shape.toItem);
    for (const item of items) {
      const same = beforeByKey.get(changeKey(item)) || null;
      // What a change that has been taken back made of an item goes with it,
      // decision and all, even where the item reads the same to the byte (a
      // value typed onto a new box changes no diff).
      const stale = Boolean(same && same.modified && !live.some((o) => o.id === same.modified.overrideId));
      if (same && !stale) {
        Object.assign(item, { decision: same.decision, decidedBy: same.decidedBy, decidedById: same.decidedById,
          decidedAt: same.decidedAt, note: same.note, reasonCode: same.reasonCode, exceptionId: same.exceptionId });
        for (const k of ['modified', 'disposition']) if (same[k] !== undefined) item.extra = { ...item.extra, [k]: same[k] };
      }
      const o = item.decidable ? bornOf.get(item.uid) : null;
      const named = Boolean(o && same && !stale && same.modified && same.modified.overrideId === o.id);
      if (o && !named) {
        const was = beforeByUid.get(item.uid) || null;
        const original = was && was.modified ? was.modified.original
          : was ? { action: was.action, diff: was.diff ?? null, name: was.name ?? null } : null;
        item.extra = { ...item.extra, modified: { overrideId: o.id, kind: o.kind, source: o.source, rule: o.rule ?? null,
          by: o.createdBy ?? null, byId: o.createdById ?? null, at: o.createdAt, note: o.note ?? null,
          recordName: o.recordName ?? null, original } };
        // The system comparing a check again decides nothing: a person's change
        // that came out differently is asked of a person again.
        if (!who.system) {
          Object.assign(item, { decision: 'approved', decidedBy: who.username ?? null, decidedById: who.id ?? null,
            decidedAt: now, note: o.note ?? null, reasonCode: null, exceptionId: null });
          closeDecidedTicket(plan.id, item.uid, who, 'approved', o.note);
          continue;
        }
      }
      if ((!same || stale) && item.decidable) item.decision = ticketed.has(item.uid) ? 'ticketed' : 'pending';
    }
    // A port goes the way of its device, as it does for every other decision.
    const byUid = new Map(items.map((i) => [i.uid, i]));
    for (const item of items) {
      if (!item.following || beforeByKey.has(changeKey(item))) continue;
      const parent = byUid.get(item.parentUid);
      if (parent) {
        Object.assign(item, { decision: parent.decision, decidedBy: parent.decidedBy ?? null,
          decidedById: parent.decidedById ?? null, decidedAt: parent.decidedAt ?? null });
      }
    }

    const fingerprint = shape.fingerprint(report.changes);
    const updated = store.replaceItems(plan.id, items, {
      fingerprint, payloadHash: null,
      // What the check was FILED as, kept the first time a change moves the
      // fingerprint: it is how the phone, comparing without the change, still
      // gets this check back and not a second draft of the same drift.
      baseFingerprint: current.baseFingerprint || current.fingerprint,
      counts: report.counts || {}, warnings: report.warnings || [], orphans: report.orphans || [],
      findings: report.findings || [],
      evidence: report.records || report.boxes
        ? { records: report.records || [], boxes: report.boxes || [] } : null,
    });
    // A ticket on an item the check no longer asks about would stay open for ever.
    const asked = new Set(items.filter((i) => i.decidable).map((i) => i.uid));
    for (const t of store.ticketsOf(plan.id)) {
      if (!shape.isOpenTicket(t) || asked.has(t.itemUid)) continue;
      store.updateTicket(plan.id, t.itemUid, { status: 'closed', closedBy: who.username ?? null,
        closedAt: now, closedWith: 'replanned' }, { touch: false });
    }

    const overrideIds = kept.map((o) => o.id);
    const payload = { why,
      before: { fingerprint: current.fingerprint, summary: shape.summarise(before) },
      after: { fingerprint, summary: shape.summarise(items) },
      overrides: overrideIds, revoked: (revoke || []).map(Number) };
    note(updated, 'replan', { actor: who, payload });
    audit(effects, updated, 'replan', { actor: who, req, payload });
    if (typeof also === 'function') also(effects, { overrideIds, overrides: kept });
    return { plan: store.getPlan(plan.id, { heavy: false }), overrides: overrideIds, replanned: true };
  });
}

/** Every suggestion the check supports right now, with what people have said about each. */
function suggestionsFor(plan, items = null) {
  const { findings, evidence } = store.evidenceOf(plan.id);
  const rows = items || store.itemsOf(plan.id);
  let live = [];
  let others = [];
  if (evidence) {
    const exceptions = require('./exceptions');
    live = store.listExceptions({ orgId: plan.orgId ?? null }).filter((ex) => exceptions.isActive(ex));
    others = plan.orgId != null && plan.rackId != null
      ? store.listPlans({ orgId: plan.orgId, rackId: plan.rackId, status: machine.OPEN, limit: 50 })
        .filter((p) => p.id !== plan.id && p.status !== 'draft')
        .map((p) => ({ ...p, items: store.itemsOf(p.id) }))
      : [];
  }
  const state = plan.suggestionState || {};
  const out = suggestLib.suggest({ plan, items: rows, orphans: plan.orphans || [], findings, evidence,
    exceptions: live, duplicates: others, state });
  // An accepted suggestion changes the very thing it was worked out from, so
  // it is no longer worked out. The card is kept as it was accepted, so the
  // person still reads what was accepted, by whom, and can take it back.
  const shown = new Set(out.suggestions.map((s) => s.id));
  const accepted = Object.entries(state)
    .filter(([id, said]) => said && said.state === 'accepted' && said.card && !shown.has(id))
    .map(([id, said]) => ({ ...said.card, id, state: 'accepted', stateBy: said.by ?? null,
      stateAt: said.at ?? null, overrideId: said.overrideId ?? null }));
  return { suggestions: [...accepted, ...out.suggestions], note: out.note };
}

/** The open suggestion a person pressed, or the refusal. */
function openSuggestion(planId, sid, who) {
  const found = open(planId, who);
  if (found.refused) return found;
  const barred = mayDecide(found.plan, who);
  if (barred) return { refused: barred };
  if (isStrict(who) && !DECIDE_OPEN.includes(found.plan.status)) {
    return { refused: refuse('transition', 'This check is not open to decisions any more.') };
  }
  const s = suggestionsFor(found.plan).suggestions.find((x) => x.id === String(sid) && x.state === 'open');
  if (!s) return { refused: refuse('guard', GONE) };
  return { plan: found.plan, s };
}

/** Write down what a person said about a suggestion, with the evidence they were shown. */
function saySuggestion(effects, plan, s, state, who, { said = null, overrideId = null, req = null } = {}) {
  const { id } = s;
  const card = { rule: s.rule, word: s.word, title: s.title, evidence: s.evidence, itemUid: s.itemUid,
    netboxId: s.netboxId, recordName: s.recordName, proposes: s.proposes, candidates: s.candidates,
    acceptLabel: s.acceptLabel };
  const fresh = store.getPlan(plan.id, { heavy: false });
  store.updatePlan(plan.id, { suggestionState: { ...(fresh.suggestionState || {}),
    [id]: { state, by: who.username ?? null, byId: who.id ?? null, at: store.nowIso(),
      note: text(said) || null, overrideId, ...(state === 'accepted' ? { card } : {}) } } });
  // The sentences are kept in the event, so why it was accepted survives a re-plan.
  const payload = { id, rule: s.rule, title: s.title, evidence: s.evidence, note: text(said) || null, overrideId };
  note(fresh, `suggestion.${state === 'accepted' ? 'accept' : 'dismiss'}`, { actor: who, item: s.itemUid || null, payload });
  audit(effects, fresh, `suggestion.${state === 'accepted' ? 'accept' : 'dismiss'}`, { actor: who, req, payload });
}

/**
 * Accept a suggestion. What that does is the rule's own answer
 * (suggest.acceptanceOf): a change and a re-plan, a decision on the item, an
 * exception applied, the check closed as a duplicate, or nothing but the word.
 */
async function acceptSuggestion(planId, sid, { note: said = null, actor, req = null } = {}) {
  const who = actorOf(actor);
  const found = openSuggestion(planId, sid, who);
  if (found.refused) return found.refused;
  const { plan, s } = found;
  const act = suggestLib.acceptanceOf(s) || { does: 'state' };

  if (act.does === 'override') {
    const out = await replan(plan.id, { actor: who, req, why: `suggestion ${s.rule}`,
      tentative: [{ ...act.override, note: text(said) || null }],
      also: (effects, { overrideIds }) => saySuggestion(effects, plan, s, 'accepted', who,
        { said, overrideId: overrideIds[0] ?? null, req }) });
    if (out.error) return out;
    return { ...get(plan.id, who), replanned: true };
  }

  const out = run((effects) => {
    const now = store.nowIso();
    if (act.does === 'decide' || act.does === 'except') {
      const items = store.itemsOf(plan.id);
      const item = items.find((i) => i.uid === s.itemUid);
      if (!item || !item.decidable || !['pending', 'ticketed'].includes(item.decision)) return refuse('guard', GONE);
      const row = act.does === 'except'
        ? { decision: 'excepted', exceptionId: act.exceptionId, reasonCode: 'known_exception',
          note: `${s.title}. ${s.evidence.join(' ')}`.slice(0, 1000) }
        : { decision: act.decisions[0].decision, reasonCode: null,
          note: text(said) || act.decisions[0].note || `Suggestion accepted: ${s.title}.` };
      const decided = { ...row, decidedBy: who.username ?? null, decidedById: who.id ?? null, decidedAt: now };
      store.updateItem(plan.id, item.uid, decided, { touch: false });
      for (const child of shape.childrenOf(items, item.uid)) store.updateItem(plan.id, child.uid, decided, { touch: false });
      closeDecidedTicket(plan.id, item.uid, who, decided.decision, decided.note);
      audit(effects, plan, 'decide', { actor: who, req, payload: { uid: item.uid, decision: decided.decision,
        note: decided.note, action: item.action, suggestion: s.id } });
    }
    if (act.does === 'duplicate') {
      const moved = move(effects, plan, 'duplicate', { actor: who, action: 'duplicate', req,
        patch: { duplicateOf: act.duplicateOf, disposition: 'duplicate' },
        ctx: ctxFor(plan, { duplicateOf: act.duplicateOf }), reason: s.title,
        auditPayload: { duplicateOf: act.duplicateOf, suggestion: s.id } });
      if (moved.refused) return moved.refused;
      closeOpenTickets(plan.id, who, 'duplicate');
    }
    saySuggestion(effects, plan, s, 'accepted', who, { said, req });
    return { ok: true };
  });
  if (out.error) return out;
  return { ...get(plan.id, who), replanned: false };
}

/** Put a suggestion away without acting on it. Nothing else changes. */
function dismissSuggestion(planId, sid, { note: said = null, actor, req = null } = {}) {
  const who = actorOf(actor);
  const found = openSuggestion(planId, sid, who);
  if (found.refused) return found.refused;
  run((effects) => saySuggestion(effects, found.plan, found.s, 'dismissed', who, { said, req }));
  return { ...get(found.plan.id, who), replanned: false };
}

/**
 * Take a change back. The check is compared again without it, the items it
 * made go back to what the scan proposed, and the suggestion it came from is
 * open again.
 */
async function revokeOverride(planId, overrideId, { actor, req = null } = {}) {
  const who = actorOf(actor);
  const found = open(planId, who);
  if (found.refused) return found.refused;
  const o = store.getOverride(overrideId);
  if (!o || o.planId !== found.plan.id || o.revokedAt) return refuse('not_found', 'no such change on this check');
  const out = await replan(found.plan.id, { actor: who, req, why: 'change taken back', revoke: [o.id],
    also: () => {
      const fresh = store.getPlan(found.plan.id, { heavy: false });
      const state = Object.fromEntries(Object.entries(fresh.suggestionState || {})
        .filter(([, said]) => !(said && Number(said.overrideId) === Number(o.id))));
      store.updatePlan(found.plan.id, { suggestionState: state });
    } });
  if (out.error) return out;
  return { ...get(found.plan.id, who), replanned: true };
}

const BY_HAND = ['serial', 'asset_tag', 'description'];

/**
 * Decide items, one by one, where a row may also be a change:
 * { uid, decision: 'modified', modified: { serial?, asset_tag?, description? }, note }.
 *
 * 'modified' is a word a person sends, never one that is stored: the value is
 * kept as an override, the check is compared again, and the item comes back
 * approved with the change on it. The shelf is never changed this way - only
 * by accepting the suggestion that found the record. Rejecting an item a change
 * made takes the change back first, so a check never sits with a rejected move
 * still laid over its scan.
 */
async function decide(planId, decisions, { actor, req = null } = {}) {
  const who = actorOf(actor);
  const rows = Array.isArray(decisions) ? decisions : [];
  const changes = rows.filter((d) => d && d.decision === 'modified');
  const itemsNow = () => store.itemsOf(Number(planId));
  const takesBack = rows.filter((d) => d && d.decision === 'rejected'
    && (itemsNow().find((i) => i.uid === d.uid) || {}).modified);
  if (!changes.length && !takesBack.length) {
    const out = decideItems(planId, rows, { actor: who, req });
    return out.error ? out : { ...out, replanned: false };
  }

  const found = open(planId, who);
  if (found.refused) return found.refused;
  const barred = mayDecide(found.plan, who);
  if (barred) return barred;
  const applied = [];
  const refused = [];
  let replanned = false;

  for (const d of takesBack) {
    const item = itemsNow().find((i) => i.uid === d.uid);
    const out = await revokeOverride(planId, item.modified.overrideId, { actor: who, req });
    if (out.error) { refused.push({ uid: d.uid, why: out.why }); continue; }
    replanned = true;
    // A record marked offline is not an item of the scan: taking the change
    // back is the whole of rejecting it.
    if (!itemsNow().some((i) => i.uid === d.uid)) applied.push({ uid: d.uid, decision: 'rejected' });
  }

  for (const d of changes) {
    const item = itemsNow().find((i) => i.uid === d.uid);
    const asked = d.modified && typeof d.modified === 'object' ? d.modified : {};
    const keys = Object.keys(asked);
    let why = null;
    if (!item) why = 'not in this plan';
    else if (!item.decidable) why = 'not a decidable item';
    else if (item.type !== 'Device') why = 'Only a device can be changed by hand.';
    else if (keys.some((k) => ['position', 'face'].includes(k))) {
      why = 'The shelf is changed only by accepting the suggestion that found the record, never by hand.';
    } else if (!keys.length || keys.some((k) => !BY_HAND.includes(k))) {
      why = 'A serial number, an asset tag or a description can be changed by hand, and nothing else.';
    } else if (keys.some((k) => typeof asked[k] !== 'string' || !asked[k].trim())) {
      why = 'Type the value to write. An empty value is never written over what the record holds.';
    }
    if (why) { refused.push({ uid: d ? d.uid : null, why }); continue; }
    const fields = Object.fromEntries(keys.map((k) => [k,
      { from: (item.diff && item.diff[k] && item.diff[k].from) ?? null, to: asked[k].trim() }]));
    // A newer value by hand replaces the older one on the same box.
    const older = store.overridesOf(found.plan.id)
      .filter((o) => o.kind === 'value' && o.itemUid === item.uid).map((o) => o.id);
    const out = await replan(planId, { actor: who, req, why: 'changed by hand', revoke: older,
      tentative: [{ kind: 'value', itemUid: item.uid, netboxId: item.netboxId ?? null, recordName: item.name ?? null,
        fields, source: 'manual', note: text(d.note) || null }] });
    if (out.error) { refused.push({ uid: d.uid, why: out.why }); continue; }
    replanned = true;
    applied.push({ uid: d.uid, decision: 'approved', modified: true });
  }

  // What is left is an ordinary decision: every other row, and the rejection of
  // an item whose change has just been taken back, which is an item of the scan again.
  const done = new Set([...changes.map((d) => d.uid), ...applied.map((a) => a.uid), ...refused.map((r) => r.uid)]);
  const plain = rows.filter((d) => !d || (d.decision !== 'modified' && !done.has(d.uid)));
  if (plain.length) {
    const out = decideItems(planId, plain, { actor: who, req });
    if (out.error && !applied.length && !refused.length) return out;
    if (!out.error) { applied.push(...out.applied); refused.push(...out.refused); }
  }
  return { plan: store.getPlan(found.plan.id, { heavy: false }), applied, refused, replanned };
}

// -- Verification, skipped ------------------------------------------------
/**
 * Move past the verification scan without one. An organization admin only,
 * with a reason, and the reason is on the plan, in the event and in the audit
 * row. The real check (a second scan compared again) is verify.js.
 */
function skipVerification(planId, { reason, actor, req = null } = {}) {
  const who = actorOf(actor);
  const found = open(planId, who);
  if (found.refused) return found.refused;
  return run((effects) => {
    const why = text(reason);
    const moved = move(effects, found.plan, 'approval_pending', {
      actor: who, action: 'verify_skip', req, reason: why || null,
      ctx: ctxFor(found.plan, { skip: true, reason: why }),
      patch: { verification: { kind: 'post_fix', result: 'skipped', reason: why,
                               by: who.username ?? null, at: store.nowIso() } },
      auditPayload: { skipped: true },
    });
    return moved.refused || { plan: moved.plan };
  });
}

// -- Approve, reject, rework ---------------------------------------------
/**
 * The plan-level approval: one name against what will be written.
 *
 * The record carries payload_hash, the fingerprint of the approved items and
 * their scaffolding, and the plan version it was signed at. When the plan's
 * risk is in the organization's dual_approval_risks the first call records
 * the first signature and parks the plan in approval_pending; the second,
 * from a different person, approves it. The person who sent the check
 * approves nothing on it: the table refuses them, with code `role`.
 *
 * `incidentState` is what the approver wants the check's ServiceNow incident
 * left as (resolved unless they say otherwise). It is kept on the incident
 * here, in the same transaction, and pushed once the outcome is known.
 */
function approve(planId, { comment = null, incidentState = null, actor, req = null } = {}) {
  const who = actorOf(actor);
  const found = open(planId, who);
  if (found.refused) return found.refused;
  const { plan } = found;
  const chosen = chosenState(plan, incidentState, 'resolved', who);
  if (chosen.refused) return chosen.refused;
  return run((effects) => {
    const ctx = ctxFor(plan);
    const ok = machine.can(plan, 'approved', who, ctx);
    if (!ok.ok) return refuse(ok.code, ok.why, { from: plan.status, to: 'approved' });
    const stage = machine.approvalStage(plan, ctx);
    const decision = store.addDecision(plan.id, {
      stage: stage.stage, approverId: who.id ?? null, approver: who.username ?? null,
      decision: 'approved', comment: text(comment) || null,
      payloadHash: ctx.payloadHash, planVersion: plan.version,
    }, { touch: false });
    const signed = { stage: stage.stage, payloadHash: ctx.payloadHash, planVersion: plan.version,
                     comment: text(comment) || null };
    if (!stage.final) {
      const second = { stage: 'second', firstApproverId: who.id ?? null };
      if (plan.status !== 'approval_pending') {
        // Signed from where the check was with its holder: it now waits, in
        // approval_pending, for the second name.
        const parked = move(effects, plan, 'approval_pending', { actor: who, action: 'approve.first', req, ctx,
          payload: signed, auditPayload: { ...signed, final: false }, patch: chosen.patch, heard: second });
        if (parked.refused) return parked.refused;
        return { plan: parked.plan, decision, stage: stage.stage, final: false, needsSecond: true };
      }
      const updated = store.updatePlan(plan.id, chosen.patch);
      note(updated, 'approve.first', { actor: who, payload: signed });
      audit(effects, updated, 'approve', { actor: who, req, payload: { ...signed, final: false } });
      emit(effects, 'approval_requested', { plan: updated, from: plan.status, to: plan.status,
        actor: who, reason: null, item: null, ...second });
      return { plan: updated, decision, stage: stage.stage, final: false, needsSecond: true };
    }
    const moved = move(effects, plan, 'approved', {
      actor: who, action: 'approve', req, force: true, payload: signed, auditPayload: { ...signed, final: true },
      patch: { payloadHash: ctx.payloadHash, ...chosen.patch },
    });
    return { plan: moved.plan, decision, stage: stage.stage, final: true, needsSecond: false };
  });
}

/**
 * What the person deciding wants the check's incident left as, as a patch for
 * the plan: validated against the list, `fallback` when they did not say, and
 * nothing at all for a check that has no ServiceNow incident to leave.
 */
function chosenState(plan, asked, fallback, who) {
  const state = asked == null || asked === '' ? fallback : String(asked);
  if (!machine.INCIDENT_STATES.includes(state)) {
    return { refused: refuse('bad_request',
      `the incident state has to be one of ${machine.INCIDENT_STATES.join(', ')}`) };
  }
  const inc = plan.incident;
  if (!inc || inc.system === 'none') return { state, patch: {} };
  return { state, patch: { incident: { ...inc, chosenState: { state, by: who.username ?? null,
    byId: who.id ?? null, at: store.nowIso() } } } };
}

/**
 * Reject, or send back for rework. Both need a reason code and a comment, and
 * neither is for the person who sent the check. A holder who rejects with
 * `wrong_spoc` is saying the check is not theirs, so the admins are told.
 */
function sendBack(planId, to, { reasonCode, comment, incidentState = null, actor, req = null } = {}) {
  const who = actorOf(actor);
  const found = open(planId, who);
  if (found.refused) return found.refused;
  const { plan } = found;
  const chosen = chosenState(plan, incidentState, to === 'rework' ? 'on_hold' : 'cancelled', who);
  if (chosen.refused) return chosen.refused;
  return run((effects) => {
    const ctx = ctxFor(plan, { reasonCode, comment });
    const moved = move(effects, plan, to, {
      actor: who, action: to === 'rework' ? 'rework' : 'reject', req, ctx, patch: chosen.patch,
      reason: reasonCode || null, payload: { comment: text(comment) || null },
      auditPayload: { reasonCode: reasonCode || null, comment: text(comment) || null },
      heard: { comment: text(comment) || null },
    });
    if (moved.refused) return moved.refused;
    let decision = null;
    if (plan.status === 'approval_pending' || plan.spocUserId != null) {
      decision = store.addDecision(plan.id, {
        stage: 'first', approverId: who.id ?? null, approver: who.username ?? null,
        decision: to === 'rework' ? 'rework' : 'rejected', reasonCode, comment: text(comment),
        payloadHash: ctx.payloadHash, planVersion: plan.version,
      }, { touch: false });
    }
    // The person who raised it should be able to read why.
    store.addComment(plan.id, { visibility: 'shared', authorId: who.id ?? null, author: who.username ?? null,
      body: `${to === 'rework' ? 'Sent back for rework' : 'Rejected'} (${reasonCode}): ${text(comment)}` });
    if (to === 'rejected') closeOpenTickets(plan.id, who, 'rejected');
    if (to === 'rejected' && reasonCode === 'wrong_spoc') {
      emit(effects, 'reassign_needed', { plan: moved.plan, actor: who, why: 'wrong_spoc',
        text: text(comment), rackId: plan.rackId, holder: plan.spoc || null });
    }
    return { plan: store.getPlan(plan.id, { heavy: false }), decision };
  });
}
const reject = (planId, opts) => sendBack(planId, 'rejected', opts);
const rework = (planId, opts) => sendBack(planId, 'rework', opts);

// -- Moves an admin makes by hand -----------------------------------------
const HAND_MOVES = {
  rejected: ['in_progress', 'verification_pending'],
  rework: ['in_progress', 'verification_pending'],
  write_failed: ['manual_review'],
};

/**
 * The few moves that are nothing but a decision with a reason: a rejected or
 * reworked plan back to in progress or to verification, and a failed write
 * to manual review. (Back to assigned is assign(); retrying a write is the
 * export route.) Back to in progress reopens the plan's tickets, keeping
 * what was found, because the work has to be done again.
 */
function moveByHand(planId, { to, reason, actor, req = null } = {}) {
  const who = actorOf(actor);
  const found = open(planId, who);
  if (found.refused) return found.refused;
  const { plan } = found;
  if (!(HAND_MOVES[plan.status] || []).includes(to)) {
    return refuse('transition', `a plan that is ${plan.status.replace(/_/g, ' ')} cannot be moved to ${String(to).replace(/_/g, ' ')} by hand`,
      { from: plan.status, to });
  }
  if (to === 'in_progress' && !store.ticketsOf(plan.id).length) {
    return refuse('guard', 'nobody was ever assigned on this plan; assign it instead', { from: plan.status, to });
  }
  return run((effects) => {
    const moved = move(effects, plan, to, { actor: who, action: `move.${to}`, req,
      reason: text(reason) || null, ctx: ctxFor(plan, { reason }) });
    if (moved.refused) return moved.refused;
    if (to === 'in_progress') {
      const items = store.itemsOf(plan.id);
      for (const t of store.ticketsOf(plan.id)) {
        store.updateTicket(plan.id, t.itemUid, { status: 'in_progress', closedAt: null, closedBy: null,
          closedWith: null, resolvedAt: null, resolvedBy: null, resolvedById: null }, { touch: false });
        const back = { decision: 'ticketed', decidedAt: store.nowIso() };
        store.updateItem(plan.id, t.itemUid, back, { touch: false });
        for (const child of shape.childrenOf(items, t.itemUid)) store.updateItem(plan.id, child.uid, back, { touch: false });
      }
      store.touchPlan(plan.id);
    }
    return { plan: store.getPlan(plan.id, { heavy: false }) };
  });
}

function cancel(planId, { reason, actor, req = null } = {}) {
  const who = actorOf(actor);
  const found = open(planId, who);
  if (found.refused) return found.refused;
  return run((effects) => {
    const moved = move(effects, found.plan, 'cancelled', {
      actor: who, action: 'cancel', req, reason: text(reason) || null,
      ctx: ctxFor(found.plan, { reason }),
      patch: { cancelledAt: store.nowIso(), cancelReason: text(reason) || null },
    });
    if (moved.refused) return moved.refused;
    closeOpenTickets(found.plan.id, who, 'cancelled');
    return { plan: store.getPlan(found.plan.id, { heavy: false }) };
  });
}

function reopen(planId, { reasonCode, comment, actor, req = null } = {}) {
  const who = actorOf(actor);
  const found = open(planId, who);
  if (found.refused) return found.refused;
  const { plan } = found;
  return run((effects) => {
    const moved = move(effects, plan, 'reopened', {
      actor: who, action: 'reopen', req, reason: reasonCode || null,
      ctx: ctxFor(plan, { reasonCode, comment }),
      patch: { reopenCount: (plan.reopenCount || 0) + 1, reopenReason: reasonCode || null, completedAt: null },
      payload: { comment: text(comment) || null },
      auditPayload: { reasonCode: reasonCode || null, comment: text(comment) || null },
    });
    if (moved.refused) return moved.refused;
    if (text(comment)) {
      store.addComment(plan.id, { visibility: 'shared', authorId: who.id ?? null, author: who.username ?? null,
        body: `Reopened (${reasonCode}): ${text(comment)}` });
    }
    return { plan: moved.plan };
  });
}

// -- The write ----------------------------------------------------------
/**
 * Has NetBox moved since this plan was compared?
 *
 * The fingerprint of a fresh comparison equals the plan's: nothing moved. On
 * a retry of a failed write it cannot - what the first attempt wrote now
 * compares as no difference - so there the recheck passes when every row the
 * fresh comparison wants is a row of this plan, same action, same field
 * changes, and every row of this plan that has gone is one this plan itself
 * wrote (result.writtenUids, kept across attempts).
 */
function recheck(plan, items, freshChanges) {
  const live = shape.fingerprint(freshChanges);
  if (live === plan.fingerprint) return { ok: true, live };
  const writtenUids = new Set((plan.result && plan.result.writtenUids) || []);
  if (['write_failed', 'manual_review'].includes(plan.status) && writtenUids.size) {
    const key = (c) => `${c.uid} ${c.action} ${shape.stable(c.diff)}`;
    const ours = items.filter((i) => shape.ACTIONABLE.has(i.action));
    const oursKeys = new Set(ours.map(key));
    const fresh = (freshChanges || []).filter((c) => shape.ACTIONABLE.has(c.action));
    const freshKeys = new Set(fresh.map(key));
    const stranger = fresh.find((c) => !oursKeys.has(key(c)));
    const vanished = ours.filter((i) => !freshKeys.has(key(i)) && !writtenUids.has(i.uid));
    if (!stranger && !vanished.length) return { ok: true, live, partial: true };
  }
  return { ok: false, live,
    why: 'NetBox has changed since this plan was approved, so nothing was written.' };
}

/**
 * Open the write. The plan has to be approved (or be a failed write being
 * tried again), NetBox must not have moved, and what would be written must
 * still be what the approval signed. If the hash no longer stands the plan
 * goes back to be approved again, with a fresh version, and nothing is
 * written: a check that is with a SPOC goes back to `assigned`, so it lands
 * with its holder, its decided items still decided; a check from before the
 * SPOC change goes back to approval_pending as it always did.
 * An approved plan with nothing approved on it completes without a write:
 * scaffolding is never written on its own.
 *
 * `onBehalfOf` is the approver a system write is made for; it rides on the
 * events so a listener can name them.
 *
 * Answers { plan, excluded } to go ahead, { done: true } when there was
 * nothing to write, or a refusal; `moved: true` on it says NetBox moved.
 */
function beginWrite(planId, { actor, freshChanges, reason = null, req = null, onBehalfOf = null } = {}) {
  const who = actorOf(actor);
  const found = open(planId, who);
  if (found.refused) return found.refused;
  const { plan } = found;
  const early = notWritable(plan);
  if (early) return early;
  if (isStrict(who) && !ROLES.writer.includes(who.role)) {
    return refuse('role', 'An admin approves and writes. Send this plan to yours to review.');
  }
  return run((effects) => {
    const items = store.itemsOf(plan.id);
    const check = recheck(plan, items, freshChanges);
    const ctx = ctxFor(plan, { recheck: check, reason: text(reason) });
    const stale = machine.approvalStands(plan, ctx);
    if (stale) {
      // The approval no longer covers what would be written. Nothing is
      // written; the plan goes back to be approved, with a fresh version -
      // to its holder when it has one, which is where such a check is approved.
      const to = plan.spocUserId != null ? 'assigned' : 'approval_pending';
      const back = move(effects, plan, to, { actor: SYSTEM, action: `auto.${to}`,
        force: true, reason: check.ok ? 'approval_stale' : 'netbox_changed',
        patch: { payloadHash: null }, payload: { why: stale, live: check.live },
        auditPayload: { why: stale, causedBy: { id: who.id ?? null, username: who.username ?? null } },
        heard: { stale: true, why: stale, approver: approverOf(onBehalfOf) } });
      audit(effects, back.plan, 'write', { actor: who, req, status: 'fail', error: stale,
        payload: { counts: {}, written: 0, failed: 0 } });
      return refuse('guard', stale, { from: plan.status, to: 'write_in_progress', moved: !check.ok,
        stale: true, live: check.live, plan: back.plan });
    }
    if (plan.status === 'approved' && ctx.toWrite === 0) {
      const done = move(effects, plan, 'completed', { actor: who, action: 'complete', req, ctx,
        reason: 'nothing to write', patch: { completedAt: store.nowIso() },
        heard: { approver: approverOf(onBehalfOf), changes: registry.summaryOf([]) } });
      return done.refused || { plan: done.plan, done: true };
    }
    const retry = plan.status !== 'approved';
    const moved = move(effects, plan, 'write_in_progress', { actor: who, action: 'write_start', req, ctx,
      reason: text(reason) || null, payload: { retry, partial: Boolean(check.partial) } });
    if (moved.refused) return moved.refused;
    return { plan: moved.plan, excluded: shape.excludedUids(items), retry };
  });
}

/**
 * The refusal for a plan that is not where a write starts from, or null. The
 * write asks this before it troubles NetBox, and beginWrite asks it again.
 */
function notWritable(plan) {
  if (['approved', 'write_failed', 'manual_review'].includes(plan.status)) return null;
  return refuse('transition', ['written', 'completed'].includes(plan.status)
    ? 'that plan has already been written'
    : 'This plan has not been approved yet. It is approved in RackTrack Approvals, then written.',
  { from: plan.status, to: 'write_in_progress' });
}

/**
 * Record what the write actually did.
 *
 * Every object went through: the plan is written. NetBox refused any of
 * them: the plan is write_failed. What was written is written and is not
 * undone (the writer never deletes); what failed is listed by uid with
 * NetBox's reason, and the uids that did go through are kept, across
 * attempts, so the next try can tell its own work from somebody else's.
 *
 * In the same transaction every change goes into the registry, from the
 * writer's own report (registry.rowsFor): a row per field written, one per
 * object created, one per object NetBox refused. `onBehalfOf` is the approver
 * a system write was made for. The `transition` to written and the
 * `write_failed` event carry `approver` and `changes` - the rows a person is
 * shown, as short lines - for whoever pushes the outcome somewhere else.
 */
function finishWrite(planId, { actor, result, req = null, withheld = null, onBehalfOf = null } = {}) {
  const who = actorOf(actor);
  const plan = store.getPlan(planId, { heavy: false });
  if (!plan) return null;
  const changes = (result && result.changes) || [];
  const failures = changes.filter((c) => c.action === 'fail');
  const went = changes.filter((c) => shape.ACTIONABLE.has(c.action));
  const before = (plan.result && plan.result.writtenUids) || [];
  const now = store.nowIso();
  const record = {
    counts: (result && result.counts) || {},
    written: went.length,
    failed: failures.length,
    failures: failures.map((c) => ({ uid: c.uid, type: c.type ?? null, name: c.name ?? null,
      reason: c.reason ?? null, ...(c.fromUid ? { fromUid: c.fromUid } : {}) })),
    writtenUids: [...new Set([...before, ...went.map((c) => c.uid)])],
    attempts: ((plan.result && plan.result.attempts) || 0) + 1,
    at: now, by: who.username ?? null,
  };
  const failed = failures.length > 0;
  return run((effects) => {
    const decisions = store.decisionsOf(plan.id);
    const rows = registry.rowsFor({ plan, items: store.itemsOf(plan.id), decisions, changes,
      attempt: record.attempts, writtenAt: now, writtenBy: who });
    for (const row of rows) store.addChange(row);
    const approver = approverOf(onBehalfOf, decisions);
    const moved = move(effects, plan, failed ? 'write_failed' : 'written', {
      actor: who, action: failed ? 'write_failed' : 'written', force: true,
      patch: failed ? { result: record }
        : { result: record, writtenAt: now, writtenBy: who.username ?? null, writtenById: who.id ?? null },
      payload: { what: failed ? 'write failed' : 'written to NetBox',
                 detail: { counts: record.counts, written: record.written, failed: record.failed,
                           failures: record.failures },
                 by: who.username ?? null, onBehalfOf: approver ? approver.username : null },
      heard: { approver, changes: registry.summaryOf(rows) },
    });
    audit(effects, moved.plan, 'write', { actor: who, req, status: failed ? 'fail' : 'ok', payload: {
      counts: record.counts, written: record.written, failed: record.failed,
      attempt: record.attempts, withheld } });
    return moved.plan;
  });
}

/**
 * Who a write was made for: the approver it was started by, else the last
 * approval on record. A listener reads this off the event.
 */
function approverOf(onBehalfOf, decisions = null) {
  if (onBehalfOf && (onBehalfOf.id != null || onBehalfOf.username)) {
    return { id: onBehalfOf.id ?? null, username: onBehalfOf.username ?? null };
  }
  const last = registry.approverOf(decisions || []);
  return last.approvedBy || last.approvedById != null
    ? { id: last.approvedById, username: last.approvedBy } : null;
}

/**
 * The write threw before it could report: the plan is write_failed, with the
 * error, and the registry says so in one row, because a write that was tried
 * and lost is part of the record too.
 */
function abortWrite(planId, { actor, error, req = null, onBehalfOf = null } = {}) {
  const who = actorOf(actor) || SYSTEM;
  const plan = store.getPlan(planId, { heavy: false });
  if (!plan || plan.status !== 'write_in_progress') return plan;
  return run((effects) => {
    const record = { ...(plan.result || {}), counts: {}, written: 0, failed: 0, failures: [],
      writtenUids: (plan.result && plan.result.writtenUids) || [],
      attempts: ((plan.result && plan.result.attempts) || 0) + 1,
      error: String(error || 'the write did not run'), at: store.nowIso(), by: who.username ?? null };
    const decisions = store.decisionsOf(plan.id);
    const rows = registry.rowsFor({ plan, items: [], decisions, attempt: record.attempts,
      writtenAt: record.at, writtenBy: who,
      changes: [{ uid: '*', type: null, name: 'The whole write', action: 'fail', reason: record.error }] });
    for (const row of rows) store.addChange(row);
    const moved = move(effects, plan, 'write_failed', { actor: SYSTEM, action: 'write_failed', force: true,
      patch: { result: record }, reason: record.error,
      payload: { what: 'write failed', detail: { error: record.error } },
      heard: { approver: approverOf(onBehalfOf, decisions), changes: registry.summaryOf(rows),
        error: record.error } });
    audit(effects, moved.plan, 'write', { actor: who, req, status: 'fail', error: record.error,
      payload: { counts: {}, written: 0, failed: 0 } });
    return moved.plan;
  });
}

// -- The change registry -------------------------------------------------
const REGISTRY_WHY = 'The change registry is for an admin, an auditor, or the SPOC of a site.';
const CHANGE_FILTERS = ['tenantId', 'rackId', 'planId', 'objectType', 'field', 'approvedById', 'incident',
  'result', 'since', 'until', 'q', 'internal', 'cursor'];

/**
 * What the writes changed, newest first: { changes, nextCursor }.
 *
 * The organization rule applies to everybody, first. Inside it an admin and
 * an auditor read everything; anybody else reads the Sites they are the SPOC
 * of and the checks they hold or held, and with neither there is nothing for
 * them here. `cap` lifts the page size for the file a person downloads.
 */
function listChanges(actor, query = {}, { cap = 500 } = {}) {
  const who = actorOf(actor);
  if (!who) return refuse('role', REGISTRY_WHY);
  const f = {};
  for (const key of CHANGE_FILTERS) if (query[key] != null && query[key] !== '') f[key] = query[key];
  f.seenBy = seenByOf(who);
  if (isStrict(who) && !machine.isAdmin(who) && who.role !== 'auditor') {
    f.tenantIds = store.sitesWhereSpoc(who.id, who.email, who.orgId ?? null);
    f.planIds = store.plansHeldBy(who.id, f.seenBy);
    if (!f.tenantIds.length && !f.planIds.length) return refuse('role', REGISTRY_WHY);
  }
  const limit = Math.min(Math.max(1, Number(query.limit) || (cap > 500 ? cap : 100)), cap);
  const rows = store.listChanges({ ...f, limit: limit + 1, cap: cap + 1 });
  const page = rows.slice(0, limit);
  return { changes: page, nextCursor: rows.length > limit ? page[page.length - 1].id : null };
}

// -- Comments -------------------------------------------------------------
function addComment(planId, { body, visibility, itemUid = null, actor } = {}) {
  const who = actorOf(actor);
  const plan = store.getPlan(planId, { heavy: false });
  if (!plan || !canTouch(plan, who)) return NOT_FOUND();
  if (who.role === 'auditor') return refuse('role', 'An auditor reads; they do not comment.');
  const said = text(body);
  if (!said) return refuse('bad_request', 'a comment needs some words');
  if (said.length > 4000) return refuse('bad_request', 'a comment is at most 4000 characters');
  if (visibility != null && !['internal', 'shared'].includes(visibility)) {
    return refuse('bad_request', 'visibility is internal or shared');
  }
  if (itemUid != null && !store.getItem(plan.id, itemUid)) return refuse('bad_request', 'no such item on this plan');
  // A technician's words are for the people handling their plan to read, and
  // they never see the internal thread, so theirs are always shared.
  const insider = ROLES.reader.includes(who.role);
  const comment = store.addComment(plan.id, { body: said, itemUid,
    visibility: insider ? (visibility || 'internal') : 'shared',
    authorId: who.id ?? null, author: who.username ?? null });
  return { comment };
}

function listComments(planId, { actor } = {}) {
  const who = actorOf(actor);
  const plan = store.getPlan(planId, { heavy: false });
  if (!plan || !canRead(plan, who)) return NOT_FOUND();
  const insider = !isStrict(who) || ROLES.reader.includes(who.role);
  return { comments: store.commentsOf(plan.id, insider ? {} : { visibility: 'shared' }) };
}

// -- Contacts -------------------------------------------------------------
/**
 * Who this check goes to when it is sent: the SPOC setup named for its Site,
 * read at the moment it is asked for. When the check cannot go to them the
 * answer says so in `why` and `whyText`, and `goesTo` is `admin`. The NetBox
 * roster is no longer read for this; only the rack NetBox recognises is, when
 * there is a NetBox, because the phone shows it.
 */
async function contacts(planId, { actor } = {}) {
  const who = actorOf(actor);
  const plan = store.getPlan(planId, { heavy: false });
  if (!plan || !canRead(plan, who)) return NOT_FOUND();
  const { netboxFor, serviceNowFor } = require('./connections');
  const me = { orgId: plan.orgId ?? who.orgId, userId: who.id };
  // A check already sent is with whoever holds it; a draft goes to whoever the
  // resolver names for the person about to send it.
  const goesTo = plan.status === 'draft' ? spoc.resolve(plan, { sender: who })
    : plan.spocUserId != null ? { ok: true, holder: plan.spoc }
      : { ok: false, why: (plan.needsAdmin && plan.needsAdmin.why) || null,
          text: (plan.needsAdmin && plan.needsAdmin.text) || null };
  const site = spoc.ofSite(plan);
  const viaSite = goesTo.ok && site && Number(site.userId) === Number(goesTo.holder.userId);
  const out = {
    spoc: goesTo.ok ? { name: goesTo.holder.username, email: goesTo.holder.email ?? null,
      title: viaSite ? `SPOC of ${site.siteLabel}${site.siteName ? ` - ${site.siteName}` : ''}` : 'Chosen by an admin',
      userId: goesTo.holder.userId, source: goesTo.holder.source || 'site' } : null,
    siteSpoc: goesTo.ok && site ? site : null,
    goesTo: goesTo.ok ? 'spoc' : 'admin',
    why: goesTo.ok ? null : goesTo.why, whyText: goesTo.ok ? null : goesTo.text,
    others: [], everyone: [], rack: null, site: null, serviceNow: Boolean(serviceNowFor(me)),
  };
  const client = netboxFor(me);
  if (client) {
    try {
      const scans = require('../netbox/store');
      const scan = plan.scanId ? scans.getScan(plan.scanId) : null;
      const resolved = await require('../netbox/rack_match').resolveRack(client, {
        tenantId: plan.tenantId ?? null, rackId: plan.rackId, scanName: scan && scan.rackName,
        fallbackName: (scan && (scan.rackName || scan.rackId)) || plan.rackName || plan.rackId,
      });
      out.matchedRack = { name: resolved.name, confidence: resolved.confidence, why: resolved.why };
      // The phone falls back on this name for its "compared against" line.
      out.rack = resolved.name ? { name: resolved.name } : null;
    } catch { /* the rack's name is a nicety here, never the reason a request fails */ }
  }
  if (machine.isAdmin(who)) out.assignable = spoc.assignableUsers(plan);
  return out;
}

// -- Reading --------------------------------------------------------------
/**
 * The one word for a plan's clocks: breached, at_risk, paused, on_track or
 * none. sla.js owns the definition - it is the module that starts, pauses and
 * breaches the clocks - and this is the only place the rest of the server asks
 * for it, so there is one answer and not two. Required lazily because sla.js
 * reads this module's defaults, and store.SLA_STATES holds the same rule as
 * SQL for the list filter and the dashboard, which have to do it in one query.
 */
function slaStateOf(planId, clocks = null) {
  try { return require('./sla').planStateOf(planId, clocks); } catch { /* not built yet */ }
  return store.slaStateOf(clocks || store.slaOf(planId));
}

/** One list row: the plan without its heavy columns, with the counts a list shows. */
function rowOf(plan) {
  const items = store.itemsOf(plan.id);
  const tickets = store.ticketsOf(plan.id);
  const clocks = store.slaOf(plan.id);
  return {
    ...plan,
    legacyStatus: shape.legacyStatus(plan.status),
    summary: { ...shape.summarise(items, plan.result, tickets),
               assignable: machine.unassigned({ items, tickets }).length },
    assignees: [...new Set(tickets.filter(shape.isOpenTicket).map((t) => t.assignee).filter(Boolean))],
    // Who it is with, who sent it, and its one incident, for a list to show.
    holder: (plan.spoc && plan.spoc.username) || null,
    sender: plan.submittedBy || null,
    siteName: plan.tenantId != null ? (store.tenantById(plan.tenantId) || {}).name || null : null,
    receivedAt: (plan.spoc && plan.spoc.assignedAt) || plan.submittedAt || null,
    incidentNumber: (plan.incident && plan.incident.number) || null,
    incidentUrl: (plan.incident && plan.incident.url) || null,
    sla: clocks.map((c) => ({ clock: c.clock, status: c.status, targetAt: c.targetAt })),
    // One of breached, at_risk, paused, on_track, none - the same word the
    // dashboard tile counts and the `sla=` list filter takes.
    slaState: slaStateOf(plan.id, clocks),
  };
}

const OPEN_FILTER = machine.OPEN.filter((s) => s !== 'written');

/**
 * Plans, newest first, scoped to what the caller may read. Filters: status,
 * tenantId, rackId, scanId, priority, risk, assignee, createdBy, holder ('me'
 * works for all three), since, until, q, sla, open=1 (everything not yet
 * written or closed), limit and cursor.
 */
function list(actor, query = {}) {
  const who = actorOf(actor);
  const f = { ...query };
  if (f.createdBy === 'me') f.createdBy = who.username;
  if (f.assignee === 'me') { f.assigneeUserId = who.id; delete f.assignee; }
  // Whose checks: mine for anybody; somebody else's by user id for an admin or an auditor.
  if (f.holder != null && f.holder !== '') {
    const anyone = !isStrict(who) || machine.isAdmin(who) || who.role === 'auditor';
    f.spocUserId = f.holder === 'me' || !anyone ? (who.id ?? -1) : f.holder;
  }
  delete f.holder;
  if (f.open === '1' || f.open === 'true' || f.open === true || f.open === 1) {
    if (!f.status) f.status = OPEN_FILTER;
  }
  delete f.open;
  // Nobody narrows to another organization, the owner included: the
  // visibility rule has no bypass to offer one.
  const scope = scopeFor(who);
  const limit = Math.min(Math.max(1, Number(f.limit) || 50), 200);
  const rows = store.listPlans({ ...f, ...scope, limit: limit + 1 });
  const page = rows.slice(0, limit);
  return { plans: page.map(rowOf), nextCursor: rows.length > limit ? page[page.length - 1].id : null };
}

const INCIDENT_LABELS = { in_progress: 'In Progress', on_hold: 'On Hold', resolved: 'Resolved',
  closed: 'Closed', cancelled: 'Cancelled' };
/** The states a person may leave the incident in, and what each decision picks unless told. */
const incidentStatesFor = (incident) => (incident && incident.sysId ? {
  options: machine.INCIDENT_STATES.map((value) => ({ value, label: INCIDENT_LABELS[value] })),
  defaults: { approve: 'resolved', reject: 'cancelled', rework: 'on_hold' },
} : null);

/**
 * One plan with everything: items, tickets, decisions, verifications,
 * comments, events, clocks, who it is with and who sent it, its incident, and
 * the moves this caller may make. `spoc` and `rackContact` are the NetBox
 * contact noted on a ticket of a check from before the SPOC change.
 */
function get(planId, actor) {
  const who = actorOf(actor);
  const plan = store.getPlan(planId, { heavy: false });
  if (!plan) return null;
  const tickets = store.ticketsOf(plan.id);
  if (!canRead(plan, who, tickets)) return null;
  const items = store.itemsOf(plan.id);
  const insider = !isStrict(who) || ROLES.reader.includes(who.role);
  const decisions = store.decisionsOf(plan.id);
  const ctx = { items, tickets, decisions, settings: settingsFor(plan.orgId),
    payloadHash: shape.payloadHash(items), toWrite: shape.approvedCount(items) };
  const mayTouch = canTouch(plan, who, tickets);
  const stage = machine.approvalStage(plan, ctx);
  const next = mayTouch && isStrict(who) ? machine.next(plan, who, ctx) : [];
  const offered = (to) => next.some((n) => n.to === to);
  const deciding = mayTouch && isStrict(who) && DECIDE_OPEN.includes(plan.status) && !mayDecide(plan, who);
  const reassign = mayTouch && ASSIGN_OPEN.includes(plan.status) && machine.isAdmin(who);
  const rackContact = (tickets.find((t) => t.spoc) || {}).spoc || null;
  const suggested = suggestionsFor(plan, items);
  return {
    plan: {
      ...plan,
      legacyStatus: shape.legacyStatus(plan.status),
      settled: shape.isSettled(items),
      payloadHashNow: ctx.payloadHash,
      summary: { ...shape.summarise(items, plan.result, tickets),
                 assignable: machine.unassigned(ctx).length },
    },
    items, tickets, decisions,
    slaState: slaStateOf(plan.id),
    verifications: store.verificationsOf(plan.id),
    comments: store.commentsOf(plan.id, insider ? {} : { visibility: 'shared' }),
    events: store.eventsOf(plan.id),
    sla: store.slaOf(plan.id),
    spoc: rackContact, rackContact,
    holder: plan.spocUserId != null ? plan.spoc : null,
    // Read through estate.js's own database handle, so never from inside a
    // transaction of ours (create() reads the plan back inside its own).
    siteSpoc: store.db().inTransaction ? null : spoc.ofSite(plan),
    sender: plan.submittedBy || plan.submittedById != null
      ? { userId: plan.submittedById ?? null, username: plan.submittedBy ?? null, note: plan.submittedNote ?? null }
      : null,
    incident: plan.incident || null,
    incidentStates: incidentStatesFor(plan.incident),
    // What the evidence suggests, and what a person changed before approving.
    suggestions: suggested.suggestions, suggestionsNote: suggested.note,
    overrides: store.overridesOf(plan.id).map(overrideBrief),
    // Filled by the stage that owns it: what the write recorded.
    changes: [],
    assignable: machine.unassigned(ctx).map((i) => i.uid),
    approval: { dual: stage.dual, stage: stage.stage,
                first: machine.firstApproval(ctx) },
    can: {
      next,
      decide: deciding,
      // A change is made where the check is with its holder, nowhere else.
      modify: deciding && plan.spocUserId != null && WORKING.includes(plan.status),
      approve: offered('approved') || offered('approval_pending'),
      reassign, assign: reassign,
      cancel: offered('cancelled'),
      comment: mayTouch && who.role !== 'auditor',
      tickets: tickets.filter((t) => mayTouch && (machine.isAdmin(who) || machine.isTicketAssignee(t, who)))
        .map((t) => t.itemUid),
      report: plan.rackId != null,
      // The sender sees the decisions greyed, and is told why.
      blocked: isStrict(who) && machine.isSender(plan, who) && DECIDE_OPEN.includes(plan.status)
        ? { why: machine.SENDER_WHY } : null,
    },
  };
}

/** Tickets across plans, each with a little of its plan, its item and the plan's clocks. */
function listTickets(actor, query = {}) {
  const who = actorOf(actor);
  const f = { ...query };
  const scope = scopeFor(who);
  // The visibility rule stays; only the Site narrowing is lifted, because a
  // reader sees every ticket of their organization and not just their Site's.
  delete scope.visibleTo;
  if (isStrict(who)) {
    if (who.role === 'site_manager') scope.tenantId = who.tenantId;
    else if (!ROLES.reader.includes(who.role)) scope.ticketAssigneeUserId = who.id ?? -1;
  }
  if (f.assignee === 'me') { scope.ticketAssigneeUserId = who.id ?? -1; delete f.assignee; }
  if (f.status) { f.ticketStatus = f.status; delete f.status; }
  const limit = Math.min(Math.max(1, Number(f.limit) || 100), 500);
  const rows = store.listTickets({ ...f, ...scope, limit: limit + 1 });
  const page = rows.slice(0, limit);
  return {
    tickets: page.map((t) => {
      const ext = t.external || {};
      return { ...t, number: ext.number || null, state: ext.state || null, url: ext.url || null,
        system: ext.system || 'none', error: ext.error || null,
        sla: store.slaOf(t.planId).map((c) => ({ clock: c.clock, status: c.status, targetAt: c.targetAt })) };
    }),
    nextCursor: rows.length > limit ? page[page.length - 1].id : null,
  };
}

/**
 * The transitions across plans, newest first: what happened, to which plan,
 * who did it and when. The auditor's view, and the answer to "who approved
 * this" without opening a plan at a time.
 *
 * Scoped by the same visibility rule as every other list, so the history a
 * person reads is the history of the plans they could open.
 */
function listEvents(actor, query = {}) {
  const who = actorOf(actor);
  const f = { ...query };
  const limit = Math.min(Math.max(1, Number(f.limit) || 100), 500);
  const rows = store.listEvents({ ...f, ...scopeFor(who), limit: limit + 1 });
  const page = rows.slice(0, limit);
  return {
    events: page.map((e) => ({
      id: e.id, planId: e.planId, rackId: e.rackId ?? null, itemUid: e.itemUid ?? null,
      action: e.action, fromStatus: e.fromStatus ?? null, toStatus: e.toStatus ?? null,
      actor: { id: e.actor.id ?? null, username: e.actor.username ?? null },
      reason: e.reason ?? null, ts: e.ts,
    })),
    nextCursor: rows.length > limit ? page[page.length - 1].id : null,
  };
}

// -- Queue, dashboard, me -------------------------------------------------
/**
 * Is this person a SPOC? The SPOC of a Site by setup, or the holder of a check
 * that is still open (an admin may give a check to somebody who is no Site's
 * SPOC). An auditor never is.
 */
function isSpoc(actor) {
  if (!actor || actor.id == null || actor.role === 'auditor') return false;
  if (store.sitesWhereSpoc(actor.id, actor.email, actor.orgId ?? null).length) return true;
  return store.listPlans({ seenBy: seenByOf(actor), spocUserId: actor.id, status: machine.OPEN, limit: 1 }).length > 0;
}

const can = (actor, { spoc: asSpoc = false } = {}) => {
  const role = actor && actor.role;
  const admin = ROLES.admin.includes(role);
  return {
    triage: admin,
    assign: admin,
    reassign: admin,
    approve: ROLES.approver.includes(role) || asSpoc,
    write: ROLES.writer.includes(role),
    verify: ROLES.technician.includes(role),
    audit: ROLES.auditor.includes(role),
    admin,
    spoc: asSpoc,
    registry: admin || role === 'auditor' || asSpoc,
  };
};

function me(actor) {
  const who = actorOf(actor);
  return {
    user: { id: who.id, username: who.username, email: who.email, role: who.role,
            orgId: who.orgId, tenantId: who.tenantId },
    can: can(who, { spoc: isSpoc(who) }),
  };
}

const SECTION_TITLES = {
  spoc: 'Assigned to me',
  mine: 'My checks', verification_pending: 'Waiting for a verification scan',
  triage: 'Needs an admin', approval_pending: 'Waiting for a second approval', write_failed: 'Write failed',
  manual_review: 'Manual review', sla_breached: 'SLA breached', recent: 'Recent',
  assigned: 'Assigned to me', accepted: 'Accepted by me', in_progress: 'In progress with me',
  pending: 'On hold with me',
};

/**
 * What is waiting on this person, in sections by role:
 *
 *   a SPOC        spoc, first: the checks that are with them, whatever their
 *                 role
 *   technician    mine, and verification_pending on their Site when a check
 *                 from before the SPOC change is waiting there
 *   admin         triage (the checks that need an admin), approval_pending,
 *                 write_failed, manual_review, sla_breached
 *   site manager  the checks of their Site, to read
 *   approver      approval_pending
 *   auditor       recent
 *   an assignee   assigned, accepted, in_progress, pending - added for anybody
 *                 who has tickets on a check that is not already under spoc
 */
function queue(actor) {
  const who = actorOf(actor);
  const scope = scopeFor(who);
  const plansFor = (filters) => store.listPlans({ ...scope, ...filters, limit: 100 }).map(rowOf);
  const sections = [];
  const add = (key, plans) => sections.push({ key, title: SECTION_TITLES[key], plans });
  const role = who.role;

  // The checks that are with this person, first, whatever their role.
  const held = who.id != null && role !== 'auditor'
    ? store.listPlans({ seenBy: seenByOf(who), spocUserId: who.id, status: WORKING, limit: 100 }) : [];
  if (held.length || (role !== 'auditor' && isSpoc(who))) add('spoc', held.map(rowOf));

  if (role === 'member') {
    add('mine', store.listPlans({ seenBy: seenByOf(who), createdBy: who.username, limit: 100 }).map(rowOf));
    const waiting = store.listPlans({ seenBy: seenByOf(who), tenantId: who.tenantId ?? -1,
      status: 'verification_pending', limit: 100 });
    if (waiting.length) add('verification_pending', waiting.map(rowOf));
  }
  if (ROLES.admin.includes(role)) {
    add('triage', plansFor({ status: 'triage' }));
    add('approval_pending', plansFor({ status: 'approval_pending' }));
    add('write_failed', plansFor({ status: 'write_failed' }));
    add('manual_review', plansFor({ status: 'manual_review' }));
    add('sla_breached', plansFor({ sla: 'breached', status: machine.OPEN }));
  }
  // A site manager reads their Site's checks; triage and reassigning are an admin's.
  if (role === 'site_manager') {
    sections.push({ key: 'mine', title: 'Checks of my site', plans: store.listPlans({
      seenBy: seenByOf(who), tenantId: who.tenantId ?? -1, status: OPEN_FILTER, limit: 100 }).map(rowOf) });
  }
  if (role === 'approver') add('approval_pending', plansFor({ status: 'approval_pending' }));
  if (role === 'auditor') add('recent', store.listPlans({ ...scope, limit: 25 }).map(rowOf));

  // Tickets that are this person's to work, by how far along the least
  // advanced one on each plan is.
  if (who.id != null && role !== 'auditor') {
    const mine = store.listTickets({ seenBy: seenByOf(who),
      ticketAssigneeUserId: who.id, ticketStatus: ['open', 'accepted', 'in_progress', 'pending'], limit: 500 });
    const byPlan = new Map();
    const underSpoc = new Set(held.map((p) => p.id));
    for (const t of mine) {
      if (underSpoc.has(t.planId)) continue;
      byPlan.set(t.planId, [...(byPlan.get(t.planId) || []), t]);
    }
    const buckets = { assigned: [], accepted: [], in_progress: [], pending: [] };
    for (const [planId, tickets] of byPlan) {
      const at = machine.workingStatus(tickets);
      if (buckets[at]) buckets[at].push(planId);
    }
    // An empty bucket is skipped for everyone, a member included. Keeping a
    // member's four empty buckets was meant to show them the shape of the work
    // that could arrive. What it produced was six stacked tables, each with a
    // full DRIFT / RACK / DATACENTRE / STATUS / PRIORITY / RISK / SLA / UPDATED
    // header and nothing under it - which reads as "nothing works" rather than
    // "nothing is assigned to you yet". The caller renders one empty state when
    // every section is gone, which says that once instead of six times.
    for (const key of Object.keys(buckets)) {
      if (!buckets[key].length) continue;
      add(key, store.listPlans({ ids: buckets[key], limit: 100 }).map(rowOf));
    }
  }
  return { role, sections };
}

/**
 * Counts by status, by priority and by SLA state, each with the filters that
 * open exactly that list. Priority counts cover open plans only: a closed P1
 * is not somebody's emergency any more.
 */
function dashboard(actor, query = {}) {
  const who = actorOf(actor);
  const scope = scopeFor(who);
  if (query.tenantId != null && query.tenantId !== '') scope.tenantId = Number(query.tenantId);
  if (who.role === 'site_manager') { scope.tenantId = who.tenantId ?? -1; delete scope.visibleTo; }
  const extra = query.tenantId != null && query.tenantId !== '' ? { tenantId: Number(query.tenantId) } : {};
  const counted = (rows) => Object.fromEntries(rows.map((r) => [r.key, r.count]));

  const byStatus = counted(store.countPlansBy('status', scope));
  const byPriority = counted(store.countPlansBy('priority', { ...scope, status: OPEN_FILTER }));
  const bySla = counted(store.countPlansBySlaState({ ...scope, status: OPEN_FILTER }));
  const total = Object.values(byStatus).reduce((a, b) => a + b, 0);
  const open = OPEN_FILTER.reduce((n, s) => n + (byStatus[s] || 0), 0);
  return {
    total, open,
    status: machine.STATUSES.map((key) => ({ key, count: byStatus[key] || 0, filters: { status: key, ...extra } })),
    priority: machine.PRIORITIES.map((key) => ({ key, count: byPriority[key] || 0,
      filters: { priority: key, open: 1, ...extra } })),
    // The five words a screen shows, and the filter that opens exactly that
    // list. A plan is in one of them, so the tiles add up to `open`.
    sla: store.SLA_STATES.map((key) => ({ key, count: bySla[key] || 0,
      filters: { sla: key, open: 1, ...extra } })),
  };
}

// -- Settings -------------------------------------------------------------
const hours = (h) => h * 60;
const BUSINESS_DAY = 9 * 60;   // 09:00 to 18:00
const target = (minutes, business = false) => ({ minutes, business });

/** Spec table 7. Minutes; `business` minutes count only inside the calendar. */
const DEFAULT_SETTINGS = {
  sla_targets: {
    P1: { acceptance: target(15), investigation: target(30), resolution: target(hours(2)), approval: target(30) },
    P2: { acceptance: target(30), investigation: target(hours(1)), resolution: target(hours(4)), approval: target(hours(2)) },
    P3: { acceptance: target(hours(4)), investigation: target(hours(8)),
          resolution: target(2 * BUSINESS_DAY, true), approval: target(hours(8), true) },
    P4: { acceptance: target(hours(8)), investigation: target(BUSINESS_DAY, true),
          resolution: target(5 * BUSINESS_DAY, true), approval: target(2 * BUSINESS_DAY, true) },
    thresholds: { warn: 80, breach: 100, escalate: 120 },
  },
  // Mon to Fri 09:00 to 18:00 in the datacentre's own time zone (tenants.timezone
  // when `timezone` is null), no holidays.
  calendar: { days: [1, 2, 3, 4, 5], start: '09:00', end: '18:00', timezone: null, holidays: [] },
  // Off until an organization turns it on: the SPOC's one approval writes.
  dual_approval_risks: [],
  // In-app and email are mandatory. Teams is off until tokens exist.
  notification_prefs: { inapp: true, email: true, teams: false },
  escalation: { warn: ['assignee', 'admin'], breach: ['assignee', 'admin', 'owner'], escalate: ['owner'] },
};
const SETTING_KEYS = Object.keys(DEFAULT_SETTINGS);
const CLOCKS = ['acceptance', 'investigation', 'resolution', 'approval'];
const RECIPIENTS = ['assignee', 'admin', 'owner', 'approver', 'creator', 'site_manager'];
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Null when `value` is a good value for `key`, else what is wrong with it. */
function settingProblem(key, value) {
  const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
  if (key === 'dual_approval_risks') {
    if (!Array.isArray(value) || value.some((r) => !machine.RISKS.includes(r))) {
      return `a list of risks, each one of ${machine.RISKS.join(', ')}`;
    }
    return null;
  }
  if (key === 'calendar') {
    if (!isObj(value)) return 'an object';
    if (!Array.isArray(value.days) || !value.days.length
        || value.days.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) return 'days: a list of weekdays 0 (Sunday) to 6';
    if (!HHMM.test(value.start || '') || !HHMM.test(value.end || '')) return 'start and end as HH:MM';
    if (value.start >= value.end) return 'start before end';
    if (value.timezone != null && typeof value.timezone !== 'string') return 'timezone as an IANA name or null';
    if (value.timezone) {
      try { new Intl.DateTimeFormat('en', { timeZone: value.timezone }); } catch { return 'timezone as an IANA name or null'; }
    }
    if (value.holidays != null && (!Array.isArray(value.holidays)
        || value.holidays.some((d) => !/^\d{4}-\d{2}-\d{2}$/.test(String(d))))) return 'holidays as YYYY-MM-DD dates';
    return null;
  }
  if (key === 'sla_targets') {
    if (!isObj(value)) return 'an object';
    for (const p of machine.PRIORITIES) {
      if (!isObj(value[p])) return `${p}: an object with ${CLOCKS.join(', ')}`;
      for (const c of CLOCKS) {
        const t = value[p][c];
        if (!isObj(t) || !Number.isFinite(t.minutes) || t.minutes <= 0 || typeof t.business !== 'boolean') {
          return `${p}.${c}: { minutes: a positive number, business: true or false }`;
        }
      }
    }
    const th = value.thresholds;
    if (!isObj(th) || ![th.warn, th.breach, th.escalate].every((n) => Number.isFinite(n) && n > 0)
        || !(th.warn < th.breach && th.breach < th.escalate)) {
      return 'thresholds: { warn, breach, escalate } as rising percentages';
    }
    return null;
  }
  if (key === 'notification_prefs') {
    if (!isObj(value) || ['inapp', 'email', 'teams'].some((c) => typeof value[c] !== 'boolean')) {
      return '{ inapp, email, teams } as true or false';
    }
    if (!value.inapp || !value.email) return 'in-app and email are mandatory and cannot be turned off';
    return null;
  }
  if (key === 'escalation') {
    if (!isObj(value)) return 'an object';
    for (const step of ['warn', 'breach', 'escalate']) {
      if (!Array.isArray(value[step]) || value[step].some((r) => !RECIPIENTS.includes(r))) {
        return `${step}: a list from ${RECIPIENTS.join(', ')}`;
      }
    }
    return null;
  }
  return 'not a setting';
}

/** Every setting of an organization, the stored value or the default. */
function getSettings(orgId) {
  const stored = orgId != null ? store.allSettings(orgId) : {};
  const settings = {};
  const meta = {};
  for (const key of SETTING_KEYS) {
    const row = stored[key];
    settings[key] = row ? row.value : DEFAULT_SETTINGS[key];
    meta[key] = row ? { isDefault: false, updatedBy: row.updatedBy, updatedAt: row.updatedAt }
      : { isDefault: true, updatedBy: null, updatedAt: null };
  }
  return { settings, meta, defaults: DEFAULT_SETTINGS };
}

function putSetting(key, value, { actor, req = null } = {}) {
  const who = actorOf(actor);
  if (!ROLES.admin.includes(who.role)) return refuse('role', 'Settings are for an organization admin.');
  if (who.orgId == null) return refuse('bad_request', 'your account belongs to no organization, so it has no settings');
  if (!SETTING_KEYS.includes(key)) return refuse('bad_request', `unknown setting; the keys are ${SETTING_KEYS.join(', ')}`);
  const problem = settingProblem(key, value);
  if (problem) return refuse('bad_request', `${key} has to be ${problem}`);
  store.setSetting(who.orgId, key, value, who.id ?? null);
  if (!store.isolated()) {
    try {
      require('../../audit').log({ req: req || undefined,
        user: { id: who.id, username: who.username, tenant_id: who.tenantId },
        action: 'approval.settings', targetType: 'approval_settings', targetId: key, payload: { key, value } });
    } catch { /* never the reason a request fails */ }
  }
  return getSettings(who.orgId);
}

/** The RackTrack users of the caller's organization, for the assignee and approver pickers. */
function users(actor) {
  const who = actorOf(actor);
  if (who.orgId == null) return { users: [] };
  return { users: store.usersOfOrg(who.orgId).map((u) => ({
    id: u.id, username: u.username, email: u.email, role: u.role,
    tenantId: u.tenantId, tenantName: u.tenantName, can: can(u) })) };
}

module.exports = {
  // plumbing the routes and the adapter share
  actorOf, trustedActor, httpStatus, canSee, canRead, canTouch, seenByOf, hasFinding, recheck,
  // filing and reading
  create, createFromPreview, get, list, listTickets, listEvents, queue, dashboard, me, users, contacts,
  // the workflow
  submit, submitAndDispatch, dispatch, triage, assign, assignLocal, assignableUids, notifyAssignee,
  acceptTicket, startTicket, holdTicket, resolveTicket, applyTicketStates, openSysIds, syncServiceNow,
  decideItems, skipVerification, approve, reject, rework, moveByHand, cancel, reopen,
  decide, replan, acceptSuggestion, dismissSuggestion, revokeOverride, suggestionsFor, _setCompare,
  beginWrite, finishWrite, abortWrite, notWritable,
  listChanges,
  addComment, listComments,
  getSettings, putSetting, DEFAULT_SETTINGS, SETTING_KEYS,
};
