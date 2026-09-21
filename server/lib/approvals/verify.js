/**
 * The second look: did the rack really change, and did the write really land?
 *
 * A plan is a photograph of one disagreement between a rack and NetBox. By the
 * time somebody has been to the cabinet and reported back, that photograph is
 * hours old, and the only honest way to know it still holds is to take another
 * one. That is a verification: a newer scan of the same rack, compared with
 * NetBox exactly as a preview compares - same walk, same writer.plan() - and
 * then read item by item against the plan.
 *
 * THE RULE, from the contract:
 *
 *   post_fix   for every item the plan asks about: if the new scan sees the
 *              same difference, the drift is confirmed twice and the item is
 *              ok. If the item no longer differs from NetBox, somebody has
 *              already put it right, so it is ok too and the item becomes
 *              `not_applicable` with disposition `remediate` - there is
 *              nothing left to write. Anything else fails, and what was
 *              actually seen is recorded as `observed`.
 *
 *   post_write the mirror image, run by write.js after NetBox has been
 *              written: every written item must now match, so an item that
 *              still differs is a mismatch and the plan reopens.
 *
 * PASS IS EVERY DECIDABLE ITEM OK. One failure fails the verification, because
 * a verification that passes with a caveat is not a verification. A failed
 * post_fix sends the plan back to `reopened` with reason `verification_failed`;
 * a failed post_write with `write_mismatch`.
 *
 * WHO. Any technician of the Site may run the verification re-scan, including
 * the one who reported the drift (decision 14 of the contract). The record
 * stores who did it, which is the point: it is evidence, not a permission.
 */
const store = require('./store');
const shape = require('./shape');
const machine = require('./machine');
const bus = require('./bus');
const service = require('./service');

const { SYSTEM } = machine;

const text = (v) => (typeof v === 'string' ? v.trim() : '');
const refuse = (code, why, extra = {}) => ({ error: why, code, why, ...extra });
const NOT_FOUND = () => refuse('not_found', 'no such plan');
const isStrict = (actor) => !(actor && (actor.trusted || actor.system));

/** The named event a status stands for, as service.js has it. */
const NAMED = { approval_pending: 'approval_requested', completed: 'completed' };

// -- Which scan is the second scan ----------------------------------------
// The same folder routes/netbox/scans.js adopts a rack's detection result from.
const fs = require('node:fs');
const path = require('node:path');
const OUTPUTS_DIR = process.env.RT_OUTPUTS_DIR || path.resolve(__dirname, '..', '..', '..', 'outputs');

/**
 * The scan a person named.
 *
 * A number is a scan on the NetBox side. Anything else is the id the phone
 * files a rack's scans under (RK-...), which is what the Drift Desk offers in
 * its list: it names that rack's adopted scan. Looked up as a number, a rack id
 * is NaN and matched nothing, so every choice from that list was answered
 * "no such scan".
 */
function scanNamed(scans, scanId) {
  const named = String(scanId).trim();
  if (/^\d+$/.test(named)) return scans.getScan(named);
  const adopted = scans.scansForRack(named).find((s) => s.source === 'adopted');
  return adopted ? scans.getScan(adopted.id) : null;
}

/** When the rack's detection result on disk was last written, in ms. */
function rescannedAt(rackId) {
  if (!/^[A-Za-z0-9._-]+$/.test(String(rackId || ''))) return null;
  try { return fs.statSync(path.join(OUTPUTS_DIR, String(rackId), 'device_unit_map.json')).mtimeMs; }
  catch { return null; }
}

/**
 * Why the plan's own scan is not a second scan, or null when it is one.
 *
 * The phone keeps ONE adopted scan per rack: scanning the rack again rebuilds
 * that scan in place rather than adding another. So "a scan with a different
 * number" is something the phone can never produce, and asking for one made
 * the verification impossible to pass from the screens. What decision 6 is
 * after is evidence newer than the drift, so the plan's own scan counts when,
 * and only when, the rack was scanned again after the plan was raised and the
 * adopted copy was rebuilt from that newer result.
 */
function staleSecondScan(scan, plan, { scannedAt = rescannedAt } = {}) {
  // The plan's and the stage's times are kept to the whole second, the file's
  // to the millisecond. Compared as they stand, a result written a moment
  // BEFORE the plan was raised, in the same second, would read as newer than it.
  // So each test is made in whole seconds, the way that can only refuse too
  // much: the rack must have been scanned in a later second than the plan was
  // raised, and the copy rebuilt no earlier than the second after that scan.
  const SECOND = 1000;
  const raised = Date.parse(plan.createdAt);
  const again = scannedAt(scan.rackId);
  if (!Number.isFinite(raised) || !again || again < raised + SECOND) {
    return 'that is the scan this plan was compared from; scan the rack again';
  }
  const rebuilt = Date.parse((scan.stages && scan.stages.detect && scan.stages.detect.ranAt) || '');
  if (!Number.isFinite(rebuilt) || rebuilt < Math.ceil(again / SECOND) * SECOND) {
    return 'this rack was scanned again, but the new scan has not been opened yet: '
      + 'open its Drift check on the phone once, then verify';
  }
  return null;
}

