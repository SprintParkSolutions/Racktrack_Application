/**
 * The push workflow, end to end, against the real plan store.
 *
 * What matters here is not that the functions run. It is that the four rules
 * the workflow exists to enforce actually hold:
 *
 *   1. an approval is a signature on one specific list of changes;
 *   2. nothing unapproved is written;
 *   3. a resolved ticket is not an approval;
 *   4. if NetBox moves between the approval and the write, the fingerprint
 *      changes, so the write can be stopped.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after, before, describe, it } = require('node:test');

let plans;
let tmp;

before(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-plans-'));
  process.env.RT_DATA_DIR = tmp;
  // Plans live in SQLite now. Point the store at a throwaway database in this
  // test's own directory so nothing here can reach the real auth.db.
  process.env.RACKTRACK_APPROVALS_DB = path.join(tmp, 'approvals.db');
  delete require.cache[require.resolve('../../lib/netbox/plans')];
  require('../../lib/approvals/store')._reset();
  plans = require('../../lib/netbox/plans');
});

after(() => {
  require('../../lib/approvals/store')._reset();
  fs.rmSync(tmp, { recursive: true, force: true });
});

/**
 * The two steps that come before any approve or reject: the admin hands the
 * item to somebody, and that person reports back. Rule 2 of the frozen
 * workflow - decide() refuses a decision on an item that has not been round.
 */
function handedBack(id, uid, { assignee = 'sam', finding = 'looked, as described' } = {}) {
  const out = plans.decide(id, [{ uid, decision: 'ticketed', assignee }], { by: 'meera' });
  if (out.refused.length) throw new Error(`could not assign ${uid}: ${out.refused[0].why}`);
  plans.resolveTicket(id, uid, { by: assignee, finding });
}

/** A comparison result shaped exactly as writer.plan() returns one. */
const report = (overrides = {}) => ({
  rackUid: 'rack:RK-TEST',
  netboxUrl: 'http://netbox.test',
  customField: 'present',
  counts: { create: 3, update: 1, noop: 1 },
  warnings: [],
  orphans: [],
  changes: [
    { type: 'Manufacturer', uid: 'mfr:tp-link', name: 'TP-Link', action: 'create' },
    { type: 'DeviceType', uid: 'dtype:sg2428p', name: 'SG2428P', action: 'create' },
    { type: 'Device', uid: 'dev:u12', name: 'Sw1', action: 'create' },
    { type: 'Device', uid: 'dev:u15', name: 'SW2', action: 'update',
      netboxId: 44, diff: { position: { from: 14, to: 15 } } },
    { type: 'Device', uid: 'dev:u10', name: 'Core', action: 'noop', netboxId: 45 },
  ],
  ...overrides,
});

describe('a plan splits decisions from scaffolding', () => {
  it('asks about devices and not about manufacturers', () => {
    const p = plans.create({ scanId: 1, rackId: 'RK-TEST', report: report(), by: 'ravi' });
    const byUid = Object.fromEntries(p.items.map((i) => [i.uid, i]));

    assert.equal(byUid['dev:u12'].decidable, true, 'a device is a decision');
    assert.equal(byUid['dev:u12'].decision, 'pending');
    assert.equal(byUid['mfr:tp-link'].decidable, false, 'a manufacturer is scaffolding');
    assert.equal(byUid['mfr:tp-link'].supporting, true);
    assert.equal(byUid['dev:u10'].decidable, false, 'a noop changes nothing, so there is nothing to ask');

    assert.equal(plans.summarise(p.items).decidable, 2);
    assert.equal(plans.isSettled(p), false, 'nothing decided yet');
  });
});

describe('the fingerprint is a signature on one specific list', () => {
  it('ignores order but notices a changed value', () => {
    const a = report();
    const shuffled = report({ changes: [...a.changes].reverse() });
    assert.equal(plans.fingerprint(a.changes), plans.fingerprint(shuffled.changes),
      'the same changes in a different order are the same plan');

    const moved = report({
      changes: a.changes.map((c) => (c.uid === 'dev:u15'
        ? { ...c, diff: { position: { from: 14, to: 16 } } } : c)),
    });
    assert.notEqual(plans.fingerprint(a.changes), plans.fingerprint(moved.changes),
      'one different field value is a different plan');
  });

  it('does not change when only a noop differs', () => {
    const a = report();
    const b = report({
      changes: a.changes.map((c) => (c.action === 'noop' ? { ...c, name: 'renamed' } : c)),
    });
    assert.equal(plans.fingerprint(a.changes), plans.fingerprint(b.changes),
      'a noop cannot be overwritten, so it cannot invalidate an approval');
  });
});

