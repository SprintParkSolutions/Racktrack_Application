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
let bus;

before(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-write-'));
  process.env.RACKTRACK_APPROVALS_DB = path.join(tmp, 'approvals.db');
  process.env.RT_DATA_DIR = tmp;
  store = require('../../lib/approvals/store');
  shape = require('../../lib/approvals/shape');
  service = require('../../lib/approvals/service');
  write = require('../../lib/approvals/write');
  bus = require('../../lib/approvals/bus');
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

/** The SPOC a held check is with, and who approves it. */
const SPOC = { id: 41, username: 'dc007.spoc', email: 'spoc@example.test', role: 'member', orgId: 1, tenantId: 7 };

/** Everything the bus says while `fn` runs, as [event, payload] pairs. */
async function hearing(events, fn) {
  const heard = [];
  const offs = events.map((e) => { const l = (p) => heard.push([e, p]); bus.on(e, l); return () => bus.off(e, l); });
  try { await fn(); } finally { offs.forEach((off) => off()); }
  return heard;
}

/** A plan an admin has approved, ready to be written. `held` puts it with the SPOC, who signed it. */
function approved({ changes = CHANGES(), reject = [], held = false } = {}) {
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
  store.updatePlan(id, { status: 'approved', payloadHash: hash,
    ...(held ? { spocUserId: SPOC.id, spoc: { userId: SPOC.id, username: SPOC.username, email: SPOC.email },
      incident: { system: 'servicenow', number: 'INC0010042', sysId: 'abc', url: 'https://sn.test/INC0010042' } } : {}) });
  const signer = held ? SPOC : { id: 5, username: 'meera' };
  store.addDecision(id, { stage: 'first', approverId: signer.id, approver: signer.username, decision: 'approved',
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

    // And the registry holds what went in: one row for each new object, in the
    // approver's name, written by the admin who ran it.
    const rows = store.changesOf(id);
    assert.deepEqual(rows.map((r) => [r.itemUid, r.action, r.field, r.result]),
      [['mfr:tp-link', 'create', '*', 'written'], ['dev:t7:5:u12', 'create', '*', 'written']]);
    assert.equal(rows[0].approvedBy, 'meera');
    assert.equal(rows[0].writtenBy, 'meera');
    assert.equal(rows[0].attempt, 1);
    const verdicts = store.changesOf(id, { checks: true }).filter((r) => r.action === 'check');
    assert.deepEqual(verdicts.map((r) => [r.result, r.attempt, r.internal]), [['verified', 1, true]],
      'what the check afterwards found is a row of its own');
    assert.equal(store.listChanges({ seenBy: { orgId: 1 }, planId: id })[0].checked, 'verified',
      'and a list reads it back on the rows of that attempt');
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
    const rows = store.changesOf(id, { checks: true });
    assert.equal(rows.filter((r) => r.action !== 'check').every((r) => r.result === 'written'), true,
      'no written row is ever rewritten');
    assert.equal(rows[rows.length - 1].result, 'mismatch');
  });

  it('records an update field by field, a bind with its link fields marked, and leaves the unneeded catalogue out', async () => {
    const changes = [
      { type: 'Manufacturer', uid: 'mfr:unknown', name: 'Unknown', action: 'create' },
      { type: 'DeviceType', uid: 'dtype:router-8', name: 'Unidentified Router (8-port)', action: 'create' },
      { type: 'Device', uid: 'dev:t7:5:u20', name: 'Router U20 RK-1', action: 'rebind', netboxId: 199,
        diff: { racktrack_uid: { from: null, to: 'dev:t7:5:u20' }, recordId: { from: null, to: 199 },
          position: { from: 22, to: 20 } } },
      { type: 'Device', uid: 'dev:t7:5:u15', name: 'SW2', action: 'update', netboxId: 44,
        diff: { position: { from: 14, to: 15 }, serial: { from: null, to: 'FTX1' } } },
    ];
    const id = approved({ changes, held: true });
    const snapshot = { rackUid: 'rack:t7:5',
      manufacturers: [{ uid: 'mfr:unknown', name: 'Unknown' }],
      deviceTypes: [{ uid: 'dtype:router-8', model: 'Unidentified Router (8-port)', manufacturerUid: 'mfr:unknown' }],
      devices: [{ uid: 'dev:t7:5:u20', name: 'Router U20', deviceTypeUid: 'dtype:router-8' },
        { uid: 'dev:t7:5:u15', name: 'SW2', deviceTypeUid: 'dtype:router-8' }] };
    const W = driver({ comparisons: [changes, []],
      push: () => ({ counts: { rebind: 1, update: 1, skip: 2 }, changes: [
        { type: 'Manufacturer', uid: 'mfr:unknown', name: 'Unknown', action: 'skip', reason: 'not needed' },
        { type: 'DeviceType', uid: 'dtype:router-8', name: 'x', action: 'skip', reason: 'not needed' },
        changes[2], changes[3]] }) });
    const out = await write.runAfterApproval(id, { approver: SPOC, client: client(), writer: W, snapshot });

    assert.equal(out.write.state, 'written', out.write.why);
    assert.deepEqual([...W.calls.pushed[0].deferScaffolding].sort(), ['dtype:router-8', 'mfr:unknown'],
      'a bind and a shelf move need no make or model, so the writer is told to leave them');
    assert.equal(snapshot.deferScaffolding, undefined, 'the snapshot the check compares is not the one marked');
    const rows = store.changesOf(id);
    assert.deepEqual(rows.map((r) => [r.itemUid, r.action, r.field, r.before, r.after, r.internal]), [
      ['dev:t7:5:u20', 'rebind', 'racktrack_uid', null, 'dev:t7:5:u20', true],
      ['dev:t7:5:u20', 'rebind', 'position', 22, 20, false],
      ['dev:t7:5:u15', 'update', 'position', 14, 15, false],
      ['dev:t7:5:u15', 'update', 'serial', null, 'FTX1', false],
    ]);
    for (const r of rows) {
      assert.equal(r.approvedBy, SPOC.username);
      assert.equal(r.approvedById, SPOC.id);
      assert.equal(r.writtenBy, 'system');
      assert.equal(r.incidentNumber, 'INC0010042');
    }
    assert.equal(out.write.changes, 3, 'the answer counts the rows a person is shown');
    assert.equal(store.getPlan(id).writtenBy, 'system');
  });

  it('adds what it spares to what the snapshot already names, and drops neither', async () => {
    const changes = [
      { type: 'Manufacturer', uid: 'mfr:unknown', name: 'Unknown', action: 'create' },
      { type: 'DeviceRole', uid: 'role:router', name: 'Router', action: 'create' },
      { type: 'Device', uid: 'dev:t7:5:u15', name: 'SW2', action: 'update', netboxId: 44,
        diff: { position: { from: 14, to: 15 } } },
    ];
    const id = approved({ changes, held: true });
    // A box a person moved names its own catalogue on the snapshot (overrides.js), as a sorted list.
    const snapshot = { rackUid: 'rack:t7:5', deferScaffolding: ['role:moved-box'],
      manufacturers: [{ uid: 'mfr:unknown', name: 'Unknown' }], deviceRoles: [{ uid: 'role:router', name: 'Router' }],
      devices: [{ uid: 'dev:t7:5:u15', name: 'SW2', roleUid: 'role:router' }] };
    const W = driver({ comparisons: [changes, []], push: () => ({ counts: { update: 1 }, changes: [changes[2]] }) });
    const out = await write.runAfterApproval(id, { approver: SPOC, client: client(), writer: W, snapshot });
    assert.equal(out.write.state, 'written', out.write.why);
    assert.deepEqual([...W.calls.pushed[0].deferScaffolding].sort(), ['mfr:unknown', 'role:moved-box', 'role:router']);
  });

  // The site is on that list because of the write of 21 September: a shelf move
  // an approver had signed was refused and wrote NOTHING, because the site row
  // that rode along with it read as a create and NetBox already had a site of
  // that name. A row the write does not need is not in the write.
  it('leaves out the site a shelf move does not need', async () => {
    const changes = [
      { type: 'Site', uid: 'site:office-sprintpark', name: 'Office-Sprintpark', action: 'create' },
      { type: 'Device', uid: 'dev:t32:16:u20', name: 'SP-R1-U20-ACT', action: 'rebind', netboxId: 199,
        diff: { racktrack_uid: { from: null, to: 'dev:t32:16:u20' }, recordId: { from: null, to: 199 },
          position: { from: 22, to: 20 } } },
    ];
    const id = approved({ changes, held: true });
    const snapshot = { rackUid: 'rack:t32:16',
      sites: [{ uid: 'site:office-sprintpark', name: 'Office-Sprintpark', slug: 'office-sprintpark' }],
      racks: [{ uid: 'rack:t32:16', name: 'SP-HYB-RM01-R01-R1', siteUid: 'site:office-sprintpark' }],
      devices: [{ uid: 'dev:t32:16:u20', name: 'SP-R1-U20-ACT', siteUid: 'site:office-sprintpark',
        rackUid: 'rack:t32:16' }] };
    const W = driver({ comparisons: [changes, []],
      push: () => ({ counts: { rebind: 1, skip: 1 }, changes: [changes[1]] }) });
    const out = await write.runAfterApproval(id, { approver: SPOC, client: client(), writer: W, snapshot });

    assert.equal(out.write.state, 'written', out.write.why);
    assert.deepEqual([...W.calls.pushed[0].deferScaffolding], ['site:office-sprintpark'],
      'the rack is not being made and is not moving, so the site is left out of the write');
    assert.deepEqual(W.calls.pushed[0].sites.map((o) => o.uid), ['site:office-sprintpark'],
      'the row stays in the snapshot, so the rack under it still resolves');
  });

  it('keeps the site a rack it is making needs', async () => {
    const changes = [
      { type: 'Site', uid: 'site:office-sprintpark', name: 'Office-Sprintpark', action: 'create' },
      { type: 'Rack', uid: 'rack:t32:16', name: 'SP-HYB-RM01-R01-R1', action: 'create' },
      { type: 'Device', uid: 'dev:t32:16:u20', name: 'SP-R1-U20-ACT', action: 'update', netboxId: 44,
        diff: { position: { from: 22, to: 20 } } },
    ];
    const id = approved({ changes, held: true });
    const snapshot = { rackUid: 'rack:t32:16',
      sites: [{ uid: 'site:office-sprintpark', name: 'Office-Sprintpark', slug: 'office-sprintpark' }],
      racks: [{ uid: 'rack:t32:16', name: 'SP-HYB-RM01-R01-R1', siteUid: 'site:office-sprintpark' }],
      devices: [{ uid: 'dev:t32:16:u20', name: 'SP-R1-U20-ACT', siteUid: 'site:office-sprintpark',
        rackUid: 'rack:t32:16' }] };
    const W = driver({ comparisons: [changes, []],
      push: () => ({ counts: { create: 2, update: 1 }, changes }) });
    const out = await write.runAfterApproval(id, { approver: SPOC, client: client(), writer: W, snapshot });

    assert.equal(out.write.state, 'written', out.write.why);
    assert.equal(W.calls.pushed[0].deferScaffolding, undefined,
      'a rack has to hang off a site, so the site this write makes it at stays in');
  });
});

