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
 * A refusal is a value, not an exception: { error, code, why, from, to } with
 * code not_found, bad_request, role, guard or transition. httpStatus() turns
 * the code into 404, 400, 403 or 409.
 */
const store = require('./store');
const shape = require('./shape');
const machine = require('./machine');
const bus = require('./bus');

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
          force = false, ctx = null, req = null, auditPayload = null } = opts;
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
  const heard = { plan: updated, from, to, actor, reason, item };
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
 *   submitted            -> triage
 *   triage               -> assigned, once nothing is left to hand out and an
 *                           admin has acted on the plan (assigned something,
 *                           or triaged it)
 *   a working status     -> the working status its tickets now add up to
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
    if (plan.status === 'submitted') {
      to = 'triage';
    } else if (plan.status === 'triage') {
      const left = machine.unassigned({ items: store.itemsOf(planId), tickets }).length;
      if (!left && (tickets.length || plan.triagedAt)) to = 'assigned';
    } else if (WORKING.includes(plan.status)) {
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
      reason: 'follows its tickets', payload: by, auditPayload: by });
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
 * verify; anybody reads a plan that has a ticket assigned to them.
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
                  orgId = null, tenantId = null, parentPlanId = null, reuse = false }) {
  const who = actorOf(actor) || trustedActor(null);
  const fingerprint = shape.fingerprint(report.changes);
  if (reuse && rackId != null) {
    const match = store.listPlans({ seenBy: { orgId, userId: who.id ?? null, username: who.username ?? null },
      rackId, status: machine.OPEN, limit: 200 })
      .filter((p) => p.fingerprint === fingerprint)
      .filter((p) => !isStrict(who) || canRead(p, who))
      .sort((a, b) => Number(b.scanId === scanId) - Number(a.scanId === scanId) || b.id - a.id)[0];
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
/**
 * A technician hands the comparison to the admin: draft, submitted, and
 * straight on to triage. Their note travels with it, because "three of these
 * look wrong to me" is worth more than the diff on its own. Sending it twice
 * is not an error; the second time says `already`.
 */
function submit(planId, { note: said = null, actor, req = null } = {}) {
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

  return run((effects) => {
    const items = store.itemsOf(plan.id);
    const moved = move(effects, plan, 'submitted', {
      actor: who, action: 'submit', req, force: !isStrict(who), ctx: ctxFor(plan),
      patch: { submittedAt: store.nowIso(), submittedBy: who.username ?? null,
               submittedById: who.id ?? null, submittedNote: text(said) || null },
      payload: { what: 'sent to the admin', detail: { note: text(said) || null, ...shape.summarise(items) } },
      auditPayload: { note: text(said) || null },
    });
    if (moved.refused) return moved.refused;
    settle(effects, plan.id, who);
    return { plan: store.getPlan(plan.id, { heavy: false }) };
  });
}

// -- Triage ---------------------------------------------------------------
const TRIAGE_OPEN = ['triage', ...WORKING, 'reopened', 'rework'];

/**
 * The admin sizes the plan up: category, priority, risk, disposition. The
 * status stays triage until everything is assigned, with two ways out from
 * here: a duplicate of another plan, or covered by a known exception.
 */
function triage(planId, body = {}, { actor, req = null } = {}) {
  const who = actorOf(actor);
  const found = open(planId, who);
  if (found.refused) return found.refused;
  const { plan } = found;
  if (isStrict(who) && !(machine.isAdmin(who) || machine.managesSite(plan, who))) {
    return refuse('role', 'Triage is for an organization admin or the site manager of this Site.');
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

/** tickets.raise()'s answer as the external record kept on the ticket. */
const externalOf = (r) => (r.ok
  ? { system: 'servicenow', number: r.number, sysId: r.sysId, url: r.url,
      state: r.state, reused: r.reused, reopened: r.reopened,
      raisedAt: new Date().toISOString() }
  : { system: 'servicenow', error: `ServiceNow replied ${r.status || 'nothing'}`,
      detail: typeof r.error === 'string' ? r.error.slice(0, 200) : r.error });

const NO_SERVICENOW = { system: 'none',
  why: 'No ServiceNow is configured, so this ticket lives only in RackTrack.' };

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
 * The admin hands items to a person.
 *
 *   items       a list of uids, or '*' for every item still waiting
 *   assignee    the name picked from the roster, and/or
 *   assigneeId  the NetBox contact id, which settles two people with one name
 *   question    what the admin wants checked
 *   rows        instead of the four above: [{ uid, assignee, assigneeId,
 *               question }], for a caller that assigns different people at once
 *
 * The person is resolved to one NetBox contact BEFORE anything is written: a
 * name that matches nobody, or two people, refuses the whole request with
 * nothing changed. Then each item gets its ticket, one ServiceNow incident is
 * raised per item through lib/netbox/tickets.js (none configured is not an
 * error: the ticket lives here), and each person gets one email listing
 * everything they were just handed. When the contact's email is a RackTrack
 * user of the organization, the ticket carries that user too.
 */
async function assign(planId, body = {}, { actor, req = null } = {}) {
  const who = actorOf(actor);
  const found = open(planId, who);
  if (found.refused) return found.refused;
  let { plan } = found;
  const strict = isStrict(who);
  if (strict && !(machine.isAdmin(who) || machine.managesSite(plan, who))) {
    return refuse('role', 'Assigning is for an organization admin or the site manager of this Site.');
  }
  if (strict && !ASSIGN_OPEN.includes(plan.status)) {
    return refuse('transition', plan.status === 'draft'
      ? 'this plan has not been sent to the admin yet'
      : `a plan that is ${plan.status.replace(/_/g, ' ')} cannot be assigned`,
    { from: plan.status, to: 'assigned' });
  }
  if (!strict && shape.legacyStatus(plan.status) === 'applied') {
    return refuse('transition', 'this plan has already been written');
  }

  const wholeRack = body.items === '*';
  let rows;
  let rackUids = [];
  if (wholeRack) {
    if (!body.assignee && (body.assigneeId == null || body.assigneeId === '')) {
      return refuse('bad_request', 'a ticket has to be assigned to somebody');
    }
    rackUids = assignableUids(plan.id);
    if (!rackUids.length) return refuse('guard', 'nothing on this plan is waiting to be assigned');
    rows = rackUids.map((uid) => ({ uid, assignee: body.assignee, assigneeId: body.assigneeId,
      question: body.question, scope: 'rack' }));
  } else if (Array.isArray(body.rows)) {
    rows = body.rows.filter((r) => r && typeof r === 'object').map((r) => ({ ...r }));
  } else {
    const uids = Array.isArray(body.items) ? body.items : [];
    rows = uids.map((uid) => ({ uid: String(uid), assignee: body.assignee,
      assigneeId: body.assigneeId, question: body.question }));
  }
  if (!rows.length) return refuse('bad_request', "send { items: [uid] } or { items: '*' } with an assignee");

  // Who each ticket goes to, settled before anything is written on the plan.
  let people = null;
  const naming = rows.filter((r) => r.assignee || (r.assigneeId != null && r.assigneeId !== ''));
  if (strict && naming.length) {
    people = await rosterFor(plan, who);
    if (!people.client) {
      return refuse('bad_request',
        'No NetBox is configured for this account, so nobody can be looked up to assign to.');
    }
    for (const r of naming) {
      const hit = contactFor(people.roster, r);
      if (hit.error) return refuse('bad_request', hit.error, { uid: r.uid });
      r.assignee = hit.person.name;
      r.assigneeId = hit.person.netboxId ?? null;
      r.assigneeEmail = hit.person.email ?? null;
      r.spoc = people.spoc;
    }
  }
  for (const r of naming) {
    const user = r.assigneeEmail ? store.userByEmail(plan.orgId, r.assigneeEmail) : null;
    r.assigneeUserId = user ? user.id : null;
  }

  const out = run(() => ticketRows(plan, rows, who));
  const raised = [];
  const sn = strict ? require('./connections').serviceNowFor({ orgId: plan.orgId ?? who.orgId, userId: who.id }) : null;

  if (out.applied.length && strict) {
    const ticketsLib = require('../netbox/tickets');
    const items = store.itemsOf(plan.id);
    const { rackName, siteName, roster } = people;
    const targets = out.applied.map((a) => items.find((i) => i.uid === a.uid)).filter(Boolean);
    const notices = new Map();   // one email per person: contact -> what they were handed
    const perItem = [];
    const effects = [];
    for (const item of targets) {
      const ticket = store.getTicket(plan.id, item.uid);
      const person = roster.find((p) => String(p.netboxId) === String(ticket.assigneeId))
        || roster.find((p) => p.name === ticket.assignee) || null;
      const external = sn
        ? externalOf(await ticketsLib.raise(sn, {
          item, rackId: plan.rackId, rackName, siteName,
          spoc: person, question: ticket.question, planId: plan.id,
        }))
        : NO_SERVICENOW;
      const patch = { external };
      if (person && !person.email) patch.emailNote = `no email in NetBox for ${person.name}, so no notice was sent`;
      store.updateTicket(plan.id, item.uid, patch, { touch: false });
      perItem.push({ uid: item.uid, ports: shape.childrenOf(items, item.uid).length, ...external });
      audit(effects, plan, 'assign', { actor: who, req, payload: {
        uid: item.uid, assignee: ticket.assignee, assigneeId: ticket.assigneeId ?? null,
        assigneeUserId: ticket.assigneeUserId ?? null, incident: external.number || null,
        scope: wholeRack ? 'rack' : 'item',
      } });
      if (person && person.email) {
        const key = person.netboxId != null ? `id:${person.netboxId}` : `name:${person.name}`;
        const n = notices.get(key) || { person, targets: [], incidents: [], userId: ticket.assigneeUserId };
        n.targets.push(item);
        if (external.system === 'servicenow') n.incidents.push(external);
        notices.set(key, n);
      }
    }
    if (wholeRack) {
      // The rack entry first: what was handed over as one move, and how the
      // incidents behind it went. `number` joins them so a screen that shows
      // one number still shows something true; `error` is the first failure.
      const incidents = perItem.map((r) => ({
        uid: r.uid, number: r.number || null, url: r.url || null, error: r.error || null,
      }));
      const numbers = incidents.map((i) => i.number).filter(Boolean);
      const failed = incidents.filter((i) => i.error);
      raised.push({
        scope: 'rack', uid: '*', items: rackUids, count: rackUids.length,
        ticket: { system: sn ? 'servicenow' : 'none', raised: numbers.length,
                  failed: failed.length, incidents },
        number: numbers.length ? numbers.join(', ') : null,
        error: failed.length ? failed[0].error : null,
      });
    }
    raised.push(...perItem);

    const question = text(body.question) || null;
    for (const n of notices.values()) {
      notifyAssignee(plan, items, {
        ...n, rackName, siteName, by: who.username, wholeRack,
        question: wholeRack ? question : (n.targets.length === 1
          ? store.getTicket(plan.id, n.targets[0].uid).question : null),
      });
      emit(effects, 'assigned', { plan, actor: who, to: 'assigned',
        assignee: { name: n.person.name, email: n.person.email, netboxId: n.person.netboxId ?? null,
                    userId: n.userId ?? null },
        items: n.targets.map((t) => t.uid) });
    }
    flush(effects);
  }

  // The plan follows: out of triage once nothing is left to hand out, and
  // back to assigned from reopened, rework or rejected.
  const after = run((effects) => {
    plan = store.getPlan(plan.id, { heavy: false });
    if (out.applied.length && ['reopened', 'rework', 'rejected'].includes(plan.status)) {
      const moved = move(effects, plan, 'assigned', {
        actor: who, action: 'assign_again', req, force: !strict,
        ctx: ctxFor(plan, { reason: text(body.reason) || text(body.question) || 'assigned again' }),
        reason: text(body.reason) || text(body.question) || 'assigned again',
      });
      if (moved.refused) return moved;
    }
    return { plan: settle(effects, plan.id, who) };
  });
  if (after.refused) return after.refused;

  return {
    plan: after.plan, applied: out.applied, refused: out.refused, raised, wholeRack,
    waiting: assignableUids(plan.id), serviceNowConfigured: Boolean(sn),
  };
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
  const changed = [];
  const out = run((effects) => {
    const items = store.itemsOf(plan.id);
    for (const t of store.ticketsOf(plan.id)) {
      const ext = t.external;
      if (!ext || !ext.sysId) continue;
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
  .filter((t) => shape.isOpenTicket(t) && t.external && t.external.sysId)
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
  return { asked, changed };
}

// -- Item decisions -------------------------------------------------------
const DECIDE_OPEN = ['triage', ...WORKING, 'resolved', 'verification_pending', 'approval_pending',
  'rework', 'reopened'];

/** True when the item has come back from whoever was asked to look, with something said. */
const hasFinding = (ticket) => Boolean(ticket && ticket.status === 'resolved' && text(ticket.finding));

/**
 * Approve or reject items, one by one.
 *
 * The admin assigns before they decide. Approve and reject are refused on an
 * item nobody has been asked to check, on one whose ticket is still open, and
 * on one that came back with nothing said: the only move open there is to
 * assign it. The one exception is an item that cannot be checked at the rack
 * at all (a rebind): it is decided as it stands. This is rule 2 of the frozen
 * workflow, held on the server, so no screen can approve from a desk.
 *
 * A decision on a device is a decision on the ports that follow it, and it
 * closes the device's resolved ticket, keeping the finding beside the close.
 */
function decideItems(planId, decisions, { actor, req = null } = {}) {
  const who = actorOf(actor);
  const found = open(planId, who);
  if (found.refused) return found.refused;
  const { plan } = found;
  const strict = isStrict(who);
  if (strict && !ROLES.approver.includes(who.role)) {
    return refuse('role', 'Approving and rejecting are for an approver or an organization admin.');
  }
  if (shape.legacyStatus(plan.status) === 'applied') {
    return refuse('transition', 'this plan has already been written');
  }
  if (strict && !DECIDE_OPEN.includes(plan.status)) {
    return refuse('transition', plan.status === 'draft'
      ? 'this plan has not been sent to the admin yet'
      : `a plan that is ${plan.status.replace(/_/g, ' ')} is closed to item decisions; send it back for rework first`);
  }

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
      if (machine.needsAssignFirst(item) && !found2) {
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
 * the first signature and the plan stays in approval_pending; the second,
 * from a different person, approves it. Somebody who resolved a ticket on the
 * plan approves nothing on it.
 */
function approve(planId, { comment = null, actor, req = null } = {}) {
  const who = actorOf(actor);
  const found = open(planId, who);
  if (found.refused) return found.refused;
  const { plan } = found;
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
      const updated = store.updatePlan(plan.id, {});
      note(updated, 'approve.first', { actor: who, payload: signed });
      audit(effects, updated, 'approve', { actor: who, req, payload: { ...signed, final: false } });
      emit(effects, 'approval_requested', { plan: updated, from: plan.status, to: plan.status,
        actor: who, reason: null, item: null, stage: 'second', firstApproverId: who.id ?? null });
      return { plan: updated, decision, stage: stage.stage, final: false, needsSecond: true };
    }
    const moved = move(effects, plan, 'approved', {
      actor: who, action: 'approve', req, force: true, payload: signed, auditPayload: { ...signed, final: true },
      patch: { payloadHash: ctx.payloadHash },
    });
    return { plan: moved.plan, decision, stage: stage.stage, final: true, needsSecond: false };
  });
}

/** Reject, or send back for rework. Both need a reason code and a comment. */
function sendBack(planId, to, { reasonCode, comment, actor, req = null } = {}) {
  const who = actorOf(actor);
  const found = open(planId, who);
  if (found.refused) return found.refused;
  const { plan } = found;
  return run((effects) => {
    const ctx = ctxFor(plan, { reasonCode, comment });
    const moved = move(effects, plan, to, {
      actor: who, action: to === 'rework' ? 'rework' : 'reject', req, ctx,
      reason: reasonCode || null, payload: { comment: text(comment) || null },
      auditPayload: { reasonCode: reasonCode || null, comment: text(comment) || null },
    });
    if (moved.refused) return moved.refused;
    let decision = null;
    if (plan.status === 'approval_pending') {
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
 * goes back to approval_pending, with a fresh version, and nothing is written.
 * An approved plan with nothing approved on it completes without a write:
 * scaffolding is never written on its own.
 *
 * Answers { plan, excluded } to go ahead, { done: true } when there was
 * nothing to write, or a refusal; `moved: true` on it says NetBox moved.
 */
function beginWrite(planId, { actor, freshChanges, reason = null, req = null } = {}) {
  const who = actorOf(actor);
  const found = open(planId, who);
  if (found.refused) return found.refused;
  const { plan } = found;
  if (!['approved', 'write_failed', 'manual_review'].includes(plan.status)) {
    return refuse('transition', ['written', 'completed'].includes(plan.status)
      ? 'that plan has already been written'
      : 'This plan has not been approved yet. It is approved in RackTrack Approvals, then written.',
    { from: plan.status, to: 'write_in_progress' });
  }
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
      // written; the plan goes back to be approved, with a fresh version.
      const back = move(effects, plan, 'approval_pending', { actor: SYSTEM, action: 'auto.approval_pending',
        force: true, reason: check.ok ? 'approval_stale' : 'netbox_changed',
        patch: { payloadHash: null }, payload: { why: stale, live: check.live },
        auditPayload: { why: stale, causedBy: { id: who.id ?? null, username: who.username ?? null } } });
      audit(effects, back.plan, 'write', { actor: who, req, status: 'fail', error: stale,
        payload: { counts: {}, written: 0, failed: 0 } });
      return refuse('guard', stale, { from: plan.status, to: 'write_in_progress', moved: !check.ok,
        live: check.live, plan: back.plan });
    }
    if (plan.status === 'approved' && ctx.toWrite === 0) {
      const done = move(effects, plan, 'completed', { actor: who, action: 'complete', req, ctx,
        reason: 'nothing to write', patch: { completedAt: store.nowIso() } });
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
 * Record what the write actually did.
 *
 * Every object went through: the plan is written. NetBox refused any of
 * them: the plan is write_failed. What was written is written and is not
 * undone (the writer never deletes); what failed is listed by uid with
 * NetBox's reason, and the uids that did go through are kept, across
 * attempts, so the next try can tell its own work from somebody else's.
 */
function finishWrite(planId, { actor, result, req = null, withheld = null } = {}) {
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
    const moved = move(effects, plan, failed ? 'write_failed' : 'written', {
      actor: who, action: failed ? 'write_failed' : 'written', force: true,
      patch: failed ? { result: record } : { result: record, writtenAt: now, writtenBy: who.username ?? null },
      payload: { what: failed ? 'write failed' : 'written to NetBox',
                 detail: { counts: record.counts, written: record.written, failed: record.failed,
                           failures: record.failures },
                 by: who.username ?? null },
    });
    audit(effects, moved.plan, 'write', { actor: who, req, status: failed ? 'fail' : 'ok', payload: {
      counts: record.counts, written: record.written, failed: record.failed,
      attempt: record.attempts, withheld } });
    return moved.plan;
  });
}

/** The write threw before it could report: the plan is write_failed, with the error. */
function abortWrite(planId, { actor, error, req = null } = {}) {
  const who = actorOf(actor);
  const plan = store.getPlan(planId, { heavy: false });
  if (!plan || plan.status !== 'write_in_progress') return plan;
  return run((effects) => {
    const record = { ...(plan.result || {}), counts: {}, written: 0, failed: 0, failures: [],
      writtenUids: (plan.result && plan.result.writtenUids) || [],
      attempts: ((plan.result && plan.result.attempts) || 0) + 1,
      error: String(error || 'the write did not run'), at: store.nowIso(), by: who.username ?? null };
    const moved = move(effects, plan, 'write_failed', { actor: SYSTEM, action: 'write_failed', force: true,
      patch: { result: record }, reason: record.error,
      payload: { what: 'write failed', detail: { error: record.error } } });
    audit(effects, moved.plan, 'write', { actor: who, req, status: 'fail', error: record.error,
      payload: { counts: {}, written: 0, failed: 0 } });
    return moved.plan;
  });
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
 * Who this rack's ticket should go to. Read from NetBox at the moment it is
 * asked for, so the SPOC is whoever the customer's own record currently says
 * it is - not a copy of it that drifts.
 */
async function contacts(planId, { actor } = {}) {
  const who = actorOf(actor);
  const plan = store.getPlan(planId, { heavy: false });
  if (!plan || !canRead(plan, who)) return NOT_FOUND();
  const { netboxFor, serviceNowFor } = require('./connections');
  const me = { orgId: plan.orgId ?? who.orgId, userId: who.id };
  if (!netboxFor(me)) {
    return { spoc: null, others: [], everyone: [], why: 'no NetBox is configured for this account' };
  }
  const r = await rosterFor(plan, who);
  return { ...(r.people || { spoc: null, others: [] }), everyone: r.everyone,
    serviceNow: Boolean(serviceNowFor(me)),
    matchedRack: { name: r.resolved.name, confidence: r.resolved.confidence, why: r.resolved.why } };
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
    sla: clocks.map((c) => ({ clock: c.clock, status: c.status, targetAt: c.targetAt })),
    // One of breached, at_risk, paused, on_track, none - the same word the
    // dashboard tile counts and the `sla=` list filter takes.
    slaState: slaStateOf(plan.id, clocks),
  };
}

const OPEN_FILTER = machine.OPEN.filter((s) => s !== 'written');

/**
 * Plans, newest first, scoped to what the caller may read. Filters: status,
 * tenantId, rackId, scanId, priority, risk, assignee, createdBy ('me' works
 * for both), since, until, q, sla, open=1 (everything not yet written or
 * closed), limit and cursor.
 */
function list(actor, query = {}) {
  const who = actorOf(actor);
  const f = { ...query };
  if (f.createdBy === 'me') f.createdBy = who.username;
  if (f.assignee === 'me') { f.assigneeUserId = who.id; delete f.assignee; }
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

/**
 * One plan with everything: items, tickets, decisions, verifications,
 * comments, events, clocks, the SPOC noted when it was assigned, the items a
 * whole-rack assign would take, and the moves this caller may make.
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
    spoc: (tickets.find((t) => t.spoc) || {}).spoc || null,
    assignable: machine.unassigned(ctx).map((i) => i.uid),
    approval: { dual: stage.dual, stage: stage.stage,
                first: machine.firstApproval(ctx) },
    can: {
      next: mayTouch && isStrict(who) ? machine.next(plan, who, ctx) : [],
      assign: mayTouch && ASSIGN_OPEN.includes(plan.status)
        && (machine.isAdmin(who) || machine.managesSite(plan, who)),
      decide: mayTouch && DECIDE_OPEN.includes(plan.status) && ROLES.approver.includes(who.role),
      comment: mayTouch && who.role !== 'auditor',
      tickets: tickets.filter((t) => mayTouch && (machine.isAdmin(who) || machine.isTicketAssignee(t, who)))
        .map((t) => t.itemUid),
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
const can = (actor) => {
  const role = actor && actor.role;
  return {
    triage: ROLES.triage.includes(role),
    assign: ROLES.triage.includes(role),
    approve: ROLES.approver.includes(role),
    write: ROLES.writer.includes(role),
    verify: ROLES.technician.includes(role),
    audit: ROLES.auditor.includes(role),
    admin: ROLES.admin.includes(role),
  };
};

function me(actor) {
  const who = actorOf(actor);
  return {
    user: { id: who.id, username: who.username, email: who.email, role: who.role,
            orgId: who.orgId, tenantId: who.tenantId },
    can: can(who),
  };
}

const SECTION_TITLES = {
  mine: 'My checks', verification_pending: 'Waiting for a verification scan',
  triage: 'Triage', approval_pending: 'Waiting for approval', write_failed: 'Write failed',
  manual_review: 'Manual review', sla_breached: 'SLA breached', recent: 'Recent',
  assigned: 'Assigned to me', accepted: 'Accepted by me', in_progress: 'In progress with me',
  pending: 'On hold with me',
};

/**
 * What is waiting on this person, in sections by role:
 *
 *   technician    mine, and verification_pending on their Site
 *   admin         triage, approval_pending, write_failed, manual_review,
 *                 sla_breached (a site manager, for their Site only)
 *   approver      approval_pending
 *   auditor       recent
 *   an assignee   assigned, accepted, in_progress, pending - added for anybody
 *                 who has tickets, whatever their role
 */
function queue(actor) {
  const who = actorOf(actor);
  const scope = scopeFor(who);
  const plansFor = (filters) => store.listPlans({ ...scope, ...filters, limit: 100 }).map(rowOf);
  const sections = [];
  const add = (key, plans) => sections.push({ key, title: SECTION_TITLES[key], plans });
  const role = who.role;

  if (role === 'member') {
    add('mine', store.listPlans({ seenBy: seenByOf(who), createdBy: who.username, limit: 100 }).map(rowOf));
    add('verification_pending', store.listPlans({ seenBy: seenByOf(who), tenantId: who.tenantId ?? -1,
      status: 'verification_pending', limit: 100 }).map(rowOf));
  }
  if (ROLES.triage.includes(role)) {
    const site = role === 'site_manager' ? { tenantId: who.tenantId ?? -1, visibleTo: undefined } : {};
    add('triage', plansFor({ status: 'triage', ...site }));
    add('approval_pending', plansFor({ status: 'approval_pending', ...site }));
    add('write_failed', plansFor({ status: 'write_failed', ...site }));
    add('manual_review', plansFor({ status: 'manual_review', ...site }));
    add('sla_breached', plansFor({ sla: 'breached', status: machine.OPEN, ...site }));
  }
  if (role === 'approver') add('approval_pending', plansFor({ status: 'approval_pending' }));
  if (role === 'auditor') add('recent', store.listPlans({ ...scope, limit: 25 }).map(rowOf));

  // Tickets that are this person's to work, by how far along the least
  // advanced one on each plan is.
  if (who.id != null && role !== 'auditor') {
    const mine = store.listTickets({ seenBy: seenByOf(who),
      ticketAssigneeUserId: who.id, ticketStatus: ['open', 'accepted', 'in_progress', 'pending'], limit: 500 });
    const byPlan = new Map();
    for (const t of mine) byPlan.set(t.planId, [...(byPlan.get(t.planId) || []), t]);
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
  dual_approval_risks: ['critical'],
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
  submit, triage, assign, assignLocal, assignableUids,
  acceptTicket, startTicket, holdTicket, resolveTicket, applyTicketStates, openSysIds, syncServiceNow,
  decideItems, skipVerification, approve, reject, rework, moveByHand, cancel, reopen,
  beginWrite, finishWrite, abortWrite,
  addComment, listComments,
  getSettings, putSetting, DEFAULT_SETTINGS, SETTING_KEYS,
};
