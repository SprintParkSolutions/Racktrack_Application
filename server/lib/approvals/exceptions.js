/**
 * Accepted drift, known exceptions, and the change windows a plan is raised in.
 *
 * Some differences between a rack and NetBox are not faults. A lab switch that
 * is meant to sit in the wrong U, a device type the customer keeps under a
 * name of their own, a rack whose serial numbers are deliberately blank: every
 * scan finds them, and every scan asks about them again. An exception is the
 * answer to that: one person writes down what is accepted, why, for how long
 * and when it will be looked at again, and from then on a matching item on a
 * new plan is marked `excepted` and asks nobody.
 *
 * WHAT AN EXCEPTION COVERS. Its scope narrows from the organization down:
 * organization, then datacentre (tenant), then one rack, and optionally one
 * item type, one item name (an exact name, or a `*` at the end for a prefix)
 * and one attribute. A field that is null is "any". An attribute-scoped
 * exception only covers an item that actually changes that field - a create
 * has no fields to change, so no attribute exception ever hides a new device.
 *
 * WHEN IT STOPS. At `expires_at`, or the moment somebody revokes it. Neither
 * un-marks the items on plans that were already filed: those were answered at
 * the time, and history is not rewritten. `expiringSoon()` is what keeps an
 * exception from quietly becoming permanent.
 *
 * CHANGE WINDOWS are the other half of the same idea, in time rather than in
 * scope: a datacentre's maintenance window says "things are expected to move
 * here between these hours". A plan raised inside one is flagged with the
 * window, and sla.js pauses its clocks while the window is open - nobody is
 * late for a change everyone agreed to.
 *
 * WHERE THIS IS CALLED FROM. `onPlanCreated()` belongs at the end of the
 * transaction that files a plan (service.create). It is safe to call twice and
 * safe to call late: an item that has already been decided is left alone.
 */
const store = require('./store');
const shape = require('./shape');

const KINDS = ['accepted_drift', 'known_exception'];
const text = (v) => (typeof v === 'string' ? v.trim() : '');
const refuse = (code, why) => ({ error: why, code, why });
const nowIso = () => store.nowIso();

/** An ISO instant, or null. Anything else is a bad request, not a guess. */
function instant(v) {
  if (v == null || v === '') return null;
  const t = Date.parse(v);
  if (Number.isNaN(t)) return undefined;
  return new Date(t).toISOString().replace(/\.\d+Z$/, 'Z');
}

// -- Does this exception still stand, and does it cover this item? --------
/** Live now: approved, not revoked, started, and not yet expired. */
function isActive(ex, at = nowIso()) {
  if (!ex || ex.revokedAt) return false;
  if (ex.startsAt && ex.startsAt > at) return false;
  if (ex.expiresAt && ex.expiresAt <= at) return false;
  return true;
}

/** An exact name, or a prefix when the exception's name ends in `*`. */
function nameMatches(pattern, name) {
  const p = String(pattern || '').trim();
  const n = String(name || '').trim();
  if (!p) return true;
  if (p.endsWith('*')) return n.toLowerCase().startsWith(p.slice(0, -1).toLowerCase());
  return p.toLowerCase() === n.toLowerCase();
}

/** Does the item actually change that field? A create changes no field. */
function touchesAttribute(item, attribute) {
  const key = String(attribute || '').trim();
  if (!key) return true;
  const diff = item && item.diff;
  if (!diff || typeof diff !== 'object') return false;
  return Object.prototype.hasOwnProperty.call(diff, key);
}

/** Does `ex` cover `item` on `plan`? Every null field on the exception is "any". */
function covers(ex, plan, item) {
  if (!ex || !plan || !item) return false;
  if (ex.orgId != null && Number(ex.orgId) !== Number(plan.orgId)) return false;
  if (ex.tenantId != null && Number(ex.tenantId) !== Number(plan.tenantId)) return false;
  if (ex.rackId && String(ex.rackId) !== String(plan.rackId)) return false;
  if (ex.itemType && String(ex.itemType) !== String(item.type)) return false;
  if (ex.itemName && !nameMatches(ex.itemName, item.name)) return false;
  if (ex.attribute && !touchesAttribute(item, ex.attribute)) return false;
  return true;
}