describe('the write a final approval starts', () => {
  it('writes as the system on the approver\'s word, and says written', async () => {
    const id = approved({ held: true, reject: ['dev:t7:5:u15'] });
    const W = driver({ comparisons: [CHANGES(), [CHANGES()[2]]], push: () => wrote(['mfr:tp-link', 'dev:t7:5:u12']) });
    const posted = [];
    let out;
    const heard = await hearing(['transition', 'completed', 'write_failed'], async () => {
      out = await write.runAfterApproval(id, { approver: SPOC, client: client(), snapshot: SNAPSHOT(), writer: W,
        sender: async (m) => { posted.push(m); return true; } });
    });
    assert.deepEqual(out.write, { state: 'written', status: 'completed', written: 2, failed: 0, failures: [],
      changes: 2, why: null });
    assert.equal(out.plan.status, 'completed');
    const written = heard.find(([e, p]) => e === 'transition' && p.to === 'written')[1];
    assert.deepEqual(written.approver, { id: SPOC.id, username: SPOC.username }, 'the event names the approver');
    assert.equal(written.actor.system, true);
    assert.equal(written.changes.written, 2);
    assert.equal(written.changes.lines.length, 2);
    assert.ok(heard.some(([e]) => e === 'completed'));
    assert.equal(posted.length, 0);
  });

  it('says nothing_to_write when nothing a person approved needs writing', async () => {
    const id = approved({ held: true, reject: ['dev:t7:5:u12', 'dev:t7:5:u15'] });
    const W = driver({ comparisons: [CHANGES()], push: () => wrote([]) });
    const out = await write.runAfterApproval(id, { approver: SPOC, client: client(), snapshot: SNAPSHOT(), writer: W });
    assert.equal(out.write.state, 'nothing_to_write');
    assert.equal(out.write.status, 'completed');
    assert.equal(W.calls.push, 0);
    assert.equal(store.changesOf(id).length, 0);
  });

  it('says failed, records the refusal, emails nobody itself and leaves it to the write_failed notice', async () => {
    const id = approved({ held: true });
    const W = driver({ comparisons: [CHANGES()],
      push: () => wrote(['mfr:tp-link', 'dev:t7:5:u12'], [{ uid: 'dev:t7:5:u15', reason: 'duplicate name' }]) });
    const auth = require('../../auth');
    const real = auth.sendNotice;
    const posted = [];
    auth.sendNotice = async (m) => { posted.push(m); return true; };
    let out;
    let heard;
    try {
      heard = await hearing(['write_failed'], async () => {
        out = await write.runAfterApproval(id, { approver: SPOC, client: client(), snapshot: SNAPSHOT(), writer: W });
      });
    } finally { auth.sendNotice = real; }
    assert.equal(out.write.state, 'failed');
    assert.equal(out.write.status, 'write_failed');
    assert.equal(out.write.written, 2);
    assert.equal(out.write.failed, 1);
    assert.deepEqual(out.write.failures.map((f) => f.uid), ['dev:t7:5:u15']);
    assert.equal(posted.length, 0, 'a system write has no person to email from here');
    assert.equal(heard.length, 1, 'the write_failed event is what tells the admins and the holder');
    assert.deepEqual(heard[0][1].approver, { id: SPOC.id, username: SPOC.username });
    assert.equal(heard[0][1].changes.failed, 1);
    const failed = store.changesOf(id).filter((r) => r.result === 'failed');
    assert.deepEqual(failed.map((r) => [r.itemUid, r.action, r.field, r.reason]),
      [['dev:t7:5:u15', 'update', '*', 'duplicate name']]);

    // The retry stays with an admin, by hand, under the same approval.
    const bySpoc = await write.run(id, { actor: SPOC, client: client(), snapshot: SNAPSHOT(), writer: W });
    assert.equal(bySpoc.code, 'role');
    const second = driver({ comparisons: [[CHANGES()[2]], []], push: () => wrote(['dev:t7:5:u15']) });
    const again = await write.run(id, { actor: ADMIN, client: client(), snapshot: SNAPSHOT(), writer: second,
      sender: async () => true });
    assert.equal(again.status, 'completed');
    const rows = store.changesOf(id);
    assert.deepEqual(rows.filter((r) => r.attempt === 2).map((r) => [r.itemUid, r.result, r.writtenBy, r.approvedBy]),
      [['dev:t7:5:u15', 'written', 'meera', SPOC.username]], 'the second attempt adds its own rows and rewrites none');
    assert.equal(rows.filter((r) => r.attempt === 1).length, 3);
  });

  it('says failed when the push throws, with one row that says the write was lost', async () => {
    const id = approved({ held: true });
    const W = driver({ comparisons: [CHANGES()], push: () => { throw new Error('socket hang up'); } });
    const out = await write.runAfterApproval(id, { approver: SPOC, client: client(), snapshot: SNAPSHOT(), writer: W });
    assert.equal(out.write.state, 'failed');
    assert.equal(out.write.status, 'write_failed');
    assert.match(out.write.why, /socket hang up/);
    const rows = store.changesOf(id);
    assert.deepEqual(rows.map((r) => [r.itemUid, r.field, r.result]), [['*', '*', 'failed']]);
    assert.match(rows[0].reason, /socket hang up/);
  });

  it('bounces a stale approval back to the holder, and an old check back to approval_pending', async () => {
    const moved = CHANGES().map((c) => (c.uid === 'dev:t7:5:u15'
      ? { ...c, diff: { position: { from: 14, to: 19 } } } : c));
    const id = approved({ held: true });
    const W = driver({ comparisons: [moved], push: () => wrote([]) });
    let out;
    const heard = await hearing(['transition', 'assigned'], async () => {
      out = await write.runAfterApproval(id, { approver: SPOC, client: client(), snapshot: SNAPSHOT(), writer: W });
    });
    assert.equal(out.write.state, 'bounced');
    assert.equal(out.write.status, 'assigned');
    assert.match(out.write.why, /NetBox changed after you approved, so nothing was written/);
    assert.equal(W.calls.push, 0);
    const plan = store.getPlan(id);
    assert.equal(plan.status, 'assigned', 'it lands with its holder again');
    assert.equal(plan.payloadHash, null);
    assert.equal(plan.spocUserId, SPOC.id);
    assert.equal(store.itemsOf(id).filter((i) => i.decidable).every((i) => i.decision === 'approved'), true,
      'what was decided stays decided');
    const back = heard.find(([e, p]) => e === 'transition' && p.to === 'assigned')[1];
    assert.equal(back.reason, 'netbox_changed');
    assert.equal(back.stale, true);
    assert.equal(heard.some(([e]) => e === 'assigned'), false, 'nobody is told it was assigned to them a second time');
    assert.equal(store.changesOf(id).length, 0);

    // The approval no longer covers the items: same road, another reason.
    const id2 = approved({ held: true });
    store.updateItem(id2, 'dev:t7:5:u15', { decision: 'rejected' }, { touch: false });
    const W2 = driver({ comparisons: [CHANGES()], push: () => wrote([]) });
    const out2 = await write.runAfterApproval(id2, { approver: SPOC, client: client(), snapshot: SNAPSHOT(), writer: W2 });
    assert.equal(out2.write.state, 'bounced');
    assert.equal(out2.write.status, 'assigned');
    assert.match(out2.write.why, /Review the check and approve it again/);

    // A check from before the SPOC change goes where it always went.
    const old = approved();
    const W3 = driver({ comparisons: [moved], push: () => wrote([]) });
    const out3 = await write.run(old, { actor: ADMIN, client: client(), snapshot: SNAPSHOT(), writer: W3 });
    assert.equal(out3.code, 'guard');
    assert.equal(store.getPlan(old).status, 'approval_pending');
  });

  it('answers writing when the write outlasts the wait, and the write still finishes', async () => {
    const id = approved({ held: true, reject: ['dev:t7:5:u15'] });
    let release;
    const gate = new Promise((r) => { release = r; });
    const W = driver({ comparisons: [CHANGES(), [CHANGES()[2]]],
      push: async () => { await gate; return wrote(['mfr:tp-link', 'dev:t7:5:u12']); } });
    const done = new Promise((resolve) => {
      const l = (p) => { if (p.plan.id === id) { bus.off('completed', l); resolve(); } };
      bus.on('completed', l);
    });
    const out = await write.runAfterApproval(id, { approver: SPOC, client: client(), snapshot: SNAPSHOT(),
      writer: W, waitMs: 20 });
    assert.deepEqual(out.write, { state: 'writing', status: 'write_in_progress', written: 0, failed: 0,
      failures: [], changes: 0, why: null });
    release();
    await done;
    assert.equal(store.getPlan(id).status, 'completed');
    assert.equal(store.changesOf(id).length, 2);
  });

  it('says not_started when the write cannot begin, leaves it approved and tells who a failed write tells', async () => {
    const id = approved({ held: true });
    const W = { plan: async () => { throw new Error('connect ECONNREFUSED'); }, push: async () => wrote([]) };
    let out;
    const heard = await hearing(['write_failed'], async () => {
      out = await write.runAfterApproval(id, { approver: SPOC, client: client(), snapshot: SNAPSHOT(), writer: W });
    });
    assert.equal(out.write.state, 'not_started');
    assert.equal(out.write.status, 'approved');
    assert.match(out.write.why, /NetBox could not be compared before the write/);
    assert.equal(heard.length, 1);
    assert.equal(heard[0][1].notStarted, true);
    assert.equal(store.getPlan(id).status, 'approved', 'an organization admin can start it again');
    const W2 = driver({ comparisons: [CHANGES(), []], push: () => wrote(['mfr:tp-link', 'dev:t7:5:u12', 'dev:t7:5:u15']) });
    const again = await write.run(id, { actor: ADMIN, client: client(), snapshot: SNAPSHOT(), writer: W2,
      sender: async () => true });
    assert.equal(again.status, 'completed');
  });

  it('frees a check a restart left in the middle of a write', () => {
    const id = approved({ held: true });
    store.updatePlan(id, { status: 'write_in_progress' });
    assert.deepEqual(write.recoverStranded(), [], 'a write that has only just begun is left alone');
    assert.deepEqual(write.recoverStranded({ now: Date.now() + 11 * 60 * 1000 }).includes(id), true);
    const plan = store.getPlan(id);
    assert.equal(plan.status, 'write_failed');
    assert.match(plan.result.error, /restarted/);
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

  it('refuses a person who is not an admin to write by hand: their approval is what writes', async () => {
    const id = approved({ held: true });
    const W = driver({ comparisons: [CHANGES(), []], push: () => wrote(['mfr:tp-link', 'dev:t7:5:u12', 'dev:t7:5:u15']) });
    for (const actor of [{ id: 9, username: 'sam', role: 'approver', orgId: 1, tenantId: 7 }, SPOC]) {
      const out = await write.run(id, { actor, client: client(), snapshot: SNAPSHOT(), writer: W });
      assert.equal(out.code, 'role');
    }
    assert.equal(W.calls.plan, 0, 'NetBox is not even read for somebody who may not write');
    assert.equal(W.calls.push, 0);
    // The same person's approval does write: the server does it, in their name.
    const out = await write.runAfterApproval(id, { approver: SPOC, client: client(), snapshot: SNAPSHOT(), writer: W });
    assert.equal(out.write.state, 'written');
    assert.equal(W.calls.push, 1);
    assert.equal(store.changesOf(id)[0].approvedBy, SPOC.username);
    assert.equal(store.changesOf(id)[0].writtenBy, 'system');
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
