/**
 * What a plan is made of, as pure functions: no database, no clock beyond a
 * timestamp, nothing to stub.
 *
 * These moved here from lib/netbox/plans.js when plans moved from JSON files
 * into tables, so the service, the adapter and the migration share one copy:
 *
 *   - which object types a person decides about, and which simply follow
 *   - the fingerprint, the signature on one specific list of changes
 *   - one row of a plan as a person reads it (a port follows its device)
 *   - the one-line summary a list shows
 *   - the payload hash an approval signs: the fingerprint of what would
 *     actually be written, which is the approved items and their scaffolding
 *   - the old plan shape the phone app and /api/nb still read
 */
const crypto = require('crypto');
const { ACTION_TRAITS, traitsOf } = require('./machine');

/**
 * Which object types a person decides about, and which simply follow.
 *
 * A manufacturer or a device type is not a decision - it is scaffolding that
 * has to exist before the thing an engineer actually cares about can be
 * written. Asking someone to approve "create manufacturer D-Link" forty times
 * teaches them to click approve without reading, which is worse than not
 * asking. So supporting types are applied whenever anything that needs them is
 * approved, and they are listed in the plan so nothing is hidden.
 */
const SUPPORTING = new Set([
  'Manufacturer', 'DeviceType', 'DeviceRole', 'Site', 'Location', 'Rack',
]);

/**
 * Actions that would change NetBox. Everything else is reported, not decided.
 * A rebind moves our uid from an object's old id to its new one and touches
 * nothing else; it changes NetBox, so it is decided and fingerprinted too.
 * Read from the one table of action traits in machine.js.
 */
const ACTIONABLE = new Set(Object.keys(ACTION_TRAITS).filter((a) => ACTION_TRAITS[a].changes));

