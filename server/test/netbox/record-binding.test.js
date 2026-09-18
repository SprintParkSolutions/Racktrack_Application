/**
 * Binding a scan to the rack the customer filled in by hand.
 *
 * The measured symptom this fixes: the only way anything found an object in
 * NetBox was our own custom field, so a rack the customer typed in was
 * invisible. Every box in it read as "create", NetBox refused the ones that
 * collided, and the devices already in the record could not be reported either,
 * because the orphan check threw away every record that did not carry our uid.
 *
 * What is proved here:
 *
 *   1. a person's binding reaches the writer through the SAME rebind that
 *      already existed: one visible plan row per object, approved like any
 *      other, and the write patches the custom field and nothing else;
 *   2. the bind is bind-only. What the customer's rack is called, where it
 *      lives and how tall it is are reported and never written;
 *   3. a binding that names a record belonging to another RackTrack identity
 *      is refused, and no twin is created beside it;
 *   4. a binding that names a record that has gone is refused the same way;
 *   5. the customer's own devices appear in the orphan report, marked as
 *      theirs, and nothing is deleted;
 *   6. a device whose serial disagrees with the switch is ONE row saying was X,
 *      now Y - the plan's high finding "Replaced" - not a removal plus an
 *      addition;
 *   7. the store survives a re-adopt: a record binding and a confirmed switch
 *      live in one file and neither erases the other.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-record-binding-'));
process.env.RT_DATA_DIR = DATA_DIR;

const cv = require('../../lib/netbox/cv');
const writer = require('../../lib/netbox/writer');
const bindings = require('../../lib/netbox/bindings');
const identity = require('../../lib/netbox/identity');
const { NetBox, UID_FIELD } = require('../../lib/netbox/netbox');

test.after(() => { try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch { /* best effort */ } });

/**
 * A NetBox that already holds the customer's own rack, filled in by hand and
 * carrying none of our uids. It answers the filters this path actually uses:
 * the custom field, an object id, and a rack's devices.
 */
function customersNetBox() {
  const store = new Map();
  const calls = [];
  let nextId = 100;
  const rows = (p) => { if (!store.has(p)) store.set(p, []); return store.get(p); };
  const nb = new NetBox('http://fake.invalid', 'nbt_test');
  nb.calls = calls;
  nb.rows = rows;
  nb.patches = (p) => calls.filter((c) => c.method === 'PATCH' && c.path.startsWith(p));

  nb.request = async (method, path, body = null, params = null) => {
    calls.push({ method, path, body, params });
    if (method === 'GET') {
      const p = params || {};
      const cf = Object.keys(p).find((k) => k.startsWith(`cf_${UID_FIELD}`));
      const list = rows(path).filter((o) => {
        if (cf) {
          const held = String((o.custom_fields || {})[UID_FIELD] || '');
          return cf.endsWith('__ic')
            ? held.toLowerCase().includes(String(p[cf]).toLowerCase())
            : held === p[cf];
        }
        if (p.id !== undefined && Number(o.id) !== Number(p.id)) return false;
        if (p.rack_id !== undefined && Number((o.rack || {}).id ?? o.rack) !== Number(p.rack_id)) return false;
        if (p.name !== undefined && o.name !== p.name) return false;
        if (p.slug !== undefined && o.slug !== p.slug) return false;
        return true;
      });
      return { results: list, next: null };
    }
    if (method === 'POST') { const obj = { id: nextId++, ...body }; rows(path).push(obj); return obj; }
    if (method === 'PATCH') {
      const m = path.match(/^(.*\/)(\d+)\/$/);
      const obj = rows(m[1]).find((o) => o.id === Number(m[2]));
      Object.assign(obj, body);
      return obj;
    }
    throw new Error(`unexpected ${method}`);
  };
  return nb;
}