/** The exceptions of this plan's organization that are live now. */
const activeFor = (plan, at = nowIso()) => store
  .listExceptions({ orgId: plan.orgId ?? null })
  .filter((ex) => isActive(ex, at));

/** The first live exception covering this item, or null. */
const matchFor = (plan, item, list = null, at = nowIso()) =>
  (list || activeFor(plan, at)).find((ex) => covers(ex, plan, item)) || null;

// -- Applying them to a plan ---------------------------------------------
/**
 * Mark every item a live exception covers, so nobody is asked about it.
 *
 * Only an item still waiting for an answer is touched: decidable and pending.
 * A device's ports follow it, as they do for every other decision. Returns
 * what was marked; an empty list is the ordinary case and not a failure.
 */
function applyToPlan(planId, { actor = null, at = nowIso() } = {}) {
  const plan = store.getPlan(planId, { heavy: false });
  if (!plan) return { applied: [], plan: null };
  const live = activeFor(plan, at);
  if (!live.length) return { applied: [], plan };
  const items = store.itemsOf(plan.id);
  const applied = [];
  store.tx(() => {
    for (const item of items) {
      if (!item.decidable || item.decision !== 'pending') continue;
      const ex = matchFor(plan, item, live, at);
      if (!ex) continue;
      const decided = {
        decision: 'excepted', exceptionId: ex.id, reasonCode: 'known_exception',
        decidedBy: actor && actor.username ? actor.username : 'system',
        decidedById: (actor && actor.id) ?? null, decidedAt: nowIso(),
        note: `Covered by exception ${ex.id}: ${text(ex.justification) || ex.kind}`,
      };
      store.updateItem(plan.id, item.uid, decided, { touch: false });
      for (const child of shape.childrenOf(items, item.uid)) {
        store.updateItem(plan.id, child.uid, decided, { touch: false });
      }
      applied.push({ uid: item.uid, exceptionId: ex.id, kind: ex.kind });
    }
    if (applied.length) {
      store.touchPlan(plan.id);
      store.addEvent(plan.id, {
        action: 'exception.applied', actorId: (actor && actor.id) ?? null,
        actorName: (actor && actor.username) || 'system',
        fromStatus: plan.status, toStatus: plan.status,
        payload: { what: 'covered by an exception', detail: { applied: applied.length }, applied },
      });
    }
  });
  return { applied, plan: store.getPlan(plan.id, { heavy: false }) };
}

/**
 * Everything that happens to a plan the moment it is filed: the exceptions
 * that cover it, and the change window it was raised inside.
 *
 * ONE LINE, at the end of the transaction in service.create():
 *   require('./exceptions').onPlanCreated(plan.id, { actor: who });
 */
function onPlanCreated(planId, { actor = null, at = nowIso() } = {}) {
  const flagged = flagWindow(planId, { at });
  const applied = applyToPlan(planId, { actor, at });
  return { applied: applied.applied, window: flagged.window, plan: applied.plan || flagged.plan };
}

// -- Writing them down ---------------------------------------------------
/**
 * File an exception. The scope is the caller's organization, always; a
 * datacentre and a rack narrow it, they never widen it.
 */
