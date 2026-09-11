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
  delete require.cache[require.resolve('../../lib/netbox/plans')];
  plans = require('../../lib/netbox/plans');
});

after(() => fs.rmSync(tmp, { recursive: true, force: true }));

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

  it('closes an open ticket when the admin decides directly', () => {
    const p = plans.create({ scanId: 6, rackId: 'RK-TEST', report: report(), by: 'ravi' });
    plans.decide(p.id, [{ uid: 'dev:u12', decision: 'ticketed', assignee: 'sam' }], { by: 'meera' });
    plans.decide(p.id, [{ uid: 'dev:u12', decision: 'approved' }], { by: 'meera' });
    const item = plans.get(p.id).items.find((i) => i.uid === 'dev:u12');
    assert.equal(item.ticket.status, 'closed');
    assert.match(item.ticket.outcome, /approved/);
  });
});

describe('a written plan is closed', () => {
  it('records the outcome and refuses further decisions', () => {
    const p = plans.create({ scanId: 7, rackId: 'RK-TEST', report: report(), by: 'ravi' });
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
    assert.ok(done.events.some((e) => e.what === 'written to NetBox'));

    const out = plans.decide(p.id, [{ uid: 'dev:u12', decision: 'rejected' }], { by: 'meera' });
    assert.match(out.error, /already been written/);
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