/** The rack the customer typed in, with two boxes already in it. */
function customersRack(nb, { rackUid = null, deviceUids = {} } = {}) {
  nb.rows('/api/dcim/sites/').push({ id: 1, name: 'London DC', slug: 'london-dc' });
  nb.rows('/api/dcim/racks/').push({
    id: 7, name: 'Row 1 Rack 4', facility_id: 'DC1-R04', site: { id: 1 }, u_height: 45,
    custom_fields: rackUid ? { [UID_FIELD]: rackUid } : {},
  });
  nb.rows('/api/dcim/devices/').push({
    id: 51, name: 'lon-core-01', rack: { id: 7 }, site: { id: 1 }, position: 10,
    serial: 'FDO2117A0X9', face: { value: 'front' }, status: { value: 'active' },
    custom_fields: deviceUids.u10 ? { [UID_FIELD]: deviceUids.u10 } : {},
  });
  nb.rows('/api/dcim/devices/').push({
    id: 52, name: 'lon-core-02', rack: { id: 7 }, site: { id: 1 }, position: 12,
    serial: 'FDO2117B1Y0', face: { value: 'front' }, status: { value: 'active' },
    custom_fields: deviceUids.u12 ? { [UID_FIELD]: deviceUids.u12 } : {},
  });
  return nb;
}

const box = (cls, ports, units) => ({
  class_name: cls, port_count: ports, units, box: [10, 10, 900, 60], center: [455, 35],
  ports: [], console_ports: [], sfp_ports: [], other_ports: [], connected_ports: [],
  ocr_make: 'Cisco', ocr_model: 'C9300-48P',
});

/** A scan of that rack, keyed on the customer's rack row. */
function snapshotFor({ recordBinding = null, serials = {} } = {}) {
  const snap = cv.toSnapshot({
    image: 'rack.jpg',
    devices: [box('Switch', 48, ['u10']), box('Switch', 24, ['u12'])],
  }, {
    rackId: 'RK-E909532A', rackKey: 't7:5', siteName: 'London DC', rackName: 'Rack 1',
    uHeight: 42, scannedAt: '2026-09-18T00:00:00Z', recordBinding,
  });
  for (const d of snap.devices) {
    const at = String(d.uid).split(':').pop();
    if (serials[at]) d.serial = serials[at];
  }
  return snap;
}

const BINDING = {
  rackNetboxId: 7,
  deviceNetboxIds: { 'dev:t7:5:u10': 51, 'dev:t7:5:u12': 52 },
  by: 'sam@example.test', at: '2026-09-18T09:00:00Z',
  why: 'the admin picked this rack from the shortlist',
};

// ── 1. the bind reaches the writer through the rebind that already existed ──

test('a person\'s binding becomes a visible rebind row, not a create', async () => {
  const nb = customersRack(customersNetBox());
  const planned = await writer.plan(snapshotFor({ recordBinding: BINDING }), nb);

  const rackRow = planned.changes.find((c) => c.type === 'Rack');
  assert.equal(rackRow.action, 'rebind', 'the customer\'s rack is rebound, never created again');
  assert.equal(rackRow.netboxId, 7, 'it names the record it will bind');
  assert.equal(rackRow.boundBy, 'record-binding');
  assert.deepEqual(rackRow.diff, { [UID_FIELD]: { from: null, to: 'rack:t7:5' } },
    'only the RackTrack id changes');
  assert.match(rackRow.reason, /name, its site/);

  const devices = planned.changes.filter((c) => c.type === 'Device');
  assert.equal(devices.length, 2);
  assert.ok(devices.every((d) => d.action === 'rebind'), 'both boxes are rebinds');
  assert.deepEqual(devices.map((d) => d.netboxId).sort(), [51, 52]);
  assert.ok((planned.counts.create || 0) > 0, 'the ports below them are still creates');
});

test('the write patches the custom field and nothing else on the bound records', async () => {
  const nb = customersRack(customersNetBox());
  await writer.push(snapshotFor({ recordBinding: BINDING }), nb);

  for (const p of [...nb.patches('/api/dcim/racks/'), ...nb.patches('/api/dcim/devices/')]) {
    assert.deepEqual(Object.keys(p.body), ['custom_fields'],
      'a bind writes the RackTrack id and nothing else');
  }
  assert.equal(nb.rows('/api/dcim/racks/').length, 1, 'no second rack was created');
  assert.equal(nb.rows('/api/dcim/racks/')[0].name, 'Row 1 Rack 4', 'the customer\'s name stands');
  assert.equal(nb.rows('/api/dcim/racks/')[0].u_height, 45, 'and its height');
  assert.ok(!nb.calls.some((c) => c.method === 'DELETE'), 'nothing is ever deleted');
});

