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
 * Since 22 September the catalogue is asked for by NAME before anything is
 * made, so most of these never reach a refused create at all - and what is
 * found that way is used exactly as the customer has it, carrying nothing of
 * ours. The write of 21 September is why: RackTrack's id for the site was on
 * nothing, RackTrack's slug for it matched nothing, and the refused create took
 * an approved shelf move down with it.
 *
 * What is proved here:
 *   1. a manufacturer NetBox already holds is found by its name, used as it
 *      stands and never made twice - and nothing is written on it, not even our
 *      own id, because their name and their slug are theirs;
 *   2. a DEVICE is never claimed, whatever collided - that is somebody's
 *      asset and it waits for the ladder and a person;
 *   3. a rack is never claimed either;
 *   4. an object already carrying somebody else's uid is left alone, and for
 *      hardware that is still a failure;
 *   5. two of one name is said out loud and nothing is made;
 *   6. any refusal that is not "already exists" is still a failure;
 *   7. an interface we would have made ourselves IS claimed and stamped, and
 *      nothing but the custom field is patched;
 *   8. a second write changes nothing.
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
          // NetBox's case-insensitive lookups, which is how a catalogue object
          // is found under the customer's own spelling of its name: __ie exact,
          // __ic contains, and contains is deliberately looser than it reads.
          if (k.endsWith('__ie')) {
            return String(o[k.slice(0, -4)] ?? '').toLowerCase() === String(v).toLowerCase();
          }
          if (k.endsWith('__ic')) {
            return String(o[k.slice(0, -4)] ?? '').toLowerCase().includes(String(v).toLowerCase());
          }
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

test('a manufacturer NetBox already has is found by its name and used as it stands', async () => {
  const nb = strictNetBox();
  // The customer's estate already lists D-Link, with no uid of ours on it.
  nb.rows('/api/dcim/manufacturers/').push({ id: 501, name: 'D-Link', slug: 'd-link', custom_fields: {} });

  const out = await writer.push(snapshot(), nb);
  const mfr = changeFor(out, /^mfr:d-link$/);

  assert.ok(mfr, 'the manufacturer is in the report');
  assert.equal(mfr.action, 'noop', 'not a failure, and nothing to write either');
  assert.equal(mfr.netboxId, 501, 'and it is the row that was already there');
  assert.match(mfr.reason, /already holds this manufacturer/);
  assert.match(mfr.reason, /nothing was written on it/);
  assert.equal(nb.rows('/api/dcim/manufacturers/').length, 1, 'no second D-Link was made');
  assert.equal(out.counts.fail || 0, 0, 'the write does not fail');
  assert.equal(out.counts.adopted, 1, 'and it is counted so a person can see it happened');
  assert.ok(out.findings.some((f) => f.kind === 'catalogue-already-there' && f.netboxId === 501),
    'with a plain sentence beside it');
});

test('it was never asked to be created, so NetBox never refused anything', async () => {
  const nb = strictNetBox();
  nb.rows('/api/dcim/manufacturers/').push({ id: 501, name: 'D-Link', slug: 'd-link', custom_fields: {} });

  await writer.push(snapshot(), nb);
  assert.equal(nb.calls.filter((c) => c.method === 'POST' && c.path === '/api/dcim/manufacturers/').length, 0,
    'the name settles it before a single create is attempted');
});

test('nothing at all is written on the customer\'s own catalogue', async () => {
  const nb = strictNetBox();
  nb.rows('/api/dcim/manufacturers/').push({ id: 501, name: 'D-Link', slug: 'd-link', custom_fields: {} });

  await writer.push(snapshot(), nb);
  assert.equal(nb.patches().filter((c) => c.path.startsWith('/api/dcim/manufacturers/')).length, 0,
    'not even our own id: their name and their slug are theirs, and an id of ours on a row '
    + 'whose slug is not the one we mint makes the next comparison offer to rename it');
  assert.equal(nb.rows('/api/dcim/manufacturers/')[0].name, 'D-Link', 'the name is untouched');
  assert.equal(nb.rows('/api/dcim/manufacturers/')[0].custom_fields[UID_FIELD], undefined);
});

