/**
 * The safety net for "photo to record".
 *
 * It drives a scanned rack the whole way: build the snapshot the way the app
 * does, plan it, write it, then plan it again. What it proves is the promise the
 * write path rests on:
 *
 *   1. a first write creates the objects;
 *   2. a second write of the same rack changes nothing — every object is found
 *      by its racktrack_uid and left alone;
 *   3. nothing is ever deleted;
 *   4. comparing again straight after a write finds no drift.
 *
 * That is the guard for every later change to matching: if a change starts
 * creating duplicates or deleting, one of these breaks.
 *
 * NetBox is an in-memory stand-in (the same shape the as-built test uses), so
 * this touches no network and needs no fixture file.
 */
const test = require('node:test');
const assert = require('node:assert');

const cv = require('../../lib/netbox/cv');
const writer = require('../../lib/netbox/writer');
const { NetBox, UID_FIELD } = require('../../lib/netbox/netbox');

// A NetBox that lives in a Map: create on POST, find by racktrack_uid on GET,
// merge on PATCH, and never a DELETE. Enough to prove idempotency end to end.
function looseNetBox() {
  const store = new Map();
  const methods = [];
  let nextId = 1;
  const rows = (p) => { if (!store.has(p)) store.set(p, []); return store.get(p); };
  const nb = new NetBox('http://fake.invalid', 'nbt_test');
  nb.methods = methods;
  nb.rows = rows;
  nb.request = async (method, path, body = null, params = null) => {
    methods.push(method);
    if (method === 'GET') {
      const key = params && Object.keys(params).find((k) => k.startsWith(`cf_${UID_FIELD}`));
      const want = key ? params[key] : undefined;
      const list = rows(path).filter((o) => {
        if (want === undefined) return params?.name === undefined || o.name === params.name;
        return String((o.custom_fields || {})[UID_FIELD] || '').toLowerCase().includes(String(want).toLowerCase());
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

// A scan as the engine hands it over: two switches at known shelves. The port
// fields are arrays of detected boxes, as the engine writes them, not counts.
function device(cls, ports, units, make, modelName) {
  return {
    class_name: cls, port_count: ports, units, box: [10, 10, 900, 60], center: [455, 35],
    ports: [], console_ports: [], sfp_ports: [], other_ports: [], connected_ports: [],
    ocr_make: make, ocr_model: modelName,
  };
}
function sampleMap() {
  return {
    image: 'rack.jpg',
    devices: [
      device('Switch', 48, ['u10'], 'Cisco', 'C9300-48P'),
      device('Switch', 24, ['u12'], 'Cisco', 'C9200-24T'),
    ],
  };
}

function snapshot() {
  return cv.toSnapshot(sampleMap(), {
    rackId: 'RK-TEST0001', siteName: 'Test Site', rackName: 'Rack 1',
    uHeight: 42, scannedAt: '2026-01-01T00:00:00Z',
  });
}

test('a first write creates the rack and its devices', async () => {
  const nb = looseNetBox();
  const out = await writer.push(snapshot(), nb);
  assert.ok(out.counts.create > 0, 'it creates objects');
  assert.equal(out.counts.fail || 0, 0, 'nothing fails');
});

test('a second write of the same rack changes nothing and deletes nothing', async () => {
  const nb = looseNetBox();
  const first = await writer.push(snapshot(), nb);
  const second = await writer.push(snapshot(), nb);
  assert.equal(second.counts.create || 0, 0, 'the second write creates nothing');
  assert.equal(second.counts.noop || 0, first.counts.create, 'every object is a no-op the second time');
  assert.equal(second.counts.fail || 0, 0, 'nothing fails');
  assert.ok(!nb.methods.includes('DELETE'), 'it never deletes');
});

test('comparing again straight after a write finds no drift', async () => {
  const nb = looseNetBox();
  await writer.push(snapshot(), nb);
  const check = await writer.plan(snapshot(), nb);
  assert.equal(check.counts.create || 0, 0, 'nothing left to create');
  assert.equal(check.counts.update || 0, 0, 'nothing left to change');
});
