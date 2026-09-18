/**
 * The first compare of a rack NetBox has never seen.
 *
 * Planning asks "is this object already there" once per object. A rack with
 * three hundred ports asked NetBox three hundred times, each one a round trip
 * through a tunnel, and a person watched a spinner for minutes to be told that
 * nothing was there. The preload already fetched the answer in a dozen
 * paginated requests, but a miss still went back to NetBox, because the flag
 * that was meant to stop it was read and never written.
 *
 * What is proved here:
 *   1. after a preload, a uid the preload covered is answered from memory,
 *      whether it exists or not, with no request;
 *   2. a uid the preload did not cover, such as a manufacturer every rack
 *      shares, is still looked up, so it can never be wrongly called absent;
 *   3. a preload that failed covers nothing, so a failure is slower and still
 *      right, never faster and wrong;
 *   4. planning a whole rack against an empty NetBox costs a handful of
 *      requests rather than one per object.
 */
const test = require('node:test');
const assert = require('node:assert');

const cv = require('../../lib/netbox/cv');
const writer = require('../../lib/netbox/writer');
const { NetBox, UID_FIELD } = require('../../lib/netbox/netbox');

// A NetBox in a Map, counting every request. Contains-filters behave the way
// NetBox's __ic does: case insensitive substring on the custom field.
function countingNetBox() {
  const store = new Map();
  const calls = [];
  let nextId = 1;
  const rows = (p) => { if (!store.has(p)) store.set(p, []); return store.get(p); };
  const nb = new NetBox('http://fake.invalid', 'nbt_test');
  nb.calls = calls;
  nb.rows = rows;
  nb.gets = () => calls.filter((c) => c.method === 'GET').length;
  nb.request = async (method, path, body = null, params = null) => {
    calls.push({ method, path, params });
    if (method === 'GET') {
      const key = params && Object.keys(params).find((k) => k.startsWith(`cf_${UID_FIELD}`));
      const want = key ? params[key] : undefined;
      const list = rows(path).filter((o) => {
        if (want === undefined) return params?.name === undefined || o.name === params.name;
        return String((o.custom_fields || {})[UID_FIELD] || '').toLowerCase()
          .includes(String(want).toLowerCase());
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

const DEVICES = '/api/dcim/devices/';

test('a uid the preload covered is answered from memory, present or absent', async () => {
  const nb = countingNetBox();
  nb.rows(DEVICES).push({
    id: 7, name: 'Switch U10', custom_fields: { [UID_FIELD]: 'dev:t7:5:u10' },
  });

  await nb.preloadByUid(DEVICES, { [`cf_${UID_FIELD}__ic`]: 't7:5' });
  const after = nb.gets();

  const there = await nb.findByUid(DEVICES, 'dev:t7:5:u10');
  assert.equal(there && there.id, 7, 'the one that exists comes back');

  const absent = await nb.findByUid(DEVICES, 'dev:t7:5:u22');
  assert.equal(absent, null, 'the one that does not exist reads as absent');

  assert.equal(nb.gets(), after, 'neither answer cost a request');
});

test('a uid outside what the preload covered is still looked up', async () => {
  const nb = countingNetBox();
  await nb.preloadByUid(DEVICES, { [`cf_${UID_FIELD}__ic`]: 't7:5' });
  const after = nb.gets();

  const mfr = await nb.findByUid('/api/dcim/manufacturers/', 'mfr:dlink');
  assert.equal(mfr, null, 'it is genuinely not there');
  assert.ok(nb.gets() > after, 'but it asked NetBox rather than assuming');

  // Same endpoint, a uid the filter never reached: a rack from another tenant.
  const other = await nb.findByUid(DEVICES, 'dev:t9:1:u10');
  assert.equal(other, null);
  assert.ok(nb.gets() > after + 1, 'that one asked too');
});

test('a preload that failed covers nothing, so a miss still asks', async () => {
  const nb = countingNetBox();
  const real = nb.request;
  nb.request = async () => { throw new Error('netbox is down'); };
  const answer = await nb.preloadByUid(DEVICES, { [`cf_${UID_FIELD}__ic`]: 't7:5' });
  assert.equal(answer, null, 'a failed preload answers null, not zero');

  nb.request = real;
  const before = nb.gets();
  const absent = await nb.findByUid(DEVICES, 'dev:t7:5:u10');
  assert.equal(absent, null);
  assert.ok(nb.gets() > before, 'it asked, because nothing is known');
});

test('an exact filter is not treated as coverage', async () => {
  const nb = countingNetBox();
  await nb.preloadByUid(DEVICES, { [`cf_${UID_FIELD}`]: 'dev:t7:5:u1' });
  const before = nb.gets();
  // u10 contains u1 as text. An exact filter said nothing about it.
  const absent = await nb.findByUid(DEVICES, 'dev:t7:5:u10');
  assert.equal(absent, null);
  assert.ok(nb.gets() > before, 'it asked rather than reading one uid as another');
});

// The whole point, end to end: a rack with many ports against an empty NetBox.
function bigRackSnapshot() {
  // Ports are detected boxes, so the fixture lays 48 of them out in a row far
  // enough apart that none is read as a double detection of its neighbour.
  const port = (i) => ({ box: [10 + i * 18, 20, 24 + i * 18, 40], confidence: 0.9, index: i + 1 });
  const device = (cls, ports, units) => ({
    class_name: cls, port_count: ports, units, box: [10, 10, 900, 60], center: [455, 35],
    ports: Array.from({ length: ports }, (_, i) => port(i)),
    console_ports: [], sfp_ports: [], other_ports: [], connected_ports: [],
    ocr_make: 'Cisco', ocr_model: 'C9300-48P',
  });
  return cv.toSnapshot({
    image: 'rack.jpg',
    devices: [
      device('Switch', 48, ['u10']), device('Switch', 48, ['u12']),
      device('Switch', 48, ['u14']), device('Switch', 48, ['u16']),
    ],
  }, {
    rackId: 'RK-BIG00001', siteName: 'Test Site', rackName: 'Rack 1',
    uHeight: 42, scannedAt: '2026-01-01T00:00:00Z',
  });
}

test('planning a rack NetBox has never seen costs a handful of requests, not one per object', async () => {
  const nb = countingNetBox();
  const snap = bigRackSnapshot();
  const objects = (snap.devices || []).length + (snap.interfaces || []).length + 1;
  assert.ok(objects > 150, `the fixture is big enough to matter (${objects} objects)`);

  const report = await writer.plan(snap, nb);
  assert.equal(report.counts.fail || 0, 0, 'nothing fails');
  assert.ok((report.counts.create || 0) >= objects - 1, 'it still finds everything missing');
  assert.ok(nb.gets() < 40,
    `it asks NetBox a few dozen times, not once per object (asked ${nb.gets()} for ${objects} objects)`);
});