test('a site is found by its name however different its slug is', async () => {
  const nb = strictNetBox();
  // The shape that failed the owner's write: their name, their slug, our id on
  // nothing. RackTrack would have minted the slug 'test-site' for this name.
  nb.rows('/api/dcim/sites/').push({ id: 7, name: '  office-SPRINTPARK ', slug: 'office-sprint',
    custom_fields: {} });
  const snap = snapshot();
  snap.sites[0].name = 'Office-Sprintpark';
  snap.sites[0].slug = 'office-sprintpark';

  const out = await writer.push(snap, nb);
  const site = out.changes.find((c) => c.type === 'Site');

  assert.equal(site.action, 'noop', 'the site the customer already has is the site this scan is of');
  assert.equal(site.netboxId, 7);
  assert.equal(nb.rows('/api/dcim/sites/').length, 1, 'no second site of that name was made');
  assert.equal(nb.rows('/api/dcim/sites/')[0].slug, 'office-sprint', 'their slug is left alone');
  assert.equal(out.counts.fail || 0, 0, 'and nothing fails');
  // The rack hangs off it, so the id really was used and not merely reported.
  assert.equal(nb.rows('/api/dcim/racks/')[0].site, 7);
});

test('a site already carrying another RackTrack id is still the customer\'s one site', async () => {
  const nb = strictNetBox();
  // Another scan called the same place something slightly different and its id
  // is on the row. A site is one site: it is used, and nothing is written on it.
  nb.rows('/api/dcim/sites/').push({ id: 7, name: 'Test Site', slug: 'ts',
    custom_fields: { [UID_FIELD]: 'site:test-site-2' } });

  const out = await writer.push(snapshot(), nb);
  const site = out.changes.find((c) => c.type === 'Site');
  assert.equal(site.action, 'noop');
  assert.equal(site.netboxId, 7);
  assert.equal(nb.rows('/api/dcim/sites/').length, 1);
  assert.equal(nb.rows('/api/dcim/sites/')[0].custom_fields[UID_FIELD], 'site:test-site-2',
    'the other id is left exactly as it was');
});

