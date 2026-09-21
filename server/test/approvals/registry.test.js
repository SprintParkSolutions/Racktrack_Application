/**
 * The change registry, as rows.
 *
 * registry.rowsFor() is pure: the writer's own report in, the rows of
 * approval_changes out. These tests pin what a person later reads there - one
 * row per field for an update, the shelf move of a customer's record with
 * RackTrack's own link fields kept but marked, one row for a new object, one
 * for an object NetBox refused - and who the row says approved it.
 */
const assert = require('node:assert/strict');
const { describe, it } = require('node:test');

const registry = require('../../lib/approvals/registry');

const PLAN = { id: 140, orgId: 1, tenantId: 32, rackId: 'RK-5B81BE87', rackName: 'SP-HYB-RM01-R01-R1',
  netboxUrl: 'https://netbox.test/', incident: { system: 'servicenow', number: 'INC0010042', sysId: 'abc123' } };
const DECISIONS = [
  { decision: 'rejected', approver: 'someone', approverId: 3, decidedAt: '2026-09-20T10:00:00Z' },
  { decision: 'approved', approver: 'first', approverId: 40, decidedAt: '2026-09-21T15:00:00Z' },
  { decision: 'approved', approver: 'dc007.spoc', approverId: 41, decidedAt: '2026-09-21T15:20:00Z' },
];
const AT = '2026-09-21T15:20:04Z';
const rows = (items, changes, over = {}) => registry.rowsFor({ plan: PLAN, items, decisions: DECISIONS,
  changes, attempt: 1, writtenAt: AT, writtenBy: { id: null, username: 'system' }, ...over });