/** Which reason a failure of each kind reopens the plan with. */
const FAIL_REASON = { post_fix: 'verification_failed', post_write: 'write_mismatch' };

// -- Comparing again ------------------------------------------------------
/**
 * Run the comparison a preview runs, on whichever scan is being verified.
 *
 * `snapshot` and `client` are handed in by write.js, which already holds both;
 * everything else loads the scan, applies the hand-declared switches the same
 * way the preview route does, and asks NetBox.
 */
async function compareFor({ plan, scanId = null, actor = null, client = null,
  snapshot = null, writer = null } = {}) {
  const W = writer || require('../netbox/writer');
  let snap = snapshot;
  let scan = null;
  if (!snap) {
    const scans = require('../netbox/store');
    scan = scans.getScan(scanId != null ? scanId : plan.scanId);
    if (!scan) return { error: 'no such scan' };
    snap = (scan.payload && scan.payload.reconciled) || (scan.payload && scan.payload.snapshot);
    if (!snap) return { error: 'that scan has no detection result yet' };
    try {
      require('../netbox/unmanaged').applyTo(snap, scan.rackId);
      require('../netbox/entered').applyTo(snap, scan.rackId);
    } catch { /* a scan with no hand-declared extras compares just the same */ }
  }
  const nb = client || require('./connections').netboxFor({
    orgId: plan.orgId ?? (actor && actor.orgId), userId: actor && actor.id });
  if (!nb) {
    return { error: 'No NetBox is configured for this account, so the scan cannot be compared.' };
  }
  const report = await W.plan(snap, nb);
  return { changes: report.changes || [], report, snapshot: snap, scan, client: nb };
}

// -- Reading one comparison against the plan ------------------------------
/**
 * The plan's items against a fresh comparison. Pure: hand it the two lists and
 * it answers what a person will read, with no database and no clock.
 */
function judge(items, freshChanges, kind = 'post_fix') {
  const live = new Map((freshChanges || [])
    .filter((c) => shape.ACTIONABLE.has(c.action))
    .map((c) => [c.uid, c]));
  const detail = [];
  for (const item of items || []) {
    if (!item.decidable) continue;
    // Nothing was ever asked about these, so there is nothing to confirm.
    if (['excepted', 'not_applicable'].includes(item.decision)) continue;
    // After a write, only what was actually written is checked. An item
    // somebody rejected was never sent to NetBox, so of course it still
    // differs - holding that against the write would reopen every plan that
    // had one thing turned down.
    if (kind === 'post_write' && item.decision !== 'approved') continue;
    const now = live.get(item.uid) || null;
    const expected = item.diff ?? null;
    const row = { uid: item.uid, type: item.type, name: item.name, action: item.action,
      expected, observed: now ? (now.diff ?? null) : null, ok: false, why: null };
    if (kind === 'post_write') {
      row.ok = !now;
      row.why = row.ok
        ? 'NetBox now matches what was written'
        : 'NetBox still differs from what was written';
    } else if (!now) {
      row.ok = true;
      row.gone = true;
      row.disposition = 'remediate';
      row.why = 'it no longer differs from NetBox, so it has already been put right';
    } else if (now.action === item.action && shape.stable(now.diff) === shape.stable(expected)) {
      row.ok = true;
      row.why = 'the second scan sees the same difference';
    } else {
      row.why = now.action !== item.action
        ? `the second scan reports ${now.action}, not ${item.action}`
        : 'the second scan sees a different value';
    }
    detail.push(row);
  }
  const failed = detail.filter((d) => !d.ok);
  return {
    result: failed.length ? 'fail' : 'pass',
    detail,
    checked: detail.length,
    failed: failed.length,
    remediated: detail.filter((d) => d.gone).length,
  };
}