test('a second write after a bind changes nothing at all', async () => {
  const nb = customersRack(customersNetBox());
  await writer.push(snapshotFor({ recordBinding: BINDING }), nb);
  const again = await writer.push(snapshotFor({ recordBinding: BINDING }), nb);
  assert.equal(again.counts.create || 0, 0, 'nothing is created the second time');
  assert.equal(again.counts.rebind || 0, 0, 'nothing is rebound the second time');
  assert.equal(again.counts.fail || 0, 0);
});

// ── 2. the bind is bind-only ────────────────────────────────────────────────

test('what the customer calls their rack is reported, never overwritten', async () => {
  const nb = customersRack(customersNetBox());
  await writer.push(snapshotFor({ recordBinding: BINDING }), nb);
  // Now the rack carries our uid, so the next plan compares field by field.
  const again = await writer.plan(snapshotFor({ recordBinding: BINDING }), nb);

  const held = again.findings.find((f) => f.kind === 'bind-only' && f.type === 'Rack');
  assert.ok(held, 'the difference is reported');
  const fields = held.fields.map((f) => f.field).sort();
  assert.ok(fields.includes('name'), 'the name is one of them');
  assert.match(held.why, /only the RackTrack id is ever written/);

  const rackRow = again.changes.find((c) => c.type === 'Rack');
  assert.equal(rackRow.action, 'noop', 'so there is nothing left to write on the rack');
  assert.equal(nb.rows('/api/dcim/racks/')[0].name, 'Row 1 Rack 4');
});

// ── 3 and 4. a binding that cannot be honoured is refused ───────────────────

test('a binding naming a record that belongs to another RackTrack id is refused, and no twin appears', async () => {
  const nb = customersRack(customersNetBox(), { rackUid: 'rack:t9:77' });
  const out = await writer.push(snapshotFor({ recordBinding: BINDING }), nb);

  const rackRow = out.changes.find((c) => c.type === 'Rack');
  assert.equal(rackRow.action, 'skip');
  assert.match(rackRow.reason, /rack:t9:77/);
  assert.equal(nb.rows('/api/dcim/racks/').length, 1, 'no second rack was created beside it');
  assert.equal(nb.rows('/api/dcim/racks/')[0].custom_fields[UID_FIELD], 'rack:t9:77',
    'and the other identity\'s record is untouched');
});

test('a binding naming a record that has gone is refused, not created around', async () => {
  const nb = customersRack(customersNetBox());
  const gone = { ...BINDING, rackNetboxId: 999 };
  const out = await writer.plan(snapshotFor({ recordBinding: gone }), nb);
  const rackRow = out.changes.find((c) => c.type === 'Rack');
  assert.equal(rackRow.action, 'skip');
  assert.match(rackRow.reason, /nothing at id 999/);
});

test('our own id on one record and a person naming another is said out loud, and neither is changed', async () => {
  const nb = customersNetBox();
  customersRack(nb, { rackUid: 'rack:t7:5' });
  // A second rack that already carries nothing, which the person named instead.
  nb.rows('/api/dcim/racks/').push({
    id: 8, name: 'Row 1 Rack 5', facility_id: 'DC1-R05', site: { id: 1 }, custom_fields: {},
  });
  const out = await writer.push(snapshotFor({ recordBinding: { ...BINDING, rackNetboxId: 8 } }), nb);

  assert.ok(out.warnings.some((w) => /record 7/.test(w) && /record 8/.test(w)),
    'both records are named in the warning');
  assert.ok(out.warnings.some((w) => /a person has to say which one is right/.test(w)));
  assert.equal(nb.rows('/api/dcim/racks/').find((r) => r.id === 8).custom_fields[UID_FIELD], undefined,
    'the record the person named was not stamped');
  assert.equal(nb.rows('/api/dcim/racks/').length, 2, 'and no third rack was created');
});

