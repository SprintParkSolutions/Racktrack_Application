/**
 * The controlled write: the only path from an approval to a change in NetBox.
 *
 * Four things are true before a single object is touched, in this order, and
 * any one of them failing stops the write with nothing written:
 *
 *   1. the plan is approved (or is a failed write being tried again);
 *   2. what would be written still hashes to what the approval signed - one
 *      more item rejected since, and the approval no longer covers it;
 *   3. NetBox itself has not moved: the comparison is run again against the
 *      live instance and the fingerprint has to match, byte for byte, the one
 *      the plan was approved on;
 *   4. at least one item a person decided is approved. Scaffolding is never
 *      written on its own - a manufacturer nobody asked for is not a change
 *      anybody signed.
 *
 * THE RETRY. NetBox refusing half a write is the ordinary case, not the
 * strange one: a duplicate name, a field the instance validates differently.
 * What went through stays through (rule 3: this writer never deletes), the
 * plan is `write_failed`, the admin who ran it is emailed the list, and they
 * may run it again under the SAME approval while the hash still matches. The
 * fingerprint of a fresh comparison CANNOT match then - the objects that were
 * written no longer differ - so the recheck is the careful one: every row the
 * fresh comparison still wants must be a row of this plan with the same action
 * and the same field changes, and every row of the plan that has vanished must
 * be one this plan itself wrote (result.writtenUids, kept across attempts).
 * That is service.recheck(), and test/approvals/write.test.js drives a writer
 * whose second comparison reflects the partial write, so the bug cannot come
 * back quietly.
 *
 * BEFORE AND AFTER. The objects the write will touch are read from NetBox
 * first and again afterwards, trimmed to the fields the plan changes, and kept
 * on the plan as pre_snapshot and post_snapshot. That is what turns "NetBox
 * says 48 ports" into "NetBox said this, we wrote that, NetBox now says this".
 *
 * AND THEN THE CHECK. A write that finished is not a write that landed: the
 * post_write verification re-reads NetBox and only a pass completes the plan.
 * A fail reopens it with `write_mismatch`.
 *
 * WHO WRITES. The final approval of a check writes it at once
 * (runAfterApproval, called by the approve route): the server does it, as the
 * system, on the approver's word, and the registry says both - approved by
 * that person, written by the system. A person writes by hand only to try a
 * failed write again, and only an organization admin may. Every change the
 * write makes goes into the change registry inside service.finishWrite, and
 * what the check afterwards found is appended to it here.
 */
const store = require('./store');
const shape = require('./shape');
const machine = require('./machine');
const service = require('./service');
const verify = require('./verify');
const registry = require('./registry');

const text = (v) => (typeof v === 'string' ? v.trim() : '');
const refuse = (code, why, extra = {}) => ({ error: why, code, why, ...extra });
const NOT_FOUND = () => refuse('not_found', 'no such plan');

/** How many objects are read for a before-and-after snapshot at most. */
const SNAPSHOT_CAP = 250;

/** Every item a write would carry: approved, what follows one, and scaffolding. */
function targetsOf(items) {
  const approved = new Set((items || [])
    .filter((i) => i.decidable && i.decision === 'approved').map((i) => i.uid));
  return (items || []).filter((i) => shape.ACTIONABLE.has(i.action) && (
    (i.supporting && !i.decidable)
    || (i.decidable && i.decision === 'approved')
    || (i.following && approved.has(i.parentUid))));
}

/** NetBox endpoint by the type name a comparison reports. */
let _endpoints = null;
function endpointFor(type) {
  if (!_endpoints) {
    _endpoints = new Map();
    try {
      for (const spec of require('../netbox/mapping').orderedSpecs()) {
        _endpoints.set(spec.label, spec.endpoint);
      }
    } catch { /* no mapping means no snapshot, not a failed write */ }
  }
  return _endpoints.get(type) || null;
}

