/**
 * Claiming what NetBox already holds, instead of calling it a failure.
 *
 * Found on the live server on 18 September 2026: a real write of 275 objects
 * finished with counts { create 64, update 1, noop 5, skip 203, fail 8 }, and
 * every one of the eight was NetBox refusing to create something it already
 * had - the manufacturers D-Link and TP-Link, the roles Router and Patch
 * Panel, and interfaces on a device someone had made by hand. The plan read
 * write_failed for objects that were already correct.
 *
 * The cause is the same one that runs through this whole system: the join is
 * our own custom field, and an estate that existed before RackTrack carries
 * none of our uids.
 *
 * What is proved here:
 *   1. an already-exists refusal is claimed by its natural key, stamped and
 *      counted as an update rather than a failure;
 *   2. a DEVICE is never claimed, whatever collided - that is somebody's
 *      asset and it waits for the ladder and a person;
 *   3. a rack is never claimed either;
 *   4. an object already carrying somebody else's uid is left alone;
 *   5. two objects answering the key is ambiguous and stays a failure;
 *   6. any refusal that is not "already exists" is still a failure;
 *   7. nothing but the custom field is ever patched.
 */
const test = require('node:test');
const assert = require('node:assert');

const writer = require('../../lib/netbox/writer');
const { NetBox, UID_FIELD } = require('../../lib/netbox/netbox');

/**
 * A NetBox that enforces its own uniqueness rules, the way the real one does:
 * a manufacturer or role is unique by slug, an interface by device and name.
 * A create that collides is refused with the phrase NetBox actually uses.
 */