describe('only what an admin approved is written', () => {
  it('withholds everything else, and keeps scaffolding so references resolve', () => {
    const p = plans.create({ scanId: 2, rackId: 'RK-TEST', report: report(), by: 'ravi' });
    handedBack(p.id, 'dev:u12');
    handedBack(p.id, 'dev:u15');
    plans.decide(p.id, [
      { uid: 'dev:u12', decision: 'approved' },
      { uid: 'dev:u15', decision: 'rejected', note: 'that is not where it is' },
    ], { by: 'meera' });

    const after = plans.get(p.id);
    assert.equal(plans.isSettled(after), true);

    const excluded = plans.excludedUids(after);
    assert.ok(excluded.has('dev:u15'), 'the rejected device is held back');
    assert.ok(!excluded.has('dev:u12'), 'the approved device goes through');
    assert.ok(!excluded.has('mfr:tp-link'),
      'scaffolding is never withheld, or the approved device cannot resolve its type');
    assert.ok(!excluded.has('dev:u10'), 'a noop stays, so the walk can still see it');

    const snap = {
      rackUid: 'rack:RK-TEST',
      manufacturers: [{ uid: 'mfr:tp-link' }],
      devices: [{ uid: 'dev:u12' }, { uid: 'dev:u15' }, { uid: 'dev:u10' }],
    };
    const filtered = plans.filterSnapshot(snap, excluded);
    assert.deepEqual(filtered.devices.map((d) => d.uid), ['dev:u12', 'dev:u10']);
    assert.equal(filtered.manufacturers.length, 1);
    assert.equal(filtered.rackUid, 'rack:RK-TEST', 'non-object fields are left alone');
  });

  it('records who decided what, and why a rejection happened', () => {
    const p = plans.create({ scanId: 3, rackId: 'RK-TEST', report: report(), by: 'ravi' });
    handedBack(p.id, 'dev:u15');
    plans.decide(p.id, [{ uid: 'dev:u15', decision: 'rejected', note: 'wrong shelf' }],
      { by: 'meera' });
    const item = plans.get(p.id).items.find((i) => i.uid === 'dev:u15');
    assert.equal(item.decidedBy, 'meera');
    assert.equal(item.note, 'wrong shelf');
    assert.ok(item.decidedAt, 'a decision without a date cannot be aged out');
  });
});

