/**
 * A decision is made per device, and its ports go with it.
 *
 * A brand-new rack with two 48-port switches used to put 290 questions to the
 * admin, one per object, and would have raised 290 incidents. These tests pin
 * the rule that replaces that: an interface follows its device, the device
 * carries the decision and the ticket, and the counts a person sees count
 * devices.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after, before, describe, it } = require('node:test');

let plans;
let tmp;

before(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-plans-group-'));
  process.env.RT_DATA_DIR = tmp;
  delete require.cache[require.resolve('../../lib/netbox/plans')];
  plans = require('../../lib/netbox/plans');
});

after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const DEV = 'dev:RK-NEW:u16';
const DEV2 = 'dev:RK-NEW:u20';

/** A new rack: one switch with three ports, a second device, the scaffolding. */
const report = (changes) => ({
  rackUid: 'rack:RK-NEW', netboxUrl: 'http://netbox.test', counts: {}, warnings: [], orphans: [],
  changes: changes || [
    { type: 'Manufacturer', uid: 'mfr:cisco', name: 'Cisco', action: 'create' },
    { type: 'Device', uid: DEV, name: 'SW-16', action: 'create' },
    { type: 'Interface', uid: `if:${DEV}:1`, name: 'Gi1/0/1', action: 'create' },
    { type: 'Interface', uid: `if:${DEV}:2`, name: 'Gi1/0/2', action: 'create' },
    { type: 'Interface', uid: `if:${DEV}:3`, name: 'Gi1/0/3', action: 'create' },
  ],
});

const byUid = (plan) => Object.fromEntries(plan.items.map((i) => [i.uid, i]));

describe('interfaces follow their device', () => {
  it('a device with three ports is one decision, not four', () => {
    const p = plans.create({ scanId: 1, rackId: 'RK-NEW', report: report(), by: 'ravi' });
    const items = byUid(p);

    assert.equal(items[DEV].decidable, true, 'the device is the decision');
    assert.equal(items[DEV].parentUid, null, 'a device has no parent');
    for (const n of [1, 2, 3]) {
      const port = items[`if:${DEV}:${n}`];
      assert.equal(port.parentUid, DEV, 'the port knows its device');
      assert.equal(port.following, true);
      assert.equal(port.decidable, false, 'a port is not asked about on its own');
      assert.equal(port.decision, 'pending', 'it mirrors the device, which is pending');
    }
    assert.equal(items['mfr:cisco'].parentUid, null, 'only interfaces have a parent');

    const s = plans.summarise(p.items);
    assert.equal(s.decidable, 1, 'one thing to decide');
    assert.equal(s.pending, 1, '"1 still waiting on you", not 4');
    assert.equal(s.following, 3, 'three ports follow');
  });

  it('a port stays a decision of its own when its device is not in question', () => {
    const p = plans.create({ scanId: 2, rackId: 'RK-NEW', by: 'ravi', report: report([
      { type: 'Device', uid: DEV, name: 'SW-16', action: 'noop', netboxId: 7 },
      { type: 'Interface', uid: `if:${DEV}:5`, name: 'Gi1/0/5', action: 'update',
        netboxId: 70, diff: { enabled: { from: false, to: true } } },
    ]) });
    const port = byUid(p)[`if:${DEV}:5`];
    assert.equal(port.parentUid, DEV);
    assert.equal(port.following, false, 'nobody is being asked about the device');
    assert.equal(port.decidable, true, 'so the port itself is the question');
    assert.equal(plans.summarise(p.items).pending, 1);
  });

  it('refuses a decision aimed at a following port', () => {
    const p = plans.create({ scanId: 3, rackId: 'RK-NEW', report: report(), by: 'ravi' });
    const out = plans.decide(p.id, [{ uid: `if:${DEV}:1`, decision: 'approved' }], { by: 'meera' });
    assert.equal(out.applied.length, 0);
    assert.match(out.refused[0].why, /not a decidable item/);
  });
});

