/**
 * The nine reports, and the one rule that makes them worth reading.
 *
 * EVERY NUMBER OPENS THE LIST IT COUNTS. The first test here takes each row of
 * the backlog and the SLA report, hands its filters straight to the plan list
 * the sub-application uses, and insists the two agree. A report that counts
 * plans a list will not show is a report that sends somebody looking for a
 * plan that is not there.
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
let service;
let reports;
let sla;

const ADMIN = { id: 5, username: 'meera', email: 'meera@example.test', role: 'org_admin',
  orgId: 1, tenantId: 7 };
const OTHER = { id: 9, username: 'ada', role: 'org_admin', orgId: 2, tenantId: 1 };

const changes = (n) => [
  { type: 'Device', uid: `dev:t7:5:u${n}`, name: `SW${n}`, action: 'create' },
  { type: 'Device', uid: `dev:t7:5:u${n + 50}`, name: `SW${n + 50}`, action: 'update',
    netboxId: 40 + n, diff: { position: { from: n, to: n + 1 } } },
];

function planOf({ status = 'triage', priority = 'P3', orgId = 1, n = 1, patch = {} } = {}) {
  const filed = service.create({ scanId: n, rackId: `RK-${n}`, rackName: `RK-${n}`,
    report: { rackUid: 'rack:t7:5', netboxUrl: 'http://netbox.test', customField: 'present',
      counts: {}, warnings: [], orphans: [], changes: changes(n) },
    actor: service.trustedActor('ravi'), orgId, tenantId: 7 });
  return store.updatePlan(filed.plan.id, { status, priority, ...patch });
}

before(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-reports-'));
  process.env.RACKTRACK_APPROVALS_DB = path.join(tmp, 'approvals.db');
  process.env.RT_DATA_DIR = tmp;
  store = require('../../lib/approvals/store');
  service = require('../../lib/approvals/service');
  reports = require('../../lib/approvals/reports');
  sla = require('../../lib/approvals/sla');

  // A day's worth of work, in the states a report is about.
  planOf({ status: 'triage', n: 1 });
  planOf({ status: 'triage', n: 2, priority: 'P1' });
  planOf({ status: 'approval_pending', n: 3 });
  const held = planOf({ status: 'assigned', n: 4, priority: 'P1' });
  planOf({ status: 'rejected', n: 5 });
  planOf({ status: 'write_failed', n: 6, patch: { result: { counts: { create: 3, fail: 1 },
    written: 3, failed: 1, attempts: 2, failures: [{ uid: 'dev:t7:5:u6', type: 'Device',
      name: 'SW6', reason: 'duplicate name' }], writtenUids: ['dev:t7:5:u6'] } } });
  planOf({ status: 'completed', n: 7, patch: { completedAt: store.nowIso(),
    writtenAt: store.nowIso(), writtenBy: 'meera',
    result: { counts: { create: 2 }, written: 2, failed: 0, attempts: 1, failures: [],
      writtenUids: ['dev:t7:5:u7'] } } });
  planOf({ status: 'completed', n: 8, patch: { reopenCount: 1, completedAt: store.nowIso() } });
  // Another organization's plan, which must never appear in these numbers.
  planOf({ status: 'triage', n: 9, orgId: 2 });

  // A clock that has run out, and one that is still running.
  sla.onTransition({ plan: held, to: 'assigned' }, { when: store.nowIso() });
  const clock = store.slaOf(held.id).find((c) => c.clock === 'acceptance');
  store.updateSla(clock.id, { status: 'breached', breachedAt: store.nowIso() });

  // Somebody was asked, and somebody answered.
  store.putTicket(held.id, 'dev:t7:5:u4', { assignee: 'sam', assigneeEmail: 'sam@example.test',
    assigneeUserId: 6, status: 'resolved', raisedBy: 'meera', raisedAt: store.nowIso(),
    resolvedBy: 'sam', resolvedById: 6, resolvedAt: store.nowIso(), finding: 'it is as described' });
  store.addDecision(3, { stage: 'first', approverId: 5, approver: 'meera', decision: 'approved',
    payloadHash: 'abc', planVersion: 1 });
});

after(() => {
  try { store._reset(); } catch { /* already closed */ }
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('every number opens the list it counts', () => {
  it('the backlog agrees with the plan list, row for row', () => {
    const report = reports.run('backlog', { actor: ADMIN });
    assert.ok(report.rows.length > 1);
    for (const row of report.rows) {
      const listed = service.list(ADMIN, { ...row.filters, limit: 200 });
      assert.equal(listed.plans.length, row.count,
        `the backlog says ${row.count} ${row.key} and the list shows ${listed.plans.length}`);
      assert.ok(listed.plans.every((p) => p.status === row.key));
    }
    assert.deepEqual(report.filtersFor[report.rows[0].key], report.rows[0].filters);
  });

  it('the SLA report speaks the five words a screen uses, and each plan is in one of them', () => {
    const report = reports.run('sla', { actor: ADMIN });
    assert.deepEqual(report.rows.map((r) => r.key),
      ['on_track', 'at_risk', 'breached', 'paused', 'none']);
    assert.equal(report.rows.find((r) => r.key === 'breached').count, 1);

    // Nothing is counted twice: the five rows are the open backlog.
    const open = reports.run('backlog', { actor: ADMIN }).total;
    assert.equal(report.rows.reduce((n, r) => n + r.count, 0), open);

    // `breached` means the same word to the plan list as it does here, so this
    // number really does open the list behind it.
    const breached = report.rows.find((r) => r.key === 'breached');
    assert.equal(service.list(ADMIN, { ...breached.filters, limit: 200 }).plans.length,
      breached.count);
  });

  it('counts one organization and not the other', () => {
    const mine = reports.run('backlog', { actor: ADMIN });
    const theirs = reports.run('backlog', { actor: OTHER });
    assert.equal(mine.rows.find((r) => r.key === 'triage').count, 2);
    assert.equal(theirs.rows.find((r) => r.key === 'triage').count, 1);
    assert.equal(service.list(OTHER, { status: 'triage' }).plans.length, 1);
  });
});