describe('a ticket is a detour, not a way out', () => {
  it('refuses a ticket with nobody on it', () => {
    const p = plans.create({ scanId: 4, rackId: 'RK-TEST', report: report(), by: 'ravi' });
    const out = plans.decide(p.id, [{ uid: 'dev:u12', decision: 'ticketed' }], { by: 'meera' });
    assert.equal(out.applied.length, 0);
    assert.match(out.refused[0].why, /assigned to somebody/);
  });

  it('comes back to the admin undecided, and writes nothing by itself', () => {
    const p = plans.create({ scanId: 5, rackId: 'RK-TEST', report: report(), by: 'ravi' });
    plans.decide(p.id, [{ uid: 'dev:u12', decision: 'ticketed', assignee: 'sam',
                          note: 'is it really at U12?' }], { by: 'meera' });

    let item = plans.get(p.id).items.find((i) => i.uid === 'dev:u12');
    assert.equal(item.decision, 'ticketed');
    assert.equal(item.ticket.status, 'open');
    assert.equal(item.ticket.assignee, 'sam');
    assert.ok(plans.excludedUids(plans.get(p.id)).has('dev:u12'),
      'a ticketed item is not written while the ticket is open');

    plans.resolveTicket(p.id, 'dev:u12', { by: 'sam', finding: 'yes, U12', outcome: 'confirmed' });

    item = plans.get(p.id).items.find((i) => i.uid === 'dev:u12');
    assert.equal(item.ticket.status, 'resolved');
    assert.equal(item.ticket.finding, 'yes, U12');
    assert.equal(item.decision, 'pending', 'a resolved ticket is NOT an approval');
    assert.ok(plans.excludedUids(plans.get(p.id)).has('dev:u12'),
      'still withheld until the admin decides again');

    plans.decide(p.id, [{ uid: 'dev:u12', decision: 'approved' }], { by: 'meera' });
    assert.ok(!plans.excludedUids(plans.get(p.id)).has('dev:u12'),
      'only the admin approving lets it through');
  });

  it('cannot be overridden while open, and is closed by the decision once resolved', () => {
    const p = plans.create({ scanId: 6, rackId: 'RK-TEST', report: report(), by: 'ravi' });
    plans.decide(p.id, [{ uid: 'dev:u12', decision: 'ticketed', assignee: 'sam' }], { by: 'meera' });

    const early = plans.decide(p.id, [{ uid: 'dev:u12', decision: 'approved' }], { by: 'meera' });
    assert.deepEqual(early.refused, [{ uid: 'dev:u12', why: 'assign first' }],
      'an open ticket is not overridden by a direct approve');
    let item = plans.get(p.id).items.find((i) => i.uid === 'dev:u12');
    assert.equal(item.ticket.status, 'open', 'the ticket is untouched');
    assert.equal(item.decision, 'ticketed');

    plans.resolveTicket(p.id, 'dev:u12', { by: 'sam', finding: 'it is there', outcome: 'confirmed' });
    plans.decide(p.id, [{ uid: 'dev:u12', decision: 'approved' }], { by: 'meera' });
    item = plans.get(p.id).items.find((i) => i.uid === 'dev:u12');
    assert.equal(item.ticket.status, 'closed', 'the decision closes the resolved ticket');
    assert.equal(item.ticket.closedWith, 'approved');
    assert.equal(item.ticket.closedBy, 'meera');
    assert.equal(item.ticket.finding, 'it is there', 'the finding is kept, not overwritten');
    assert.equal(item.ticket.resolvedBy, 'sam', 'and so is who resolved it');
    assert.equal(item.ticket.outcome, 'confirmed');
  });
});

