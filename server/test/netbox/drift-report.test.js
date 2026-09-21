/**
 * The drift report: one page somebody can send. What it must say, and what it
 * must never print.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const report = require('../../lib/netbox/drift_report');

const PLAN = {
  id: 347, rackName: 'SP-HYB-RM01-R01-R1', netboxUrl: 'http://netbox', state: 'assigned',
  createdAt: '2026-09-21T10:57:00Z', createdBy: 'Aasritha', submittedNote: 'The router is on U20.',
  items: [
    { uid: 'rack:t32:16', type: 'Rack', name: 'SP-HYB-RM01-R01-R1', action: 'rebind', decidable: true, fromUid: null,
      diff: { racktrack_uid: { from: null, to: 'rack:t32:16' }, recordId: { from: null, to: 26 } } },
    { uid: 'dev:RK-1:u20', type: 'Device', name: 'Router U20 SP-HYB-RM01-R01-R1', action: 'create', decidable: true },
    { uid: 'dev:RK-1:u17', type: 'Device', name: 'Switch U17 SP-HYB-RM01-R01-R1', action: 'skip' },
    { uid: 'if:dev:RK-1:u17:1', type: 'Interface', name: '1', action: 'skip' },
  ],
  orphans: [
    { netboxId: 196, name: 'SP-R1-U17-SW03', position: 17, seen: true, matchedBox: 'dev:RK-1:u17' },
    { netboxId: 198, name: 'SP-R1-U19-FW', position: 19, seen: false },
  ],
};
const TICKETS = [{ itemUid: 'dev:RK-1:u20', assignee: 'dc007.tech', status: 'resolved', finding: 'Router is on U20.', external: { number: 'INC0010007' } }];

test('the three groups a reader wants: what differs, what matches, what was not seen', () => {
  const g = report.groups(PLAN);
  assert.deepEqual(g.different.map((i) => i.uid), ['dev:RK-1:u20'], "RackTrack's own tag on the rack is not a difference");
  assert.deepEqual(g.matching.map((m) => [m.item.uid, m.record.name]), [['dev:RK-1:u17', 'SP-R1-U17-SW03']], 'a match names the record it matched, and ports are not rows');
  assert.deepEqual(g.notSeen.map((o) => o.name), ['SP-R1-U19-FW']);
});

test('the page says which rack, where it stands, who holds it and what they found', () => {
  const html = report.build(PLAN, { tickets: TICKETS, siteName: 'Office-Sprintpark', spaceName: 'Server Room' });
  for (const must of ['Drift report', 'SP-HYB-RM01-R01-R1', 'Office-Sprintpark - Server Room', 'Assigned', 'INC0010007',
    'Router', 'Not in the record', 'With dc007.tech', 'Finding: Router is on U20.', 'SP-R1-U17-SW03', 'SP-R1-U19-FW', 'The router is on U20.']) {
    assert.ok(html.includes(must), `the report says "${must}"`);
  }
  assert.ok(!/racktrack_uid|recordId|rack:t32:16/.test(html), "RackTrack's own keys are never printed");
  assert.ok(!/<script/i.test(html), 'a page that is attached to an incident carries no script');
});

test('a scan nobody has identified is not named by the hash of its photograph, and markup in a name is text', () => {
  const html = report.build({ ...PLAN, rackName: 'RK-58353344', items: [{ uid: 'dev:x:u1', type: 'Device', name: '<img src=x onerror=1>', action: 'create', decidable: true }], orphans: [] });
  assert.ok(html.includes('Rack not identified yet'));
  assert.ok(!html.includes('RK-58353344</h1>'));
  assert.ok(!html.includes('<img src=x'), 'a name is escaped');
});

test('a check sent to the SPOC says so, and names its one incident once', () => {
  const external = { system: 'servicenow', number: 'INC0010042', planLevel: true };
  const items = [...PLAN.items, { uid: 'dev:RK-1:u22', type: 'Device', name: 'Switch U22 SP-HYB-RM01-R01-R1', action: 'create', decidable: true }];
  const tickets = [
    { itemUid: 'dev:RK-1:u20', assignee: 'dc007.spoc', status: 'open', external },
    { itemUid: 'dev:RK-1:u22', assignee: 'dc007.spoc', status: 'open', external },
  ];
  const html = report.build({ ...PLAN, items }, { tickets });
  assert.equal(html.split('INC0010042').length - 1, 1, 'the incident is the check\'s, not each item\'s');
  assert.equal(html.split('With dc007.spoc - open').length - 1, 2);

  assert.ok(report.build({ ...PLAN, state: 'submitted' }).includes('Sent to the SPOC'));
  assert.ok(report.build({ ...PLAN, state: 'triage' }).includes('Needs an admin'));
  assert.ok(report.build(PLAN, { tickets: [{ itemUid: 'x', external: { system: 'none' } }] }).includes('no incident raised'));
  assert.ok(!/the admin\b/.test(report.build({ ...PLAN, state: 'submitted' })), 'nothing is sent to an admin any more');
});

test('an older check still lists the incident of each item', () => {
  const tickets = [
    { itemUid: 'dev:RK-1:u20', assignee: 'dc007.tech', status: 'open', external: { number: 'INC0010007' } },
    { itemUid: 'dev:RK-1:u17', assignee: 'dc007.tech', status: 'open', external: { number: 'INC0010008' } },
  ];
  const html = report.build(PLAN, { tickets });
  assert.ok(html.includes('INC0010007, INC0010008'));
  assert.ok(html.includes('With dc007.tech - INC0010007 - open'));
});
