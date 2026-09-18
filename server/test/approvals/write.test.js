/**
 * The controlled write, and the retry that used to be wrong.
 *
 * The first three tests are the guards: nothing is written unless the plan is
 * approved, the approval still covers what would be written, and NetBox has
 * not moved. The fourth is the one that matters most.
 *
 * THE RETRY. When NetBox refuses half a write, the plan is write_failed and
 * may be written again under the same approval. The fresh comparison then
 * CANNOT match the fingerprint any more, because the objects that did go
 * through no longer differ - so a naive check refuses every retry, and a
 * careless one accepts any change at all. The rule is: every row the fresh
 * comparison still wants has to be a row of this plan with the same action and
 * the same field changes, and every row of the plan that has vanished has to
 * be one this plan itself wrote. The writer stub below reflects the partial
 * write in its second comparison, exactly as a real NetBox would, so the bug
 * cannot come back quietly.
 */
process.env.NODE_ENV = 'test';
process.env.RACKTRACK_SKIP_WORKER_POOL = '1';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after, before, describe, it } = require('node:test');

let tmp;
let store;
let shape;
let service;
let write;

before(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-write-'));
  process.env.RACKTRACK_APPROVALS_DB = path.join(tmp, 'approvals.db');
  process.env.RT_DATA_DIR = tmp;
  store = require('../../lib/approvals/store');
  shape = require('../../lib/approvals/shape');
  service = require('../../lib/approvals/service');
  write = require('../../lib/approvals/write');
});

after(() => {
  try { store._reset(); } catch { /* already closed */ }
  fs.rmSync(tmp, { recursive: true, force: true });
});

const ADMIN = { id: 5, username: 'meera', email: 'meera@example.test', role: 'org_admin',
  orgId: 1, tenantId: 7 };

const CHANGES = () => [
  { type: 'Manufacturer', uid: 'mfr:tp-link', name: 'TP-Link', action: 'create' },
  { type: 'Device', uid: 'dev:t7:5:u12', name: 'Sw1', action: 'create' },
  { type: 'Device', uid: 'dev:t7:5:u15', name: 'SW2', action: 'update', netboxId: 44,
    diff: { position: { from: 14, to: 15 } } },
];

const SNAPSHOT = () => ({
  rackUid: 'rack:t7:5',
  manufacturers: [{ uid: 'mfr:tp-link', name: 'TP-Link' }],
  devices: [{ uid: 'dev:t7:5:u12', name: 'Sw1' }, { uid: 'dev:t7:5:u15', name: 'SW2' }],
});

/** A NetBox that holds nothing and answers every lookup. */
const client = () => ({ url: 'http://netbox.test', findByUid: async () => null });

/**
 * A stand-in for lib/netbox/writer. `comparisons` is what plan() answers, one
 * call after another; `push` is what the write does.
 */
function driver({ comparisons = [], push }) {
  const calls = { plan: 0, push: 0, pushed: [] };
  return {
    calls,
    plan: async () => {
      const changes = comparisons[Math.min(calls.plan, comparisons.length - 1)] || [];
      calls.plan += 1;
      return { changes, counts: {}, warnings: [], orphans: [] };
    },
    push: async (snapshot) => {
      calls.push += 1;
      calls.pushed.push(snapshot);
      return push(snapshot, calls.push);
    },
  };
}

/** A plan an admin has approved, ready to be written. */
function approved({ changes = CHANGES(), reject = [] } = {}) {
  const filed = service.create({ scanId: 1, rackId: 'RK-1', rackName: 'RK-1',
    report: { rackUid: 'rack:t7:5', netboxUrl: 'http://netbox.test', customField: 'present',
      counts: {}, warnings: [], orphans: [], changes },
    actor: service.trustedActor('ravi'), orgId: 1, tenantId: 7 });
  const id = filed.plan.id;
  for (const item of store.itemsOf(id)) {
    if (!item.decidable) continue;
    store.updateItem(id, item.uid, {
      decision: reject.includes(item.uid) ? 'rejected' : 'approved',
      decidedBy: 'meera', decidedById: 5, decidedAt: store.nowIso(),
    }, { touch: false });
  }
  const hash = shape.payloadHash(store.itemsOf(id));
  store.updatePlan(id, { status: 'approved', payloadHash: hash });
  store.addDecision(id, { stage: 'first', approverId: 5, approver: 'meera', decision: 'approved',
    payloadHash: hash, planVersion: store.getPlan(id).version }, { touch: false });
  return id;
}