describe('the admin assigns before they decide', () => {
  it('refuses approve and reject on an item nobody has been asked to check', () => {
    const p = plans.create({ scanId: 60, rackId: 'RK-TEST', report: report(), by: 'ravi' });
    const out = plans.decide(p.id, [
      { uid: 'dev:u12', decision: 'approved' },
      { uid: 'dev:u15', decision: 'rejected', note: 'looks wrong from here' },
    ], { by: 'meera' });
    assert.equal(out.applied.length, 0, 'nothing was decided from a desk');
    assert.deepEqual(out.refused, [
      { uid: 'dev:u12', why: 'assign first' },
      { uid: 'dev:u15', why: 'assign first' },
    ]);
    const items = plans.get(p.id).items;
    assert.equal(items.find((i) => i.uid === 'dev:u12').decision, 'pending');
    assert.equal(items.find((i) => i.uid === 'dev:u15').decision, 'pending');
    assert.equal(plans.isSettled(plans.get(p.id)), false);
  });

  it('accepts assigning as the first move, and decides once it has come back', () => {
    const p = plans.create({ scanId: 61, rackId: 'RK-TEST', report: report(), by: 'ravi' });
    const first = plans.decide(p.id, [{ uid: 'dev:u12', decision: 'ticketed', assignee: 'sam' }],
      { by: 'meera' });
    assert.deepEqual(first.applied, [{ uid: 'dev:u12', decision: 'ticketed' }]);

    plans.resolveTicket(p.id, 'dev:u12', { by: 'sam', finding: 'yes' });
    const second = plans.decide(p.id, [{ uid: 'dev:u12', decision: 'rejected', note: 'no' }],
      { by: 'meera' });
    assert.deepEqual(second.applied, [{ uid: 'dev:u12', decision: 'rejected' }]);
    assert.equal(second.refused.length, 0);
  });

  it('can be assigned again after it has come back', () => {
    const p = plans.create({ scanId: 62, rackId: 'RK-TEST', report: report(), by: 'ravi' });
    handedBack(p.id, 'dev:u12', { assignee: 'sam' });
    const again = plans.decide(p.id, [{ uid: 'dev:u12', decision: 'ticketed', assignee: 'priya' }],
      { by: 'meera' });
    assert.equal(again.refused.length, 0);
    const item = plans.get(p.id).items.find((i) => i.uid === 'dev:u12');
    assert.equal(item.ticket.assignee, 'priya');
    assert.equal(item.ticket.status, 'open', 'a fresh ticket, waiting on the new person');
  });

  it('keeps the assignee\'s NetBox id and email on the ticket, and on the ports that follow', () => {
    const p = plans.create({ scanId: 63, rackId: 'RK-TEST', by: 'ravi', report: report({ changes: [
      { type: 'Device', uid: 'dev:u12', name: 'Sw1', action: 'create' },
      { type: 'Interface', uid: 'if:dev:u12:1', name: 'Gi1/0/1', action: 'create' },
    ] }) });
    plans.decide(p.id, [{ uid: 'dev:u12', decision: 'ticketed', assignee: 'Meera Raghavan',
                          assigneeId: 7, assigneeEmail: 'meera.raghavan@sprintpark.com' }],
      { by: 'meera' });
    const items = Object.fromEntries(plans.get(p.id).items.map((i) => [i.uid, i]));
    assert.equal(items['dev:u12'].ticket.assigneeId, 7);
    assert.equal(items['dev:u12'].ticket.assigneeEmail, 'meera.raghavan@sprintpark.com');
    assert.equal(items['if:dev:u12:1'].ticket.assigneeId, 7, 'the port names the same person');
    assert.equal(items['if:dev:u12:1'].ticket.assigneeEmail, 'meera.raghavan@sprintpark.com');
  });
});

describe('a written plan is closed', () => {
  it('records the outcome and refuses further decisions', () => {
    const p = plans.create({ scanId: 7, rackId: 'RK-TEST', report: report(), by: 'ravi' });
    handedBack(p.id, 'dev:u12');
    handedBack(p.id, 'dev:u15');
    plans.decide(p.id, [
      { uid: 'dev:u12', decision: 'approved' },
      { uid: 'dev:u15', decision: 'approved' },
    ], { by: 'meera' });

    plans.markApplied(p.id, {
      by: 'meera',
      result: { counts: { create: 3, update: 1 }, changes: report().changes },
    });

    const done = plans.get(p.id);
    assert.equal(done.status, 'applied');
    assert.equal(done.appliedBy, 'meera');
    assert.equal(done.result.written, 4);
    assert.equal(done.result.failed, 0);
    assert.ok(done.events.some((e) => e.what === 'written to NetBox'));
    assert.equal(plans.summarise(done.items, done.result).written, 4);

    const out = plans.decide(p.id, [{ uid: 'dev:u12', decision: 'rejected' }], { by: 'meera' });
    assert.match(out.error, /already been written/);
  });
});

describe('a write NetBox refused part of', () => {
  it('is write_failed, not applied: the failures are listed and the plan stays open', () => {
    const p = plans.create({ scanId: 70, rackId: 'RK-TEST', report: report(), by: 'ravi' });
    handedBack(p.id, 'dev:u12');
    handedBack(p.id, 'dev:u15');
    plans.decide(p.id, [
      { uid: 'dev:u12', decision: 'approved' },
      { uid: 'dev:u15', decision: 'approved' },
    ], { by: 'meera' });

    plans.markApplied(p.id, { by: 'meera', result: {
      counts: { create: 2, fail: 1 },
      changes: [
        { type: 'Manufacturer', uid: 'mfr:tp-link', name: 'TP-Link', action: 'create' },
        { type: 'Device', uid: 'dev:u12', name: 'Sw1', action: 'create' },
        { type: 'Device', uid: 'dev:u15', name: 'SW2', action: 'fail',
          reason: 'lookup failed: "position 15 is taken"' },
      ],
    } });

    const after = plans.get(p.id);
    assert.equal(after.status, 'write_failed');
    assert.equal(after.appliedAt, undefined, 'it was not applied');
    assert.equal(after.lastWriteBy, 'meera');
    assert.equal(after.result.written, 2);
    assert.equal(after.result.failed, 1);
    assert.deepEqual(after.result.failures, [{ uid: 'dev:u15', type: 'Device', name: 'SW2',
      reason: 'lookup failed: "position 15 is taken"' }]);
    assert.ok(after.events.some((e) => e.what === 'write failed'));
    assert.ok(plans.STATUSES.has('write_failed'));

    const s = plans.summarise(after.items, after.result);
    assert.equal(s.failed, 1, 'the summary says how many NetBox refused');
    assert.equal(s.written, 2);
    assert.equal(plans.list({ scanId: 70 })[0].summary.failed, 1, 'and so does the index row');

    const retry = plans.decide(p.id, [{ uid: 'dev:u15', decision: 'ticketed', assignee: 'sam' }],
      { by: 'meera' });
    assert.equal(retry.error, undefined, 'a write_failed plan is still open to the admin');
  });
});