function create(body = {}, { actor, req = null } = {}) {
  const who = actor || {};
  if (who.orgId == null) {
    return refuse('bad_request', 'your account belongs to no organization, so it has no exceptions');
  }
  const kind = body.kind || 'known_exception';
  if (!KINDS.includes(kind)) return refuse('bad_request', `kind has to be one of ${KINDS.join(', ')}`);
  const justification = text(body.justification);
  if (justification.length < 10) {
    return refuse('bad_request', 'say in a sentence why this difference is accepted');
  }
  const startsAt = instant(body.startsAt) ?? nowIso();
  const expiresAt = instant(body.expiresAt);
  const reviewAt = instant(body.reviewAt);
  if (startsAt === undefined || expiresAt === undefined || reviewAt === undefined) {
    return refuse('bad_request', 'startsAt, expiresAt and reviewAt have to be dates');
  }
  if (expiresAt && expiresAt <= startsAt) return refuse('bad_request', 'an exception expires after it starts');
  if (!expiresAt) return refuse('bad_request', 'an exception needs a date it expires on, so it cannot become permanent by accident');
  const tenantId = body.tenantId != null && body.tenantId !== '' ? Number(body.tenantId) : null;
  if (tenantId != null && !Number.isInteger(tenantId)) return refuse('bad_request', 'tenantId has to be a number');
  const ex = store.addException({
    orgId: who.orgId, tenantId, rackId: text(body.rackId) || null,
    itemType: text(body.itemType) || null, itemName: text(body.itemName) || null,
    attribute: text(body.attribute) || null, kind, justification,
    ownerId: body.ownerId != null && body.ownerId !== '' ? Number(body.ownerId) : (who.id ?? null),
    startsAt, expiresAt, reviewAt, approvedBy: who.id ?? null,
  });
  trail(req, who, 'exception.create', ex.id, { kind, tenantId, rackId: ex.rackId, itemType: ex.itemType,
    itemName: ex.itemName, attribute: ex.attribute, expiresAt });
  return { exception: ex };
}

/** Stop an exception now. What it already marked stays marked; history stands. */
function revoke(id, { actor, req = null } = {}) {
  const who = actor || {};
  const ex = store.getException(id);
  if (!ex || (who.role !== 'owner' && Number(ex.orgId) !== Number(who.orgId))) {
    return refuse('not_found', 'no such exception');
  }
  if (ex.revokedAt) return { exception: ex, already: true };
  const out = store.revokeException(ex.id);
  trail(req, who, 'exception.revoke', ex.id, { kind: ex.kind });
  return { exception: out };
}

/** Every exception of the caller's organization, newest first. */
function list({ actor, tenantId = null, includeRevoked = false, rackId = null } = {}) {
  const who = actor || {};
  const rows = store.listExceptions({ orgId: who.orgId ?? null, includeRevoked })
    .filter((ex) => (tenantId == null || tenantId === '' ? true : Number(ex.tenantId) === Number(tenantId)))
    .filter((ex) => (!rackId ? true : String(ex.rackId || '') === String(rackId)));
  const at = nowIso();
  return { exceptions: rows.map((ex) => ({ ...ex, active: isActive(ex, at) })) };
}

/** The ones that run out soon, so a review happens before they lapse. */
function expiringSoon({ actor, days = 30 } = {}) {
  const who = actor || {};
  const at = nowIso();
  const until = new Date(Date.now() + Math.max(1, Number(days) || 30) * 86400000)
    .toISOString().replace(/\.\d+Z$/, 'Z');
  const rows = store.listExceptions({ orgId: who.orgId ?? null })
    .filter((ex) => isActive(ex, at))
    .filter((ex) => (ex.expiresAt && ex.expiresAt <= until)
      || (ex.reviewAt && ex.reviewAt <= until))
    .sort((a, b) => String(a.reviewAt || a.expiresAt).localeCompare(String(b.reviewAt || b.expiresAt)));
  return { exceptions: rows, until };
}

// -- Change windows -------------------------------------------------------
/** The windows of one datacentre that cover this instant. */
function windowsCovering(tenantId, at = nowIso(), orgId = null) {
  if (tenantId == null) return [];
  return store.listWindows({ orgId, tenantId: Number(tenantId) })
    .filter((w) => w.startsAt <= at && at < w.endsAt);
}

/** Is this plan's datacentre inside a maintenance window right now? */
const inWindow = (plan, at = nowIso()) => Boolean(plan
  && windowsCovering(plan.tenantId, at, plan.orgId ?? null).length);

