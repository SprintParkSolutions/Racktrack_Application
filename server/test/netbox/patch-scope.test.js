/**
 * An approval changes one thing, not everything.
 *
 * An update used to PATCH the whole mapped payload. NetBox applies a PATCH
 * field by field, so approving one correction rewrote every field this system
 * maps on the customer's object - and for a field no source ever stated, what
 * it rewrote it to was empty. mapping.js sends serial: '' for a device whose
 * serial nobody read, and diff() deliberately does not report NetBox-null
 * against our empty string as a difference, so the admin could not see it in
 * the list they approved. A serial somebody typed into NetBox by hand would
 * have been cleared by approving a name change.
 *
 * Rule 3 of the frozen workflow is "nothing invented"; this is its other half.
 * A value no source stated is not ours to write, and it is certainly not ours
 * to erase on the way past.
 */
const test = require('node:test');
const assert = require('node:assert');

const writer = require('../../lib/netbox/writer');
const { NetBox, UID_FIELD } = require('../../lib/netbox/netbox');

function netbox() {
  const store = new Map();
  const calls = [];
  let nextId = 1;
  const rows = (p) => { if (!store.has(p)) store.set(p, []); return store.get(p); };
  const nb = new NetBox('http://fake.invalid', 'nbt_test');
  nb.calls = calls;
  nb.rows = rows;
  nb.request = async (method, path, body = null, params = null) => {
    calls.push({ method, path, body, params });
    if (method === 'GET') {
      const key = params && Object.keys(params).find((k) => k.startsWith(`cf_${UID_FIELD}`));
      const want = key ? params[key] : undefined;
      const list = rows(path).filter((o) => {
        if (want === undefined) return true;
        return String((o.custom_fields || {})[UID_FIELD] || '').toLowerCase()
          .includes(String(want).toLowerCase());
      });
      return { results: list, next: null };
    }
    if (method === 'POST') { const o = { id: nextId++, custom_fields: {}, ...body }; rows(path).push(o); return o; }
    if (method === 'PATCH') {
      const m = path.match(/^(.*\/)(\d+)\/$/);
      const o = rows(m[1]).find((x) => x.id === Number(m[2]));
      for (const [k, v] of Object.entries(body)) {
        if (k === 'custom_fields') o.custom_fields = { ...o.custom_fields, ...v };
        else o[k] = v;
      }
      return o;
    }
    throw new Error(`unexpected ${method}`);
  };
  return nb;
}

function snapshot({ rackName = 'Rack 1' } = {}) {
  const cv = require('../../lib/netbox/cv');
  return cv.toSnapshot({
    image: 'rack.jpg',
    devices: [{
      class_name: 'Switch', port_count: 2, units: ['u10'],
      box: [10, 10, 900, 60], center: [455, 35],
      ports: [
        { box: [10, 20, 24, 40], confidence: 0.9, index: 1 },
        { box: [40, 20, 54, 40], confidence: 0.9, index: 2 },
      ],
      console_ports: [], sfp_ports: [], other_ports: [], connected_ports: [],
      ocr_make: 'D-Link', ocr_model: 'DGS-1210',
    }],
  }, {
    rackId: 'RK-PATCH001', siteName: 'Test Site', rackName,
    uHeight: 42, scannedAt: '2026-01-01T00:00:00Z',
  });
}

const DEVICES = '/api/dcim/devices/';

test('an approved change does not clear a serial the customer typed', async () => {
  const nb = netbox();
  // First write: the device lands, with no serial, because nobody read one.
  await writer.push(snapshot(), nb);
  const device = nb.rows(DEVICES)[0];
  assert.ok(device, 'the device was written');

  // The customer then types the real serial into NetBox by hand, and renames
  // the rack, so the next scan has one genuine difference to approve.
  device.serial = 'FOC1234X5YZ';
  device.asset_tag = 'AST-0042';

  const second = await writer.push(snapshot({ rackName: 'Rack 1A' }), nb);
  assert.equal(second.counts.fail || 0, 0, 'nothing fails');

  assert.equal(nb.rows(DEVICES)[0].serial, 'FOC1234X5YZ',
    'the serial somebody typed is still there');
  assert.equal(nb.rows(DEVICES)[0].asset_tag, 'AST-0042',
    'and so is the asset tag');
});

