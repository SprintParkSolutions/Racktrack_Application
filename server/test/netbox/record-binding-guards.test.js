/**
 * The guards around binding a scan to the customer's own records.
 *
 * record-binding.test.js proves the bind works. This file proves it cannot go
 * wrong quietly, which is the owner's actual sentence: "connect a rack to the
 * database rack exactly the one, I need 100 percent guarantee on that". The
 * guarantee is never to bind or overwrite the wrong record, so almost everything
 * below is a refusal.
 *
 * What is proved here:
 *
 *   1. an approval pins WHICH record it binds: two plans that differ only in the
 *      record named no longer sign the same;
 *   2. the protection on a bound record lives on the record, so taking the
 *      answer back does not let the next compare rename and re-site it;
 *   3. what the customer says the hardware IS - the model and the role - is
 *      never overwritten from a camera reading;
 *   4. a record outside the scan's scope is refused: another site, another rack,
 *      or a row that has changed since the person was shown it;
 *   5. one record is one box, refused where the answer is given and again in the
 *      plan, rather than settled by the order of a loop;
 *   6. a device whose id happens to equal the bound rack's id is still reported;
 *   7. a record on a shelf this scan has a box on is "not yet bound", never
 *      "gone from the rack", and no duplicate is created on that shelf;
 *   8. the resolver is wired: a rack the customer filled in by hand comes back
 *      as rebind rows instead of a list of creates, which is slice 2's own proof;
 *   9. a shelf on its own is a question and never a bind.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-bind-guards-'));
process.env.RT_DATA_DIR = DATA_DIR;

const cv = require('../../lib/netbox/cv');
const writer = require('../../lib/netbox/writer');
const bindings = require('../../lib/netbox/bindings');
const find = require('../../lib/netbox/find');
const shape = require('../../lib/approvals/shape');
const { NetBox, UID_FIELD, BOUND_FIELD } = require('../../lib/netbox/netbox');

test.after(() => { try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch { /* best effort */ } });

/**
 * A NetBox close enough to the real one for these questions: it filters on the
 * fields the resolver asks about, honours `limit`, refuses a second site with a
 * name it already has (which is how the customer's own site gets claimed rather
 * than duplicated), and merges custom fields on a PATCH.
 */
