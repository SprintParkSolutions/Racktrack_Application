/**
 * The one ServiceNow incident of a check.
 *
 * A check that goes to the SPOC of its Site has one incident, raised when it
 * is sent, in the SPOC's name, with the drift report and the photograph of the
 * rack attached. RackTrack then moves that incident as its own check moves:
 * approved and written, rejected, sent back, cancelled, given to somebody
 * else. lib/netbox/tickets.js is the calls; this file is when they are made
 * and what is written down about them.
 *
 * Four rules the shape of this file exists to enforce.
 *
 *   THE CHECK NEVER WAITS ON SERVICENOW. Everything here runs after the change
 *   it follows has committed, never throws, and records a failure as a value on
 *   plan.incident. What failed is kept under `pending` and the poller tries it
 *   again; after eight tries the admins are told once and it is left alone.
 *
 *   ONE WRITER. plan.incident is written by stamp() and by nothing else in this
 *   file. It reads the plan again every time, because a raise, an upload and a
 *   poll can all be half way through their network calls at once, and it
 *   copies the pointer onto every ticket of the plan, which is where the phone
 *   builds already in the field and the Tickets page look for the number.
 *
 *   ONCE. A raise, an outcome and an upload each run one at a time per check:
 *   a second caller is handed the first one's promise. An outcome is pushed
 *   once per move of the check, keyed on the event that made the move.
 *
 *   SERVICENOW DECIDES NOTHING. An incident somebody closes over there is
 *   flagged on the check and the admins and the holder are told. It never
 *   moves the check, decides an item or starts a write.
 *
 * No ServiceNow configured is not a failure: the incident is { system: 'none' }
 * and the whole flow carries on inside RackTrack.
 */
const fs = require('node:fs');
const path = require('node:path');

const store = require('./store');
const machine = require('./machine');
const bus = require('./bus');
const tickets = require('../netbox/tickets');

const norm = (v) => String(v ?? '').trim();
// A reason as somebody typed it, ready to sit inside a sentence of ours.
const bare = (v) => norm(v).replace(/[.\s]+$/, '');
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** The states a person may leave the incident in, by the word the routes take. */
const STATES = {
  in_progress: { code: 2, label: 'In Progress' },
  on_hold: { code: 3, label: 'On Hold' },
  resolved: { code: 6, label: 'Resolved' },
  closed: { code: 7, label: 'Closed' },
  cancelled: { code: 8, label: 'Cancelled' },
};
/** What each decision leaves the incident as, unless the person deciding says otherwise. */
const DEFAULTS = { approve: 'resolved', reject: 'cancelled', rework: 'on_hold', cancel: 'cancelled' };
const NO_SERVICENOW = { system: 'none',
  why: 'No ServiceNow is configured, so this check lives only in RackTrack.' };

const CLOSING = ['resolved', 'closed', 'cancelled'];
const MAX_TRIES = 8;
// How long a request waits for ServiceNow before it answers without it. The
// call itself carries on and lands on the plan when it lands.
const PUSH_WAIT_MS = 10000;

const REASON_WORDS = {
  insufficient_evidence: 'not enough evidence', incorrect_remediation: 'the wrong fix',
  configuration_still_differs: 'it still differs', wrong_spoc: 'not the right person',
  wrong_asset: 'the wrong device', change_not_authorized: 'not authorised', duplicate: 'a duplicate',
  known_exception: 'a known exception', maintenance_window_required: 'needs a maintenance window',
  other: 'another reason',
};

// -- What a test hands in -------------------------------------------------
let _deps = {};

/**
 * Tests: { serviceNowFor(who) -> cfg | null, fetchImpl, rawFetchImpl }. The
 * two senders are what lib/netbox/tickets.js takes as its last argument, for
 * the Table API and for an upload. Nothing restores the real ones.
 */
function _setDeps(deps) { _deps = deps || {}; }

const sender = (fetchImpl) => fetchImpl || _deps.fetchImpl || undefined;
const rawSender = (fetchImpl) => fetchImpl || _deps.rawFetchImpl || _deps.fetchImpl || undefined;

/** The ServiceNow of the check's organization, or null. */
function cfgFor(plan) {
  const who = { orgId: plan.orgId ?? null, userId: plan.submittedById ?? plan.createdById ?? null };
  try {
    if (_deps.serviceNowFor) return _deps.serviceNowFor(who) || null;
    // A test never reaches an instance: it hands its own in, above.
    if (store.isolated() || process.env.NODE_ENV === 'test') return null;
    return require('./connections').serviceNowFor(who);
  } catch { return null; }
}

/** `promise`, or `late: true` once `ms` has passed. The promise carries on either way. */
function within(promise, ms) {
  let timer;
  const late = new Promise((resolve) => { timer = setTimeout(() => resolve({ late: true, value: null }), ms); });
  const done = Promise.resolve(promise).then((value) => ({ late: false, value }),
    () => ({ late: false, value: null }));
  return Promise.race([done, late]).finally(() => clearTimeout(timer));
}

/** One run per check at a time: a second caller gets the first one's promise. */
function once(flights, planId, fn) {
  const key = Number(planId);
  if (flights.has(key)) return flights.get(key);
  const flight = Promise.resolve().then(fn).catch(() => null).finally(() => flights.delete(key));
  flights.set(key, flight);
  return flight;
}

// -- The one writer ---------------------------------------------------------
const pointerOf = (inc) => (inc.system === 'none'
  ? { system: 'none', why: inc.why || NO_SERVICENOW.why, planLevel: true }
  : { system: inc.system, number: inc.number ?? null, sysId: inc.sysId ?? null, url: inc.url ?? null,
      state: inc.state ?? null, error: inc.error ?? null, planLevel: true });