describe('a person sees their own plans', () => {
  it('filters the index by who raised the plan', () => {
    plans.create({ scanId: 80, rackId: 'RK-MINE', report: report(), by: 'ravi', orgId: 5 });
    plans.create({ scanId: 81, rackId: 'RK-MINE', report: report(), by: 'priya', orgId: 5 });
    assert.equal(plans.list({ rackId: 'RK-MINE', orgId: 5, createdBy: 'ravi' }).length, 1);
    assert.equal(plans.list({ rackId: 'RK-MINE', orgId: 5, createdBy: 'priya' }).length, 1);
    assert.equal(plans.list({ rackId: 'RK-MINE', orgId: 5, createdBy: 'nobody' }).length, 0);
    assert.equal(plans.list({ rackId: 'RK-MINE', orgId: 5 }).length, 2, 'no filter, no narrowing');
  });
});

describe('the history survives', () => {
  it('lists plans newest first, and filters by rack', () => {
    plans.create({ scanId: 8, rackId: 'RK-OTHER', report: report(), by: 'ravi' });
    const mine = plans.list({ rackId: 'RK-TEST' });
    const other = plans.list({ rackId: 'RK-OTHER' });
    assert.ok(mine.length >= 7);
    assert.equal(other.length, 1);
    assert.ok(mine[0].id > mine[1].id, 'newest first');
    assert.ok(mine[0].summary, 'the index carries a summary, so a board needs no file reads');
  });
});

describe('a technician hands it to an admin', () => {
  it('marks it waiting, and carries their note across', () => {
    const p = plans.create({ scanId: 20, rackId: 'RK-TEST', report: report(), by: 'ravi' });
    assert.equal(p.status, 'open', 'a fresh comparison is nobody else’s problem yet');

    const out = plans.submit(p.id, { by: 'ravi', note: 'U15 looks wrong to me' });
    assert.equal(out.plan.status, 'submitted');
    assert.equal(out.plan.submittedBy, 'ravi');
    assert.equal(out.plan.submittedNote, 'U15 looks wrong to me');
    assert.ok(out.plan.events.some((e) => e.what === 'sent to the admin'));
  });

  it('shows up in the admin inbox, and an unsent one does not', () => {
    const sent = plans.create({ scanId: 21, rackId: 'RK-INBOX', report: report(), by: 'ravi' });
    plans.submit(sent.id, { by: 'ravi' });
    plans.create({ scanId: 22, rackId: 'RK-INBOX', report: report(), by: 'ravi' });

    const inbox = plans.list({ rackId: 'RK-INBOX', status: 'submitted' });
    assert.equal(inbox.length, 1);
    assert.equal(inbox[0].id, sent.id);
    assert.equal(inbox[0].submittedBy, 'ravi', 'the index carries it, so an inbox needs no file reads');
  });

  it('is idempotent, and refuses once written', () => {
    const p = plans.create({ scanId: 23, rackId: 'RK-TEST', report: report(), by: 'ravi' });
    plans.submit(p.id, { by: 'ravi' });
    assert.equal(plans.submit(p.id, { by: 'ravi' }).already, true);

    plans.markApplied(p.id, { by: 'meera', result: { counts: {}, changes: [] } });
    assert.match(plans.submit(p.id, { by: 'ravi' }).error, /already been written/);
  });
});