// ── 5. the customer's own devices are visible to the orphan check ───────────

test('a device the customer wrote, still in the record and not in this scan, is reported as theirs', async () => {
  const nb = customersRack(customersNetBox());
  // A third box the customer has on record that this photo did not see.
  nb.rows('/api/dcim/devices/').push({
    id: 53, name: 'lon-pdu-01', rack: { id: 7 }, site: { id: 1 }, position: 1,
    serial: 'PDU-001', status: { value: 'active' }, custom_fields: {},
  });

  const out = await writer.plan(snapshotFor({ recordBinding: BINDING }), nb);
  assert.equal(out.orphans.length, 1, 'exactly the box this scan did not see');
  const [orphan] = out.orphans;
  assert.equal(orphan.netboxId, 53);
  assert.equal(orphan.ours, false, 'it says plainly that it is the customer\'s');
  assert.match(orphan.whose, /customer/);
  assert.match(orphan.recommendation, /nothing here deletes/);
  assert.ok(!nb.calls.some((c) => c.method === 'DELETE'));
});

test('a device this plan is about to bind is not reported as gone from the rack', async () => {
  const nb = customersRack(customersNetBox());
  const out = await writer.plan(snapshotFor({ recordBinding: BINDING }), nb);
  assert.deepEqual(out.orphans, [], 'the two bound boxes are seen, not missing');
});

test('binding the rack alone makes the customer\'s own devices visible to the check', async () => {
  const nb = customersRack(customersNetBox());
  // The rack is bound and the boxes in it are not, which is what the screen in
  // the next slice starts from. Before this change both of these were invisible:
  // the check threw away every record that did not carry our own uid.
  const rackOnly = { ...BINDING, deviceNetboxIds: {} };
  const out = await writer.plan(snapshotFor({ recordBinding: rackOnly }), nb);
  assert.deepEqual(out.orphans.map((o) => o.netboxId).sort(), [51, 52],
    'both of the customer\'s boxes are reported');
  assert.ok(out.orphans.every((o) => o.ours === false), 'and both are marked as theirs, not ours');
  assert.ok(out.orphans.every((o) => o.position !== null), 'with the shelf the record puts them on');
  assert.ok(!nb.calls.some((c) => c.method === 'DELETE'));
});

test('with no binding at all the rack itself is unknown, so there is nothing to check inside it', async () => {
  const nb = customersRack(customersNetBox());
  const out = await writer.plan(snapshotFor(), nb);
  assert.equal(out.changes.find((c) => c.type === 'Rack').action, 'create',
    'this is the symptom the slice fixes: the rack is there and RackTrack cannot see it');
  assert.deepEqual(out.orphans, [], 'and with no rack named, the check has nowhere to look');
});

// ── 6. Replaced: one row, was X now Y ──────────────────────────────────────

test('a bound box whose serial disagrees with the switch is one row, was X now Y', async () => {
  const nb = customersRack(customersNetBox());
  const snap = snapshotFor({
    recordBinding: BINDING,
    // The switch published a different serial from the one on the record.
    serials: { u10: 'FDO9999ZZZZ' },
  });
  const out = await writer.plan(snap, nb);

  const replaced = out.findings.filter((f) => f.kind === 'replaced');
  assert.equal(replaced.length, 1, 'one row, not a removal plus an addition');
  assert.equal(replaced[0].tier, 'high');
  assert.equal(replaced[0].netboxId, 51);
  assert.equal(replaced[0].was, 'FDO2117A0X9');
  assert.equal(replaced[0].now, 'FDO9999ZZZZ');
  assert.match(replaced[0].why, /was FDO2117A0X9 and is now FDO9999ZZZZ/);
  assert.ok(out.warnings.some((w) => /Replaced/.test(w)), 'and it reaches the plan the admin reads');

  assert.equal(out.orphans.length, 0, 'the box is not reported as gone from the rack');
  assert.equal(out.changes.filter((c) => c.type === 'Device' && c.action === 'create').length, 0,
    'and it is not reported as a new box either');
});