/**
 * Change plan.incident, and copy the pointer onto every ticket of the plan.
 *
 * Sync. `patch` is merged into the incident as it is NOW, read here and not
 * by the caller; a function is called with that incident and answers the
 * patch, which is the only safe way to change `attachments` or `pending`.
 * An empty patch only copies the pointer again, for tickets made since.
 *
 * A check filed before this had an incident per ticket. Such a ticket keeps
 * its own under `previous`, so the number does not vanish from RackTrack.
 */
function stamp(planId, patch = {}) {
  return store.tx(() => {
    const plan = store.getPlan(planId, { heavy: false });
    if (!plan) return null;
    const was = plan.incident || null;
    const change = typeof patch === 'function' ? patch(was || {}) : patch;
    const next = { ...(was || {}), ...(change || {}) };
    for (const key of Object.keys(next)) if (next[key] === undefined) delete next[key];
    if (!next.system) return was;
    if (JSON.stringify(next) !== JSON.stringify(was)) store.updatePlan(plan.id, { incident: next });
    const pointer = pointerOf(next);
    for (const t of store.ticketsOf(plan.id)) {
      // A ticket made afresh for a new holder starts with no pointer at all;
      // what the one before it carried is in its history.
      const ext = t.external || ((t.history || []).slice(-1)[0] || {}).external || null;
      const own = ext && ext.sysId && !ext.planLevel && ext.sysId !== pointer.sysId
        ? { number: ext.number ?? null, sysId: ext.sysId, url: ext.url ?? null, state: ext.state ?? null }
        : (ext && ext.previous) || null;
      const external = own ? { ...pointer, previous: own } : pointer;
      if (JSON.stringify(external) === JSON.stringify(t.external)) continue;
      store.updateTicket(plan.id, t.itemUid, { external }, { touch: false });
    }
    return next;
  });
}

// What is still owed to ServiceNow, one row per kind of call.
const opOf = (inc, op) => ((inc && inc.pending) || []).find((p) => p.op === op) || null;
const without = (inc, op) => ((inc && inc.pending) || []).filter((p) => p.op !== op);
const failedOp = (inc, op, error, fields = {}) => {
  const was = opOf(inc, op);
  const tries = ((was && was.tries) || 0) + 1;
  return [...without(inc, op), { op, fields, tries, lastError: norm(error) || 'no reason given',
    at: store.nowIso(), ...(tries >= MAX_TRIES ? { gaveUp: true } : {}) }];
};

// -- Naming the rack, and telling people ------------------------------------
const PHOTO_HASH = /^RK-[0-9A-F]{6,}$/i;

/**
 * The rack, the Site and the room as a person names them. A check filed before
 * its rack was identified carries the hash of its photograph as a name; the
 * rack is known by now, so it is called by the id on its tape, exactly as the
 * drift report route does.
 */
function contextFor(plan) {
  let rackName = plan.rackName && !PHOTO_HASH.test(plan.rackName) ? plan.rackName : null;
  let siteName = null;
  let spaceName = null;
  try {
    if (plan.tenantId != null && !store.isolated()) {
      const estate = require('../estate');
      const site = estate.getTenant(plan.tenantId);
      siteName = site ? site.name : null;
      const known = estate.getRackByRackId(plan.tenantId, plan.rackId);
      const space = known && known.space_id != null ? estate.getSpace(known.space_id) : null;
      spaceName = space ? space.name : null;
      if (!rackName && known) rackName = known.facility_id || known.name || null;
      // And the other way a rack is known: a person confirmed which rack this
      // photograph is, which binds it in rack_identity rather than filing a
      // row under the scan's own id. Everything the app shows reads that
      // binding, so an incident and a report must too.
      if (!rackName) {
        const bound = require('../rack_identity').confirmedRack(plan.tenantId, plan.rackId);
        if (bound && bound.rack) {
          rackName = bound.rack.facility_id || bound.rack.name || null;
          if (!spaceName && bound.rack.space_id != null) {
            const boundSpace = estate.getSpace(bound.rack.space_id);
            spaceName = boundSpace ? boundSpace.name : null;
          }
        }
      }
    }
  } catch { /* the incident still stands without them */ }
  if (!siteName && plan.tenantId != null) siteName = (store.tenantById(plan.tenantId) || {}).name || null;
  return { rackName, siteName, spaceName };
}

const holderOf = (plan) => (plan && plan.spoc && plan.spoc.userId != null
  ? { userId: plan.spoc.userId, username: plan.spoc.username ?? null, email: plan.spoc.email ?? null }
  : null);

/** Tell the admins the incident needs a look. Whoever calls this makes sure it is said once. */
function tell(planId, problem, more = {}) {
  try {
    const plan = store.getPlan(planId, { heavy: false });
    if (!plan) return;
    const { rackName, siteName } = contextFor(plan);
    bus.emit('incident_failed', { plan, problem, incident: plan.incident || null, holder: holderOf(plan),
      rackName, siteName, actor: machine.SYSTEM, ...more });
  } catch { /* a notice that cannot be sent changes nothing on the check */ }
}

// -- Raising it -------------------------------------------------------------
const raising = new Map();

/** The items that were sent, as the incident lists them. */
const sentItems = (planId) => store.itemsOf(planId)
  .filter((i) => i.decidable && !i.following && i.decision !== 'not_applicable');

function senderOf(plan) {
  const user = (plan.submittedById != null ? store.userById(plan.submittedById) : null)
    || (plan.submittedBy ? store.userByUsername(plan.submittedBy) : null);
  return { username: (user && user.username) || plan.submittedBy || null, email: (user && user.email) || null };
}

