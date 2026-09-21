/**
 * Mark Offline: a record the scan did not see, marked offline and never deleted.
 *
 * The record is not a box in the scan, so nothing in the walk would ever reach
 * it. A SPOC's word puts it on the snapshot as approvedOffline, and the writer
 * answers with one ordinary `update` row - status, from what it was to offline
 * - so it is fingerprinted, signed, written and checked like any other row.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-offline-row-'));
process.env.RT_DATA_DIR = DATA_DIR;

const writer = require('../../lib/netbox/writer');
const overrides = require('../../lib/approvals/overrides');
const shape = require('../../lib/approvals/shape');
const { UID_FIELD } = require('../../lib/netbox/netbox');
const F = require('../fixtures/demo_rack');

test.after(() => { try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch { /* best effort */ } });

const UID = `nb:device:${F.RECORD_ID}`;
const OFFLINE = { kind: 'offline', itemUid: null, netboxId: F.RECORD_ID, recordName: 'SP-R1-U20-ACT',
  fields: { status: { from: 'active', to: 'offline' } }, source: 'suggestion', rule: 'mark_offline' };
const marked = () => overrides.applyTo(F.demoSnapshot(), [OFFLINE]);
const rowOf = (report) => report.changes.find((c) => c.uid === UID);

test('says nothing at all without a SPOC\'s word', async () => {
  const nb = F.seedDemoRack(F.fakeNetBox());
  const plan = await writer.plan(F.demoSnapshot(), nb.client());
  assert.equal(rowOf(plan), undefined);
});

test('is one update row, status to offline, and one patch that carries nothing else', async () => {
  const nb = F.seedDemoRack(F.fakeNetBox());
  const before = structuredClone(nb.record());
  const plan = await writer.plan(marked(), nb.client());
  const row = rowOf(plan);
  assert.deepEqual({ type: row.type, action: row.action, netboxId: row.netboxId, name: row.name, synthetic: row.synthetic },
    { type: 'Device', action: 'update', netboxId: F.RECORD_ID, name: 'SP-R1-U20-ACT', synthetic: 'offline' });
  assert.deepEqual(row.diff, { status: { from: 'active', to: 'offline' } });
  assert.match(row.reason, /^Marked offline on the SPOC's word/);
  assert.equal(plan.counts.update, 1);
  assert.notEqual(shape.fingerprint(plan.changes),
    shape.fingerprint((await writer.plan(F.demoSnapshot(), nb.client())).changes), 'it is part of what is signed');
  const item = plan.changes.map(shape.toItem).find((i) => i.uid === UID);
  assert.equal(item.decidable, true, 'a person decides it like any other row');
  assert.equal(nb.writes().length, 0);

  // Only the record is approved: the new box on U20 is left out of this write.
  const from = nb.calls.length;
  await writer.push(shape.filterSnapshot(marked(), new Set([F.U20])), nb.client());
  const onRecord = nb.writes(from).filter((c) => c.path === `${F.DEVICES}${F.RECORD_ID}/`);
  assert.deepEqual(onRecord.map((c) => [c.method, c.body]), [['PATCH', { status: 'offline' }]]);
  assert.equal(nb.calls.filter((c) => c.method === 'DELETE').length, 0, 'nothing is ever deleted');
  const after = nb.record();
  assert.deepEqual(after.status, { value: 'offline' });
  assert.deepEqual({ ...after, status: before.status }, before, 'everything else on the record is as it was');
  assert.ok(nb.rows(F.DEVICES).some((d) => d.id === F.RECORD_ID), 'the record is still there');

  // The check after the write finds it done.
  assert.equal(rowOf(await writer.plan(marked(), nb.client())).action, 'noop');
});

test('a rejected mark offline writes nothing', async () => {
  const nb = F.seedDemoRack(F.fakeNetBox());
  const from = nb.calls.length;
  const pushed = await writer.push(shape.filterSnapshot(marked(), new Set([UID, F.U20])), nb.client());
  assert.equal(rowOf(pushed), undefined);
  assert.deepEqual(nb.writes(from).filter((c) => c.path.startsWith(F.DEVICES)), []);
  assert.deepEqual(nb.record().status, { value: 'active' });
});

test('leaves the record alone when it is not what the person decided about any more', async () => {
  const cases = [
    [(r) => { r.rack = { id: 27 }; }, /no longer in this rack/],
    [(r) => { r.status = { value: 'planned' }; }, /status changed to planned/],
    [(r) => { r.custom_fields = { [UID_FIELD]: F.U20 }; }, /shows the box after all/],
  ];
  for (const [change, why] of cases) {
    const nb = F.seedDemoRack(F.fakeNetBox());
    change(nb.record());
    const from = nb.calls.length;
    const pushed = await writer.push(shape.filterSnapshot(marked(), new Set()), nb.client());
    assert.equal(rowOf(pushed).action, 'skip');
    assert.match(rowOf(pushed).reason, why);
    assert.ok(!nb.writes(from).some((c) => c.path === `${F.DEVICES}${F.RECORD_ID}/` && c.body && 'status' in c.body),
      'no status was written on the record');
  }
  const gone = F.seedDemoRack(F.fakeNetBox());
  gone.rows(F.DEVICES).length = 0;
  assert.match(rowOf(await writer.plan(marked(), gone.client())).reason, /no longer in NetBox/);
});

test('the rows a suggestion reads say what kind of box each record is', async () => {
  const nb = F.seedDemoRack(F.fakeNetBox());
  const plan = await writer.plan(F.demoSnapshot(), nb.client());
  assert.deepEqual(plan.orphans.map((o) => [o.netboxId, o.seen, o.role, o.deviceType, o.assetTag, o.face]),
    [[F.RECORD_ID, false, { id: 9, name: 'Router', slug: 'router' },
      { model: 'ISR 4331', manufacturer: 'Cisco', uHeight: 1 }, null, 'front']]);
  assert.deepEqual(plan.records, [{ netboxId: F.RECORD_ID, name: 'SP-R1-U20-ACT', position: 22, uHeight: 1,
    face: 'front', status: 'active', role: { id: 9, name: 'Router', slug: 'router' },
    deviceType: { model: 'ISR 4331', manufacturer: 'Cisco' }, serial: null, assetTag: null, uid: null, bound: false }]);
  assert.equal(plan.boxes.length, 1);
  const [box] = plan.boxes;
  assert.deepEqual([box.uid, box.position, box.span, box.cvClass, box.portCount, box.modelIsOcr, box.evidence],
    [F.U20, 20, 1, 'Router', 8, false, 'cv_only']);
  assert.equal(box.sockets, undefined, 'the socket list stays with the ports check');
});