/** Everything the write carried, by uid. */
const wrote = (uids, failures = []) => ({
  counts: { create: uids.length, fail: failures.length },
  changes: [
    ...uids.map((uid) => ({ uid, type: 'Device', name: uid, action: 'create', netboxId: 100 })),
    ...failures.map((f) => ({ uid: f.uid, type: 'Device', name: f.uid, action: 'fail',
      reason: f.reason })),
  ],
});

describe('a write that goes through', () => {
  it('writes only what was approved, keeps both snapshots, and completes on a clean check', async () => {
    const id = approved({ reject: ['dev:t7:5:u15'] });
    const W = driver({
      // Before the write, the whole plan still differs; after it, only the
      // item nobody approved.
      comparisons: [CHANGES(), [CHANGES()[2]]],
      push: () => wrote(['mfr:tp-link', 'dev:t7:5:u12']),
    });
    const out = await write.run(id, { actor: ADMIN, client: client(), snapshot: SNAPSHOT(),
      writer: W, sender: async () => true });

    assert.equal(out.error, undefined, out.why);
    assert.equal(out.status, 'completed');
    assert.equal(out.result.written, 2);
    assert.equal(out.result.failed, 0);
    assert.deepEqual(out.result.writtenUids.sort(), ['dev:t7:5:u12', 'mfr:tp-link']);

    // The rejected device was never handed to the writer.
    const pushed = W.calls.pushed[0];
    assert.deepEqual(pushed.devices.map((d) => d.uid), ['dev:t7:5:u12']);

    const plan = store.getPlan(id);
    assert.ok(plan.preSnapshot && plan.postSnapshot, 'before and after are both kept');
    assert.equal(plan.preSnapshot.objects.length, 2);
    assert.equal(store.verificationsOf(id).filter((v) => v.kind === 'post_write').length, 1);
  });

  it('reopens with write_mismatch when NetBox does not hold what was written', async () => {
    const id = approved();
    const W = driver({
      comparisons: [CHANGES(), CHANGES()],   // nothing changed in NetBox after the push
      push: () => wrote(['mfr:tp-link', 'dev:t7:5:u12', 'dev:t7:5:u15']),
    });
    const out = await write.run(id, { actor: ADMIN, client: client(), snapshot: SNAPSHOT(),
      writer: W, sender: async () => true });

    assert.equal(out.status, 'reopened');
    assert.equal(store.getPlan(id).reopenReason, 'write_mismatch');
  });
});

describe('a write NetBox refused part of', () => {
  it('is write_failed, names the objects, and emails the admin who ran it', async () => {
    const id = approved();
    const posted = [];
    const W = driver({
      comparisons: [CHANGES()],
      push: () => wrote(['mfr:tp-link', 'dev:t7:5:u12'],
        [{ uid: 'dev:t7:5:u15', reason: 'duplicate name' }]),
    });
    const out = await write.run(id, { actor: ADMIN, client: client(), snapshot: SNAPSHOT(),
      writer: W, sender: async (msg) => { posted.push(msg); return true; } });

    assert.equal(out.status, 'write_failed');
    assert.equal(out.result.written, 2);
    assert.equal(out.result.failed, 1);
    assert.deepEqual(out.failures.map((f) => f.uid), ['dev:t7:5:u15']);
    assert.equal(out.emailed, true);
    assert.equal(posted.length, 1);
    assert.equal(posted[0].to, 'meera@example.test');
    assert.match(posted[0].text, /duplicate name/);
    assert.equal(store.getPlan(id).status, 'write_failed');
  });

  it('is written again under the same approval, with the partial write allowed for', async () => {
    const id = approved();
    const first = driver({
      comparisons: [CHANGES()],
      push: () => wrote(['mfr:tp-link', 'dev:t7:5:u12'],
        [{ uid: 'dev:t7:5:u15', reason: 'duplicate name' }]),
    });
    await write.run(id, { actor: ADMIN, client: client(), snapshot: SNAPSHOT(), writer: first,
      sender: async () => true });
    assert.equal(store.getPlan(id).status, 'write_failed');

    // The retry. NetBox now holds the two objects that went through, so the
    // fresh comparison wants only the one that did not - and the fingerprint
    // can never match again. What was written is in writtenUids.
    const left = [CHANGES()[2]];
    const second = driver({ comparisons: [left, []], push: () => wrote(['dev:t7:5:u15']) });
    const out = await write.run(id, { actor: ADMIN, client: client(), snapshot: SNAPSHOT(),
      writer: second, sender: async () => true });

    assert.equal(out.error, undefined, out.why);
    assert.equal(second.calls.push, 1, 'the retry really wrote');
    assert.equal(out.status, 'completed');
    assert.equal(out.result.attempts, 2, 'both attempts are counted');
    assert.deepEqual(out.result.writtenUids.sort(),
      ['dev:t7:5:u12', 'dev:t7:5:u15', 'mfr:tp-link'], 'what each attempt wrote is kept');
    const decisions = store.decisionsOf(id);
    assert.equal(decisions.length, 1, 'the same approval covered both attempts');
  });

  it('refuses the retry when something in NetBox is not this plan\'s work', async () => {
    const id = approved();
    const first = driver({
      comparisons: [CHANGES()],
      push: () => wrote(['mfr:tp-link'], [{ uid: 'dev:t7:5:u12', reason: 'no such device type' }]),
    });
    await write.run(id, { actor: ADMIN, client: client(), snapshot: SNAPSHOT(), writer: first,
      sender: async () => true });

    // Somebody has moved SW2 in NetBox since: a row this plan never approved.
    const meddled = [CHANGES()[1], { ...CHANGES()[2], diff: { position: { from: 14, to: 21 } } }];
    const second = driver({ comparisons: [meddled], push: () => wrote(['dev:t7:5:u12']) });
    const out = await write.run(id, { actor: ADMIN, client: client(), snapshot: SNAPSHOT(),
      writer: second, sender: async () => true });

    assert.equal(out.code, 'guard');
    assert.equal(second.calls.push, 0, 'nothing was written');
    assert.match(out.why, /NetBox has changed/);
  });
});