/** The fields this item is about, plus enough to recognise the object. */
function fieldsOf(object, item) {
  if (!object) return null;
  const keep = { id: object.id ?? null, name: object.name ?? object.model ?? object.label ?? null };
  if (object.status) keep.status = object.status.value ?? object.status;
  const cf = object.custom_fields || {};
  if (cf.racktrack_uid !== undefined) keep.racktrack_uid = cf.racktrack_uid;
  if (cf.racktrack_bound !== undefined) keep.racktrack_bound = cf.racktrack_bound;
  for (const key of Object.keys((item && item.diff) || {})) {
    const v = object[key];
    keep[key] = v && typeof v === 'object' && !Array.isArray(v)
      ? (v.id ?? v.value ?? v) : (v ?? null);
  }
  return keep;
}

/**
 * What NetBox holds for the objects this write is about, right now.
 *
 * Read one at a time by our own uid, which is how the writer finds them too,
 * and then by the record's own id when the item names one: a customer's
 * record does not carry our uid until the write has bound it. The comparison
 * that has just run on this client preloaded these rows, so a read costs a
 * request only where `fresh` asks for one or the preload did not reach.
 * A lookup that throws is recorded as an error on that row rather than failing
 * the write: a snapshot is evidence, and evidence that is missing should say
 * so, not stop the change an admin approved.
 */
async function snapshotOf(client, items, { cap = SNAPSHOT_CAP, fresh = false } = {}) {
  const at = store.nowIso();
  if (!client || typeof client.findByUid !== 'function') {
    return { at, objects: [], why: 'this NetBox client cannot be read object by object' };
  }
  const objects = [];
  const rows = items.slice(0, cap);
  for (const item of rows) {
    const endpoint = endpointFor(item.type);
    if (!endpoint) continue;
    let object = null;
    let error = null;
    try {
      object = await client.findByUid(endpoint, item.uid, { fresh });
      if (!object && item.netboxId != null && typeof client.get === 'function') {
        object = await client.get(`${endpoint}${item.netboxId}/`);
        if (object && object.id == null) object = null;
      }
    } catch (err) {
      error = String((err && (err.detail || err.message)) || err).slice(0, 200);
    }
    objects.push({ uid: item.uid, type: item.type, name: item.name,
      netboxId: object ? object.id : null, present: Boolean(object),
      fields: fieldsOf(object, item), ...(error ? { error } : {}) });
  }
  return { at, objects, truncated: items.length > rows.length, of: items.length };
}

/**
 * The email an admin gets when NetBox refused part of a write.
 *
 * To the person who ran it, at their own address, so the one who pressed the
 * button is the one who hears which objects did not go through. A write the
 * system made on an approval has no such person: the `write_failed` notice
 * tells the admins and the holder, and nothing is sent from here.
 */
function tellTheAdmin(plan, who, { sender = null } = {}) {
  const to = who && !who.system && who.email;
  if (!to) return Promise.resolve(false);
  const r = (plan && plan.result) || {};
  const lines = (r.failures || []).map((f) =>
    `  ${f.type || 'object'} "${f.name || f.uid}"${f.reason ? ` - ${f.reason}` : ''}`);
  const body = [
    `Hello ${who.username || to},`,
    '',
    `The write of plan ${plan.id} for rack ${plan.rackName || plan.rackId} to NetBox did not `
      + `finish. NetBox refused ${r.failed} object${r.failed === 1 ? '' : 's'}:`,
    '',
    ...lines,
    '',
    `${r.written} object${r.written === 1 ? '' : 's'} went through before that and `
      + `${r.written === 1 ? 'is' : 'are'} in NetBox now. Nothing else was changed.`,
    '',
    'The plan is marked "write failed". Fix the cause in NetBox or in the plan and write it '
      + 'again; NetBox is compared once more before anything is written, and the approval '
      + 'still stands while what would be written has not changed.',
    '',
    '- RackTrack',
  ].join('\n');
  const send = sender || ((msg) => require('../../auth').sendNotice(msg));
  return Promise.resolve()
    .then(() => send({ to, subject: `RackTrack: the write for rack ${plan.rackName || plan.rackId} did not finish`, text: body }))
    .catch(() => false);
}