/** A plan raised inside a window carries it, so its clocks can pause. */
function flagWindow(planId, { at = nowIso() } = {}) {
  const plan = store.getPlan(planId, { heavy: false });
  if (!plan || plan.windowId != null) return { plan, window: null };
  const open = windowsCovering(plan.tenantId, at, plan.orgId ?? null)[0] || null;
  if (!open) return { plan, window: null };
  const updated = store.updatePlan(plan.id, { windowId: open.id });
  store.addEvent(plan.id, {
    action: 'window.raised_in', actorName: 'system',
    fromStatus: plan.status, toStatus: plan.status,
    payload: { what: 'raised inside a change window',
      detail: { windowId: open.id, startsAt: open.startsAt, endsAt: open.endsAt, note: open.note } },
  });
  return { plan: updated, window: open };
}

function listWindows({ actor, tenantId = null } = {}) {
  const who = actor || {};
  const rows = store.listWindows({ orgId: who.orgId ?? null,
    tenantId: tenantId != null && tenantId !== '' ? Number(tenantId) : null });
  const at = nowIso();
  return { windows: rows.map((w) => ({ ...w, open: w.startsAt <= at && at < w.endsAt })) };
}

function createWindow(body = {}, { actor, req = null } = {}) {
  const who = actor || {};
  if (who.orgId == null) {
    return refuse('bad_request', 'your account belongs to no organization, so it has no change windows');
  }
  const tenantId = body.tenantId != null && body.tenantId !== '' ? Number(body.tenantId) : null;
  if (tenantId == null || !Number.isInteger(tenantId)) {
    return refuse('bad_request', 'a change window belongs to one datacentre; send its tenantId');
  }
  const startsAt = instant(body.startsAt);
  const endsAt = instant(body.endsAt);
  if (!startsAt || !endsAt) return refuse('bad_request', 'a change window needs startsAt and endsAt');
  if (endsAt <= startsAt) return refuse('bad_request', 'a change window ends after it starts');
  const w = store.addWindow({ orgId: who.orgId, tenantId, startsAt, endsAt,
    note: text(body.note).slice(0, 500) || null, createdBy: who.id ?? null });
  trail(req, who, 'window.create', w.id, { tenantId, startsAt, endsAt });
  return { window: w };
}

function deleteWindow(id, { actor, req = null } = {}) {
  const who = actor || {};
  const w = store.getWindow(id);
  if (!w || (who.role !== 'owner' && Number(w.orgId) !== Number(who.orgId))) {
    return refuse('not_found', 'no such change window');
  }
  store.deleteWindow(w.id);
  trail(req, who, 'window.delete', w.id, { tenantId: w.tenantId });
  return { deleted: true, window: w };
}

// -- Duplicates -----------------------------------------------------------
/**
 * The open plan this comparison would duplicate, if there is one.
 *
 * service.create() already does this when it is called with reuse: true - the
 * preview route's path - and returns the open plan with reused: true instead
 * of filing a second one. This is the same rule for a caller that has a
 * fingerprint and not a report: the triage screen asking "is this one we have
 * already got?", and the duplicate check on a plan filed by another route.
 */
function openDuplicateOf({ orgId = null, rackId, fingerprint, excludePlanId = null } = {}) {
  if (!rackId || !fingerprint) return null;
  const machine = require('./machine');
  return store.listPlans({ orgId, rackId, status: machine.OPEN, limit: 200 })
    .filter((p) => p.fingerprint === fingerprint)
    .filter((p) => excludePlanId == null || Number(p.id) !== Number(excludePlanId))
    .sort((a, b) => b.id - a.id)[0] || null;
}

// -- The audit trail ------------------------------------------------------
/** One audit row. Never the reason a request fails, and never on a test database. */
function trail(req, who, action, targetId, payload) {
  if (store.isolated()) return;
  try {
    require('../../audit').log({
      req: req || undefined,
      user: { id: who.id ?? null, username: who.username ?? null, tenant_id: who.tenantId ?? null },
      action: `approval.${action}`, targetType: 'approval_exception', targetId, payload,
    });
  } catch { /* the trail never breaks the request */ }
}

module.exports = {
  KINDS,
  isActive, nameMatches, touchesAttribute, covers, activeFor, matchFor,
  applyToPlan, onPlanCreated,
  create, revoke, list, expiringSoon,
  windowsCovering, inWindow, flagWindow, listWindows, createWindow, deleteWindow,
  openDuplicateOf,
};