/**
 * Raise the incident of a held check that has none, and stamp it.
 *
 * Async and never throws. Answers plan.incident as it now stands: the incident,
 * { system: 'none' } with no ServiceNow, or the failure with a `raise` owed
 * under `pending`. A check that already has its incident is answered with it;
 * `again` tries a raise that failed before, which is what the poller and an
 * admin's reassign ask for. Two calls at once for one check share one raise,
 * so a send that is tapped twice cannot raise two incidents.
 */
function raiseFor(planId, { fetchImpl, again = false } = {}) {
  return once(raising, planId, () => raise(planId, { fetchImpl, again }));
}

async function raise(planId, { fetchImpl, again }) {
  const plan = store.getPlan(planId, { heavy: false });
  if (!plan) return null;
  const had = plan.incident;
  if (had && had.sysId) return had;
  if (had && !again && (had.system === 'none' || had.error)) return had;
  const holder = holderOf(plan);
  if (!holder) return had || null;

  const cfg = cfgFor(plan);
  if (!cfg) return stamp(plan.id, { ...NO_SERVICENOW, state: undefined, pending: undefined, error: undefined });

  // Said before the first call goes out, so a server that stops half way
  // leaves a raise owed rather than a check with no incident and no retry.
  stamp(plan.id, (inc) => ({ system: 'servicenow', why: undefined, number: null, sysId: null, url: null,
    state: 'raising', raisedFor: holder, error: null, detail: null,
    pending: opOf(inc, 'raise') ? inc.pending : [...without(inc, 'raise'),
      { op: 'raise', fields: {}, tries: 0, lastError: null, at: store.nowIso() }] }));

  const { rackName, siteName } = contextFor(plan);
  const r = await tickets.raiseCheck(cfg, { plan, items: sentItems(plan.id), rackName, siteName, holder,
    sender: senderOf(plan), note: plan.submittedNote || null }, sender(fetchImpl));

  if (!r.ok) {
    let first = false;
    const inc = stamp(plan.id, (now) => {
      first = !((opOf(now, 'raise') || {}).tries > 0);
      return { state: null, error: r.error || 'ServiceNow did not answer', detail: r.detail ?? null,
        pending: failedOp(now, 'raise', r.error) };
    });
    const op = opOf(inc, 'raise');
    if (first) tell(plan.id, 'raise_failed', { error: r.error });
    else if (op && op.gaveUp) tell(plan.id, 'push_failed', { op: 'raise', error: r.error, tries: op.tries });
    return inc;
  }

  stamp(plan.id, (now) => ({ system: 'servicenow', number: r.number ?? null, sysId: r.sysId ?? null,
    url: r.url ?? null, state: r.state || 'new', raisedAt: store.nowIso(), raisedFor: holder,
    assigned: Boolean(r.assigned), assignedTo: r.assignedTo || null, assignWarning: r.assignWarning || null,
    error: null, detail: null, attachments: now.attachments || [], pending: without(now, 'raise'),
    closedInServiceNow: null }));
  if (!r.assigned) tell(plan.id, 'unassigned', { assignWarning: r.assignWarning });

  // The drift report and the photograph follow on their own; nobody waits.
  attachEvidence(plan.id, { fetchImpl });

  // The check may have moved on while ServiceNow was being slow.
  const fresh = store.getPlan(plan.id, { heavy: false });
  const now = holderOf(fresh);
  if (now && Number(now.userId) !== Number(holder.userId)) {
    await reassign(plan.id, now, { by: (fresh.spoc && fresh.spoc.assignedBy) || null,
      reason: (fresh.spoc && fresh.spoc.reason) || null, fetchImpl });
  }
  if (outcomeFor(fresh)) await pushOutcome(plan.id, { fetchImpl });
  return store.getPlan(plan.id, { heavy: false }).incident;
}

// -- The drift report and the photograph ------------------------------------
const attaching = new Map();
const PHOTO_TYPES = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png' };

/** The photograph the check was made from: the scan's own file, else the rack's output folder. */
function photoOf(plan) {
  const found = [];
  try {
    const scan = plan.scanId != null ? require('../netbox/store').getScan(plan.scanId) : null;
    if (scan && scan.imagePath) found.push(path.resolve(scan.imagePath));
  } catch { /* no scan on record: the folder is asked next */ }
  // The same folder every scan route writes a rack's photograph into.
  const outputs = process.env.RT_OUTPUTS_DIR || path.resolve(__dirname, '..', '..', '..', 'outputs');
  if (plan.rackId && !/[\\/]|\.\./.test(String(plan.rackId))) {
    for (const ext of Object.keys(PHOTO_TYPES)) found.push(path.join(outputs, String(plan.rackId), `original_image.${ext}`));
  }
  const file = found.find((f) => { try { return fs.statSync(f).isFile(); } catch { return false; } });
  if (!file) return null;
  const ext = path.extname(file).slice(1).toLowerCase();
  return { file, ext: PHOTO_TYPES[ext] ? ext : 'jpg', contentType: PHOTO_TYPES[ext] || 'image/jpeg' };
}

/** The drift report of the check, as the page the report route serves, built with no request. */
function reportOf(plan, inc) {
  // Required here, not at the top: lib/netbox/plans.js loads service.js.
  const legacy = require('../netbox/plans').get(plan.id);
  const { rackName, siteName, spaceName } = contextFor(plan);
  const held = store.ticketsOf(plan.id);
  // A check with nothing to ticket still has its incident, and the report says so.
  const carried = held.some((t) => t.external && t.external.planLevel && t.external.number);
  const rows = carried || !inc.number ? held : [...held, { itemUid: null, external: pointerOf(inc) }];
  return require('../netbox/drift_report').build({ ...legacy, rackName: rackName || legacy.rackName },
    { tickets: rows, siteName, spaceName });
}