describe('a decision on the device is a decision on its ports', () => {
  it('assigning the device shares one ticket with its three ports', () => {
    const p = plans.create({ scanId: 4, rackId: 'RK-NEW', report: report(), by: 'ravi' });
    const out = plans.decide(p.id, [{ uid: DEV, decision: 'ticketed', assignee: 'sam',
                                      note: 'is this switch really at U16?' }], { by: 'meera' });
    assert.deepEqual(out.applied, [{ uid: DEV, decision: 'ticketed' }], 'one decision recorded');

    const items = byUid(plans.get(p.id));
    const dev = items[DEV];
    assert.equal(dev.decision, 'ticketed');
    assert.equal(dev.ticket.status, 'open');
    assert.equal(dev.ticket.sharedWith, undefined, 'the device holds the real ticket');

    for (const n of [1, 2, 3]) {
      const port = items[`if:${DEV}:${n}`];
      assert.equal(port.decision, 'ticketed', 'the port follows');
      assert.equal(port.ticket.sharedWith, DEV, 'its ticket is a reference to the device ticket');
      assert.equal(port.ticket.id, dev.ticket.id, 'same ticket id');
      assert.equal(port.ticket.assignee, 'sam');
      assert.equal(port.ticket.status, 'open');
    }

    const s = plans.summarise(plans.get(p.id).items);
    assert.equal(s.ticketed, 1, 'counted as one item with somebody');
    assert.equal(s.openTickets, 1, 'one ticket, not four');
    assert.equal(s.pending, 0);
  });

  it('the parent external, once raised, is what the ports point at', () => {
    const p = plans.create({ scanId: 5, rackId: 'RK-NEW', report: report(), by: 'ravi' });
    plans.decide(p.id, [{ uid: DEV, decision: 'ticketed', assignee: 'sam' }], { by: 'meera' });

    // What the decide route does after tickets.raise(): stamp the device and
    // every port that follows it with the same incident.
    const plan = plans.get(p.id);
    const ext = { system: 'servicenow', number: 'INC0042', sysId: 's42', state: 'new' };
    const dev = plan.items.find((i) => i.uid === DEV);
    dev.ticket.external = ext;
    for (const c of plans.childrenOf(plan, DEV)) c.ticket.external = ext;
    plans.save(plan);

    const items = byUid(plans.get(p.id));
    assert.equal(items[`if:${DEV}:2`].ticket.external.number, 'INC0042');
    assert.equal(new Set(plans.openSysIds(plans.get(p.id))).size, 1,
      'every row names the same incident: one sys_id to ask ServiceNow about');
  });

  it('approving the device after it comes back approves its ports too', () => {
    const p = plans.create({ scanId: 6, rackId: 'RK-NEW', report: report(), by: 'ravi' });
    plans.decide(p.id, [{ uid: DEV, decision: 'ticketed', assignee: 'sam' }], { by: 'meera' });
    plans.resolveTicket(p.id, DEV, { by: 'sam', finding: 'yes, U16' });
    assert.equal(byUid(plans.get(p.id))[DEV].decision, 'pending', 'a resolved ticket is not an approval');

    plans.decide(p.id, [{ uid: DEV, decision: 'approved' }], { by: 'meera' });
    const items = byUid(plans.get(p.id));
    for (const n of [1, 2, 3]) {
      assert.equal(items[`if:${DEV}:${n}`].decision, 'approved', 'the port goes with the device');
      assert.equal(items[`if:${DEV}:${n}`].ticket.status, 'closed', 'its shared ticket is closed with it');
    }
    assert.equal(plans.isSettled(plans.get(p.id)), true);
    assert.ok(!plans.excludedUids(plans.get(p.id)).has(DEV), 'the approved device is written');
  });

  it('rejecting the device holds its ports back with it', () => {
    const p = plans.create({ scanId: 7, rackId: 'RK-NEW', report: report(), by: 'ravi' });
    // Somebody has to have looked first: the admin assigns before they decide.
    plans.decide(p.id, [{ uid: DEV, decision: 'ticketed', assignee: 'sam' }], { by: 'meera' });
    plans.resolveTicket(p.id, DEV, { by: 'sam', finding: 'nothing at U16' });
    plans.decide(p.id, [{ uid: DEV, decision: 'rejected', note: 'not there' }], { by: 'meera' });
    const after = plans.get(p.id);
    assert.equal(byUid(after)[`if:${DEV}:1`].decision, 'rejected');
    assert.ok(plans.excludedUids(after).has(DEV), 'the device is withheld');
    // Its ports carry a reference to the device, so the writer skips them
    // when the device is not there to attach to (writer.js: unresolved ref).
    const snap = { devices: [{ uid: DEV }], interfaces: [{ uid: `if:${DEV}:1` }] };
    assert.deepEqual(plans.filterSnapshot(snap, plans.excludedUids(after)).devices, []);
  });
});

