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
 */
const store = require('./store');
const shape = require('./shape');
const machine = require('./machine');
const service = require('./service');
const verify = require('./verify');

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
 * Read one at a time by our own uid, which is how the writer finds them too.
 * A lookup that throws is recorded as an error on that row rather than failing
 * the write: a snapshot is evidence, and evidence that is missing should say
 * so, not stop the change an admin approved.
 */
async function snapshotOf(client, items, { cap = SNAPSHOT_CAP } = {}) {
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
      object = await client.findByUid(endpoint, item.uid);
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
 * button is the one who hears which objects did not go through.
 */
function tellTheAdmin(plan, who, { sender = null } = {}) {
  const to = who && who.email;
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
 *   client    the NetBox to write to; the organization's own by default
 *   snapshot  the scan snapshot to write; the plan's own scan by default
 *   writer    lib/netbox/writer, so a test can drive plan() and push()
 *
 * Answers { plan, result, status, failures, verification } or a refusal.
 */
async function run(planId, { actor, req = null, client = null, snapshot = null, writer = null,
  reason = null, sender = null } = {}) {
  const who = service.actorOf(actor) || machine.SYSTEM;
  const plan = store.getPlan(planId, { heavy: false });
  if (!plan || !service.canTouch(plan, who)) return NOT_FOUND();
  // Asked and answered before NetBox is troubled at all: an approver may read
  // this plan and may not write it.
  if (!(who.trusted || who.system) && !machine.ROLES.writer.includes(who.role)) {
    return refuse('role', 'An admin approves and writes. Send this plan to yours to review.');
  }
  const W = writer || require('../netbox/writer');

  // The snapshot this plan was made from, and the NetBox it was compared with.
  const prepared = await prepare(plan, who, { client, snapshot });
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
    reason: text(reason), req });
  if (begun.error) return begun;
  if (begun.done) return { plan: begun.plan, result: null, status: begun.plan.status, wrote: false };

  const items = store.itemsOf(plan.id);
  const targets = targetsOf(items);
  const toWrite = shape.filterSnapshot(snap, begun.excluded);

  const pre = await snapshotOf(nb, targets);
  store.updatePlan(plan.id, { preSnapshot: pre });

  let report;
  try {
    report = await W.push(toWrite, nb);
  } catch (err) {
    const message = String((err && (err.detail || err.message)) || err).slice(0, 400);
    const failedPlan = service.abortWrite(plan.id, { actor: who, error: message, req });
    const emailed = await tellTheAdmin(failedPlan, who, { sender });
    return { plan: failedPlan, result: failedPlan && failedPlan.result, status: 'write_failed',
      failures: [], error: message, emailed, wrote: false };
  }

  const post = await snapshotOf(nb, targets);
  store.updatePlan(plan.id, { postSnapshot: post });

  const finished = service.finishWrite(plan.id, { actor: who, result: report, req,
    withheld: begun.excluded ? begun.excluded.size : 0 });
  const result = (finished && finished.result) || {};

  if (finished && finished.status === 'write_failed') {
    const emailed = await tellTheAdmin(finished, who, { sender });
    return { plan: finished, result, status: 'write_failed', failures: result.failures || [],
      emailed, wrote: true, preSnapshot: pre, postSnapshot: post, retryable: true };
  }

  // A write that finished is not a write that landed. Read NetBox again.
  const checked = await verify.run(plan.id, { kind: 'post_write', actor: machine.SYSTEM,
    client: nb, snapshot: snap, writer: W, req });
  const after = store.getPlan(plan.id, { heavy: false });
  return {
    plan: after, result, status: after.status, failures: result.failures || [],
    wrote: true, preSnapshot: pre, postSnapshot: post,
    verification: checked && checked.error ? null : checked,
    verificationRefused: checked && checked.error ? checked : null,
  };
}

/** The scan snapshot and the NetBox client a write needs. */
async function prepare(plan, who, { client = null, snapshot = null } = {}) {
  // The one loader every comparison of a check shares, so what a person
  // changed on it is in the snapshot here exactly as it was when they changed it.
  const loaded = require('./snapshot').forPlan(plan, { snapshot });
  if (loaded.error) return loaded;
  const { snap } = loaded;
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

module.exports = { run, of, toManualReview, targetsOf, snapshotOf, fieldsOf, tellTheAdmin };