// -- The write ------------------------------------------------------------
/**
 * Write an approved plan to NetBox.
 *
 *   client      the NetBox to write to; the organization's own by default
 *   snapshot    the scan snapshot to write; the plan's own scan by default
 *   writer      lib/netbox/writer, so a test can drive plan() and push()
 *   onBehalfOf  the approver, when the system writes on their word
 *
 * One client serves the comparison, the push and the check after it; the
 * client reads a row it has preloaded before as the same row (netbox.js).
 *
 * Answers { plan, result, status, failures, verification } or a refusal.
 */
async function run(planId, { actor, req = null, client = null, snapshot = null, writer = null,
  reason = null, sender = null, onBehalfOf = null } = {}) {
  const who = service.actorOf(actor) || machine.SYSTEM;
  const plan = store.getPlan(planId, { heavy: false });
  if (!plan || !service.canTouch(plan, who)) return NOT_FOUND();
  // Asked and answered before NetBox is troubled at all: an approver may read
  // this plan and may not write it.
  if (!(who.trusted || who.system) && !machine.ROLES.writer.includes(who.role)) {
    return refuse('role', 'An admin approves and writes. Send this plan to yours to review.');
  }
  const W = writer || _deps.writer || require('../netbox/writer');

  // The snapshot this plan was made from, and the NetBox it was compared with.
  const prepared = await prepare(plan, who, { client: client || _deps.client,
    snapshot: snapshot || _deps.snapshot });
  if (prepared.error) return refuse(prepared.code || 'bad_request', prepared.error);
  const { snap, nb } = prepared;

  // Compare again, live, so the checks below judge NetBox as it is now.
  let fresh;
  try {
    fresh = await W.plan(snap, nb);
  } catch (err) {
    return refuse('bad_request',
      `NetBox could not be compared before the write: ${String((err && (err.detail || err.message)) || err)}`);
  }

  const begun = service.beginWrite(plan.id, { actor: who, freshChanges: fresh.changes,
    reason: text(reason), req, onBehalfOf });
  if (begun.error) return begun;
  if (begun.done) return { plan: begun.plan, result: null, status: begun.plan.status, wrote: false };

  const items = store.itemsOf(plan.id);
  const targets = targetsOf(items);
  const toWrite = { ...shape.filterSnapshot(snap, begun.excluded) };
  // Scaffolding nothing in this write needs is named, not removed: the walk
  // still has to see it to resolve what refers to it.
  const spare = spareScaffolding(toWrite, items);
  if (spare.size) toWrite.deferScaffolding = spare;

  const pre = await snapshotOf(nb, targets);
  store.updatePlan(plan.id, { preSnapshot: pre });

  let report;
  try {
    report = await W.push(toWrite, nb);
  } catch (err) {
    const message = String((err && (err.detail || err.message)) || err).slice(0, 400);
    const failedPlan = service.abortWrite(plan.id, { actor: who, error: message, req, onBehalfOf });
    const emailed = await tellTheAdmin(failedPlan, who, { sender });
    return { plan: failedPlan, result: failedPlan && failedPlan.result, status: 'write_failed',
      failures: [], error: message, emailed, wrote: false };
  }

  const finished = service.finishWrite(plan.id, { actor: who, result: report, req,
    withheld: begun.excluded ? begun.excluded.size : 0, onBehalfOf });
  const result = (finished && finished.result) || {};

  if (finished && finished.status === 'write_failed') {
    const post = await snapshotOf(nb, targets, { fresh: true });
    store.updatePlan(plan.id, { postSnapshot: post });
    const emailed = await tellTheAdmin(finished, who, { sender });
    return { plan: store.getPlan(plan.id, { heavy: false }) || finished, result, status: 'write_failed',
      failures: result.failures || [], emailed, wrote: true, preSnapshot: pre, postSnapshot: post, retryable: true };
  }

  // A write that finished is not a write that landed. Read NetBox again.
  const checked = await verify.run(plan.id, { kind: 'post_write', actor: machine.SYSTEM,
    client: nb, snapshot: snap, writer: W, req });
  recordVerdict(plan, result.attempts || 1, checked);
  // Read after the check, whose comparison has just preloaded these rows as
  // they are now; a check that could not run leaves nothing to lean on.
  const post = await snapshotOf(nb, targets, { fresh: Boolean(!checked || checked.error) });
  store.updatePlan(plan.id, { postSnapshot: post });
  const after = store.getPlan(plan.id, { heavy: false });
  return {
    plan: after, result, status: after.status, failures: result.failures || [],
    wrote: true, preSnapshot: pre, postSnapshot: post,
    verification: checked && checked.error ? null : checked,
    verificationRefused: checked && checked.error ? checked : null,
  };
}