/**
 * Put the drift report and the photograph of the rack on the incident.
 *
 * Runs after the answer to the send has gone. Each file is recorded under
 * `attachments` with the id ServiceNow gave it or the reason it did not go; a
 * file that is already there is never sent twice, so a retry uploads only what
 * is missing. A rack with no photograph on disk has nothing to attach, and
 * that is not an error.
 */
function attachEvidence(planId, { fetchImpl } = {}) {
  return once(attaching, planId, () => attach(planId, { fetchImpl }));
}

async function attach(planId, { fetchImpl }) {
  const plan = store.getPlan(planId, { heavy: false });
  const inc = plan && plan.incident;
  if (!inc || !inc.sysId) return inc || null;
  const cfg = cfgFor(plan);
  if (!cfg) return inc;

  const there = new Set((inc.attachments || []).filter((a) => a.sysId).map((a) => a.kind));
  const record = (row) => stamp(plan.id, (now) => ({
    attachments: [...(now.attachments || []).filter((a) => a.kind !== row.kind), { ...row, at: store.nowIso() }] }));
  const problems = [];

  const files = [];
  if (!there.has('report')) {
    const name = `drift-report-check-${plan.id}.html`;
    try {
      files.push({ kind: 'report', what: 'the drift report', fileName: name,
        contentType: 'text/html; charset=utf-8', body: Buffer.from(reportOf(plan, inc), 'utf8') });
    } catch {
      record({ kind: 'report', name, sysId: null, error: 'The drift report could not be built.' });
      problems.push({ what: 'the drift report', error: 'it could not be built' });
    }
  }
  const photo = there.has('photo') ? null : photoOf(plan);
  if (photo) {
    const name = `rack-photo-check-${plan.id}.${photo.ext}`;
    try {
      files.push({ kind: 'photo', what: 'the photo of the rack', fileName: name,
        contentType: photo.contentType, body: fs.readFileSync(photo.file) });
    } catch {
      record({ kind: 'photo', name, sysId: null, error: 'The photo of the rack could not be read.' });
      problems.push({ what: 'the photo of the rack', error: 'it could not be read' });
    }
  }

  for (const f of files) {
    const r = await tickets.attach(cfg, inc.sysId, f, rawSender(fetchImpl));
    record({ kind: f.kind, name: f.fileName, sysId: r.ok ? r.sysId || f.fileName : null, error: r.ok ? null : r.error });
    if (!r.ok) problems.push({ what: f.what, error: r.error });
  }

  if (!problems.length) return stamp(plan.id, (now) => ({ pending: without(now, 'attach') }));
  let first = false;
  const out = stamp(plan.id, (now) => {
    first = !opOf(now, 'attach');
    return { pending: failedOp(now, 'attach', problems[0].error) };
  });
  if (first) tell(plan.id, 'attachment_failed', problems[0]);
  return out;
}

// -- Notes, and a new holder --------------------------------------------------
/** A work note on the check's incident. Said twice within a minute, it is written once. */
async function note(planId, text, { fetchImpl } = {}) {
  const plan = store.getPlan(planId, { heavy: false });
  const inc = plan && plan.incident;
  const said = norm(text);
  if (!inc || !inc.sysId || !said) return { ok: false, error: 'There is no incident to note it on.' };
  const last = inc.lastNote;
  if (last && last.text === said && Date.now() - Date.parse(last.at) < 60000) return { ok: true, already: true };
  const cfg = cfgFor(plan);
  if (!cfg) return { ok: false, error: NO_SERVICENOW.why };
  stamp(plan.id, { lastNote: { text: said, at: store.nowIso() } });
  const r = await tickets.workNote(cfg, inc.sysId, said, sender(fetchImpl));
  return { ok: r.ok, error: r.ok ? null : r.error };
}

/**
 * The check has gone to somebody else, so its incident follows: the new
 * holder's ServiceNow user becomes the assignee, with a work note saying who
 * moved it and why. An incident that was already closed is put back In
 * Progress, because a closed one is nobody's to work. With no ServiceNow user
 * behind the new holder the assignee is cleared, not left with the old one,
 * and the admins are warned as they are at a raise.
 *
 * Always ends in stamp(), so the fresh tickets of the new holder carry the
 * incident whatever ServiceNow said.
 */