// -- Committing the move --------------------------------------------------
/** service.move, for the two moves a verification makes. */
function commit(effects, plan, to, opts = {}) {
  const { actor = SYSTEM, action = to, reason = null, patch = {}, payload = null,
    ctx = null, force = false, req = null, auditPayload = null } = opts;
  const from = plan.status;
  if (!force) {
    const ok = machine.can(plan, to, actor, ctx || {});
    if (!ok.ok) return { refused: refuse(ok.code, ok.why, { from, to }) };
  }
  const updated = store.updatePlan(plan.id, { ...patch, status: to });
  store.addEvent(plan.id, { action, actorId: actor.id ?? null, actorName: actor.username ?? null,
    fromStatus: from, toStatus: to, reason, payload });
  effects.push({ kind: 'audit', plan: updated, action, actor, req,
    payload: { from, to, reason, ...(auditPayload || {}) } });
  const heard = { plan: updated, from, to, actor, reason, item: null };
  effects.push({ kind: 'bus', event: 'transition', payload: heard });
  if (NAMED[to]) effects.push({ kind: 'bus', event: NAMED[to], payload: heard });
  return { plan: updated, from, to };
}

/** The audit row and the bus, after the transaction has committed. */
function flush(effects) {
  for (const e of effects) {
    try {
      if (e.kind === 'bus') { bus.emit(e.event, e.payload); continue; }
      if (store.isolated()) continue;
      const a = e.actor || {};
      require('../../audit').log({ req: e.req || undefined,
        user: { id: a.id ?? null, username: a.username ?? null,
          tenant_id: e.plan?.tenantId ?? a.tenantId ?? null },
        action: `approval.${e.action}`, status: e.status || 'ok',
        targetType: 'approval_plan', targetId: e.plan?.id ?? null, payload: e.payload ?? null });
    } catch { /* the trail and the listeners never break the request */ }
  }
  effects.length = 0;
}

// -- The operation --------------------------------------------------------
/**
 * Verify a plan.
 *
 *   scanId    the newer scan of the same rack (post_fix; required unless the
 *             caller hands the comparison over itself)
 *   kind      post_fix, or post_write from write.js
 *   changes   a comparison already run, so write.js does not run it twice
 *
 * Answers { verification, result, detail, plan } or a refusal.
 */
