/**
 * Accepted drift, and the two ways it could go wrong.
 *
 * An exception stops a question being asked, so the danger is not that it
 * fails to match - it is that it matches too much, or that it never stops. So:
 * the scope narrows exactly as far as it says and no further, an attribute
 * exception cannot hide a whole new device, and an exception that has expired
 * or been revoked marks nothing at all.
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
let exceptions;

before(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-exceptions-'));
  process.env.RACKTRACK_APPROVALS_DB = path.join(tmp, 'approvals.db');
  process.env.RT_DATA_DIR = tmp;
  store = require('../../lib/approvals/store');
  service = require('../../lib/approvals/service');
  exceptions = require('../../lib/approvals/exceptions');
});

after(() => {
  try { store._reset(); } catch { /* already closed */ }
  fs.rmSync(tmp, { recursive: true, force: true });
});

// Each test starts with nothing accepted: an exception left live by the test
// before would quietly cover the plans of the one after it.
beforeEach(() => {
  for (const ex of store.listExceptions({ orgId: 1 })) store.revokeException(ex.id);
});

const ADMIN = { id: 5, username: 'meera', role: 'org_admin', orgId: 1, tenantId: 7 };
const soon = (days) => new Date(Date.now() + days * 86400000).toISOString().replace(/\.\d+Z$/, 'Z');
const ago = (days) => new Date(Date.now() - days * 86400000).toISOString().replace(/\.\d+Z$/, 'Z');

const CHANGES = () => [
  { type: 'Device', uid: 'dev:t7:5:u12', name: 'LAB-SW1', action: 'create' },
  { type: 'Interface', uid: 'if:dev:t7:5:u12:1', name: 'Gi1/0/1', action: 'create' },
  { type: 'Device', uid: 'dev:t7:5:u15', name: 'SW2', action: 'update', netboxId: 44,
    diff: { position: { from: 14, to: 15 } } },
];

function planOf({ rackId = 'RK-1', changes = CHANGES(), tenantId = 7 } = {}) {
  const filed = service.create({ scanId: 1, rackId, rackName: rackId,
    report: { rackUid: 'rack:t7:5', netboxUrl: 'http://netbox.test', customField: 'present',
      counts: {}, warnings: [], orphans: [], changes },
    actor: service.trustedActor('ravi'), orgId: 1, tenantId });
  return filed.plan;
}

const file = (body) => {
  const out = exceptions.create({ justification: 'the lab rack is deliberately unmanaged',
    expiresAt: soon(90), ...body }, { actor: ADMIN });
  if (out.error) throw new Error(out.why);
  return out.exception;
};

describe('writing one down', () => {
  it('needs a reason and an end date', () => {
    assert.match(exceptions.create({ justification: 'no', expiresAt: soon(10) },
      { actor: ADMIN }).why, /why this difference is accepted/);
    assert.match(exceptions.create({ justification: 'a perfectly good reason, at length' },
      { actor: ADMIN }).why, /expires on/);
    assert.match(exceptions.create({ justification: 'a perfectly good reason, at length',
      startsAt: soon(10), expiresAt: soon(2) }, { actor: ADMIN }).why, /after it starts/);
    assert.match(exceptions.create({ kind: 'whatever', justification: 'a perfectly good reason',
      expiresAt: soon(10) }, { actor: ADMIN }).why, /kind has to be/);
  });

  it('belongs to the caller\'s organization, and nobody else\'s', () => {
    const ex = file({ rackId: 'RK-1' });
    assert.equal(ex.orgId, 1);
    const seen = exceptions.list({ actor: { id: 9, username: 'ada', role: 'org_admin', orgId: 2 } });
    assert.equal(seen.exceptions.length, 0);
    const out = exceptions.revoke(ex.id, { actor: { id: 9, role: 'org_admin', orgId: 2 } });
    assert.equal(out.code, 'not_found');
  });
});