async function reassign(planId, holder, { by = null, reason = null, fetchImpl } = {}) {
  try {
    const plan = store.getPlan(planId, { heavy: false });
    const inc = plan && plan.incident;
    if (!inc || !inc.sysId || !holder) return stamp(planId, {});
    const cfg = cfgFor(plan);
    if (!cfg) return stamp(planId, {});

    const f = sender(fetchImpl);
    const before = (inc.raisedFor && inc.raisedFor.username) || 'nobody';
    const email = norm(holder.email).toLowerCase();
    const found = await tickets.findUsers(cfg, [email], f);
    const users = (found.ok && found.byEmail[email]) || [];
    const user = users.length === 1 ? users[0] : null;
    const nobody = 'so the incident is not assigned to anybody.';
    const warning = user ? null
      : !email ? `${holder.username || 'The new holder'} has no email address in RackTrack, ${nobody}`
        : !found.ok ? `RackTrack could not look ${holder.username || 'the new holder'} up in ServiceNow (${found.error}), ${nobody}`
          : `${users.length ? 'More than one' : 'No'} ServiceNow user has the email ${email}, ${nobody}`;
    const said = `Reassigned${by ? ` by ${by}` : ''} in RackTrack from ${before} to ${holder.username || email}`
      + `${norm(reason) ? `: ${norm(reason)}` : '.'}`;
    const closed = CLOSING.includes(inc.state);
    const r = user
      ? await tickets.reassign(cfg, inc.sysId, user.sysId, { note: said, reopen: closed }, f)
      : await tickets.update(cfg, inc.sysId, { assigned_to: '', work_notes: `${said}\n${warning}`,
        ...(closed ? { state: STATES.in_progress.code } : {}) }, f);

    if (r.ok) {
      const warnedBefore = inc.assignWarning;
      const out = stamp(planId, (now) => ({ raisedFor: holder, assigned: Boolean(user), assignedTo: user || null,
        assignWarning: warning, state: r.state && r.state !== 'unknown' ? r.state : now.state,
        // Open again, so whatever was pushed before no longer describes it.
        ...(closed ? { pushedState: null, pushedFor: null, closedInServiceNow: null } : {}),
        pending: without(now, 'reassign') }));
      if (warning && warning !== warnedBefore) tell(planId, 'unassigned', { assignWarning: warning });
      return out;
    }

    // A closed incident the integration user may not write to is not going to
    // open on the ninth try either: it is said once and left.
    const shut = closed && (r.status === 403 || r.status === 400);
    let first = false;
    const out = stamp(planId, (now) => {
      first = !opOf(now, 'reassign');
      const pending = failedOp(now, 'reassign', r.error, { by, reason });
      if (shut) pending[pending.length - 1].gaveUp = true;
      return { pending, ...(shut ? { assignWarning:
        `Incident ${inc.number || 'of this check'} is ${inc.state} in ServiceNow and could not be reopened.` } : {}) };
    });
    const op = opOf(out, 'reassign');
    if (first || (op && op.gaveUp && !shut)) {
      tell(planId, 'push_failed', { op: 'reassign', error: r.error, to: holder.username || email });
    }
    return out;
  } catch {
    return stamp(planId, {});
  }
}

// -- The outcome of the check, pushed to its incident -----------------------
const pushing = new Map();
const BOUNCED_FROM = ['approved', 'write_in_progress', 'write_failed', 'manual_review'];

/** The event that last changed the check's status: what an outcome is keyed on. */
function lastMove(planId) {
  const moves = store.eventsOf(planId).filter((e) => e.toStatus && e.fromStatus !== e.toStatus);
  return moves[moves.length - 1] || null;
}

const shown = (v) => (v == null || v === '' ? 'nothing' : typeof v === 'object' ? JSON.stringify(v) : String(v));
const OWN_FIELDS = new Set(['racktrack_uid', 'racktrack_bound', 'recordId']);

/** What was written, a line per field, from the change registry once it is there. */
function writtenLines(plan) {
  const rows = typeof store.changesOf === 'function' ? store.changesOf(plan.id) || [] : null;
  if (rows) {
    return rows.filter((c) => !c.internal && (c.result || 'written') === 'written')
      .map((c) => (c.field === '*' ? `${c.objectName ?? c.object_name}: added to NetBox`
        : `${c.objectName ?? c.object_name}: ${c.field} ${shown(c.before)} -> ${shown(c.after)}`));
  }
  const lines = [];
  for (const i of store.itemsOf(plan.id).filter((x) => x.decision === 'approved' && x.decidable)) {
    if (i.action === 'create') lines.push(`${i.name}: added to NetBox`);
    for (const [field, v] of Object.entries(i.diff || {})) {
      if (OWN_FIELDS.has(field)) continue;
      lines.push(`${i.name}: ${field} ${shown(v && v.from)} -> ${shown(v && v.to)}`);
    }
  }
  return lines;
}

/**
 * What the check's status asks of its incident: { key, kind, state, notes }, or
 * null when it asks nothing. `state` is null where the incident stays as it is
 * and only hears about it in a work note.
 */
