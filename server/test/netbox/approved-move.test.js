/**
 * The one way a shelf is ever written on the customer's own record.
 *
 * A bound record's position is the customer's: reported, never written. The
 * narrow exception is a SPOC accepting "same device, wrong shelf" on a check.
 * That rides on the snapshot as approvedMoves - per check, per box, naming the
 * one record - and what is pinned here is how narrow it is:
 *
 *   - without it, the plan and the write are exactly what they were
 *   - with it, the rebind row carries position in its diff and the write is ONE
 *     patch: the shelf and RackTrack's own two fields, nothing else of theirs
 *   - the camera-counted ports of the box are never made on their record
 *   - a record somebody has moved since is left alone
 *   - an allowance for one record allows nothing on another, and nothing but
 *     the shelf and the face whatever the snapshot claims
 *   - two checks moving a record to different shelves sign differently
 *   - a bound record is never taken out of its U to make room
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-approved-move-'));
process.env.RT_DATA_DIR = DATA_DIR;

const writer = require('../../lib/netbox/writer');
const overrides = require('../../lib/approvals/overrides');
const shape = require('../../lib/approvals/shape');
const { UID_FIELD, BOUND_FIELD } = require('../../lib/netbox/netbox');
const F = require('../fixtures/demo_rack');

test.after(() => { try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch { /* best effort */ } });

const actionable = (report) => report.changes.filter((c) => shape.ACTIONABLE.has(c.action));
const rowOf = (report, uid = F.U20) => report.changes.find((c) => c.uid === uid);
/** The phone's answer "this box is record 199", with no shelf move approved. */
const boundOnly = () => F.demoSnapshot({ deviceNetboxIds: { [F.U20]: F.RECORD_ID },
  shown: { devices: { [F.U20]: { name: 'SP-R1-U20-ACT', position: 22 } } } });
const moved = (move = F.MOVE) => overrides.applyTo(F.demoSnapshot(), [move]);

test('without an approved move the shelf is reported and never written, exactly as before', async () => {
  const nb = F.seedDemoRack(F.fakeNetBox());
  const plain = await writer.plan(boundOnly(), nb.client());
  assert.deepEqual(Object.keys(rowOf(plain).diff), [UID_FIELD, 'recordId']);

  // An allowance that names another record allows nothing on this one.
  const other = boundOnly();
  other.approvedMoves = { [F.U20]: { netboxId: 198, fields: { position: { from: 22, to: 20 } } } };
  const same = await writer.plan(other, nb.client());
  assert.deepEqual(same.changes, plain.changes, 'the plan is the same to the byte');
  assert.equal(shape.fingerprint(same.changes), shape.fingerprint(plain.changes));

  const from = nb.calls.length;
  await writer.push(other, nb.client());
  const patches = nb.writes(from).filter((c) => c.path === `${F.DEVICES}${F.RECORD_ID}/`);
  assert.equal(patches.length, 1);
  assert.deepEqual(Object.keys(patches[0].body), ['custom_fields'], 'only RackTrack\'s own fields');
  assert.equal(nb.record().position, 22, 'the record stays on the shelf the customer gave it');
});

test('an approved move is one row, signed with its shelf, and one patch: the shelf and nothing else of theirs', async () => {
  const nb = F.seedDemoRack(F.fakeNetBox());
  const before = structuredClone(nb.record());
  const plan = await writer.plan(moved(), nb.client());

  const row = rowOf(plan);
  assert.equal(row.action, 'rebind');
  assert.equal(row.netboxId, F.RECORD_ID);
  assert.deepEqual(row.diff, { [UID_FIELD]: { from: null, to: F.U20 },
    recordId: { from: null, to: F.RECORD_ID }, position: { from: 22, to: 20 } });
  assert.match(row.reason, /The shelf is moved from U22 to U20 on the word of the person who accepted that change/);
  assert.match(row.boundMark, /^bound by dc007\.spoc/);
  assert.deepEqual(actionable(plan).map((c) => c.uid), [F.U20], 'one thing to write, and no port beside it');
  assert.equal(plan.changes.filter((c) => c.type === 'Interface').length, 0);
  assert.deepEqual(plan.orphans, [], 'the record is no longer one the scan did not see');
  assert.equal(nb.writes().length, 0, 'a plan writes nothing');

  const from = nb.calls.length;
  const pushed = await writer.push(moved(), nb.client());
  const writes = nb.writes(from);
  assert.equal(writes.length, 1, JSON.stringify(writes));
  assert.equal(writes[0].method, 'PATCH');
  assert.equal(writes[0].path, `${F.DEVICES}${F.RECORD_ID}/`);
  assert.deepEqual(writes[0].body, { position: 20,
    custom_fields: { [UID_FIELD]: F.U20, [BOUND_FIELD]: 'bound by dc007.spoc on 2026-09-22T09:00:00Z' } });
  assert.equal(writes.filter((c) => c.method === 'POST').length, 0,
    'no port, no device type, no role: nothing is made for a box that is the customer\'s own record');
  assert.deepEqual(rowOf(pushed).diff.position, { from: 22, to: 20 });

  const after = nb.record();
  assert.equal(after.position, 20);
  for (const field of ['name', 'rack', 'site', 'role', 'device_type', 'tenant', 'face', 'status', 'serial']) {
    assert.deepEqual(after[field], before[field], `${field} is as the customer had it`);
  }
  assert.equal(nb.rows(F.INTERFACES).length, 5, 'and it keeps the five ports the customer gave it');

  // The check after the write reads the same snapshot, and finds nothing left.
  const again = await writer.plan(moved(), nb.client());
  assert.deepEqual(actionable(again), []);
  assert.equal(rowOf(again).action, 'noop');
});