describe('what an exception covers', () => {
  it('marks a matching item, and the ports that follow it', () => {
    const ex = file({ rackId: 'RK-1', itemType: 'Device', itemName: 'LAB-*' });
    // Filing a plan applies whatever already covers it (service.create calls
    // onPlanCreated), so this second pass finds nothing left to do. What is
    // asserted is the state it leaves, which is the same either way.
    const plan = planOf();
    exceptions.applyToPlan(plan.id, { actor: ADMIN });

    const item = store.getItem(plan.id, 'dev:t7:5:u12');
    assert.equal(item.decision, 'excepted');
    assert.equal(item.exceptionId, ex.id);
    assert.equal(store.getItem(plan.id, 'if:dev:t7:5:u12:1').decision, 'excepted',
      'a port follows its device here as everywhere else');
    assert.equal(store.getItem(plan.id, 'dev:t7:5:u15').decision, 'pending',
      'the device the exception does not name is still a question');
    assert.equal(store.eventsOf(plan.id).filter((e) => e.action === 'exception.applied').length, 1);
    exceptions.revoke(ex.id, { actor: ADMIN });
  });

  it('does not reach another rack, another Site or another name', () => {
    const ex = file({ rackId: 'RK-9', itemType: 'Device' });
    const plan = planOf({ rackId: 'RK-1' });
    assert.equal(exceptions.applyToPlan(plan.id, { actor: ADMIN }).applied.length, 0);
    exceptions.revoke(ex.id, { actor: ADMIN });

    const site = file({ tenantId: 8, itemType: 'Device' });
    assert.equal(exceptions.applyToPlan(planOf({ rackId: 'RK-2' }).id, { actor: ADMIN }).applied.length, 0);
    exceptions.revoke(site.id, { actor: ADMIN });

    const named = file({ itemName: 'CORE-1' });
    assert.equal(exceptions.applyToPlan(planOf({ rackId: 'RK-3' }).id, { actor: ADMIN }).applied.length, 0);
    exceptions.revoke(named.id, { actor: ADMIN });
  });

  it('an attribute exception covers the field it names, never a whole new device', () => {
    const ex = file({ attribute: 'position' });
    const plan = planOf({ rackId: 'RK-4' });
    exceptions.applyToPlan(plan.id, { actor: ADMIN });

    assert.equal(store.getItem(plan.id, 'dev:t7:5:u15').decision, 'excepted',
      'only the item whose position differs');
    assert.equal(store.getItem(plan.id, 'dev:t7:5:u12').decision, 'pending',
      'a device that is not in NetBox at all is not an accepted field difference');
    exceptions.revoke(ex.id, { actor: ADMIN });
  });
});

describe('an exception that has stopped', () => {
  it('marks nothing once it has expired', () => {
    const ex = store.addException({ orgId: 1, tenantId: null, rackId: null, itemType: 'Device',
      kind: 'accepted_drift', justification: 'it ran out yesterday', ownerId: 5,
      startsAt: ago(30), expiresAt: ago(1) });
    assert.equal(exceptions.isActive(ex), false);
    assert.equal(exceptions.applyToPlan(planOf({ rackId: 'RK-5' }).id, { actor: ADMIN }).applied.length, 0);
  });

  it('marks nothing once it has been revoked, and leaves what it marked alone', () => {
    const ex = file({ itemType: 'Device', itemName: 'LAB-SW1' });
    const marked = planOf({ rackId: 'RK-6' });
    exceptions.applyToPlan(marked.id, { actor: ADMIN });
    assert.equal(store.getItem(marked.id, 'dev:t7:5:u12').decision, 'excepted');

    exceptions.revoke(ex.id, { actor: ADMIN });
    assert.equal(store.getItem(marked.id, 'dev:t7:5:u12').decision, 'excepted',
      'history is not rewritten');
    const later = planOf({ rackId: 'RK-7' });
    assert.equal(exceptions.applyToPlan(later.id, { actor: ADMIN }).applied.length, 0);
  });

  it('has not started yet', () => {
    const ex = file({ itemType: 'Device', startsAt: soon(5), expiresAt: soon(50) });
    assert.equal(exceptions.isActive(ex), false);
    assert.equal(exceptions.applyToPlan(planOf({ rackId: 'RK-8' }).id, { actor: ADMIN }).applied.length, 0);
    exceptions.revoke(ex.id, { actor: ADMIN });
  });
});