function outcomeFor(plan) {
  if (!plan) return null;
  const move = lastMove(plan.id);
  const key = `${plan.status}:${move ? move.id : 0}`;
  const inc = plan.incident || {};
  const chosen = inc.chosenState && STATES[inc.chosenState.state] ? inc.chosenState.state : null;
  const who = (move && move.actorName) || 'somebody';
  const said = norm(move && move.payload && move.payload.comment);

  if (plan.status === 'completed') {
    const approval = store.decisionsOf(plan.id).filter((d) => d.decision === 'approved').pop();
    const lines = writtenLines(plan);
    const written = (plan.result && plan.result.written) || 0;
    const head = `Approved by ${(approval && approval.approver) || 'the SPOC'} in RackTrack check ${plan.id}.`;
    const notes = written || lines.length
      ? [`${head} Written to NetBox: ${plural(lines.length || written, 'change')}.`, ...lines.slice(0, 10),
        lines.length > 10 ? `And ${lines.length - 10} more, listed in the check.` : ''].filter(Boolean).join('\n')
      : `${head} Nothing needed to be written.`;
    return { key, kind: 'approve', state: chosen || DEFAULTS.approve, notes };
  }
  if (plan.status === 'rejected') {
    const why = move && move.reason ? ` (${REASON_WORDS[move.reason] || String(move.reason).replace(/_/g, ' ')})` : '';
    return { key, kind: 'reject', state: chosen || DEFAULTS.reject,
      notes: `Rejected by ${who} in RackTrack check ${plan.id}${why}${said ? `: ${said}` : '.'}` };
  }
  if (plan.status === 'rework') {
    return { key, kind: 'rework', state: chosen || DEFAULTS.rework,
      notes: `Sent back by ${who} in RackTrack check ${plan.id}${said ? `: ${said}` : '.'}` };
  }
  if (machine.TERMINAL.includes(plan.status)) {
    const reason = plan.status === 'duplicate'
      ? `it is the same as check ${plan.duplicateOf ?? 'another one'}`
      : plan.status === 'known_exception' ? 'it is covered by a known exception'
        : bare(plan.cancelReason) || bare(move && move.reason) || 'the check was cancelled';
    return { key, kind: 'cancel', state: DEFAULTS.cancel, notes: `Closed in RackTrack: ${reason}.` };
  }
  if (plan.status === 'write_failed') {
    const result = plan.result || {};
    const failures = (result.failures || []).slice(0, 10)
      .map((f) => `${f.name || f.type || 'An object'}: ${f.reason || 'no reason given'}`);
    const head = failures.length
      ? `Approved, but NetBox refused ${plural(result.failed || failures.length, 'object')}:`
      : `Approved, but the write to NetBox did not finish${bare(result.error) ? `: ${bare(result.error)}.` : '.'}`;
    return { key, kind: 'write_failed', state: null, notes: [head, ...failures,
      'This incident stays open. An organization admin can try the write again.'].join('\n') };
  }
  if (plan.status === 'reopened' && plan.reopenReason === 'write_mismatch') {
    return { key, kind: 'mismatch', state: null,
      notes: 'NetBox did not hold what was written. An admin is looking at it.' };
  }
  if (plan.status === 'assigned' && move && BOUNCED_FROM.includes(move.fromStatus)) {
    return { key, kind: 'bounced', state: null,
      notes: 'NetBox changed before the write, so nothing was written. The check is back with the SPOC.' };
  }
  return null;
}

// A refusal that is about the close code, which is the only one another code can cure.
const aboutCloseCode = (r) => (r.status === 400 || r.status === 403)
  && /close[_ ]code|resolution code|data policy/i.test(`${r.error} ${JSON.stringify(r.detail ?? '')}`);

/**
 * The close code to send, and the ones to try after it. From the instance's
 * own list when it shows one: what the admin stored, then for a check that
 * ended without a write the choice that says so, then the stock codes that
 * are true of a NetBox write, then whatever tickets.js would pick. With the
 * list refused, tickets.js's own ladder of stock codes.
 */
async function closeCodesFor(cfg, want, f) {
  const picked = await tickets.pickCloseCode(cfg, f);
  if (picked.source !== 'instance') return picked.candidates;
  const list = await tickets.choices(cfg, 'close_code', f);   // answered from its cache
  if (!list.ok || !list.choices.length) return picked.candidates;
  const named = (name) => list.choices.find((c) => c.value === name || c.label === name);
  const like = (re) => list.choices.find((c) => re.test(c.value) || re.test(c.label));
  const best = (want.kind !== 'approve' ? like(/no resolution|not solved|cancel/i) : null)
    || ['Solution provided', 'Solved (Permanently)', 'Resolved by change'].map(named).find(Boolean);
  return [best ? best.value : picked.value];
}

async function setOutcome(cfg, sysId, want, f) {
  if (!CLOSING.includes(want.state)) return tickets.setState(cfg, sysId, want.state, { notes: want.notes }, f);
  let out = null;
  for (const code of await closeCodesFor(cfg, want, f)) {
    // Some releases want the close fields on Cancelled too; they do no harm where they are not wanted.
    out = want.state === 'cancelled'
      ? await tickets.update(cfg, sysId, { state: STATES.cancelled.code, close_code: code,
        close_notes: want.notes, work_notes: want.notes }, f)
      : await tickets.setState(cfg, sysId, want.state, { notes: want.notes, closeCode: code }, f);
    if (out.ok || !aboutCloseCode(out)) break;
  }
  return out;
}

/**
 * Push what the check's status asks to its incident.
 *
 * Async, never throws, answers plan.incident. Idempotent per move of the
 * check: the bus listener and the route that wants the result in its answer
 * both call this, the second is handed the first one's promise, and a call
 * after it landed finds `pushedFor` equal and does nothing. A push ServiceNow
 * refuses is owed under `pending` and the poller tries it again.
 */
function pushOutcome(planId, { fetchImpl } = {}) {
  return once(pushing, planId, () => push(planId, { fetchImpl }));
}

async function push(planId, { fetchImpl }) {
  const plan = store.getPlan(planId, { heavy: false });
  const inc = plan && plan.incident;
  if (!inc || inc.system !== 'servicenow') return inc || null;
  const want = outcomeFor(plan);
  if (!want) return opOf(inc, 'state') ? stamp(plan.id, (now) => ({ pending: without(now, 'state') })) : inc;
  // No incident yet: the raise that is still owed pushes this when it lands.
  if (inc.pushedFor === want.key || !inc.sysId) return inc;
  const cfg = cfgFor(plan);
  if (!cfg) return inc;

  const f = sender(fetchImpl);
  const r = want.state ? await setOutcome(cfg, inc.sysId, want, f)
    : await tickets.workNote(cfg, inc.sysId, want.notes, f);

  if (!r.ok) {
    const out = stamp(plan.id, (now) => ({ pending: failedOp(now, 'state', r.error, { key: want.key, state: want.state }) }));
    const op = opOf(out, 'state');
    if (op && op.gaveUp) tell(plan.id, 'push_failed', { op: 'state', state: want.state, error: r.error });
    return out;
  }
  const out = stamp(plan.id, (now) => ({
    state: r.state && r.state !== 'unknown' ? r.state : (want.state ? tickets.STATE[STATES[want.state].code] : now.state),
    ...(want.state ? { pushedState: want.state } : {}),
    pushedAt: store.nowIso(), pushedFor: want.key, pending: without(now, 'state') }));

  // An older check had an incident per item. Once this one is closed, each of
  // those is told where the work went. Best effort, never tried again.
  if (CLOSING.includes(want.state)) {
    const old = new Map(store.ticketsOf(plan.id).map((t) => t.external && t.external.previous)
      .filter((p) => p && p.sysId).map((p) => [p.sysId, p]));
    for (const p of old.values()) {
      await tickets.workNote(cfg, p.sysId, `Continued under ${out.number || 'the incident of the whole check'}.`, f);
    }
  }
  return out;
}