test('a patch carries only the fields that differ, plus the uid', async () => {
  const nb = netbox();
  await writer.push(snapshot(), nb);
  const rack = nb.rows('/api/dcim/racks/')[0];
  const before = nb.calls.length;

  // One real difference: the rack has been renamed.
  await writer.push(snapshot({ rackName: 'Rack 1A' }), nb);

  const patch = nb.calls.slice(before).find((c) => c.method === 'PATCH'
    && c.path.startsWith('/api/dcim/racks/'));
  assert.ok(patch, 'the rack was patched');
  const sent = Object.keys(patch.body).sort();
  assert.deepEqual(sent, ['custom_fields', 'name'],
    `only the changed field and the uid were sent, got ${sent.join(', ')}`);
  assert.equal(patch.body.name, 'Rack 1A');
  assert.equal(nb.rows('/api/dcim/racks/')[0].id, rack.id, 'the same rack');
});

test('what the admin was shown is exactly what was sent', async () => {
  const nb = netbox();
  await writer.push(snapshot(), nb);
  const before = nb.calls.length;

  const report = await writer.push(snapshot({ rackName: 'Rack 1A' }), nb);
  const row = report.changes.find((c) => c.type === 'Rack' && c.action === 'update');
  assert.ok(row, 'the rack shows as an update');

  const patch = nb.calls.slice(before).find((c) => c.method === 'PATCH'
    && c.path.startsWith('/api/dcim/racks/'));
  const shown = Object.keys(row.diff).sort();
  const sent = Object.keys(patch.body).filter((k) => k !== 'custom_fields').sort();
  assert.deepEqual(sent, shown,
    'every field sent appears in the difference the admin approved, and no other');
});

test('a second write of an unchanged rack still patches nothing at all', async () => {
  const nb = netbox();
  await writer.push(snapshot(), nb);
  const before = nb.calls.length;

  const second = await writer.push(snapshot(), nb);
  assert.equal(second.counts.update || 0, 0, 'nothing to update');
  assert.equal(nb.calls.slice(before).filter((c) => c.method === 'PATCH').length, 0,
    'and not one PATCH was sent');
});

/**
 * One device holds one port of each name.
 *
 * Measured on the live server on 18 September 2026: a real write refused four
 * interfaces on one switch, all with "Interface with this Device and Name
 * already exists". The four uids were distinct, so nothing on our side
 * noticed; the names were 1, 2, 3 and 4 asked for twice, because the engine
 * numbers a port from where it sits on the panel and read two rows the same
 * way. The first of each pair went in and the second was refused.
 *
 * Claiming the existing one by device and name would hide a reading problem,
 * so the second port is given its place in the list instead, and the
 * disagreement is recorded for a person.
 */
test('two ports the camera read as one number do not collide', () => {
  const cv = require('../../lib/netbox/cv');
  // Two rows, one above the other, so these are four separate sockets and not
  // one socket detected twice: extractPorts drops a genuine double detection.
  const at = (x, y, index) => ({ box: [x, y, x + 14, y + 16], confidence: 0.9, index });
  const snap = cv.toSnapshot({
    image: 'rack.jpg',
    devices: [{
      class_name: 'Switch', port_count: 4, units: ['u8'],
      box: [10, 10, 900, 60], center: [455, 35],
      // Two rows, and the engine numbered both rows 1 and 2.
      ports: [at(10, 20, 1), at(40, 20, 2), at(10, 60, 1), at(40, 60, 2)],
      console_ports: [], sfp_ports: [], other_ports: [], connected_ports: [],
      ocr_make: 'D-Link', ocr_model: 'DGS-1210',
    }],
  }, {
    rackId: 'RK-DUPE0001', siteName: 'Test Site', rackName: 'Rack 1',
    uHeight: 42, scannedAt: '2026-01-01T00:00:00Z',
  });

  const names = snap.interfaces.map((i) => i.name);
  assert.equal(new Set(names).size, names.length,
    `every port on the device has its own name, got ${names.join(', ')}`);
  assert.ok(names.includes('1') && names.includes('2'),
    'the numbers the camera actually read are kept where they are unique');
  assert.ok(snap.conflicts.some((c) => c.field === 'name'),
    'and the two that read alike are reported rather than smoothed over');
});

test('an old snapshot with two ports of one name is repaired when it is read', async () => {
  // A scan taken before the naming fix: the snapshot on disk carries the
  // duplicate, and a compare made today re-reads NetBox but not the camera.
  const nb = netbox();
  const snap = snapshot();
  snap.interfaces[1].name = snap.interfaces[0].name;   // as cv.js used to write it

  const report = await writer.push(snap, nb);
  assert.equal(report.counts.fail || 0, 0, 'the write no longer fails on it');

  const names = nb.rows('/api/dcim/interfaces/').map((i) => i.name);
  assert.equal(new Set(names).size, names.length,
    `each interface reached NetBox with its own name, got ${names.join(', ')}`);
  assert.ok(report.warnings.some((w) => /both read as/.test(w)),
    'and the reading problem is named in the warnings, not hidden');
  assert.ok(report.warnings.some((w) => /Photograph the rack again/.test(w)),
    'with what to do about it');
});
