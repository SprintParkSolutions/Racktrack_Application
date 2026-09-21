/**
 * The verification rule, as the contract states it.
 *
 * A verification is the only thing standing between "somebody said they fixed
 * it" and a write to the customer's source of truth, so what matters here is
 * not that it runs: it is that a second scan seeing something DIFFERENT fails,
 * that a difference which has already been put right is not written again, and
 * that a failure sends the plan back rather than quietly passing.
 */
process.env.NODE_ENV = 'test';
process.env.RACKTRACK_SKIP_WORKER_POOL = '1';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after, before, beforeEach, describe, it } = require('node:test');

let tmp;
let store;
let service;
let verify;
let bus;

before(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-verify-'));
  process.env.RACKTRACK_APPROVALS_DB = path.join(tmp, 'approvals.db');
  process.env.RT_DATA_DIR = tmp;
  store = require('../../lib/approvals/store');
  service = require('../../lib/approvals/service');
  verify = require('../../lib/approvals/verify');
  bus = require('../../lib/approvals/bus');
});

after(() => {
  try { store._reset(); } catch { /* already closed */ }
  fs.rmSync(tmp, { recursive: true, force: true });
});

const CHANGES = () => [
  { type: 'Manufacturer', uid: 'mfr:tp-link', name: 'TP-Link', action: 'create' },
  { type: 'Device', uid: 'dev:t7:5:u12', name: 'Sw1', action: 'create' },
  { type: 'Interface', uid: 'if:dev:t7:5:u12:1', name: 'Gi1/0/1', action: 'create' },
  { type: 'Device', uid: 'dev:t7:5:u15', name: 'SW2', action: 'update', netboxId: 44,
    diff: { position: { from: 14, to: 15 } } },
  { type: 'Device', uid: 'dev:t7:5:u10', name: 'Core', action: 'noop', netboxId: 45 },
];

const report = (changes = CHANGES()) => ({
  rackUid: 'rack:t7:5', netboxUrl: 'http://netbox.test', customField: 'present',
  counts: { create: 3, update: 1, noop: 1 }, warnings: [], orphans: [], changes,
});

const ADMIN = { id: 5, username: 'meera', email: 'meera@example.test', role: 'org_admin',
  orgId: 1, tenantId: 7 };

/** A plan waiting for its verification scan. */
function waiting(changes = CHANGES()) {
  const filed = service.create({ scanId: 1, rackId: 'RK-1', rackName: 'RK-1', report: report(changes),
    actor: service.trustedActor('ravi'), orgId: 1, tenantId: 7 });
  store.updatePlan(filed.plan.id, { status: 'verification_pending' });
  return filed.plan.id;
}

let heard;
beforeEach(() => { heard = []; });
const listen = (event) => {
  const fn = (payload) => heard.push({ event, payload });
  bus.on(event, fn);
  return () => bus.off(event, fn);
};

describe('a verification confirms the drift, or says what it saw instead', () => {
  it('passes when the second scan sees the same differences', async () => {
    const id = waiting();
    const out = await verify.run(id, { kind: 'post_fix', changes: CHANGES(), actor: ADMIN });

    assert.equal(out.result, 'pass');
    assert.equal(out.detail.length, 2, 'the two decidable items are judged; the port follows its device');
    assert.ok(out.detail.every((d) => d.ok));
    assert.equal(store.getPlan(id).status, 'approval_pending');
    const rows = store.verificationsOf(id);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].kind, 'post_fix');
    assert.equal(rows[0].performedBy, 'meera');
  });

  it('sets aside an item that no longer differs, and still passes', async () => {
    const id = waiting();
    // Somebody moved SW2 back to position 15 in NetBox: it is not drift any more.
    const fixed = CHANGES().filter((c) => c.uid !== 'dev:t7:5:u15');
    const out = await verify.run(id, { kind: 'post_fix', changes: fixed, actor: ADMIN });

    assert.equal(out.result, 'pass');
    const row = out.detail.find((d) => d.uid === 'dev:t7:5:u15');
    assert.equal(row.ok, true);
    assert.equal(row.disposition, 'remediate');
    const item = store.getItem(id, 'dev:t7:5:u15');
    assert.equal(item.decision, 'not_applicable');
    assert.equal(item.disposition, 'remediate', 'the disposition is kept on the item');
    assert.equal(store.getPlan(id).status, 'approval_pending');
  });

  it('fails when the second scan sees a different value, and records what it saw', async () => {
    const stop = listen('verification_failed');
    const id = waiting();
    const moved = CHANGES().map((c) => (c.uid === 'dev:t7:5:u15'
      ? { ...c, diff: { position: { from: 14, to: 16 } } } : c));
    const out = await verify.run(id, { kind: 'post_fix', changes: moved, actor: ADMIN });
    stop();

    assert.equal(out.result, 'fail');
    const row = out.detail.find((d) => d.uid === 'dev:t7:5:u15');
    assert.equal(row.ok, false);
    assert.deepEqual(row.expected, { position: { from: 14, to: 15 } });
    assert.deepEqual(row.observed, { position: { from: 14, to: 16 } });

    const plan = store.getPlan(id);
    assert.equal(plan.status, 'reopened');
    assert.equal(plan.reopenReason, 'verification_failed');
    assert.equal(plan.reopenCount, 1);
    assert.equal(heard.length, 1, 'the people waiting on it are told');
    assert.equal(heard[0].payload.reason, 'verification_failed');
  });

  it('fails when the second scan reports a different action', async () => {
    const id = waiting();
    const other = CHANGES().map((c) => (c.uid === 'dev:t7:5:u12'
      ? { ...c, action: 'update', diff: { name: { from: 'Sw1', to: 'Sw1a' } } } : c));
    const out = await verify.run(id, { kind: 'post_fix', changes: other, actor: ADMIN });
    assert.equal(out.result, 'fail');
    assert.match(out.detail.find((d) => d.uid === 'dev:t7:5:u12').why, /reports update/);
  });
});