describe('hearing back from ServiceNow', () => {
  const withTicket = (scanId) => {
    const p = plans.create({ scanId, rackId: 'RK-SN', report: report(), by: 'ravi' });
    plans.decide(p.id, [{ uid: 'dev:u12', decision: 'ticketed', assignee: 'sam' }], { by: 'meera' });
    const plan = plans.get(p.id);
    const item = plan.items.find((i) => i.uid === 'dev:u12');
    item.ticket.external = { system: 'servicenow', sysId: 'abc123', number: 'INC001', state: 'new' };
    plans.save(plan);
    return p.id;
  };

  it('a closed incident returns the item to the admin, undecided', () => {
    const id = withTicket(30);
    const { changed } = plans.applyTicketStates(id, {
      abc123: { number: 'INC001', state: 'resolved', closed: true,
                notes: 'It is at U12. NetBox was wrong.' },
    });

    assert.equal(changed.length, 1);
    const item = plans.get(id).items.find((i) => i.uid === 'dev:u12');
    assert.equal(item.ticket.status, 'resolved');
    assert.equal(item.ticket.finding, 'It is at U12. NetBox was wrong.');
    assert.equal(item.decision, 'pending', 'somebody having looked is not somebody having approved');
    assert.ok(plans.excludedUids(plans.get(id)).has('dev:u12'), 'still withheld from the write');
  });

  it('an incident still open only updates its state', () => {
    const id = withTicket(31);
    plans.applyTicketStates(id, {
      abc123: { number: 'INC001', state: 'in progress', closed: false },
    });
    const item = plans.get(id).items.find((i) => i.uid === 'dev:u12');
    assert.equal(item.ticket.external.state, 'in progress');
    assert.equal(item.ticket.status, 'open');
    assert.equal(item.decision, 'ticketed', 'nothing comes back until it is closed');
  });

  it('lists what it is waiting on, and stops once resolved', () => {
    const id = withTicket(32);
    assert.deepEqual(plans.openSysIds(plans.get(id)), ['abc123']);
    plans.applyTicketStates(id, { abc123: { number: 'INC001', state: 'closed', closed: true } });
    assert.deepEqual(plans.openSysIds(plans.get(id)), [], 'nothing left to ask about');
  });
});

describe('plans are isolated by organisation', () => {
  const rep = () => ({ rackUid: 'rack:RK-ISO', counts: {}, warnings: [], orphans: [],
    changes: [{ type: 'Device', uid: 'dev:x', name: 'X', action: 'create' }] });

  it('a plan belongs to one org, and only that org lists it', () => {
    plans.create({ scanId: 90, rackId: 'RK-ISO', report: rep(), by: 'a', orgId: 13, tenantId: 14 });
    plans.create({ scanId: 91, rackId: 'RK-ISO', report: rep(), by: 'b', orgId: 99, tenantId: 88 });

    const org13 = plans.list({ rackId: 'RK-ISO', orgId: 13 });
    const org99 = plans.list({ rackId: 'RK-ISO', orgId: 99 });
    assert.equal(org13.length, 1, 'org 13 sees only its own');
    assert.equal(org99.length, 1, 'org 99 sees only its own');
    assert.notEqual(org13[0].id, org99[0].id);
  });

  it('canSee is strict — no owner bypass, no cross-org, no unowned', () => {
    assert.equal(plans.canSee(13, 13), true, 'same org sees it');
    assert.equal(plans.canSee(13, 99), false, 'another org cannot');
    assert.equal(plans.canSee(13, null), false, 'a caller with no org cannot');
    assert.equal(plans.canSee(null, 13), false, 'an unowned plan is visible to nobody');
    assert.equal(plans.canSee(null, null), false, 'null does not match null');
  });

  it('an org filter of undefined returns everything (server-side callers)', () => {
    const all = plans.list({ rackId: 'RK-ISO' });
    assert.ok(all.length >= 2, 'no orgId given = no scoping');
  });
});