function fakeNetBox() {
  const store = new Map();
  const calls = [];
  let nextId = 200;
  const rows = (p) => { if (!store.has(p)) store.set(p, []); return store.get(p); };
  const nb = new NetBox('http://fake.invalid', 'nbt_test');
  nb.calls = calls;
  nb.rows = rows;
  // The two fields RackTrack keeps its ids in. An instance it has written to
  // before holds them, and a preview will not show a record as bound unless the
  // field that marks it as the customer's own is really there - which is its own
  // test at the end of this file.
  rows('/api/extras/custom-fields/').push(
    { id: 1, name: UID_FIELD, object_types: [], filter_logic: 'exact' },
    { id: 2, name: BOUND_FIELD, object_types: [], filter_logic: 'exact' });
  nb.patches = (p) => calls.filter((c) => c.method === 'PATCH' && c.path.startsWith(p));
  const idOf = (v) => (v && typeof v === 'object' ? v.id : v);
  const same = (a, b) => String(a ?? '').toLowerCase() === String(b ?? '').toLowerCase();

  nb.request = async (method, path, body = null, params = null) => {
    calls.push({ method, path, body, params });
    if (method === 'GET') {
      const p = params || {};
      const cf = Object.keys(p).find((k) => k.startsWith(`cf_${UID_FIELD}`));
      let list = rows(path).filter((o) => {
        if (cf) {
          const held = String((o.custom_fields || {})[UID_FIELD] || '');
          return cf.endsWith('__ic')
            ? held.toLowerCase().includes(String(p[cf]).toLowerCase())
            : held === p[cf];
        }
        if (p.id !== undefined && Number(o.id) !== Number(p.id)) return false;
        if (p.site_id !== undefined && Number(idOf(o.site)) !== Number(p.site_id)) return false;
        if (p.rack_id !== undefined && Number(idOf(o.rack)) !== Number(p.rack_id)) return false;
        if (p.position !== undefined && Number(o.position) !== Number(p.position)) return false;
        if (p.face !== undefined && !same(idOf(o.face) ?? (o.face || {}).value ?? o.face, p.face)) return false;
        if (p.facility_id !== undefined && !same(o.facility_id, p.facility_id)) return false;
        if (p.asset_tag !== undefined && !same(o.asset_tag, p.asset_tag)) return false;
        if (p.serial !== undefined && !same(o.serial, p.serial)) return false;
        if (p.serial__ic !== undefined
          && !String(o.serial ?? '').toLowerCase().includes(String(p.serial__ic).toLowerCase())) return false;
        if (p.name !== undefined && !same(o.name, p.name)) return false;
        if (p.slug !== undefined && o.slug !== p.slug) return false;
        return true;
      });
      if (p.limit !== undefined) list = list.slice(0, Number(p.limit));
      return { results: list, next: null };
    }
    if (method === 'POST') {
      // NetBox's own uniqueness, for the one type these tests lean on: a site
      // name is unique, so RackTrack's create is refused and the writer claims
      // the customer's site instead of making a second one.
      if (path === '/api/dcim/sites/' && rows(path).some((o) => same(o.name, body.name))) {
        const e = new Error('conflict');
        e.status = 400;
        e.detail = { name: ['site with this name already exists.'] };
        e.name = 'NetBoxError';
        throw e;
      }
      const obj = { id: nextId++, custom_fields: {}, ...body };
      rows(path).push(obj);
      return obj;
    }
    if (method === 'PATCH') {
      const m = path.match(/^(.*\/)(\d+)\/$/);
      const obj = rows(m[1]).find((o) => o.id === Number(m[2]));
      for (const [k, v] of Object.entries(body)) {
        if (k === 'custom_fields') obj.custom_fields = { ...obj.custom_fields, ...v };
        else obj[k] = v;
      }
      return obj;
    }
    throw new Error(`unexpected ${method}`);
  };
  return nb;
}