describe('what a write refuses', () => {
  it('refuses a plan nobody approved', async () => {
    const id = approved();
    store.updatePlan(id, { status: 'triage' });
    const W = driver({ comparisons: [CHANGES()], push: () => wrote([]) });
    const out = await write.run(id, { actor: ADMIN, client: client(), snapshot: SNAPSHOT(), writer: W });
    assert.equal(out.code, 'transition');
    assert.equal(W.calls.push, 0);
  });

  it('refuses when NetBox has moved since the approval, and sends the plan back', async () => {
    const id = approved();
    const moved = CHANGES().map((c) => (c.uid === 'dev:t7:5:u15'
      ? { ...c, diff: { position: { from: 14, to: 19 } } } : c));
    const W = driver({ comparisons: [moved], push: () => wrote([]) });
    const out = await write.run(id, { actor: ADMIN, client: client(), snapshot: SNAPSHOT(), writer: W });

    assert.equal(out.code, 'guard');
    assert.equal(out.moved, true);
    assert.equal(W.calls.push, 0, 'nothing was written');
    assert.equal(store.getPlan(id).status, 'approval_pending', 'it goes back to be approved again');
  });

  it('writes nothing when no decidable item was approved', async () => {
    const id = approved({ reject: ['dev:t7:5:u12', 'dev:t7:5:u15'] });
    const W = driver({ comparisons: [CHANGES()], push: () => wrote([]) });
    const out = await write.run(id, { actor: ADMIN, client: client(), snapshot: SNAPSHOT(), writer: W });

    assert.equal(W.calls.push, 0, 'scaffolding is never written on its own');
    assert.equal(out.wrote, false);
    assert.equal(store.getPlan(id).status, 'completed');
  });

  it('refuses an approver: approving and writing are different things', async () => {
    const id = approved();
    const W = driver({ comparisons: [CHANGES()], push: () => wrote([]) });
    const out = await write.run(id, { actor: { id: 9, username: 'sam', role: 'approver',
      orgId: 1, tenantId: 7 }, client: client(), snapshot: SNAPSHOT(), writer: W });
    assert.equal(out.code, 'role');
    assert.equal(W.calls.plan, 0, 'NetBox is not even read for somebody who may not write');
    assert.equal(W.calls.push, 0);
  });

  it('is not there at all for another organization', async () => {
    const id = approved();
    const W = driver({ comparisons: [CHANGES()], push: () => wrote([]) });
    const out = await write.run(id, { actor: { id: 11, username: 'ada', role: 'org_admin',
      orgId: 2, tenantId: 1 }, client: client(), snapshot: SNAPSHOT(), writer: W });
    assert.equal(out.code, 'not_found');
    assert.equal(W.calls.push, 0);
  });
});

describe('the write is handed to a person when it cannot be finished', () => {
  it('moves a failed write to manual review, with a reason', async () => {
    const id = approved();
    const W = driver({ comparisons: [CHANGES()],
      push: () => wrote([], [{ uid: 'dev:t7:5:u12', reason: 'NetBox said no' }]) });
    await write.run(id, { actor: ADMIN, client: client(), snapshot: SNAPSHOT(), writer: W,
      sender: async () => true });

    const out = write.toManualReview(id, { reason: 'the device type has to be created by hand',
      actor: ADMIN });
    assert.equal(out.error, undefined, out.why);
    assert.equal(store.getPlan(id).status, 'manual_review');
  });
});