/**
 * What the check after the write found, appended to the registry. The rows of
 * the write itself are never touched: the verdict is a row of its own.
 */
function recordVerdict(plan, attempt, checked) {
  if (!checked || checked.error || !checked.summary) return;
  try {
    const s = checked.summary;
    store.addChange(registry.verdictRow({ plan: store.getPlan(plan.id, { heavy: false }) || plan, attempt,
      result: s.result, checked: s.checked ?? null, failed: s.failed ?? null, at: s.at || store.nowIso() }));
  } catch { /* the verdict is on the plan as well; the registry row is the second copy */ }
}

/**
 * The catalogue entries - manufacturers, device types, roles - this write
 * would create and nothing in it needs.
 *
 * Scaffolding goes with whatever needs it, and a comparison lists it for
 * every box in the photo, ticked or not. A write of one approved shelf move
 * would otherwise also create the make, model and role RackTrack guessed for
 * fifteen other boxes, in the customer's NetBox and in the registry. Needed:
 * the type and role of every device this write creates, or updates in its
 * type or role, and the maker of each such type. The rest is handed to the
 * writer by uid as `deferScaffolding`; the rows stay in the snapshot.
 */
function spareScaffolding(toWrite, items) {
  const byUid = new Map((items || []).map((i) => [i.uid, i]));
  const needed = new Set();
  const types = new Map((toWrite.deviceTypes || []).map((t) => [t.uid, t]));
  for (const d of toWrite.devices || []) {
    const item = byUid.get(d.uid);
    if (!item) continue;
    const diff = item.diff || {};
    if (!(item.action === 'create' || (item.action === 'update' && (diff.device_type || diff.role)))) continue;
    if (d.deviceTypeUid) needed.add(d.deviceTypeUid);
    if (d.roleUid) needed.add(d.roleUid);
    const type = types.get(d.deviceTypeUid);
    if (type && type.manufacturerUid) needed.add(type.manufacturerUid);
  }
  const spare = new Set();
  for (const key of ['manufacturers', 'deviceTypes', 'deviceRoles']) {
    for (const o of toWrite[key] || []) {
      const item = byUid.get(o.uid);
      if (item && item.action === 'create' && !needed.has(o.uid)) spare.add(o.uid);
    }
  }
  return spare;
}

// -- The write an approval starts -------------------------------------------
const STALE_MOVED = 'NetBox changed after you approved, so nothing was written.';

/** How many changes a person would be shown for this attempt of the write. */
const visibleChanges = (planId, attempt) => store.changesOf(planId)
  .filter((c) => !c.internal && c.result === 'written' && (attempt == null || c.attempt === attempt)).length;

/** What the approve route answers under `write`. */
function answerOf(planId, out) {
  const plan = store.getPlan(planId, { heavy: false }) || (out && out.plan) || {};
  const base = { state: null, status: plan.status ?? null, written: 0, failed: 0, failures: [], changes: 0, why: null };
  if (out && out.error && out.status !== 'write_failed') {
    if (out.stale) {
      return { ...base, state: 'bounced', why: out.moved
        ? `${STALE_MOVED} ${out.replanned
          ? 'The check has been compared again - review what changed and approve it again.'
          : 'Ask the technician to compare the rack again.'}`
        : 'What was approved changed before the write, so nothing was written. Review the check and approve it again.' };
    }
    return { ...base, state: 'not_started', why: out.why || out.error };
  }
  const r = (out && out.result) || {};
  if (out && out.status === 'write_failed') {
    return { ...base, state: 'failed', written: r.written || 0, failed: r.failed || 0,
      failures: r.failures || (out.failures || []), changes: visibleChanges(planId, r.attempts),
      why: out.error || r.error || null };
  }
  if (out && out.wrote === false) return { ...base, state: 'nothing_to_write' };
  return { ...base, state: 'written', written: r.written || 0, failed: 0, failures: [],
    changes: visibleChanges(planId, r.attempts),
    why: plan.status === 'reopened'
      ? 'NetBox did not hold everything that was written, so the check has been reopened.' : null };
}