test('the same serial spelled differently is not a replacement', async () => {
  const nb = customersRack(customersNetBox());
  const snap = snapshotFor({ recordBinding: BINDING, serials: { u10: 'fdo-2117-a0x9' } });
  const out = await writer.plan(snap, nb);
  assert.deepEqual(out.findings.filter((f) => f.kind === 'replaced'), []);
  assert.equal(identity.normalise('fdo-2117-a0x9'), identity.normalise('FDO2117A0X9'));
});

test('a serial the record does not hold at all is a gap to fill, not a replacement', async () => {
  const nb = customersNetBox();
  customersRack(nb);
  nb.rows('/api/dcim/devices/').find((d) => d.id === 51).serial = '';
  const out = await writer.plan(snapshotFor({ recordBinding: BINDING, serials: { u10: 'FDO9999ZZZZ' } }), nb);
  assert.deepEqual(out.findings.filter((f) => f.kind === 'replaced'), []);
});

// ── 7. the store: one file, two kinds of answer, neither erasing the other ──

test('a record binding and a confirmed switch live in one scope and survive each other', () => {
  const scope = bindings.scopeOf({ tenantId: 7, rackId: 'RK-E909532A' });
  const said = bindings.bindRecord(scope, {
    rackNetboxId: 7, deviceNetboxIds: { 'dev:t7:5:u10': 51 },
    by: 'sam@example.test', why: 'picked from the shortlist',
  });
  assert.equal(said.record.rackNetboxId, 7);

  // Somebody now says which live switch is in that box. That used to be the
  // only thing this file held, and it must not wipe the record binding.
  const out = bindings.confirm(scope, {
    aliases: identity.aliasesOf({ identity: { serial: 'FDO2117A0X9' } }),
    deviceUid: 'dev:t7:5:u10', position: 10, switchId: 3, by: 'sam@example.test',
  });
  assert.ok(out.binding, 'the switch confirmation is stored');
  assert.equal(bindings.recordBinding(scope).rackNetboxId, 7, 'and the record binding is still there');

  // And the other way round: binding one more box leaves the confirmation alone.
  bindings.bindRecord(scope, { deviceNetboxIds: { 'dev:t7:5:u12': 52 } });
  assert.equal(bindings.list(scope).length, 1, 'the switch confirmation stands');
  assert.deepEqual(bindings.recordBinding(scope).deviceNetboxIds,
    { 'dev:t7:5:u10': 51, 'dev:t7:5:u12': 52 });
  assert.equal(bindings.recordBinding(scope).rackNetboxId, 7, 'and the rack it was bound to');
});

test('a record binding refuses anything that is not a record id', () => {
  const scope = bindings.scopeOf({ tenantId: 7, rackId: 'RK-REFUSE' });
  assert.match(bindings.bindRecord(scope, { rackNetboxId: 'seven' }).error, /not a record id/);
  assert.match(bindings.bindRecord(scope, { deviceNetboxIds: { 'dev:x': -1 } }).error, /not a record id/);
  assert.equal(bindings.recordBinding(scope), null, 'and nothing was stored');
});

test('a person can take a record binding back, one box or the whole rack', () => {
  const scope = bindings.scopeOf({ tenantId: 7, rackId: 'RK-FORGET' });
  bindings.bindRecord(scope, { rackNetboxId: 7, deviceNetboxIds: { a: 1, b: 2 } });
  assert.ok(bindings.forgetRecordBinding(scope, { deviceUid: 'a' }).ok);
  assert.deepEqual(bindings.recordBinding(scope).deviceNetboxIds, { b: 2 });
  assert.ok(bindings.forgetRecordBinding(scope).ok);
  assert.equal(bindings.recordBinding(scope), null);
});

test('the snapshot carries the binding, so a re-adopt and a re-detect keep it', () => {
  const snap = snapshotFor({ recordBinding: BINDING });
  assert.deepEqual(snap.recordBinding, BINDING);
  // A snapshot built without one carries null rather than a stale answer.
  assert.equal(snapshotFor().recordBinding, null);
});