/** The customer's estate: one site, their rack, and two boxes already in it. */
function customersEstate(nb, { rackUid = null, deviceUids = {} } = {}) {
  nb.rows('/api/dcim/sites/').push({ id: 1, name: 'London DC', slug: 'london-dc', custom_fields: {} });
  nb.rows('/api/dcim/device-types/').push({ id: 900, model: 'C9300-48P', slug: 'c9300-48p', custom_fields: {} });
  nb.rows('/api/dcim/device-roles/').push({ id: 910, name: 'Core Switch', slug: 'core-switch', custom_fields: {} });
  nb.rows('/api/dcim/racks/').push({
    id: 7, name: 'Row 1 Rack 4', facility_id: 'DC1-R04', site: { id: 1 }, u_height: 45,
    custom_fields: rackUid ? { [UID_FIELD]: rackUid } : {},
  });
  nb.rows('/api/dcim/devices/').push({
    id: 51, name: 'lon-core-01', rack: { id: 7 }, site: { id: 1 }, position: 10,
    serial: 'FDO-2117-A0X9', face: { value: 'front' }, status: { value: 'active' },
    device_type: { id: 900, model: 'C9300-48P' }, role: { id: 910, name: 'Core Switch' },
    custom_fields: deviceUids.u10 ? { [UID_FIELD]: deviceUids.u10 } : {},
  });
  nb.rows('/api/dcim/devices/').push({
    id: 52, name: 'lon-core-02', rack: { id: 7 }, site: { id: 1 }, position: 12,
    serial: 'FDO2117B1Y0', face: { value: 'front' }, status: { value: 'active' },
    device_type: { id: 900, model: 'C9300-48P' }, role: { id: 910, name: 'Core Switch' },
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
function snapshotFor({ recordBinding = null, recordMatch = null, serials = {}, units = ['u10', 'u12'] } = {}) {
  const snap = cv.toSnapshot({
    image: 'rack.jpg',
    devices: units.map((u, i) => box('Switch', i === 0 ? 48 : 24, [u])),
  }, {
    rackId: 'RK-E909532A', rackKey: 't7:5', siteName: 'London DC', rackName: 'Rack 1',
    uHeight: 42, scannedAt: '2026-09-18T00:00:00Z', recordBinding, recordMatch,
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

/** The record's own answer, as rack_match resolves it: site and rack, by key. */
const MATCH = {
  siteId: 1, rackNetboxId: 7, by: 'facility-id', confidence: 'confirmed',
  why: 'the customer\'s rack id DC1-R04 at this site',
};

// ── 1. the approval pins which record is bound ──────────────────────────────

test('two plans that bind different records do not sign the same', async () => {
  const one = fakeNetBox();
  customersEstate(one);
  one.rows('/api/dcim/racks/').push({
    id: 8, name: 'FRA Row 9 Rack 1', facility_id: 'DC2-R09', site: { id: 1 }, custom_fields: {},
  });
  const two = fakeNetBox();
  customersEstate(two);
  two.rows('/api/dcim/racks/').push({
    id: 8, name: 'FRA Row 9 Rack 1', facility_id: 'DC2-R09', site: { id: 1 }, custom_fields: {},
  });

  const toSeven = await writer.plan(snapshotFor({
    recordBinding: { ...BINDING, deviceNetboxIds: {} }, recordMatch: MATCH,
  }), one);
  const toEight = await writer.plan(snapshotFor({
    recordBinding: { ...BINDING, rackNetboxId: 8, deviceNetboxIds: {} }, recordMatch: MATCH,
  }), two);

  assert.equal(toSeven.changes.find((c) => c.type === 'Rack').netboxId, 7);
  assert.equal(toEight.changes.find((c) => c.type === 'Rack').netboxId, 8);
  assert.notEqual(shape.fingerprint(toSeven.changes), shape.fingerprint(toEight.changes),
    'an approval of one record cannot be spent on another');
});

// ── 2. the protection is on the record, not beside it ───────────────────────

test('taking the answer back does not let the next compare rename the customer\'s rack', async () => {
  const nb = fakeNetBox();
  customersEstate(nb);
  await writer.push(snapshotFor({ recordBinding: BINDING, recordMatch: MATCH }), nb);
  const rack = nb.rows('/api/dcim/racks/').find((r) => r.id === 7);
  assert.equal(rack.custom_fields[UID_FIELD], 'rack:t7:5', 'the bind happened');
  assert.match(String(rack.custom_fields[BOUND_FIELD]), /sam@example.test/,
    'and the record says who bound it');

  // The binding is gone: forgotten, corrected, or the file behind it lost. The
  // uid it wrote is permanent, so this is the state that used to rename "Row 1
  // Rack 4" to the technician's local alias and move it to the RackTrack site.
  const out = await writer.push(snapshotFor(), nb);

  const row = out.changes.find((c) => c.type === 'Rack');
  assert.equal(row.action, 'noop', 'nothing is left to write on the customer\'s rack');
  assert.equal(nb.rows('/api/dcim/racks/').find((r) => r.id === 7).name, 'Row 1 Rack 4');
  assert.equal(nb.rows('/api/dcim/racks/').find((r) => r.id === 7).u_height, 45);
  assert.ok(out.findings.some((f) => f.kind === 'bind-only' && f.netboxId === 7),
    'and the difference is still reported');
});

// ── 3. what the customer says the hardware is ───────────────────────────────

test('a bound box keeps the model and role the customer recorded', async () => {
  const nb = fakeNetBox();
  customersEstate(nb);
  await writer.push(snapshotFor({ recordBinding: BINDING, recordMatch: MATCH }), nb);
  const again = await writer.plan(snapshotFor({ recordBinding: BINDING, recordMatch: MATCH }), nb);

  const row = again.changes.find((c) => c.uid === 'dev:t7:5:u10');
  const proposed = Object.keys((row && row.diff) || {});
  assert.ok(!proposed.includes('device_type'), 'the camera does not re-parent their asset');
  assert.ok(!proposed.includes('role'), 'nor its role');
  const held = again.findings.find((f) => f.kind === 'bind-only' && f.netboxId === 51);
  assert.ok(held, 'the difference is reported instead');
  assert.ok(held.fields.some((f) => f.field === 'device_type'));

  await writer.push(snapshotFor({ recordBinding: BINDING, recordMatch: MATCH }), nb);
  const device = nb.rows('/api/dcim/devices/').find((d) => d.id === 51);
  assert.equal(device.device_type.id, 900, 'and the record still says what it is');
  assert.equal(device.role.id, 910);
});

// ── 4. a record outside the scan's scope ────────────────────────────────────

test('a rack at another site is never bound, however it was named', async () => {
  const nb = fakeNetBox();
  customersEstate(nb);
  nb.rows('/api/dcim/sites/').push({ id: 2, name: 'Frankfurt DC', slug: 'frankfurt-dc', custom_fields: {} });
  nb.rows('/api/dcim/racks/').push({
    id: 8, name: 'FRA Row 9 Rack 1', facility_id: 'DC2-R09', site: { id: 2 }, custom_fields: {},
  });

  const out = await writer.push(snapshotFor({
    recordBinding: { ...BINDING, rackNetboxId: 8, deviceNetboxIds: {} },
    recordMatch: MATCH,
  }), nb);

  const row = out.changes.find((c) => c.type === 'Rack');
  assert.equal(row.action, 'skip');
  assert.match(row.reason, /is at site 2 and this scan is of site 1/);
  assert.equal(nb.rows('/api/dcim/racks/').find((r) => r.id === 8).custom_fields[UID_FIELD], undefined,
    'the rack in the other building is untouched');
});

test('a record in another rack is never bound to a box in this rack', async () => {
  const nb = fakeNetBox();
  customersEstate(nb);
  nb.rows('/api/dcim/racks/').push({ id: 9, name: 'LON-R12', site: { id: 1 }, custom_fields: {} });
  nb.rows('/api/dcim/devices/').push({
    id: 77, name: 'someone-elses', rack: { id: 9 }, site: { id: 1 }, position: 10,
    serial: 'OTHER-1', status: { value: 'active' }, custom_fields: {},
  });

  const out = await writer.push(snapshotFor({
    recordBinding: { ...BINDING, deviceNetboxIds: { 'dev:t7:5:u10': 77 } },
    recordMatch: MATCH,
  }), nb);

  const row = out.changes.find((c) => c.uid === 'dev:t7:5:u10');
  assert.equal(row.action, 'skip');
  assert.match(row.reason, /cannot be a box in this rack/);
  assert.equal(nb.rows('/api/dcim/devices/').find((d) => d.id === 77).custom_fields[UID_FIELD], undefined,
    'the other rack\'s record is untouched');
});

test('a record that has changed since the person was shown it refuses itself', async () => {
  const nb = fakeNetBox();
  customersEstate(nb);
  // NetBox was restored from a backup and the ids moved: record 51 is now a
  // different box from the one the person answered about.
  nb.rows('/api/dcim/devices/').find((d) => d.id === 51).name = 'lon-edge-09';

  const out = await writer.plan(snapshotFor({
    recordBinding: {
      ...BINDING,
      deviceNetboxIds: { 'dev:t7:5:u10': 51 },
      shown: { rack: null, devices: { 'dev:t7:5:u10': { name: 'lon-core-01', position: 10 } } },
    },
    recordMatch: MATCH,
  }), nb);

  const row = out.changes.find((c) => c.uid === 'dev:t7:5:u10');
  assert.equal(row.action, 'skip');
  assert.match(row.reason, /is not the record that was named/);
  assert.match(row.reason, /lon-core-01/);
});

// ── 5. one record is one box ────────────────────────────────────────────────

test('one record named by two boxes is refused where the answer is given', () => {
  const scope = bindings.scopeOf({ tenantId: 7, rackId: 'RK-TWOBOXES' });
  const out = bindings.bindRecord(scope, {
    deviceNetboxIds: { 'dev:t7:5:u10': 51, 'dev:t7:5:u12': 51 },
  });
  assert.match(out.error, /One record is one box/);
  assert.equal(bindings.recordBinding(scope), null, 'and nothing was stored');
});

test('one record named by two boxes is refused in the plan as well', async () => {
  const nb = fakeNetBox();
  customersEstate(nb);
  // A file edited by hand, or an older answer stored before the rule existed.
  const out = await writer.plan(snapshotFor({
    recordBinding: { ...BINDING, deviceNetboxIds: { 'dev:t7:5:u10': 51, 'dev:t7:5:u12': 51 } },
    recordMatch: MATCH,
  }), nb);

  const rows = out.changes.filter((c) => c.type === 'Device');
  assert.equal(rows.filter((r) => r.action === 'rebind').length, 1, 'one of them binds');
  const refused = rows.find((r) => r.action === 'skip');
  assert.ok(refused, 'and the other is refused in the preview, not by the write');
  assert.match(refused.reason, /One record is one device/);
});

test('a record id is a number, not a flag', () => {
  const scope = bindings.scopeOf({ tenantId: 7, rackId: 'RK-COERCE' });
  assert.match(bindings.bindRecord(scope, { rackNetboxId: true }).error, /not a record id/);
  assert.match(bindings.bindRecord(scope, { rackNetboxId: [7] }).error, /not a record id/);
  assert.equal(bindings.recordBinding(scope), null, 'and NetBox row 1 was never named');
  assert.equal(bindings.asNetboxId('7'), 7, 'a string of digits is still an id');
  assert.equal(bindings.asNetboxId('7a'), null);
});

// ── 6. a device id that equals a rack id ────────────────────────────────────

test('a device whose id equals the bound rack\'s id is still reported as gone', async () => {
  const nb = fakeNetBox();
  customersEstate(nb);
  // NetBox numbers racks and devices separately, so a device 7 in rack 7 is
  // ordinary. This one RackTrack wrote itself, and this scan does not see it.
  nb.rows('/api/dcim/devices/').push({
    id: 7, name: 'Switch U30', rack: { id: 7 }, site: { id: 1 }, position: 30,
    serial: 'GONE-1', status: { value: 'active' },
    custom_fields: { [UID_FIELD]: 'dev:t7:5:u30' },
  });

  const out = await writer.plan(snapshotFor({
    recordBinding: { ...BINDING, deviceNetboxIds: {} }, recordMatch: MATCH,
  }), nb);

  const gone = out.orphans.find((o) => o.netboxId === 7);
  assert.ok(gone, 'binding rack 7 does not hide device 7');
  assert.equal(gone.ours, true);
  assert.match(gone.recommendation, /absent from this one/);
});

// ── 7. seen is not gone ─────────────────────────────────────────────────────

test('a record on a shelf this scan has a box on is not reported as gone from the rack', async () => {
  const nb = fakeNetBox();
  customersEstate(nb);
  const out = await writer.plan(snapshotFor({
    // The rack is bound and the boxes are not, which is the ordinary state:
    // nothing in the product produces device ids.
    recordBinding: { ...BINDING, deviceNetboxIds: {} }, recordMatch: MATCH,
  }), nb);

  for (const o of out.orphans) {
    assert.equal(o.seen, true, `record ${o.netboxId} is on a shelf this scan photographed`);
    assert.match(o.recommendation, /It is not missing/);
    assert.ok(o.matchedBox, 'and the box that answers for it is named');
  }
  assert.ok(!out.orphans.some((o) => /did not see it/.test(o.recommendation)),
    'nothing claims the scan did not see a box it is looking at');

  // And the same plan does not propose a second box on an occupied shelf, which
  // a real NetBox refuses at write time.
  const creates = out.changes.filter((c) => c.type === 'Device' && c.action === 'create');
  assert.deepEqual(creates, [], 'no duplicate is planned for a shelf the record already fills');
});

// ── 8. the resolver, wired ──────────────────────────────────────────────────

test('a rack the customer filled in by hand comes back as rebinds, not a list of creates', async () => {
  const nb = fakeNetBox();
  customersEstate(nb);
  // The boxes publish their serials, and the record holds the same two, spelled
  // with separators on one side and without on the other.
  const snap = snapshotFor({
    recordMatch: MATCH,
    serials: { u10: 'FDO2117A0X9', u12: 'FDO2117B1Y0' },
  });

  const out = await writer.plan(snap, nb);

  const rack = out.changes.find((c) => c.type === 'Rack');
  assert.equal(rack.action, 'rebind', 'the rack the record already holds is not created again');
  assert.equal(rack.netboxId, 7);
  assert.equal(rack.boundBy, 'record-match');
  assert.equal(rack.confidence, 'confirmed');

  const devices = out.changes.filter((c) => c.type === 'Device');
  assert.equal(devices.length, 2);
  assert.ok(devices.every((d) => d.action === 'rebind'), 'and their boxes are matched by serial');
  assert.deepEqual(devices.map((d) => d.netboxId).sort(), [51, 52]);
  assert.deepEqual(out.orphans, [], 'nothing of the customer\'s reads as missing');

  // The write puts the RackTrack id on their records and nothing else.
  await writer.push(snap, nb);
  for (const p of [...nb.patches('/api/dcim/racks/'), ...nb.patches('/api/dcim/devices/')]) {
    assert.deepEqual(Object.keys(p.body), ['custom_fields']);
  }
  assert.equal(nb.rows('/api/dcim/racks/').length, 1, 'no second rack');
  assert.equal(nb.rows('/api/dcim/devices/').length, 2, 'and no twin of either box');
});

test('a rack the record knows only by name is a question, never a bind', async () => {
  const nb = fakeNetBox();
  customersEstate(nb);
  const out = await writer.plan(snapshotFor({
    recordMatch: { ...MATCH, by: 'name', why: 'a rack at this site is called Rack 1' },
  }), nb);

  const rack = out.changes.find((c) => c.type === 'Rack');
  assert.equal(rack.action, 'create', 'a name finds the record and proves nothing');
  assert.ok(out.findings.some((f) => f.kind === 'record-candidate' && f.type === 'Rack'),
    'and the candidate is put to a person');
});

// ── 9. a shelf is a question ────────────────────────────────────────────────

test('a shelf on its own is possible, and possible is never written', async () => {
  const nb = fakeNetBox();
  customersEstate(nb);
  const hit = await find.findDevice(nb, { siteId: 1, rackId: 7, position: 10, face: 'front' });
  assert.equal(hit.id, 51);
  assert.equal(hit.by, 'rack-position');
  assert.equal(hit.confidence, 'possible', 'the box on a shelf today is not the box that was on it');
  assert.equal(hit.writable, false);

  // And in a plan: the box on the shelf becomes a question, and nothing is
  // written or created on top of the customer's record.
  const out = await writer.plan(snapshotFor({ recordMatch: MATCH }), nb);
  const row = out.changes.find((c) => c.uid === 'dev:t7:5:u10');
  assert.equal(row.action, 'skip');
  assert.ok(out.findings.some((f) => f.kind === 'record-candidate' && f.netboxId === 51),
    'the record that may be this box is named');
  assert.equal(nb.rows('/api/dcim/devices/').length, 2, 'nothing was created');
});

// ── the answer that no longer names a box in this scan ──────────────────────

test('an answer about a box this scan does not have says so out loud', async () => {
  const nb = fakeNetBox();
  customersEstate(nb);
  // The same physical box, read one unit off this time.
  const out = await writer.plan(snapshotFor({
    recordBinding: { ...BINDING, deviceNetboxIds: { 'dev:t7:5:u10': 51 } },
    recordMatch: MATCH,
    units: ['u11', 'u12'],
  }), nb);

  assert.ok(out.warnings.some((w) => /this scan has no box called dev:t7:5:u10/.test(w)),
    'the answer that cannot be applied is named');
  assert.ok(out.findings.some((f) => f.kind === 'binding-not-applied' && f.netboxId === 51));

  // And it is not duplicated beside the warning. The box the answer is about is
  // almost certainly the box at U11 - the same hardware, read one unit off - so
  // a create here gives the customer two records for one box, with a sentence
  // above it saying so. A warning next to a duplicate is not a refusal.
  const creates = out.changes.filter((c) => c.type === 'Device' && c.action === 'create');
  assert.deepEqual(creates, [], 'nothing is created while that answer is outstanding');
  const heldRow = out.changes.find((c) => c.uid === 'dev:t7:5:u11');
  assert.equal(heldRow.action, 'skip');
  assert.match(heldRow.reason, /two records for one box/);
  assert.match(heldRow.reason, /says which box that record is/);
  assert.ok(out.findings.some((f) => f.kind === 'create-held' && f.uid === 'dev:t7:5:u11'));
});

test('and the write makes no second record for it either', async () => {
  const nb = fakeNetBox();
  customersEstate(nb);
  await writer.push(snapshotFor({
    recordBinding: { ...BINDING, deviceNetboxIds: { 'dev:t7:5:u10': 51 } },
    recordMatch: MATCH,
    units: ['u11', 'u12'],
  }), nb);

  assert.equal(nb.rows('/api/dcim/devices/').length, 2,
    'the customer still has the two boxes they had, and no twin of either');
});

// ── the scope a bind rests on, when the scope is not there ──────────────────
//
// The rule this whole round exists for: an absent scope means refuse, never
// allow. A missing site id, a rack that does not exist yet, a field that cannot
// be seen - each of them is a refusal with a sentence, not a bind.

test('with no site in the customer\'s record, no rack is bound however it was named', async () => {
  const nb = fakeNetBox();
  customersEstate(nb);
  nb.rows('/api/dcim/sites/').push({ id: 2, name: 'Frankfurt DC', slug: 'frankfurt-dc', custom_fields: {} });
  nb.rows('/api/dcim/racks/').push({
    id: 8, name: 'FRA Row 9 Rack 1', facility_id: 'DC2-R09', site: { id: 2 }, u_height: 45,
    custom_fields: {},
  });

  // This is the ORDINARY case, not an exotic one: a scan's site name is the
  // RackTrack tenant's own name, the customer's record has no site called that,
  // and so no site id reaches the plan. The site check was skipped whenever it
  // was null, and a Frankfurt rack was bound to a London scan.
  const out = await writer.push(snapshotFor({
    recordBinding: { ...BINDING, rackNetboxId: 8, deviceNetboxIds: {} },
    recordMatch: {
      siteId: null, siteWhy: 'the record has no site called RackTrack',
      rackNetboxId: null, by: null, confidence: 'none', why: 'nothing recognised this rack',
    },
  }), nb);

  const rack = out.changes.find((c) => c.type === 'Rack');
  assert.equal(rack.action, 'skip', 'a bind with nothing to check it against is refused');
  assert.match(rack.reason, /not been placed at a site in the customer's own record/);
  assert.match(rack.reason, /no site called RackTrack/, 'and it names what is missing');
  assert.match(rack.reason, /Name the site/, 'and what would settle it');
  assert.equal(nb.rows('/api/dcim/racks/').find((r) => r.id === 8).custom_fields[UID_FIELD], undefined,
    'the rack in the other building is untouched');
  assert.equal(nb.rows('/api/dcim/racks/').length, 2, 'and no rack was created either');
  assert.equal(nb.rows('/api/dcim/devices/').length, 2,
    'and neither scanned box was planned into somebody else\'s rack');
});

test('a rack the record matched by rack id, with no site, is a question and never a bind', async () => {
  const nb = fakeNetBox();
  customersEstate(nb);

  const out = await writer.plan(snapshotFor({
    // The resolver answered by facility id, which is the customer's own key -
    // but it answered across a whole NetBox with no site to look inside, and a
    // rack id is unique inside a site and nowhere else.
    recordMatch: { ...MATCH, siteId: null, siteWhy: 'the record has no site called RackTrack' },
  }), nb);

  const rack = out.changes.find((c) => c.type === 'Rack');
  assert.notEqual(rack.action, 'rebind', 'nothing of the customer\'s is claimed on that answer');
  const asked = out.findings.find((f) => f.kind === 'record-candidate' && f.type === 'Rack');
  assert.ok(asked, 'it is put to a person instead');
  assert.match(asked.why, /not been placed at a site in the customer's own record/);
  assert.ok(!nb.patches('/api/dcim/racks/').length, 'and their rack is not touched');
});

test('a box is never bound while the rack holding it is unresolved', async () => {
  const nb = fakeNetBox();
  customersEstate(nb);

  // Nobody has said which record the rack is and the record does not recognise
  // it, so this plan is creating the rack. Record 51 is a box in the customer's
  // rack 7, and one transposed digit in a tap looks exactly like a right answer.
  const out = await writer.plan(snapshotFor({
    recordBinding: {
      rackNetboxId: null, deviceNetboxIds: { 'dev:t7:5:u10': 51 },
      by: 'sam@example.test', at: '2026-09-18T09:00:00Z', why: 'typed at the rack',
    },
    recordMatch: {
      siteId: 1, siteWhy: null, rackNetboxId: null, by: null, confidence: 'none',
      why: 'nothing recognised this rack',
    },
  }), nb);

  const row = out.changes.find((c) => c.uid === 'dev:t7:5:u10');
  assert.equal(row.action, 'skip');
  assert.match(row.reason, /rack holding this box has not been found in the customer's record/);
  assert.match(row.reason, /Say which record the rack is first/);
  assert.ok(!out.changes.some((c) => c.action === 'rebind' && c.netboxId === 51),
    'their box is not claimed by a plan that cannot say which rack it is in');
});

test('a preview shows no bind while the field that protects one is not there', async () => {
  const nb = fakeNetBox();
  customersEstate(nb);
  // The instance has the uid field and not the one that marks a record as the
  // customer's own. push() has always held its binds back for this; plan() did
  // not check at all, so the preview printed rebind rows the write then skipped
  // - and the preview is what an admin approves.
  const fields = nb.rows('/api/extras/custom-fields/');
  fields.splice(fields.findIndex((f) => f.name === BOUND_FIELD), 1);

  const out = await writer.plan(snapshotFor({ recordBinding: BINDING, recordMatch: MATCH }), nb);

  assert.equal(out.boundField, 'ABSENT');
  assert.ok(!out.changes.some((c) => c.action === 'rebind'),
    'nothing is promised here that the write would refuse');
  const rack = out.changes.find((c) => c.type === 'Rack');
  assert.equal(rack.action, 'skip');
  assert.match(rack.reason, /cannot be marked as the customer's own/);
  assert.ok(out.warnings.some((w) => /Export creates the field/.test(w)),
    'and the admin is told what to do about it');
});

// ── the record lookup itself ────────────────────────────────────────────────

test('a serial spelled with separators in the record is still found', async () => {
  const nb = fakeNetBox();
  customersEstate(nb);
  // The record holds FDO-2117-A0X9; the switch published it bare.
  const hit = await find.findDevice(nb, { siteId: 1, rackId: 7, serial: 'FDO2117A0X9' });
  assert.equal(hit.id, 51, 'a hyphen does not defeat the strongest rung on the ladder');
  assert.equal(hit.by, 'serial');
});

test('a serial field holding the box\'s own model identifies nothing', async () => {
  const nb = fakeNetBox();
  customersEstate(nb);
  nb.rows('/api/dcim/devices/').push({
    id: 61, name: 'shop-sw-07', rack: { id: 9 }, site: { id: 1 }, position: 3,
    serial: 'GS724Tv4', device_type: { id: 901, model: 'GS724Tv4' },
    status: { value: 'active' }, custom_fields: {},
  });

  const byValue = await find.findDevice(nb, { siteId: 1, rackId: 7, serial: 'GS724Tv4' });
  assert.equal(byValue.id, undefined, 'a model two units share is not a serial');
  assert.match(byValue.why, /model number/);

  const asOwnModel = await find.findDevice(nb, {
    siteId: 1, rackId: 7, serial: 'GS724Tv4', models: ['GS724Tv4'],
  });
  assert.equal(asOwnModel.id, undefined, 'and it is not even asked about');
});

test('a record that will not answer says what NetBox said, and what to do', async () => {
  const nb = fakeNetBox();
  nb.request = async () => {
    const e = new Error('forbidden');
    e.status = 403;
    e.detail = { detail: 'You do not have permission to perform this action.' };
    throw e;
  };
  const hit = await find.findDevice(nb, { siteId: 1, rackId: 7, serial: 'FDO2117A0X9' });
  assert.equal(hit.none, true);
  assert.equal(hit.blocked, true);
  assert.match(hit.why, /HTTP 403/);
  assert.match(hit.why, /token/i, 'and it names the one thing that fixes it');
});