/**
 * The incident as the answer to a decision carries it: { number, state, pushed,
 * error }, plus `pending: true` when ServiceNow had not answered in time and
 * the push is finishing on its own. Null for a check with no incident.
 *
 * `push` pushes the outcome now - reject, rework and cancel have nothing to
 * wait for. Without it only a push already under way is waited for, which is
 * the one the bus listener starts when a write finishes.
 */
async function answerFor(planId, { push: now = false, waitMs = null, fetchImpl } = {}) {
  const work = now ? pushOutcome(planId, { fetchImpl }) : pushing.get(Number(planId));
  const wait = waitMs || Number(process.env.RT_INCIDENT_PUSH_WAIT_MS) || PUSH_WAIT_MS;
  const waited = work ? await within(work, wait) : { late: false };
  const plan = store.getPlan(planId, { heavy: false });
  const inc = plan && plan.incident;
  if (!inc || inc.system === 'none') return null;
  const want = outcomeFor(plan);
  const owed = opOf(inc, 'state');
  return { number: inc.number || null, state: inc.state || null,
    pushed: Boolean(want ? inc.pushedFor === want.key : inc.pushedState),
    error: inc.error || (owed && owed.lastError) || null,
    ...(waited.late ? { pending: true } : {}) };
}

// -- The poller's half -------------------------------------------------------
/**
 * What ServiceNow now says about the check's incident. Sync.
 *
 * It refreshes the state. A closed state RackTrack did not push, on a check
 * that is still open, is somebody closing the incident over there: it is
 * flagged on the check (`closedInServiceNow`), written into its history, and
 * the admins and the holder are told, once. It NEVER moves the check, decides
 * an item or starts a write. A closure RackTrack pushed itself - or the
 * instance closing a Resolved incident on its own days later - is ours, and is
 * not read back as anything.
 */
function applyState(planId, heard) {
  const plan = store.getPlan(planId, { heavy: false });
  const inc = plan && plan.incident;
  if (!inc || !inc.sysId || !heard || !heard.state) return { changed: false, closedOutside: false };
  const ours = CLOSING.includes(inc.pushedState);
  const outside = Boolean(heard.closed) && !ours && machine.OPEN.includes(plan.status);
  const flagged = Boolean(inc.closedInServiceNow);
  if (heard.state === inc.state && outside === flagged) return { changed: false, closedOutside: false };

  store.tx(() => {
    stamp(plan.id, { state: heard.state, number: heard.number || inc.number,
      closedInServiceNow: outside
        ? inc.closedInServiceNow || { state: heard.state, at: store.nowIso(), notes: heard.notes || null }
        : null });
    if (outside && !flagged) {
      store.addEvent(plan.id, { itemUid: null, action: 'servicenow.closed_outside', actorId: null,
        actorName: 'ServiceNow', fromStatus: plan.status, toStatus: plan.status, reason: heard.state,
        payload: { what: 'the incident was closed in ServiceNow', detail: { number: inc.number || null,
          state: heard.state, notes: heard.notes || null } } });
    }
  });
  if (outside && !flagged) tell(plan.id, 'closed_outside', { state: heard.state });
  return { changed: true, closedOutside: outside && !flagged };
}

/**
 * Every call still owed to ServiceNow, tried again: a raise, an outcome, an
 * upload, a new assignee. Each failure counts; at eight the admins are told
 * and the call is left alone.
 */
async function retryPending({ fetchImpl } = {}) {
  let retried = 0;
  for (const id of waiting().owed) {
    const plan = store.getPlan(id, { heavy: false });
    const owed = ((plan && plan.incident && plan.incident.pending) || []).filter((p) => !p.gaveUp);
    for (const op of owed) {
      retried += 1;
      try {
        if (op.op === 'raise') {
          // A check that ended, or lost its holder, no longer needs one raised.
          if (holderOf(plan) && machine.OPEN.includes(plan.status)) await raiseFor(id, { fetchImpl, again: true });
          else stamp(id, (now) => ({ pending: without(now, 'raise') }));
        } else if (op.op === 'state') await pushOutcome(id, { fetchImpl });
        else if (op.op === 'attach') await attachEvidence(id, { fetchImpl });
        else if (op.op === 'reassign' && holderOf(plan)) {
          await reassign(id, holderOf(plan), { ...(op.fields || {}), fetchImpl });
        }
      } catch { /* the next pass tries it again */ }
    }
  }
  return { retried };
}