/**
 * The write a final approval starts. Called by the approve route.
 *
 * The server writes, as the system, on the approver's word (`onBehalfOf`). It
 * waits up to `waitMs` for the write and the check after it; past that it
 * answers `writing` and the write finishes in the background, where a throw
 * still leaves the check `write_failed` and never stranded.
 *
 * -> { plan, write: { state, status, written, failed, failures, changes, why } }
 *
 *   written           it went through (status completed; reopened, with `why`,
 *                     when NetBox did not hold it afterwards)
 *   nothing_to_write  nothing a person approved needed writing: completed
 *   failed            NetBox refused part of it, or the push threw: write_failed
 *   bounced           the approval no longer covered it, or NetBox had moved:
 *                     nothing written, the check is back with its holder
 *   writing           still going after `waitMs`
 *   not_started       it could not begin (no NetBox, no scan, NetBox down):
 *                     still approved, the admins and the holder are told, and
 *                     an organization admin starts it again
 */
async function runAfterApproval(planId, { approver, req = null, waitMs = _deps.waitMs ?? 25000,
  client = null, writer = null, snapshot = null } = {}) {
  const plan = store.getPlan(planId, { heavy: false });
  if (!plan) return { plan: null, write: null };
  const system = { ...machine.SYSTEM, orgId: plan.orgId ?? null };
  const onBehalfOf = service.actorOf(approver);
  const whole = run(planId, { actor: system, onBehalfOf, req, client, writer, snapshot })
    .then((out) => afterRun(planId, out, { system, onBehalfOf, req }));
  // Whoever stops waiting, a throw leaves the check write_failed, not stranded.
  const safe = whole.catch((err) => {
    const message = String((err && (err.detail || err.message)) || err).slice(0, 400);
    service.abortWrite(planId, { actor: system, error: message, req, onBehalfOf });
    return { error: message, code: 'guard', why: message, threw: true };
  });
  let timer = null;
  const waited = new Promise((resolve) => {
    timer = setTimeout(() => resolve(null), Math.max(0, Number(waitMs) || 0));
  });
  const out = await Promise.race([safe, waited]);
  clearTimeout(timer);
  const now = store.getPlan(planId, { heavy: false });
  if (out === null) {
    return { plan: now, write: { state: 'writing', status: now.status, written: 0, failed: 0,
      failures: [], changes: 0, why: null } };
  }
  if (out && out.threw && now.status !== 'approved') {
    // It threw after it had begun: the check says how far it got.
    return { plan: now, write: answerOf(planId, now.status === 'write_failed'
      ? { status: 'write_failed', result: now.result, error: out.error }
      : { status: now.status, result: now.result }) };
  }
  return { plan: now, write: answerOf(planId, out) };
}

/** What follows a run the approval started: the bounce compared again, a write that never began told. */
async function afterRun(planId, out, { system, onBehalfOf, req }) {
  if (!out || !out.error) return out;
  if (out.stale) {
    if (!out.moved) return out;
    // S4: replan here. NetBox moved, so the check that lands back with its
    // holder has to show NetBox as it is now, or approving it again would only
    // bounce again. service.replan is the re-plan in place; until it exists
    // the holder is told to have the rack compared again.
    let replanned = false;
    if (typeof service.replan === 'function') {
      try {
        const again = await service.replan(planId, { actor: system, req, why: 'netbox_changed' });
        replanned = Boolean(again && !again.error);
      } catch { replanned = false; }
    }
    return { ...out, replanned };
  }
  // It never began, so no move will say so. Tell the people a failed write tells.
  const plan = store.getPlan(planId, { heavy: false });
  if (plan && plan.status === 'approved') {
    try {
      require('./bus').emit('write_failed', { plan, from: plan.status, to: plan.status, actor: system,
        reason: out.why || out.error, item: null, error: out.why || out.error, notStarted: true,
        approver: onBehalfOf ? { id: onBehalfOf.id ?? null, username: onBehalfOf.username ?? null } : null,
        changes: registry.summaryOf([]) });
    } catch { /* a listener never breaks the answer */ }
  }
  return out;
}