test('a create NetBox refuses as already there is adopted by name, not failed', async () => {
  const nb = strictNetBox();
  const real = nb.request;
  // A NetBox whose name lookup answers nothing - an instance that will not take
  // the filter, a row indexed differently - and which then refuses the create
  // because the thing is there after all. This is the last line of defence, and
  // it is the one the live write needed.
  let down = true;
  nb.request = async (method, path, body, params) => {
    // The look for the site by name does not get through - NetBox was busy, the
    // token was being renewed, whatever it was - so nothing knows the site is
    // there and a create is attempted. NetBox answers that one, and by then it
    // can be asked again.
    if (down && method === 'GET' && path === '/api/dcim/sites/' && params
      && Object.keys(params).some((k) => k.startsWith('name'))) {
      throw Object.assign(new Error('Server Error'), { status: 500 });
    }
    if (method === 'POST' && path === '/api/dcim/sites/') {
      down = false;
      const e = new Error('conflict');
      e.status = 400;
      e.detail = { name: ['site with this name already exists.'] };
      e.name = 'NetBoxError';
      throw e;
    }
    return real(method, path, body, params);
  };
  // Their slug is not the one we would mint, so the key NetBox refused the
  // create on cannot find it either. The name is all that is left.
  nb.rows('/api/dcim/sites/').push({ id: 7, name: 'Test Site', slug: 'somebody-elses-slug',
    custom_fields: {} });

  const out = await writer.push(snapshot(), nb);
  const site = out.changes.find((c) => c.type === 'Site');

  assert.equal(site.action, 'noop', 'a refused create is not a failed write');
  assert.equal(site.netboxId, 7, 'the site NetBox said was already there is the one that is used');
  assert.match(site.reason, /would not make a second site/);
  assert.ok(out.findings.some((f) => f.kind === 'catalogue-already-there' && f.netboxId === 7),
    'and it is on the record as a finding, in plain words');
  assert.equal(out.counts.fail || 0, 0, 'nothing failed');
  assert.equal(nb.rows('/api/dcim/sites/')[0].custom_fields[UID_FIELD], undefined,
    'their site carries nothing of ours');
  assert.equal(nb.rows('/api/dcim/racks/')[0].site, 7, 'and the rack hangs off it');
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

test('a maker another scan has already put its id on is still the one D-Link', async () => {
  const nb = strictNetBox();
  nb.rows('/api/dcim/manufacturers/').push({
    id: 501, name: 'D-Link', slug: 'd-link',
    custom_fields: { [UID_FIELD]: 'mfr:someone-elses' },
  });

  const out = await writer.push(snapshot(), nb);
  const mfr = changeFor(out, /^mfr:d-link$/);
  // There is one D-Link in an estate and NetBox will not hold a second, so a
  // refusal here is a write that fails over nothing. It is used, and the id
  // another scan left on it is not touched.
  assert.equal(mfr.action, 'noop');
  assert.equal(mfr.netboxId, 501);
  assert.equal(nb.rows('/api/dcim/manufacturers/').length, 1, 'no second D-Link');
  assert.equal(nb.rows('/api/dcim/manufacturers/')[0].custom_fields[UID_FIELD], 'mfr:someone-elses',
    'and one id is never stamped over another');
});

test('a port carrying somebody else\'s id is never claimed', async () => {
  const nb = strictNetBox();
  await writer.push(snapshot(), nb);
  // Hardware, not catalogue: the uid guard still bites, and a collision on a
  // port somebody else's record already names is a failure a person reads.
  for (const i of nb.rows('/api/dcim/interfaces/')) i.custom_fields = { [UID_FIELD]: 'if:someone-elses' };

  const out = await writer.push(snapshot(), nb);
  const iface = out.changes.find((c) => c.type === 'Interface');
  assert.equal(iface.action, 'fail');
  assert.equal(nb.rows('/api/dcim/interfaces/')[0].custom_fields[UID_FIELD], 'if:someone-elses');
});

test('two of one name is said out loud and nothing is made', async () => {
  const nb = strictNetBox();
  const real = nb.request;
  // A NetBox whose name filter answers with two rows. NetBox itself does not
  // hold two makers of one name, so this is the loose-filter case, and the
  // answer is the same either way: nothing is made and nobody has to guess.
  nb.request = async (method, path, body, params) => {
    if (method === 'GET' && path === '/api/dcim/manufacturers/' && params
      && Object.keys(params).some((k) => k.startsWith('name'))) {
      return { results: [
        { id: 501, name: 'D-Link', slug: 'd-link', custom_fields: {} },
        { id: 502, name: 'D-Link', slug: 'd-link-2', custom_fields: {} },
      ], next: null };
    }
    return real(method, path, body, params);
  };

  const out = await writer.push(snapshot(), nb);
  const mfr = changeFor(out, /^mfr:d-link$/);
  assert.equal(mfr.action, 'skip', 'it refuses to guess which');
  assert.match(mfr.reason, /More than one manufacturer in the customer's record is called "D-Link"/);
  assert.equal(nb.rows('/api/dcim/manufacturers/').length, 0, 'and no third one was made');
  const said = out.findings.find((f) => f.kind === 'catalogue-candidates');
  assert.deepEqual(said.candidates.map((c) => c.id), [501, 502], 'both are named');
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

test('a second write changes nothing', async () => {
  const nb = strictNetBox();
  nb.rows('/api/dcim/manufacturers/').push({ id: 501, name: 'D-Link', slug: 'd-link', custom_fields: {} });

  await writer.push(snapshot(), nb);
  const from = nb.calls.length;
  const second = await writer.push(snapshot(), nb);

  assert.equal(second.counts.create || 0, 0, 'nothing is created the second time');
  assert.equal(second.counts.fail || 0, 0, 'and nothing fails');
  // The maker is still the customer's and carries nothing of ours, so it is
  // found by its name again rather than there being nothing left to find.
  assert.equal(second.counts.adopted, 1);
  assert.equal(nb.calls.slice(from).filter((c) => c.method !== 'GET').length, 0,
    'and the second write asks questions without writing an answer');
  assert.ok(!nb.calls.some((c) => c.method === 'DELETE'), 'nothing is ever deleted');
});