describe('the whole rack in one move', () => {
  /** What the decide route does for { uid: '*' }: every pending top-level item. */
  const wholeRack = (plan, assignee, note) => plan.items
    .filter((i) => i.decidable && i.decision === 'pending')
    .map((i) => ({ uid: i.uid, decision: 'ticketed', assignee, note }));

  it('assigns every pending device, and only those, to one person', () => {
    const p = plans.create({ scanId: 8, rackId: 'RK-NEW', by: 'ravi', report: report([
      { type: 'Device', uid: DEV, name: 'SW-16', action: 'create' },
      { type: 'Interface', uid: `if:${DEV}:1`, name: 'Gi1/0/1', action: 'create' },
      { type: 'Interface', uid: `if:${DEV}:2`, name: 'Gi1/0/2', action: 'create' },
      { type: 'Device', uid: DEV2, name: 'FW-20', action: 'create' },
      { type: 'Device', uid: 'dev:RK-NEW:u1', name: 'PDU', action: 'noop', netboxId: 9 },
    ]) });
    // One device was already dealt with by hand (assigned, come back, and
    // rejected); the rack move must leave it.
    plans.decide(p.id, [{ uid: DEV2, decision: 'ticketed', assignee: 'sam' }], { by: 'meera' });
    plans.resolveTicket(p.id, DEV2, { by: 'sam', finding: 'that is rack 2' });
    plans.decide(p.id, [{ uid: DEV2, decision: 'rejected', note: 'wrong rack' }], { by: 'meera' });

    const decisions = wholeRack(plans.get(p.id), 'sam', 'please check the whole rack');
    assert.deepEqual(decisions.map((d) => d.uid), [DEV], 'only what is still pending, devices only');

    const out = plans.decide(p.id, decisions, { by: 'meera' });
    assert.equal(out.refused.length, 0);

    const items = byUid(plans.get(p.id));
    assert.equal(items[DEV].decision, 'ticketed');
    assert.equal(items[`if:${DEV}:1`].ticket.sharedWith, DEV, 'the ports came along');
    assert.equal(items[DEV2].decision, 'rejected', 'the earlier decision stands');
    assert.equal(items['dev:RK-NEW:u1'].decision, 'not applicable', 'a noop is not touched');

    const s = plans.summarise(plans.get(p.id).items);
    assert.equal(s.pending, 0, 'nothing left waiting');
    assert.equal(s.ticketed, 1);
    assert.equal(s.rejected, 1);
  });

  it('marks every pending top-level item ticketed when nothing was decided yet', () => {
    const p = plans.create({ scanId: 9, rackId: 'RK-NEW', by: 'ravi', report: report([
      { type: 'Device', uid: DEV, name: 'SW-16', action: 'create' },
      { type: 'Interface', uid: `if:${DEV}:1`, name: 'Gi1/0/1', action: 'create' },
      { type: 'Device', uid: DEV2, name: 'FW-20', action: 'update', netboxId: 3,
        diff: { position: { from: 19, to: 20 } } },
    ]) });
    const out = plans.decide(p.id, wholeRack(p, 'sam'), { by: 'meera' });
    assert.deepEqual(out.applied.map((d) => d.uid).sort(), [DEV, DEV2].sort());

    const after = plans.get(p.id);
    assert.ok(after.items.filter((i) => i.decidable).every((i) => i.decision === 'ticketed'));
    assert.equal(plans.summarise(after.items).openTickets, 2, 'two device tickets in RackTrack');
    assert.ok(plans.excludedUids(after).has(DEV) && plans.excludedUids(after).has(DEV2),
      'nothing is written while it is with somebody');
  });
});