describe('the ones that need looking at', () => {
  it('lists what expires or comes up for review soon', () => {
    const near = file({ itemName: 'NEAR', expiresAt: soon(10) });
    const far = file({ itemName: 'FAR', expiresAt: soon(300) });
    const review = file({ itemName: 'REVIEW', expiresAt: soon(300), reviewAt: soon(5) });

    const out = exceptions.expiringSoon({ actor: ADMIN, days: 30 });
    const ids = out.exceptions.map((e) => e.id);
    assert.ok(ids.includes(near.id));
    assert.ok(ids.includes(review.id), 'a review date counts as well as an expiry');
    assert.ok(!ids.includes(far.id));
    for (const ex of [near, far, review]) exceptions.revoke(ex.id, { actor: ADMIN });
  });
});

describe('change windows', () => {
  it('needs a datacentre and an end after its start', () => {
    assert.match(exceptions.createWindow({ startsAt: soon(1), endsAt: soon(2) },
      { actor: ADMIN }).why, /tenantId/);
    assert.match(exceptions.createWindow({ tenantId: 7, startsAt: soon(2), endsAt: soon(1) },
      { actor: ADMIN }).why, /ends after it starts/);
  });

  it('flags a plan raised inside one', () => {
    const out = exceptions.createWindow({ tenantId: 7, startsAt: ago(1), endsAt: soon(1),
      note: 'planned move' }, { actor: ADMIN });
    const plan = planOf({ rackId: 'RK-10' });
    assert.equal(exceptions.inWindow(plan), true);

    // Filing it flagged the window already; flagging again changes nothing.
    exceptions.flagWindow(plan.id);
    assert.equal(store.getPlan(plan.id).windowId, out.window.id);
    assert.equal(store.eventsOf(plan.id).filter((e) => e.action === 'window.raised_in').length, 1);

    exceptions.deleteWindow(out.window.id, { actor: ADMIN });
    assert.equal(exceptions.inWindow(store.getPlan(plan.id)), false);
  });

  it('does not flag a plan of another datacentre', () => {
    const out = exceptions.createWindow({ tenantId: 8, startsAt: ago(1), endsAt: soon(1) },
      { actor: ADMIN });
    const plan = planOf({ rackId: 'RK-11', tenantId: 7 });
    assert.equal(exceptions.flagWindow(plan.id).window, null);
    exceptions.deleteWindow(out.window.id, { actor: ADMIN });
  });
});

describe('everything that happens when a plan is filed', () => {
  it('applies the exceptions and the window in one call', () => {
    const ex = file({ itemType: 'Device', itemName: 'LAB-SW1' });
    const window = exceptions.createWindow({ tenantId: 7, startsAt: ago(1), endsAt: soon(1) },
      { actor: ADMIN }).window;
    const plan = planOf({ rackId: 'RK-12' });

    // service.create calls this the moment the plan is filed, so by the time
    // a test can look, it has run. Calling it again is safe and does nothing,
    // which is the promise; the state is what matters.
    exceptions.onPlanCreated(plan.id, { actor: ADMIN });
    assert.equal(store.getItem(plan.id, 'dev:t7:5:u12').decision, 'excepted');
    assert.equal(store.getItem(plan.id, 'dev:t7:5:u12').exceptionId, ex.id);
    assert.equal(store.getPlan(plan.id).windowId, window.id);

    exceptions.revoke(ex.id, { actor: ADMIN });
    exceptions.deleteWindow(window.id, { actor: ADMIN });
  });
});

describe('the same comparison twice', () => {
  it('finds the open plan rather than filing a second one', () => {
    const first = planOf({ rackId: 'RK-20' });
    const found = exceptions.openDuplicateOf({ orgId: 1, rackId: 'RK-20',
      fingerprint: first.fingerprint });
    assert.equal(found.id, first.id);

    // service.create already does this on the preview path: the same rack with
    // the same differences hands back the plan that is already open.
    const again = service.create({ scanId: 2, rackId: 'RK-20', report: {
      rackUid: 'rack:t7:5', netboxUrl: 'http://netbox.test', customField: 'present',
      counts: {}, warnings: [], orphans: [], changes: CHANGES() },
    actor: service.trustedActor('ravi'), orgId: 1, tenantId: 7, reuse: true });
    assert.equal(again.reused, true);
    assert.equal(again.plan.id, first.id);
  });
});