async function run(planId, { kind = 'post_fix', scanId = null, actor, req = null,
  changes = null, client = null, snapshot = null, writer = null, evidence = null,
  reason = null, scannedAt = null } = {}) {
  const who = service.actorOf(actor) || SYSTEM;
  const plan = store.getPlan(planId, { heavy: false });
  if (!plan || !service.canTouch(plan, who)) return NOT_FOUND();
  if (!['post_fix', 'post_write'].includes(kind)) {
    return refuse('bad_request', "a verification is post_fix or post_write");
  }
  const strict = isStrict(who);
  if (kind === 'post_fix') {
    if (strict && !machine.isTechnicianOf(plan, who)) {
      return refuse('role', 'A technician of this Site runs the verification scan.');
    }
    if (plan.status !== 'verification_pending') {
      return refuse('transition', plan.status === 'written' || plan.status === 'completed'
        ? 'this plan has already been written'
        : `a plan that is ${String(plan.status).replace(/_/g, ' ')} is not waiting for a verification scan`,
      { from: plan.status, to: 'approval_pending' });
    }
  } else if (plan.status !== 'written') {
    return refuse('transition', 'only a plan that has just been written is checked against NetBox',
      { from: plan.status, to: 'completed' });
  }

  // The evidence. A second scan is required to verify a fix (decision 6),
  // and it has to be a newer scan of the same rack. The phone names it by the
  // rack's id and rebuilds the rack's one adopted scan in place, so both are
  // understood here rather than refused.
  let scan = null;
  // The plan's own scan, rebuilt from a newer scan of the rack (see staleSecondScan).
  let rebuiltFromRescan = false;
  if (kind === 'post_fix' && !changes) {
    if (scanId == null || scanId === '') {
      return refuse('bad_request', 'send the id of the new scan of this rack');
    }
    scan = scanNamed(require('../netbox/store'), scanId);
    if (!scan) return refuse('not_found', 'no such scan');
    if (String(scan.rackId) !== String(plan.rackId)) {
      return refuse('bad_request', 'that scan is of a different rack');
    }
    if (Number(scan.id) === Number(plan.scanId)) {
      const stale = staleSecondScan(scan, plan, scannedAt ? { scannedAt } : {});
      if (stale) return refuse('bad_request', stale);
      rebuiltFromRescan = true;
    }
  }

  let fresh = changes;
  if (!fresh) {
    const compared = await compareFor({ plan, scanId: scan ? scan.id : null, actor: who,
      client, snapshot, writer });
    if (compared.error) return refuse('bad_request', compared.error);
    fresh = compared.changes;
  }

  const items = store.itemsOf(plan.id);
  const verdict = judge(items, fresh, kind);
  const now = store.nowIso();

  const effects = [];
  const out = store.tx(() => {
    const record = store.addVerification(plan.id, {
      kind, scanId: scan ? scan.id : (kind === 'post_fix' ? scanId : plan.scanId),
      result: verdict.result, performedBy: who.username ?? null, performedAt: now,
      detail: verdict.detail,
      evidence: evidence || { checked: verdict.checked, failed: verdict.failed,
        remediated: verdict.remediated, scanId: scan ? scan.id : null,
        ...(rebuiltFromRescan ? { sameScanRebuilt: true } : {}) },
    });

    // An item the second scan finds already put right is no longer a question:
    // there is nothing left to write, and nobody should be asked to approve it.
    if (kind === 'post_fix') {
      for (const row of verdict.detail.filter((d) => d.gone)) {
        const item = items.find((i) => i.uid === row.uid);
        if (!item) continue;
        const decided = { decision: 'not_applicable', reasonCode: null,
          decidedBy: who.username ?? null, decidedById: who.id ?? null, decidedAt: now,
          note: 'The verification scan found it already matches NetBox.',
          extra: { ...extraOf(item), disposition: 'remediate' } };
        store.updateItem(plan.id, item.uid, decided, { touch: false });
        for (const child of shape.childrenOf(items, item.uid)) {
          store.updateItem(plan.id, child.uid, { ...decided, extra: undefined }, { touch: false });
        }
      }
    }

    const summary = { kind, result: verdict.result, at: now, by: who.username ?? null,
      scanId: record.scanId, checked: verdict.checked, failed: verdict.failed,
      remediated: verdict.remediated };
    const passed = verdict.result === 'pass';
    const to = passed
      ? (kind === 'post_fix' ? 'approval_pending' : 'completed')
      : 'reopened';
    const ctx = ctxFor(plan, { verification: { ...summary }, reason: text(reason) });
    const patch = { verification: summary };
    if (passed && kind === 'post_write') patch.completedAt = now;
    if (!passed) {
      patch.reopenCount = (plan.reopenCount || 0) + 1;
      patch.reopenReason = FAIL_REASON[kind];
    }
    // The check after a write is the server's own move, whoever asked for the
    // write: it is not a person's decision, it is a fact about NetBox.
    const moved = commit(effects, plan, to, {
      actor: kind === 'post_write' ? SYSTEM : who,
      action: passed ? `verify.${kind}` : `verify.${kind}_failed`,
      req, ctx, patch, force: kind === 'post_write' ? false : !strict,
      reason: passed ? null : FAIL_REASON[kind],
      payload: { what: passed ? 'verification passed' : 'verification failed',
        detail: { ...summary, failures: verdict.detail.filter((d) => !d.ok) } },
      auditPayload: summary,
    });
    if (moved.refused) return moved.refused;
    if (!passed) {
      effects.push({ kind: 'bus', event: 'verification_failed',
        payload: { plan: moved.plan, from: plan.status, to, actor: who,
          reason: FAIL_REASON[kind], item: null, kind,
          failures: verdict.detail.filter((d) => !d.ok) } });
    }
    return { verification: record, result: verdict.result, detail: verdict.detail,
      summary, plan: moved.plan };
  });
  flush(effects);
  return out;
}

/** What machine.can() reads. service.ctxFor is private, so this is its twin. */
function ctxFor(plan, extra = {}) {
  const items = store.itemsOf(plan.id);
  const risks = plan.orgId != null ? store.getSetting(plan.orgId, 'dual_approval_risks') : undefined;
  return {
    items,
    tickets: store.ticketsOf(plan.id),
    decisions: store.decisionsOf(plan.id),
    settings: { dualApprovalRisks: Array.isArray(risks) ? risks
      : service.DEFAULT_SETTINGS.dual_approval_risks },
    payloadHash: shape.payloadHash(items),
    toWrite: shape.approvedCount(items),
    ...extra,
  };
}

/**
 * Whatever the comparison put on an item that the table has no column for.
 * store.itemOf() spreads it back over the row, so what is left after the
 * known fields is exactly what came in as `extra`.
 */
const KNOWN = new Set(['id', 'planId', 'uid', 'type', 'name', 'action', 'netboxId', 'diff', 'reason',
  'supporting', 'decidable', 'decision', 'decidedBy', 'decidedById', 'decidedAt', 'note',
  'reasonCode', 'parentUid', 'following', 'exceptionId']);
function extraOf(item) {
  const out = {};
  for (const [k, v] of Object.entries(item || {})) if (!KNOWN.has(k)) out[k] = v;
  return out;
}

/** Every verification a plan has had, newest last. */
const historyOf = (planId) => store.verificationsOf(planId);

module.exports = { run, judge, compareFor, historyOf, extraOf, FAIL_REASON };