describe('the other six', () => {
  it('quality counts how often work comes back', () => {
    const report = reports.run('quality', { actor: ADMIN });
    const by = Object.fromEntries(report.rows.map((r) => [r.key, r.count]));
    assert.equal(by.filed, 8, 'the other organization is not counted');
    assert.equal(by.completed, 2);
    assert.equal(by.first_pass, 1, 'one of the two came back before it was done');
    assert.equal(by.rejected, 1);
    assert.equal(by.reopened, 1);
    assert.equal(by.write_failed, 1);
    assert.equal(report.firstPassRate, 50);
    // The rows that carry filters really do open a list.
    const row = report.rows.find((r) => r.key === 'rejected');
    assert.equal(service.list(ADMIN, row.filters).plans.length, row.count);
  });

  it('trends puts a day on each line', () => {
    const report = reports.run('trends', { actor: ADMIN });
    assert.equal(report.rows.length, 1, 'everything here was raised today');
    assert.equal(report.rows[0].raised, 8);
    assert.equal(report.rows[0].completed, 2);
    assert.match(report.rows[0].day, /^\d{4}-\d{2}-\d{2}$/);
  });

  it('resolvers says who was asked and who answered', () => {
    const report = reports.run('resolvers', { actor: ADMIN });
    const sam = report.rows.find((r) => r.person === 'sam');
    assert.equal(sam.asked, 1);
    assert.equal(sam.answered, 1);
    assert.equal(sam.openNow, 0);
    assert.equal(service.list(ADMIN, sam.filters).plans.length, 1);
  });

  it('approvals says who decided', () => {
    const report = reports.run('approvals', { actor: ADMIN });
    const meera = report.rows.find((r) => r.person === 'meera');
    assert.equal(meera.approved, 1);
    assert.equal(meera.rejected, 0);
  });

  it('writes counts the objects as well as the plans', () => {
    const report = reports.run('writes', { actor: ADMIN });
    assert.equal(report.objects.written, 5, 'three from the failed write and two from the clean one');
    assert.equal(report.objects.failed, 1);
    assert.equal(report.failures.length, 1);
    assert.equal(report.failures[0].failed, 1);
    const row = report.rows.find((r) => r.key === 'write_failed');
    assert.equal(row.count, 1);
    assert.equal(service.list(ADMIN, row.filters).plans.length, 1);
  });

  it('exceptions says what is being hidden', () => {
    const exceptions = require('../../lib/approvals/exceptions');
    const ex = exceptions.create({ justification: 'the lab rack is deliberately unmanaged',
      rackId: 'RK-1', itemType: 'Device',
      expiresAt: new Date(Date.now() + 86400000 * 30).toISOString() }, { actor: ADMIN }).exception;
    exceptions.applyToPlan(1, { actor: ADMIN });

    const report = reports.run('exceptions', { actor: ADMIN });
    const row = report.rows.find((r) => r.id === ex.id);
    assert.equal(row.active, true);
    assert.equal(row.scope, 'rack RK-1 / Device');
    assert.ok(row.items >= 1, 'it says how many questions it is answering for us');
    assert.equal(report.hiding, row.items);
  });
});