/** JSON with object keys sorted, so key order cannot change the hash. */
function stable(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}`;
}

// The separator between the parts of a fingerprint row is a NUL byte: no uid,
// action or JSON text can contain one, so two rows can never run together.
// Built from its code so this file stays plain text (the old plans.js held
// the byte itself, and git took the file for a binary).
const SEP = String.fromCharCode(0);

/**
 * A stable hash of what a list of changes would do.
 *
 * Order-independent and value-sensitive: the same differences in a different
 * order hash the same, and one changed field value hashes differently. Only
 * actionable items count - a noop or a skip cannot be overwritten by anybody.
 * Byte for byte what the JSON plans were hashed with, so a plan migrated from
 * a file still matches a fresh comparison.
 */
function fingerprint(changes) {
  const rows = (changes || [])
    .filter((c) => ACTIONABLE.has(c.action))
    .map((c) => `${c.uid}${SEP}${c.action}${SEP}${stable(c.diff)}`)
    .sort();
  return crypto.createHash('sha256').update(rows.join('\n')).digest('hex').slice(0, 32);
}

/**
 * The device an interface belongs to, read from its uid.
 *
 * Interface uids are `if:<device uid>:<n>` (cv.js, reconcile.js), so the
 * device is everything between the prefix and the last colon. Null for any
 * other type: only interfaces have a parent.
 */
function parentUidOf(change) {
  if (!change || change.type !== 'Interface') return null;
  const m = /^if:(.+):[^:]+$/.exec(String(change.uid || ''));
  return m ? m[1] : null;
}

/**
 * One row of the plan, as a person will read it.
 *
 * An interface FOLLOWS its device. A new switch brings forty-eight ports with
 * it, and asking about each one separately turns one decision into forty-nine
 * and one incident into forty-nine. So when the device is itself up for a
 * decision in the same plan, its interfaces are listed but not asked about:
 * the device carries the decision and it is passed down. An interface whose
 * device is not in question (the device is already right in NetBox and only a
 * port changed) stays a decision of its own.
 *
 * One exception. A child follows a parent that is decided from the desk (a
 * rebind) only when the child is decided from the desk too. A new or changed
 * port under a rebound device is a real question about the rack: it stays a
 * decision of its own, under assign-first, and is never waved through with
 * the rebind.
 *
 * Whatever else the comparison put on the row (fromUid on a rebind, a future
 * `binding` object) is kept as `extra` and handed back on read, unchanged.
 *
 * `all` is the change list this row comes from - Array.prototype.map hands it
 * over as the third argument.
 */
const KNOWN_CHANGE_FIELDS = new Set(['uid', 'type', 'name', 'action', 'netboxId', 'diff', 'reason']);

function toItem(change, _index, all) {
  const parentUid = parentUidOf(change);
  const parent = parentUid && Array.isArray(all) ? all.find((c) => c.uid === parentUid) : null;
  const traits = traitsOf(change.action);
  const supporting = SUPPORTING.has(change.type);
  const actionable = traits.changes && (!supporting || Boolean(traits.evenWhenSupporting));
  const parentAsked = Boolean(parent && traitsOf(parent.action).changes && !SUPPORTING.has(parent.type));
  const following = Boolean(actionable && parentAsked
    && (traitsOf(parent.action).ticketable || !traits.ticketable));
  const decidable = actionable && !following;
  const extra = {};
  for (const [k, v] of Object.entries(change)) if (!KNOWN_CHANGE_FIELDS.has(k)) extra[k] = v;
  return {
    ...extra,
    uid: change.uid,
    type: change.type,
    name: change.name,
    action: change.action,
    netboxId: change.netboxId ?? null,
    diff: change.diff ?? null,
    reason: change.reason ?? null,
    supporting,
    decidable,
    parentUid,
    following,
    // Supporting scaffolding is applied with whatever needs it; it is listed
    // so the plan hides nothing, but it is not put to a person as a question.
    // A following interface mirrors its device, which starts pending.
    decision: decidable || following ? 'pending' : 'not_applicable',
    extra,
  };
}

/** The interfaces that follow a device, by its uid. Works on either shape. */
const childrenOf = (items, uid) => (items || []).filter((i) => i.following && i.parentUid === uid);

/** A ticket somebody can still act on: not resolved and not closed. */
const OPEN_TICKET = new Set(['open', 'accepted', 'in_progress', 'pending']);
const isOpenTicket = (t) => Boolean(t && OPEN_TICKET.has(t.status));

/**
 * A one-line count of what a plan holds, for a list row and the events log.
 *
 * `items` may carry their ticket on `item.ticket` (the old shape) or the
 * tickets may be passed beside them as rows keyed by itemUid. `result` is the
 * plan's write result once a write has run, so a screen can show a write that
 * half failed without opening the plan.
 */
function summarise(items, result = null, tickets = null) {
  const byUid = tickets ? new Map(tickets.map((t) => [t.itemUid, t])) : null;
  const ticketOf = (i) => (byUid ? byUid.get(i.uid) || null : i.ticket || null);
  const d = (items || []).filter((i) => i.decidable);
  const by = (k) => d.filter((i) => i.decision === k).length;
  return {
    decidable: d.length,
    // Scaffolding that goes with whatever needs it. A supporting row that is
    // itself a decision (a rebind of the Rack record) is counted above instead.
    supporting: (items || []).filter((i) => i.supporting && !i.decidable && ACTIONABLE.has(i.action)).length,
    pending: by('pending'),
    approved: by('approved'),
    rejected: by('rejected'),
    ticketed: by('ticketed'),
    openTickets: d.filter((i) => isOpenTicket(ticketOf(i))).length,
    // Items that have come back from the person who looked and now wait on
    // the admin. These are the only ones approve and reject are open for.
    resolved: d.filter((i) => { const t = ticketOf(i); return Boolean(t && t.status === 'resolved'); }).length,
    // Interfaces that go with their device. Counted so a screen can say "48
    // ports follow", never as decisions: `d` is top-level items only.
    following: (items || []).filter((i) => i.following).length,
    // The write, once it has run. Zero on a plan that has not been written.
    written: result ? Number(result.written || 0) : 0,
    failed: result ? Number(result.failed || 0) : 0,
  };
}

/**
 * True when every decidable item has an answer: nothing waiting on the admin
 * and nothing out with somebody. An item that is ticketed has an open ticket,
 * and a plan with an open ticket is not settled - writing it would close the
 * plan over the head of whoever is still at the rack.
 */
const isSettled = (items) => (items || [])
  .filter((i) => i.decidable && (i.decision === 'pending' || i.decision === 'ticketed')).length === 0;

/**
 * The uids a write must NOT carry.
 *
 * Stated as an exclusion rather than a list of what to keep, and that is
 * deliberate. An object the comparison called a noop is already correct in
 * NetBox, so writing it is unnecessary - but the walk still has to SEE it,
 * because everything downstream refers to it by uid. So only one kind of
 * object is held back: something a person was asked about and did not approve.
 */
function excludedUids(items) {
  const out = new Set();
  for (const i of items || []) if (i.decidable && i.decision !== 'approved') out.add(i.uid);
  return out;
}

/**
 * The same snapshot, minus what was not approved.
 *
 * What a person changed on the check rides on the snapshot beside the arrays,
 * and goes the same way. A record marked offline that was then rejected writes
 * nothing. And the answer "this box is that record" about a box that was left
 * out goes with the box: the writer reads an answer about a box it cannot find
 * as a box the scan lost, and holds every new device back until somebody says
 * where it went - which would stop the approved half of the check for the sake
 * of the rejected half. Nothing on the snapshot handed in is changed.
 */
function filterSnapshot(snapshot, excluded) {
  if (!excluded || !excluded.size) return snapshot;
  const out = { ...snapshot };
  for (const [key, value] of Object.entries(snapshot)) {
    if (Array.isArray(value) && value.length && value[0] && value[0].uid !== undefined) {
      out[key] = value.filter((o) => !excluded.has(o.uid));
    }
  }
  const without = (map) => Object.fromEntries(Object.entries(map).filter(([uid]) => !excluded.has(uid)));
  const isMap = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
  if (isMap(snapshot.approvedOffline)) {
    out.approvedOffline = Object.fromEntries(Object.entries(snapshot.approvedOffline)
      .filter(([, row]) => !(row && excluded.has(row.uid))));
  }
  if (isMap(snapshot.approvedMoves)) out.approvedMoves = without(snapshot.approvedMoves);
  const binding = snapshot.recordBinding;
  if (isMap(binding) && isMap(binding.deviceNetboxIds)
    && Object.keys(binding.deviceNetboxIds).some((uid) => excluded.has(uid))) {
    out.recordBinding = { ...binding, deviceNetboxIds: without(binding.deviceNetboxIds) };
    if (isMap(binding.shown) && isMap(binding.shown.devices)) {
      out.recordBinding.shown = { ...binding.shown, devices: without(binding.shown.devices) };
    }
  }
  return out;
}

/**
 * What an approval signs: the fingerprint of the items that would be written.
 *
 * That is every actionable item a person approved, the ports that follow an
 * approved device, and the scaffolding, which goes with whatever needs it. A
 * rejected item is not in it, so rejecting one more item after an approval
 * changes the hash and the approval no longer stands.
 */
function payloadHash(items) {
  const approvedParents = new Set((items || [])
    .filter((i) => i.decidable && i.decision === 'approved').map((i) => i.uid));
  const written = (items || []).filter((i) => ACTIONABLE.has(i.action) && (
    (i.supporting && !i.decidable)
    || (i.decidable && i.decision === 'approved')
    || (i.following && approvedParents.has(i.parentUid))));
  return fingerprint(written);
}

/** How many items a person approved that a write would carry. */
const approvedCount = (items) => (items || [])
  .filter((i) => i.decidable && i.decision === 'approved' && ACTIONABLE.has(i.action)).length;

// -- The old shape ------------------------------------------------------
/**
 * The status the phone app and /api/nb know, from the status the workflow
 * holds. The app has four words and the workflow has twenty-two; everything
 * between handing a plan over and writing it is, to the app, "submitted".
 * The closed-without-a-write statuses pass through under their own names:
 * the app shows a word it does not know as it is, and "rejected" is truer
 * than pretending the plan is still with the admin.
 */
function legacyStatus(status) {
  if (status === 'draft') return 'open';
  if (status === 'written' || status === 'completed') return 'applied';
  if (status === 'write_failed') return 'write_failed';
  if (['rejected', 'cancelled', 'duplicate', 'known_exception'].includes(status)) return status;
  return 'submitted';
}

/** The workflow statuses an old status word stands for, for a list filter. */
function statusesForLegacy(word) {
  const ALL = require('./machine').STATUSES;
  const match = ALL.filter((s) => legacyStatus(s) === word);
  return match.length ? match : [word];
}

/** A ticket row as the old nested `item.ticket` object. */
function legacyTicket(planId, t) {
  if (!t) return null;
  const out = {
    id: `${planId}-${t.itemUid}`,
    assignee: t.assignee ?? null,
    assigneeId: t.assigneeId ?? null,
    assigneeEmail: t.assigneeEmail ?? null,
    raisedBy: t.raisedBy ?? null,
    raisedAt: t.raisedAt ?? null,
    // The app knows open, resolved and closed. Accepted, in progress and
    // pending are all "somebody has it", which is what open meant.
    status: isOpenTicket(t) ? 'open' : t.status,
    state: t.status,
    question: t.question ?? null,
    resolvedBy: t.resolvedBy ?? null,
    resolvedAt: t.resolvedAt ?? null,
    outcome: t.outcome ?? null,
    finding: t.finding ?? null,
  };
  if (t.external) out.external = t.external;
  if (t.spoc) out.spoc = t.spoc;
  if (t.scope) out.scope = t.scope;
  if (t.emailedAt) out.emailedAt = t.emailedAt;
  if (t.emailNote) out.emailNote = t.emailNote;
  if (t.closedAt || t.closedBy || t.closedWith) {
    out.closedBy = t.closedBy ?? null;
    out.closedAt = t.closedAt ?? null;
    out.closedWith = t.closedWith ?? null;
  }
  return out;
}

/** The reference a following port carries to its device's ticket. */
function legacySharedTicket(planId, parentUid, t) {
  if (!t) return null;
  return {
    sharedWith: parentUid,
    id: `${planId}-${parentUid}`,
    assignee: t.assignee ?? null,
    assigneeId: t.assigneeId ?? null,
    assigneeEmail: t.assigneeEmail ?? null,
    raisedBy: t.raisedBy ?? null,
    raisedAt: t.raisedAt ?? null,
    status: isOpenTicket(t) ? 'open' : t.status,
    external: t.external ?? null,
  };
}

/** The old event line, from an approval_events row. */
const legacyEvent = (e) => ({
  at: e.ts,
  by: e.actorName ?? null,
  what: (e.payload && e.payload.what) || e.action,
  detail: (e.payload && e.payload.detail) ?? null,
});

/**
 * A whole plan in the shape the JSON files had: items with their ticket
 * nested, the old status words, the old event lines. `full` is what
 * service.get() returns.
 */
function legacyPlan(full) {
  if (!full || !full.plan) return null;
  const { plan } = full;
  const tickets = new Map((full.tickets || []).map((t) => [t.itemUid, t]));
  const items = (full.items || []).map((row) => {
    // Everything the row carries goes through, the pass-through fields
    // included (fromUid, a future binding); only the table's own keys stay home.
    const { id: _id, planId: _planId, decidedById: _decidedById, extra: _extra, ...i } = row;
    return {
      ...i,
      netboxId: i.netboxId ?? null, diff: i.diff ?? null, reason: i.reason ?? null,
      parentUid: i.parentUid ?? null,
      // The files spelled it with a space, and only ever on a row nobody is
      // asked about. A decidable item verification set aside keeps the new word.
      decision: i.decision === 'not_applicable' && !i.decidable && !i.following ? 'not applicable' : i.decision,
      decidedBy: i.decidedBy ?? null, decidedAt: i.decidedAt ?? null, note: i.note ?? null,
      ticket: i.following
        ? legacySharedTicket(plan.id, i.parentUid, tickets.get(i.parentUid))
        : legacyTicket(plan.id, tickets.get(i.uid)),
    };
  });
  const status = legacyStatus(plan.status);
  const out = {
    id: plan.id,
    scanId: plan.scanId ?? null,
    rackId: plan.rackId ?? null,
    orgId: plan.orgId ?? null,
    tenantId: plan.tenantId ?? null,
    rackUid: plan.rackUid ?? null,
    netboxUrl: plan.netboxUrl ?? null,
    createdAt: plan.createdAt,
    createdBy: plan.createdBy ?? null,
    fingerprint: plan.fingerprint,
    status,
    // The workflow's own word, for a screen that knows it.
    state: plan.status,
    priority: plan.priority,
    risk: plan.risk,
    version: plan.version,
    counts: plan.counts || {},
    warnings: plan.warnings || [],
    orphans: plan.orphans || [],
    customField: plan.customField ?? null,
    items,
    events: (full.events || []).map(legacyEvent),
  };
  if (plan.submittedAt) {
    out.submittedAt = plan.submittedAt;
    out.submittedBy = plan.submittedBy ?? null;
    out.submittedNote = plan.submittedNote ?? null;
  }
  if (plan.result) {
    const { at, by, ...result } = plan.result;
    out.result = result;
    out.lastWriteAt = at ?? plan.writtenAt ?? null;
    out.lastWriteBy = by ?? plan.writtenBy ?? null;
  }
  if (status === 'applied') {
    out.appliedAt = plan.writtenAt ?? null;
    out.appliedBy = plan.writtenBy ?? null;
  }
  return out;
}

/** The old index row a plan list hands back. */
function legacyIndexRow(plan, items, tickets) {
  return {
    id: plan.id, scanId: plan.scanId ?? null, rackId: plan.rackId ?? null,
    createdAt: plan.createdAt, createdBy: plan.createdBy ?? null,
    status: legacyStatus(plan.status), state: plan.status,
    fingerprint: plan.fingerprint,
    orgId: plan.orgId ?? null, tenantId: plan.tenantId ?? null,
    submittedBy: plan.submittedBy ?? null, submittedAt: plan.submittedAt ?? null,
    summary: summarise(items, plan.result, tickets),
  };
}

module.exports = {
  SUPPORTING, ACTIONABLE, OPEN_TICKET,
  stable, fingerprint, parentUidOf, toItem, childrenOf, isOpenTicket,
  summarise, isSettled, excludedUids, filterSnapshot, payloadHash, approvedCount,
  legacyStatus, statusesForLegacy, legacyTicket, legacySharedTicket, legacyEvent,
  legacyPlan, legacyIndexRow,
};