/** A plan whose approved items have just been written to NetBox. */
function written() {
  const id = waiting();
  for (const item of store.itemsOf(id)) {
    if (!item.decidable) continue;
    store.updateItem(id, item.uid, { decision: 'approved', decidedBy: 'meera', decidedById: 5,
      decidedAt: store.nowIso() }, { touch: false });
  }
  store.updatePlan(id, { status: 'written' });
  return id;
}

describe('the check after a write', () => {
  it('completes the plan when NetBox no longer differs', async () => {
    const id = written();
    const out = await verify.run(id, { kind: 'post_write', changes: [], actor: ADMIN });

    assert.equal(out.result, 'pass');
    const plan = store.getPlan(id);
    assert.equal(plan.status, 'completed');
    assert.ok(plan.completedAt);
    assert.equal(store.verificationsOf(id)[0].kind, 'post_write');
  });

  it('reopens with write_mismatch when NetBox still differs', async () => {
    const id = written();
    const out = await verify.run(id, { kind: 'post_write', changes: CHANGES(), actor: ADMIN });

    assert.equal(out.result, 'fail');
    const plan = store.getPlan(id);
    assert.equal(plan.status, 'reopened');
    assert.equal(plan.reopenReason, 'write_mismatch');
  });
});

describe('what a verification refuses', () => {
  it('needs a scan', async () => {
    const id = waiting();
    const out = await verify.run(id, { kind: 'post_fix', actor: ADMIN });
    assert.equal(out.code, 'bad_request');
    assert.match(out.why, /id of the new scan/);
  });

  it('refuses a scan of another rack', async () => {
    const scans = require('../../lib/netbox/store');
    const other = scans.addScan({ rackId: 'RK-2', source: 'test', payload: { snapshot: {} } });
    const id = waiting();
    const out = await verify.run(id, { kind: 'post_fix', scanId: other.id, actor: ADMIN });
    assert.equal(out.code, 'bad_request');
    assert.match(out.why, /different rack/);
  });

  it('refuses the scan the plan was compared from', async () => {
    const scans = require('../../lib/netbox/store');
    const same = scans.addScan({ rackId: 'RK-1', source: 'test', payload: { snapshot: {} } });
    const filed = service.create({ scanId: same.id, rackId: 'RK-1', report: report(),
      actor: service.trustedActor('ravi'), orgId: 1, tenantId: 7 });
    store.updatePlan(filed.plan.id, { status: 'verification_pending' });
    const out = await verify.run(filed.plan.id, { kind: 'post_fix', scanId: same.id, actor: ADMIN });
    assert.equal(out.code, 'bad_request');
    assert.match(out.why, /scan the rack again/);
  });

  // The phone keeps one adopted scan per rack and rebuilds it in place when the
  // rack is scanned again, and the Drift Desk names it by the rack's id. Both
  // used to make the verification impossible to pass from the screens.
  describe('the scan the phone actually produces', () => {
    const writer = { plan: async () => ({ changes: CHANGES() }) };
    /** A plan raised from a rack's one adopted scan, waiting to be verified. */
    function raisedFromAdopted(rackId) {
      const scans = require('../../lib/netbox/store');
      const adopted = scans.addScan({ rackId, source: 'adopted', payload: { snapshot: { devices: [] } } });
      const filed = service.create({ scanId: adopted.id, rackId, rackName: rackId, report: report(),
        actor: service.trustedActor('ravi'), orgId: 1, tenantId: 7 });
      // Raised an hour ago: these times are kept to the whole second, and a test
      // that raises, scans and rebuilds inside one second proves nothing about order.
      const hourAgo = new Date(Date.now() - 3600e3).toISOString().replace(/\.\d+Z$/, 'Z');
      store.updatePlan(filed.plan.id, { status: 'verification_pending', createdAt: hourAgo });
      return { scans, adopted, id: filed.plan.id, raised: Date.parse(store.getPlan(filed.plan.id).createdAt) };
    }
    const HALF_HOUR = 1800e3;

    it('takes the rack id the Drift Desk offers, and still refuses a rack not scanned again', async () => {
      const { id } = raisedFromAdopted('RK-PHONE-1');
      const out = await verify.run(id, { kind: 'post_fix', scanId: 'RK-PHONE-1', actor: ADMIN,
        client: {}, writer, scannedAt: () => null });
      assert.equal(out.code, 'bad_request', 'found the scan; it is refused for being old, not for being missing');
      assert.match(out.why, /scan the rack again/);
    });

    it('answers no such scan for a rack id nothing was adopted under', async () => {
      const { id } = raisedFromAdopted('RK-PHONE-2');
      const out = await verify.run(id, { kind: 'post_fix', scanId: 'RK-NOBODY', actor: ADMIN });
      assert.equal(out.code, 'not_found');
    });

    it('says the new scan has not been opened when the rack was scanned again but not adopted again', async () => {
      const { id } = raisedFromAdopted('RK-PHONE-3');
      const out = await verify.run(id, { kind: 'post_fix', scanId: 'RK-PHONE-3', actor: ADMIN,
        client: {}, writer, scannedAt: () => Date.now() + HALF_HOUR });
      assert.equal(out.code, 'bad_request');
      assert.match(out.why, /has not been opened yet/);
      assert.equal(store.getPlan(id).status, 'verification_pending', 'a refusal moves nothing');
    });

    it('passes on the same scan once it has been rebuilt from a newer scan of the rack', async () => {
      const { scans, adopted, id, raised } = raisedFromAdopted('RK-PHONE-4');
      // What adopting again does: the payload is replaced and the stage is stamped.
      scans.setPayload(adopted.id, { snapshot: { devices: [] } });
      scans.recordStage(adopted.id, 'detect', 'ok', 'adopted again');
      const out = await verify.run(id, { kind: 'post_fix', scanId: 'RK-PHONE-4', actor: ADMIN,
        client: {}, writer, scannedAt: () => raised + HALF_HOUR });
      assert.equal(out.result, 'pass');
      assert.equal(store.getPlan(id).status, 'approval_pending');
      const row = store.verificationsOf(id)[0];
      assert.equal(Number(row.scanId), adopted.id);
      assert.equal(row.evidence.sameScanRebuilt, true, 'the record says which kind of second scan it was');
    });

    it('does not count a result written in the same second the plan was raised', async () => {
      const { scans, adopted, id, raised } = raisedFromAdopted('RK-PHONE-6');
      scans.recordStage(adopted.id, 'detect', 'ok', 'adopted again');
      // 900 ms "after" a time that is only known to the second could be before it.
      const out = await verify.run(id, { kind: 'post_fix', scanId: 'RK-PHONE-6', actor: ADMIN,
        client: {}, writer, scannedAt: () => raised + 900 });
      assert.equal(out.code, 'bad_request');
      assert.match(out.why, /scan the rack again/);
    });

    it('takes the scan number as well as the rack id', async () => {
      const { scans, adopted, id, raised } = raisedFromAdopted('RK-PHONE-5');
      scans.recordStage(adopted.id, 'detect', 'ok', 'adopted again');
      const out = await verify.run(id, { kind: 'post_fix', scanId: adopted.id, actor: ADMIN,
        client: {}, writer, scannedAt: () => raised + HALF_HOUR });
      assert.equal(out.result, 'pass');
    });
  });

  it('refuses a plan that is not waiting for one', async () => {
    const id = waiting();
    store.updatePlan(id, { status: 'triage' });
    const out = await verify.run(id, { kind: 'post_fix', changes: CHANGES(), actor: ADMIN });
    assert.equal(out.code, 'transition');
  });

  it('refuses somebody from another Site, and another organization sees no plan', async () => {
    const id = waiting();
    const elsewhere = { id: 9, username: 'sam', role: 'member', orgId: 1, tenantId: 99 };
    const out = await verify.run(id, { kind: 'post_fix', changes: CHANGES(), actor: elsewhere });
    assert.equal(out.code, 'not_found', 'a plan of a Site they cannot see is not there at all');

    const stranger = { id: 11, username: 'ada', role: 'org_admin', orgId: 2, tenantId: 1 };
    const out2 = await verify.run(id, { kind: 'post_fix', changes: CHANGES(), actor: stranger });
    assert.equal(out2.code, 'not_found');
  });
});