/** The checks the poller has something to ask or to retry for. */
function waiting() {
  const open = machine.OPEN.map((s) => `'${s}'`).join(', ');
  const rows = store.db().prepare(`
    SELECT id, org_id AS orgId, status,
      json_extract(incident, '$.sysId') AS sysId,
      COALESCE(json_array_length(json_extract(incident, '$.pending')), 0) AS owed
    FROM approval_plans
    WHERE incident IS NOT NULL AND json_extract(incident, '$.system') = 'servicenow'
      AND ((json_extract(incident, '$.sysId') IS NOT NULL AND status IN (${open}))
        OR COALESCE(json_array_length(json_extract(incident, '$.pending')), 0) > 0)
  `).all();
  return { polled: rows.filter((r) => r.sysId && machine.OPEN.includes(r.status)),
    owed: rows.filter((r) => r.owed > 0).map((r) => r.id) };
}

/** One pass of the poller over the checks that have an incident: hear, then retry. */
async function sync({ fetchImpl } = {}) {
  const byOrg = new Map();
  for (const row of waiting().polled) {
    const group = byOrg.get(row.orgId) || [];
    group.push(row);
    byOrg.set(row.orgId, group);
  }
  let asked = 0;
  let changed = 0;
  for (const group of byOrg.values()) {
    const cfg = cfgFor(store.getPlan(group[0].id, { heavy: false }));
    if (!cfg) continue;
    asked += group.length;
    const r = await tickets.statusOf(cfg, group.map((g) => g.sysId), sender(fetchImpl));
    if (!r || !r.ok) continue;
    for (const row of group) {
      try { if (applyState(row.id, r.states[row.sysId]).changed) changed += 1; } catch { /* next check */ }
    }
  }
  const { retried } = await retryPending({ fetchImpl });
  return { asked, changed, retried };
}

// -- Listening ---------------------------------------------------------------
let _listening = false;

/**
 * Follow the checks: when one reaches a status the outcome table knows, push
 * it. This is how an approval reaches the incident - the write finishes some
 * time after the approve request, and `completed` or `write_failed` is heard
 * here. A check with no ServiceNow incident is left at once, before any
 * network. Idempotent.
 */
function subscribe() {
  if (_listening) return;
  _listening = true;
  bus.on('transition', (heard) => {
    const id = heard && heard.plan && heard.plan.id;
    if (id == null) return null;
    const plan = store.getPlan(id, { heavy: false });
    if (!plan || !plan.incident || plan.incident.system !== 'servicenow' || !outcomeFor(plan)) return null;
    return pushOutcome(id);
  });
  // An approval whose write could not even begin changes no status, so it is
  // heard by name.
  bus.on('write_failed', (heard) => {
    if (!heard || !heard.notStarted || !heard.plan) return null;
    return note(heard.plan.id, `Approved, but the write to NetBox could not start: ${bare(heard.error) || 'no reason given'}. `
      + 'An organization admin can start it again.');
  });
}

/**
 * A ticket an admin raises by hand on a check, and gives to somebody.
 *
 * Not the check's own incident: that one is raised when the drift is sent and
 * carries every difference. This is an admin saying "somebody go and look at
 * this", with their own words, to a person they choose - a technician or the
 * site's SPOC. It is recorded on the plan as a ticket so the drift page shows
 * it, and the person is told (the owner, 23 September 2026).
 *
 * Returns { ok, ticket } or { ok: false, error } - and never throws, because
 * the screen that called it has to say what happened.
 */
async function raiseTaskFor(plan, { assignee, summary, note, raisedBy }, { fetchImpl } = {}) {
  if (!plan || !plan.id) return { ok: false, error: 'There is no check to raise a ticket on.' };
  if (!assignee || (!assignee.email && assignee.userId == null)) {
    return { ok: false, error: 'Choose who the ticket goes to.' };
  }
  const cfg = cfgFor(plan);
  if (!cfg) return { ok: false, error: 'This organization has no ServiceNow connection.' };

  const { rackName, siteName } = contextFor(plan);
  // One key per ticket on this check, so two tickets are two incidents.
  const already = store.ticketsOf(plan.id).filter((t) => String(t.uid || '').startsWith('task:')).length;
  const key = `${plan.id}-${already + 1}`;
  const r = await tickets.raiseTask(cfg, {
    summary, note, rackName, siteName, planId: plan.id, raisedBy,
    appUrl: tickets.appUrlFor(plan.id), key,
    assignee: { email: assignee.email || null, username: assignee.username || assignee.name || null,
      name: assignee.name || assignee.username || null, userId: assignee.userId ?? null },
  }, sender(fetchImpl));

  if (!r.ok) return { ok: false, error: r.error || 'ServiceNow did not take the ticket.' };

  const uid = `task:${r.number || key}`;
  store.putTicket(plan.id, uid, {
    system: 'servicenow', number: r.number || null, url: r.url || null, sysId: r.sysId || null,
    status: 'open', kind: 'task', summary: summary || null, note: note || null,
    assignee: assignee.username || assignee.name || null,
    assigneeEmail: assignee.email || null, assigneeUserId: assignee.userId ?? null,
    raisedBy: raisedBy || null, raisedAt: store.nowIso(),
  });
  bus.emit('task_raised', { plan, ticketUid: uid, assignee, summary: summary || null,
    number: r.number || null, url: r.url || null, raisedBy: raisedBy || null });
  return { ok: true, ticket: { uid, number: r.number || null, url: r.url || null,
    assigned: Boolean(r.assigned), assignWarning: r.assignWarning || null } };
}

module.exports = {
  STATES, DEFAULTS, NO_SERVICENOW, MAX_TRIES,
  raiseFor, stamp, attachEvidence, note, reassign, pushOutcome, answerFor, outcomeFor,
  applyState, retryPending, sync, subscribe, contextFor, within, raiseTaskFor,
  _setDeps,
};