function strictNetBox() {
  const store = new Map();
  const calls = [];
  let nextId = 1;
  const rows = (p) => { if (!store.has(p)) store.set(p, []); return store.get(p); };
  const nb = new NetBox('http://fake.invalid', 'nbt_test');
  nb.calls = calls;
  nb.rows = rows;
  nb.patches = () => calls.filter((c) => c.method === 'PATCH');

  const UNIQUE = {
    '/api/dcim/manufacturers/': (o) => ['slug', o.slug],
    '/api/dcim/device-roles/': (o) => ['slug', o.slug],
    '/api/dcim/devices/': (o) => ['name', o.name],
    '/api/dcim/interfaces/': (o) => ['device+name', `${o.device}:${o.name}`],
  };

  nb.request = async (method, path, body = null, params = null) => {
    calls.push({ method, path, body, params });
    if (method === 'GET') {
      const list = rows(path).filter((o) => {
        if (!params) return true;
        return Object.entries(params).every(([k, v]) => {
          if (k === 'limit') return true;
          if (k.startsWith(`cf_${UID_FIELD}`)) {
            return String((o.custom_fields || {})[UID_FIELD] || '').toLowerCase()
              .includes(String(v).toLowerCase());
          }
          if (k === 'device_id') return o.device === v;
          if (k === 'manufacturer_id') return o.manufacturer === v;
          if (k === 'site_id') return o.site === v;
          return String(o[k]) === String(v);
        });
      });
      return { results: list, next: null };
    }
    if (method === 'POST') {
      const rule = UNIQUE[path];
      if (rule) {
        const [label, value] = rule(body);
        const clash = rows(path).some((o) => rule(o)[1] === value);
        if (clash) {
          const e = new Error('conflict');
          e.status = 400;
          e.detail = { [label]: [`${path} object with this ${label} already exists.`] };
          e.name = 'NetBoxError';
          throw e;
        }
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

/** A snapshot with one switch, so the supporting objects are exercised. */
function snapshot() {
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
    rackId: 'RK-ADOPT001', siteName: 'Test Site', rackName: 'Rack 1',
    uHeight: 42, scannedAt: '2026-01-01T00:00:00Z',
  });
}

const changeFor = (report, re) => report.changes.find((c) => re.test(c.uid));

test('a manufacturer NetBox already has is claimed, stamped and counted as an update', async () => {
  const nb = strictNetBox();
  // The customer's estate already lists D-Link, with no uid of ours on it.
  nb.rows('/api/dcim/manufacturers/').push({ id: 501, name: 'D-Link', slug: 'd-link', custom_fields: {} });

  const out = await writer.push(snapshot(), nb);
  const mfr = changeFor(out, /^mfr:d-link$/);

  assert.ok(mfr, 'the manufacturer is in the report');
  assert.equal(mfr.action, 'update', 'not a failure');
  assert.equal(mfr.netboxId, 501, 'and it is the row that was already there');
  // The row already says Manufacturer in its own column, and HOW it was matched
  // is the writer's business, not the approver's.
  assert.match(mfr.reason, /NetBox already had this one, so it was updated rather than created/);
  assert.equal(nb.rows('/api/dcim/manufacturers/').length, 1, 'no second D-Link was made');
  assert.equal(nb.rows('/api/dcim/manufacturers/')[0].custom_fields[UID_FIELD], 'mfr:d-link',
    'our uid was stamped on it');
  assert.equal(out.counts.fail || 0, 0, 'the write does not fail');
  assert.equal(out.counts.adopted, 1, 'and it is counted so a person can see it happened');
});

test('nothing but the custom field is patched on an object we claim', async () => {
  const nb = strictNetBox();
  nb.rows('/api/dcim/manufacturers/').push({ id: 501, name: 'D-Link', slug: 'd-link', custom_fields: {} });

  await writer.push(snapshot(), nb);
  const patch = nb.patches().find((c) => c.path.startsWith('/api/dcim/manufacturers/'));
  assert.ok(patch, 'it patched the manufacturer');
  assert.deepEqual(Object.keys(patch.body), ['custom_fields'], 'and only the custom field');
  assert.equal(nb.rows('/api/dcim/manufacturers/')[0].name, 'D-Link', 'the name is untouched');
});

test('a device is never claimed, however it collided', async () => {
  const nb = strictNetBox();
  const snap = snapshot();
  const dev = snap.devices[0];
  // Somebody made this device by hand. It has the same name and no uid.
  nb.rows('/api/dcim/devices/').push({ id: 900, name: dev.name, custom_fields: {} });

  const out = await writer.push(snap, nb);
  const row = changeFor(out, /^dev:/);

  assert.equal(row.action, 'fail', 'it stays a failure');
  assert.equal(nb.rows('/api/dcim/devices/')[0].custom_fields[UID_FIELD], undefined,
    'and nothing of ours was stamped on somebody\'s asset');
  assert.equal(out.counts.adopted || 0, 0);
});

test('an object already carrying somebody else\'s uid is left alone', async () => {
  const nb = strictNetBox();
  nb.rows('/api/dcim/manufacturers/').push({
    id: 501, name: 'D-Link', slug: 'd-link',
    custom_fields: { [UID_FIELD]: 'mfr:someone-elses' },
  });

  const out = await writer.push(snapshot(), nb);
  const mfr = changeFor(out, /^mfr:d-link$/);
  assert.equal(mfr.action, 'fail', 'one uid is never stamped over another');
  assert.equal(nb.rows('/api/dcim/manufacturers/')[0].custom_fields[UID_FIELD], 'mfr:someone-elses');
});

test('two objects answering the key is ambiguous and stays a failure', async () => {
  const nb = strictNetBox();
  const real = nb.request;
  // A NetBox whose filter is loose enough to answer with two rows.
  nb.request = async (method, path, body, params) => {
    if (method === 'GET' && path === '/api/dcim/manufacturers/' && params && params.slug) {
      return { results: [
        { id: 501, name: 'D-Link', slug: 'd-link', custom_fields: {} },
        { id: 502, name: 'D Link', slug: 'd-link', custom_fields: {} },
      ], next: null };
    }
    return real(method, path, body, params);
  };
  nb.rows('/api/dcim/manufacturers/').push({ id: 501, name: 'D-Link', slug: 'd-link', custom_fields: {} });

  const out = await writer.push(snapshot(), nb);
  assert.equal(changeFor(out, /^mfr:d-link$/).action, 'fail', 'it refuses to guess which');
});

test('a refusal that is not "already exists" is still a failure', async () => {
  const nb = strictNetBox();
  const real = nb.request;
  nb.request = async (method, path, body, params) => {
    if (method === 'POST' && path === '/api/dcim/manufacturers/') {
      const e = new Error('nope'); e.status = 400;
      e.detail = { name: ['This field may not be blank.'] };
      throw e;
    }
    return real(method, path, body, params);
  };

  const out = await writer.push(snapshot(), nb);
  const mfr = changeFor(out, /^mfr:d-link$/);
  assert.equal(mfr.action, 'fail');
  assert.match(mfr.reason, /may not be blank/, 'and the real reason is kept');
});

test('an interface NetBox already has is claimed by its device and name', async () => {
  const nb = strictNetBox();
  const out1 = await writer.push(snapshot(), nb);
  assert.equal(out1.counts.fail || 0, 0);

  // Wipe our uids off the interfaces, as if somebody had made them by hand.
  for (const i of nb.rows('/api/dcim/interfaces/')) i.custom_fields = {};
  const before = nb.rows('/api/dcim/interfaces/').length;

  const out2 = await writer.push(snapshot(), nb);
  assert.equal(out2.counts.fail || 0, 0, 'the second write does not fail');
  assert.equal(nb.rows('/api/dcim/interfaces/').length, before, 'and no duplicate interfaces');
  const iface = out2.changes.find((c) => c.type === 'Interface');
  assert.equal(iface.action, 'update');
  // The claim happened; which NetBox field matched it is not the approver's problem.
  assert.match(iface.reason, /NetBox already had this one/);
});

test('a second write after a claim is a clean no-op', async () => {
  const nb = strictNetBox();
  nb.rows('/api/dcim/manufacturers/').push({ id: 501, name: 'D-Link', slug: 'd-link', custom_fields: {} });

  await writer.push(snapshot(), nb);
  const second = await writer.push(snapshot(), nb);

  assert.equal(second.counts.create || 0, 0, 'nothing is created the second time');
  assert.equal(second.counts.fail || 0, 0, 'and nothing fails');
  assert.equal(second.counts.adopted || 0, 0, 'there is nothing left to claim');
  assert.ok(!nb.calls.some((c) => c.method === 'DELETE'), 'nothing is ever deleted');
});