test('a record somebody moved since is left alone, whichever way it is noticed', async () => {
  // The answer kept the shelf the person was shown: the binding itself is refused.
  const shownShelf = F.seedDemoRack(F.fakeNetBox(), { position: 23 });
  const a = await writer.plan(moved(), shownShelf.client());
  assert.equal(rowOf(a).action, 'skip');
  assert.match(rowOf(a).reason, /the shelf was 22 and is now 23/);

  // An answer that kept no shelf: the move itself is what no longer fits.
  const noShelf = F.seedDemoRack(F.fakeNetBox(), { position: 23 });
  const b = await writer.plan(moved({ ...F.MOVE, shown: { name: 'SP-R1-U20-ACT' } }), noShelf.client());
  assert.equal(rowOf(b).action, 'skip');
  assert.match(rowOf(b).reason, /the record moved since this change was accepted/);
  assert.match(rowOf(b).reason, /U23/);

  for (const nb of [shownShelf, noShelf]) {
    const from = nb.calls.length;
    await writer.push(moved({ ...F.MOVE, shown: nb === noShelf ? { name: 'SP-R1-U20-ACT' } : F.MOVE.shown }), nb.client());
    assert.deepEqual(nb.writes(from), [], 'nothing is written');
    assert.equal(nb.record().position, 23);
  }
});

test('the allowance is the shelf and the face, whatever a snapshot claims', async () => {
  const nb = F.seedDemoRack(F.fakeNetBox());
  const snap = moved();
  snap.approvedMoves[F.U20].fields = { position: { from: 22, to: 20 },
    name: { from: 'SP-R1-U20-ACT', to: 'Router U20 SP-HYB-RM01-R01-R1' }, role: { from: 9, to: 1 },
    device_type: { from: 55, to: 1 }, rack: { from: 26, to: 1 }, site: { from: 7, to: 1 }, tenant: { from: 4, to: null } };
  assert.deepEqual(Object.keys(writer._internal.allowanceFor(snap, F.U20, F.RECORD_ID)), ['position']);
  const from = nb.calls.length;
  await writer.push(snap, nb.client());
  const [patch] = nb.writes(from);
  assert.deepEqual(Object.keys(patch.body).sort(), ['custom_fields', 'position']);
  assert.equal(nb.record().name, 'SP-R1-U20-ACT');
});

test('two checks that move a record from different shelves sign differently', async () => {
  const at22 = await writer.plan(moved(), F.seedDemoRack(F.fakeNetBox()).client());
  const from24 = { ...F.MOVE, fields: { position: { from: 24, to: 20 } }, shown: { name: 'SP-R1-U20-ACT', position: 24 } };
  const at24 = await writer.plan(moved(from24), F.seedDemoRack(F.fakeNetBox(), { position: 24 }).client());
  assert.deepEqual(rowOf(at24).diff.position, { from: 24, to: 20 });
  assert.notEqual(shape.fingerprint(at22.changes), shape.fingerprint(at24.changes));
  const unmoved = await writer.plan(boundOnly(), F.seedDemoRack(F.fakeNetBox()).client());
  assert.notEqual(shape.fingerprint(at22.changes), shape.fingerprint(unmoved.changes),
    'and differently from a check that binds the record and moves nothing');
});

test('a record already bound is moved by the same allowance, as an update with the shelf alone', async () => {
  const nb = F.seedDemoRack(F.fakeNetBox());
  nb.record().custom_fields = { [UID_FIELD]: F.U20, [BOUND_FIELD]: 'bound by Aasritha' };
  const held = await writer.plan(boundOnly(), nb.client());
  assert.equal(rowOf(held).action, 'noop', 'with no allowance the shelf is withheld');
  assert.ok(held.findings.some((f) => f.kind === 'bind-only' && f.uid === F.U20
    && f.fields.some((x) => x.field === 'position')));

  const plan = await writer.plan(moved(), nb.client());
  assert.equal(rowOf(plan).action, 'update');
  assert.deepEqual(rowOf(plan).diff, { position: { from: 22, to: 20 } });
  const from = nb.calls.length;
  await writer.push(moved(), nb.client());
  const patches = nb.writes(from);
  assert.equal(patches.length, 1);
  assert.deepEqual(Object.keys(patches[0].body).sort(), ['custom_fields', 'position']);
  assert.equal(nb.record().position, 20);
  assert.equal(nb.record().name, 'SP-R1-U20-ACT');
});

test('a bound record is never taken out of its U to make room, even when its type is not the camera\'s guess', async () => {
  // After the demo write: 199 on U20 with our uid and the mark, and the
  // customer's own device type, which the camera's "Unidentified Router" never is.
  const nb = F.seedDemoRack(F.fakeNetBox(), { position: 20 });
  nb.record().custom_fields = { [UID_FIELD]: F.U20, [BOUND_FIELD]: 'bound by dc007.spoc' };
  // The next check of the rack creates a server on U5. Each phase reads with a
  // client of its own, so nothing a preload remembered can hide the defect.
  const next = () => F.demoSnapshot({ boxes: [F.cameraBox('Server', 0, ['u05'])] });
  await writer.plan(next(), nb.client());
  const from = nb.calls.length;
  const pushed = await writer.push(next(), nb.client());
  const onRecord = nb.writes(from).filter((c) => c.path === `${F.DEVICES}${F.RECORD_ID}/`);
  assert.deepEqual(onRecord, [], 'nothing at all is written on the customer\'s record');
  assert.equal(nb.record().position, 20);
  assert.deepEqual(nb.record().face, { value: 'front' });
  assert.ok(!pushed.warnings.some((w) => /taken out of/.test(w)));
});