describe('the ninth: what the writes changed', () => {
  const change = (planId, over = {}) => store.addChange({ orgId: 1, tenantId: 7, planId, attempt: 1,
    rackId: 'RK-7', rackName: 'RACK-07', itemUid: 'dev:t7:5:u7', objectType: 'Device', objectName: 'SW7',
    action: 'update', field: 'position', before: 6, after: 7, result: 'written', approvedBy: 'meera',
    approvedById: 5, writtenBy: 'system', writtenAt: store.nowIso(), incidentNumber: 'INC0010007', ...over });

  it('counts a check by the registry rows its filter opens, and leaves the link fields out', () => {
    const p7 = store.listPlans({ orgId: 1, rackId: 'RK-7', limit: 1 })[0].id;
    const p6 = store.listPlans({ orgId: 1, rackId: 'RK-6', limit: 1 })[0].id;
    change(p7);
    change(p7, { field: 'serial', before: null, after: 'FTX7' });
    change(p7, { field: 'racktrack_uid', before: null, after: 'dev:t7:5:u7', internal: true });
    change(p6, { rackId: 'RK-6', rackName: 'RACK-06', field: '*', result: 'failed', reason: 'duplicate name' });
    change(9, { orgId: 2, rackId: 'RK-9' });

    const report = reports.run('changes', { actor: ADMIN });
    assert.deepEqual(report.rows.map((r) => [r.planId, r.written, r.failed]), [[p6, 0, 1], [p7, 2, 0]],
      'newest first, one organization only');
    for (const row of report.rows) {
      const behind = service.listChanges(ADMIN, report.filtersFor[row.key]).changes;
      assert.equal(behind.length, row.written + row.failed, `check ${row.planId} opens what it counts`);
    }
    assert.equal(report.rows[1].approvedBy, 'meera');
    assert.equal(report.rows[1].incidentNumber, 'INC0010007');
    const csv = reports.toCsv(report).split('\n');
    assert.equal(csv[0], 'Check,Rack,Written,Failed,Approved by,Incident,When');
    assert.equal(csv.length, 4);
  });

  it('is empty, not an error, for somebody the registry is not for', () => {
    const report = reports.run('changes', { actor: { id: 77, username: 'ravi', role: 'member', orgId: 1, tenantId: 7 } });
    assert.deepEqual(report.rows, []);
  });
});

describe('the same report as a file', () => {
  it('writes the columns it declares, with the commas escaped', () => {
    const report = reports.run('backlog', { actor: ADMIN });
    const csv = reports.toCsv(report).split('\n');
    assert.equal(csv[0], 'Status,Plans,Oldest');
    assert.equal(csv.length, report.rows.length + 2, 'a header, the rows, and a final newline');
    assert.match(csv[1], /^[A-Za-z ]+,\d+,/);
  });

  it('has no report by that name', () => {
    assert.equal(reports.run('whatever', { actor: ADMIN }), null);
    assert.equal(reports.NAMES.length, 9);
  });
});