describe('what a write leaves in the registry', () => {
  it('gives an update one row per field, with before and after', () => {
    const out = rows([{ uid: 'dev:t32:16:u15', type: 'Device', name: 'FW-15', action: 'update', netboxId: 44 }],
      [{ type: 'Device', uid: 'dev:t32:16:u15', name: 'FW-15', action: 'update', netboxId: 44,
        diff: { position: { from: 14, to: 15 }, serial: { from: null, to: 'FTX1' } } }]);
    assert.deepEqual(out.map((r) => [r.field, r.before, r.after]),
      [['position', 14, 15], ['serial', null, 'FTX1']]);
    for (const r of out) {
      assert.equal(r.action, 'update');
      assert.equal(r.result, 'written');
      assert.equal(r.internal, false);
      assert.equal(r.source, 'scan');
      assert.equal(r.approvedBy, 'dc007.spoc', 'the last approval on record is the name it was written in');
      assert.equal(r.approvedById, 41);
      assert.equal(r.approvedAt, '2026-09-21T15:20:00Z');
      assert.equal(r.writtenBy, 'system');
      assert.equal(r.writtenAt, AT);
      assert.equal(r.incidentNumber, 'INC0010042');
      assert.equal(r.incidentSysId, 'abc123');
      assert.equal(r.netboxUrl, 'https://netbox.test/dcim/devices/44/');
      assert.equal(r.planId, 140);
      assert.equal(r.tenantId, 32);
    }
  });

  it('shows the shelf move of a bound record as one row, and keeps the link fields marked as its own', () => {
    const item = { uid: 'dev:t32:16:u20', type: 'Device', name: 'Router U20 SP-HYB-RM01-R01-R1', action: 'rebind',
      netboxId: 199, modified: { source: 'suggestion', rule: 'wrong_shelf', recordName: 'SP-R1-U20-ACT' } };
    const out = rows([item], [{ type: 'Device', uid: item.uid, name: item.name, action: 'rebind', netboxId: 199,
      boundMark: 'bound by dc007.spoc',
      diff: { racktrack_uid: { from: null, to: item.uid }, recordId: { from: null, to: 199 },
        position: { from: 22, to: 20 } } }]);
    assert.deepEqual(out.map((r) => [r.field, r.internal]),
      [['racktrack_uid', true], ['position', false], ['racktrack_bound', true]], 'recordId is not a NetBox field');
    const visible = out.filter((r) => !r.internal);
    assert.equal(visible.length, 1, 'exactly one row a person sees');
    assert.deepEqual([visible[0].before, visible[0].after], [22, 20]);
    assert.equal(visible[0].objectName, 'SP-R1-U20-ACT', 'the record is called what the customer calls it');
    assert.equal(visible[0].source, 'suggestion');
    assert.equal(visible[0].rule, 'wrong_shelf');
    assert.equal(out[2].after, 'bound by dc007.spoc');
    assert.deepEqual(registry.summaryOf(out), { written: 1, failed: 0, more: 0,
      lines: ['SP-R1-U20-ACT: position 22 -> 20'] });
  });

  it('works on a check nobody changed, and on one whose change says nothing about where it came from', () => {
    const plain = rows([{ uid: 'a', type: 'Device', name: 'A', action: 'rebind', netboxId: 5 }],
      [{ type: 'Device', uid: 'a', name: 'A', action: 'rebind', netboxId: 5,
        diff: { racktrack_uid: { from: null, to: 'a' }, recordId: { from: null, to: 5 } } }]);
    assert.deepEqual(plain.map((r) => [r.field, r.internal, r.source]), [['racktrack_uid', true, 'scan']]);
    const byHand = rows([{ uid: 'b', type: 'Device', name: 'B', action: 'update', netboxId: 6, modified: {} }],
      [{ type: 'Device', uid: 'b', name: 'B', action: 'update', netboxId: 6,
        diff: { serial: { from: 'X', to: 'Y' } } }]);
    assert.equal(byHand[0].source, 'manual');
  });

  it('gives a new object one row, with what was sent', () => {
    const out = rows([{ uid: 'dev:t32:16:u12', type: 'Device', name: 'Switch U12 SP-HYB-RM01-R01-R1', action: 'create' }],
      [{ type: 'Device', uid: 'dev:t32:16:u12', name: 'Switch U12 SP-HYB-RM01-R01-R1', action: 'create',
        netboxId: 310, created: { name: 'Switch U12', position: 12, status: 'active' } }]);
    assert.equal(out.length, 1);
    assert.equal(out[0].field, '*');
    assert.equal(out[0].before, null);
    assert.deepEqual(out[0].after, { name: 'Switch U12', position: 12, status: 'active' });
    assert.equal(out[0].netboxId, 310);
    assert.equal(out[0].objectName, 'Switch U12', 'the name of the rack is not repeated in every row');
  });

  it('records what NetBox refused as failed, and nothing for a row that wrote nothing', () => {
    const items = [{ uid: 'if:x:2', type: 'Interface', name: 'Gi1/0/2', action: 'create', following: true,
      parentUid: 'x' }, { uid: 'x', type: 'Device', name: 'X', action: 'create' }];
    const out = rows(items, [
      { type: 'Interface', uid: 'if:x:2', name: 'Gi1/0/2', action: 'fail', reason: 'NetBox refused this change: duplicate name' },
      { type: 'Device', uid: 'x', name: 'X', action: 'noop' },
      { type: 'Device', uid: 'y', name: 'Y', action: 'skip', reason: 'held' },
    ]);
    assert.equal(out.length, 1);
    assert.deepEqual([out[0].action, out[0].field, out[0].result], ['create', '*', 'failed']);
    assert.match(out[0].reason, /duplicate name/);
    assert.equal(out[0].netboxUrl, null, 'only a device has a page to link to');
    assert.deepEqual(registry.summaryOf(out).lines, ['Gi1/0/2: not written - NetBox refused this change: duplicate name']);
  });

  it('lets a port inherit the approver, the incident and the source of its device', () => {
    const items = [
      { uid: 'dev:1', type: 'Device', name: 'SW', action: 'create', modified: { source: 'manual', rule: null } },
      { uid: 'if:dev:1:1', type: 'Interface', name: 'Gi1', action: 'create', following: true, parentUid: 'dev:1' },
    ];
    const out = rows(items, [
      { type: 'Device', uid: 'dev:1', name: 'SW', action: 'create', netboxId: 1, created: { name: 'SW' } },
      { type: 'Interface', uid: 'if:dev:1:1', name: 'Gi1', action: 'create', netboxId: 2, created: { name: 'Gi1' } },
    ]);
    assert.equal(out[1].source, 'manual');
    assert.equal(out[1].approvedBy, 'dc007.spoc');
    assert.equal(out[1].incidentNumber, 'INC0010042');
  });

  it('has nobody to name when there is no approval on record, and says so with nulls', () => {
    const out = rows([], [{ type: 'Device', uid: 'z', name: 'Z', action: 'create', netboxId: 9 }],
      { decisions: [], plan: { ...PLAN, incident: null } });
    assert.equal(out[0].approvedBy, null);
    assert.equal(out[0].incidentNumber, null);
    assert.equal(out[0].after, null);
  });

  it('writes the check after the write as a row of its own', () => {
    const pass = registry.verdictRow({ plan: PLAN, attempt: 2, result: 'pass', checked: 3, failed: 0, at: AT });
    assert.deepEqual([pass.action, pass.field, pass.result, pass.internal, pass.attempt],
      ['check', '*', 'verified', true, 2]);
    const fail = registry.verdictRow({ plan: PLAN, attempt: 2, result: 'fail', checked: 3, failed: 1, at: AT });
    assert.equal(fail.result, 'mismatch');
    assert.match(fail.reason, /did not hold/);
  });
});