/**
 * A write the server was stopped in the middle of. Nothing but the write
 * itself moves a check out of write_in_progress, so a restart would leave it
 * there for good. Called once at boot: what has sat there longer than any
 * write runs goes to write_failed, where an organization admin can run it again.
 */
function recoverStranded({ olderThanMs = 10 * 60 * 1000, now = Date.now() } = {}) {
  const out = [];
  for (const plan of store.listPlans({ status: ['write_in_progress'], limit: 200 })) {
    const at = Date.parse(plan.updatedAt || '') || 0;
    if (now - at < olderThanMs) continue;
    const failed = service.abortWrite(plan.id, { actor: { ...machine.SYSTEM, orgId: plan.orgId ?? null },
      error: 'The server restarted while this write was running. Nothing more was written. '
        + 'An organization admin can run it again.' });
    if (failed && failed.status === 'write_failed') out.push(plan.id);
  }
  return out;
}

/**
 * Tests only: the writer, the NetBox client and the snapshot every write
 * uses, and how long an approval waits for its write. null restores.
 */
let _deps = { writer: null, client: null, snapshot: null, waitMs: null };
function _setDeps(deps) {
  _deps = { writer: (deps && deps.writer) || null, client: (deps && deps.client) || null,
    snapshot: (deps && deps.snapshot) || null, waitMs: (deps && deps.waitMs) ?? null };
}

/** The scan snapshot and the NetBox client a write needs. */
async function prepare(plan, who, { client = null, snapshot = null } = {}) {
  let snap = snapshot;
  if (!snap) {
    if (plan.scanId == null) return { error: 'this plan has no scan to write from' };
    const scan = require('../netbox/store').getScan(plan.scanId);
    if (!scan) return { error: 'the scan this plan was compared from is gone', code: 'not_found' };
    snap = (scan.payload && scan.payload.reconciled) || (scan.payload && scan.payload.snapshot);
    if (!snap) return { error: 'that scan has no detection result yet' };
    try {
      require('../netbox/unmanaged').applyTo(snap, scan.rackId);
      require('../netbox/entered').applyTo(snap, scan.rackId);
    } catch { /* a scan with no hand-declared extras writes just the same */ }
  }
  const nb = client || require('./connections').netboxFor({
    orgId: plan.orgId ?? who.orgId, userId: who.id });
  if (!nb) {
    return { error: 'No NetBox is configured for this organization, so there is nowhere to write.' };
  }
  return { snap, nb };
}

/**
 * A write nobody can get to finish goes to a person instead.
 *
 * `manual_review` is not a failure state, it is a handover: the plan keeps its
 * approval and its history, and an admin decides whether to try again, write
 * the objects by hand in NetBox, or reject the plan.
 */
const toManualReview = (planId, { reason, actor, req = null } = {}) => service
  .moveByHand(planId, { to: 'manual_review', reason, actor, req });

/** What a screen shows about the last write: the record and both snapshots. */
function of(planId, actor) {
  const who = service.actorOf(actor);
  const plan = store.getPlan(planId);
  if (!plan || !service.canRead(plan, who)) return null;
  return {
    planId: plan.id, status: plan.status, result: plan.result || null,
    writtenAt: plan.writtenAt, writtenBy: plan.writtenBy,
    preSnapshot: plan.preSnapshot || null, postSnapshot: plan.postSnapshot || null,
    verifications: store.verificationsOf(plan.id).filter((v) => v.kind === 'post_write'),
  };
}

module.exports = { run, of, toManualReview, targetsOf, snapshotOf, fieldsOf, tellTheAdmin,
  runAfterApproval, recoverStranded, spareScaffolding, _setDeps };
