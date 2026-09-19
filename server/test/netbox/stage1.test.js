/**
 * Part B, Stage 1: one rack, one set of NetBox records.
 *
 * A scan used to key every NetBox uid on the hash of its photo, so two photos
 * of one rack wrote two racks. Stage 1 keys a recognised scan on the
 * customer's rack instead (t<tenant>:<row> where the hash stood, so the rack
 * reads rack:t7:5 and a device dev:t7:5:u10) and teaches the planner to find
 * records written under the old hash and rebind them. What is proved:
 *
 *   a. two photos of one rack (two hashes, one key): the second write is all
 *      no-op, nothing created, nothing deleted;
 *   b. a rack written under its hash, then keyed: the plan shows rebinds and no
 *      creates, the push applies them, a plan after that is all no-op, no
 *      endpoint holds two records with one uid, and a rebind refuses when the
 *      new uid has appeared in the meantime;
 *   c. two tenants typing the same rack id get two keys and two racks;
 *   d. a scan with no key mints exactly the uids it always did;
 *   e. the resolver hands out a key only on explicit identification, never for
 *      "the only rack set up in this space".
 *
 * NetBox is the in-memory stand-in the round-trip test uses, with one change:
 * a fresh client per walk over one shared store, which is what the server does
 * (every request builds its own client, so no lookup cache outlives a walk).
 * The estate database is stubbed, as rack_match.test.js stubs it.
 */
process.env.RACKTRACK_AUTH_DB = ':memory:';

const assert = require('node:assert/strict');
const { test, beforeEach, afterEach } = require('node:test');

const cv = require('../../lib/netbox/cv');
const estate = require('../../lib/estate');
const plans = require('../../lib/netbox/plans');
const rackMatch = require('../../lib/netbox/rack_match');
const writer = require('../../lib/netbox/writer');
const { NetBox, UID_FIELD } = require('../../lib/netbox/netbox');

// One NetBox, many clients. Create on POST, find by racktrack_uid on GET,
// merge on PATCH (custom fields merged, as NetBox does), and never a DELETE.
function looseWorld() {
  const store = new Map();
  const calls = [];
  const arrivals = [];
  let nextId = 1;
  const rows = (p) => { if (!store.has(p)) store.set(p, []); return store.get(p); };
  const request = async (method, path, body = null, params = null) => {
    calls.push({ method, path });
    if (method === 'GET') {
      const key = params && Object.keys(params).find((k) => k.startsWith(`cf_${UID_FIELD}`));
      const want = key ? params[key] : undefined;
      const list = rows(path).filter((o) => {
        if (want === undefined) return params?.name === undefined || o.name === params.name;
        return String((o.custom_fields || {})[UID_FIELD] || '').toLowerCase().includes(String(want).toLowerCase());
      });
      // Another writer: a row that lands the moment somebody first asks for
      // its exact uid, after this answer has been given. The asker was told
      // "absent"; the row is there for whoever asks next.
      if (key === `cf_${UID_FIELD}`) {
        const i = arrivals.findIndex((a) => a.path === path && a.uid === want);
        if (i >= 0) { rows(path).push({ id: nextId++, ...arrivals[i].row }); arrivals.splice(i, 1); }
      }
      return { results: list, next: null };
    }
    if (method === 'POST') { const obj = { id: nextId++, ...body }; rows(path).push(obj); return obj; }
    if (method === 'PATCH') {
      const m = path.match(/^(.*\/)(\d+)\/$/);
      const obj = rows(m[1]).find((o) => o.id === Number(m[2]));
      const { custom_fields: cf, ...rest } = body;
      Object.assign(obj, rest);
      if (cf) obj.custom_fields = { ...(obj.custom_fields || {}), ...cf };
      return obj;
    }
    throw new Error(`unexpected ${method}`);
  };
  return {
    calls,
    rows,
    /** Have `row` appear on `path` right after the first exact lookup of `uid`. */
    arriveOnLookup: (path, uid, row) => arrivals.push({ path, uid, row }),
    methods: () => calls.map((c) => c.method),
    client() { const nb = new NetBox('http://fake.invalid', 'nbt_test'); nb.request = request; return nb; },
    uidsOn: (endpoint) => rows(endpoint).map((o) => (o.custom_fields || {})[UID_FIELD]).filter(Boolean),
    endpoints: () => [...store.keys()],
  };
}

/** No endpoint may hold two records with one uid. That is the whole point. */
function assertOneRecordPerUid(w) {
  for (const ep of w.endpoints()) {
    const seen = new Map();
    for (const uid of w.uidsOn(ep)) seen.set(uid, (seen.get(uid) || 0) + 1);
    for (const [uid, n] of seen) assert.equal(n, 1, `${ep} holds ${n} records with ${UID_FIELD}=${uid}`);
  }
}

// A scan as the engine hands it over: two switches, each with two visible
// ports, so the snapshot has a rack, devices and interfaces to key.
function device(cls, ports, units, make, modelName) {
  return {
    class_name: cls, port_count: ports, units, box: [10, 10, 900, 60], center: [455, 35],
    ports: [
      { box: [20, 20, 40, 40], confidence: 0.9, class_name: 'port' },
      { box: [60, 20, 80, 40], confidence: 0.9, class_name: 'port' },
    ],
    console_ports: [], sfp_ports: [], other_ports: [], connected_ports: [],
    ocr_make: make, ocr_model: modelName,
  };
}
const sampleMap = () => ({
  image: 'rack.jpg',
  devices: [
    device('Switch', 48, ['u10'], 'Cisco', 'C9300-48P'),
    device('Switch', 24, ['u12'], 'Cisco', 'C9200-24T'),
  ],
});
const snap = ({ rackId, rackKey = null, rackName = 'A01', siteName = 'Test Site' }) =>
  cv.toSnapshot(sampleMap(), {
    rackId, rackKey, siteName, rackName, uHeight: 42, scannedAt: '2026-01-01T00:00:00Z',
  });

const KEY = 't7:5';
// What the sample rack writes: seven rack-scoped records (the rack, two devices,
// four ports) and five shared ones (site, manufacturer, two types, one role).
const RACK_SCOPED = 7;
const SHARED = 5;
const RACK_SCOPED_ENDPOINTS = ['/api/dcim/racks/', '/api/dcim/devices/', '/api/dcim/interfaces/'];

// ── d. no key: nothing changes ──────────────────────────────────────────────

test('d. without a key the uids are exactly what they always were', () => {
  const s = snap({ rackId: 'RK-TEST0001' });
  assert.equal(s.rackUid, 'rack:RK-TEST0001');
  assert.equal(s.aliasOf, null);
  assert.equal(s.racks[0].uid, 'rack:RK-TEST0001');
  assert.equal(s.racks[0].name, 'A01');
  assert.deepEqual(s.devices.map((d) => d.uid), ['dev:RK-TEST0001:u10', 'dev:RK-TEST0001:u12']);
  assert.deepEqual(s.interfaces.map((i) => i.uid), [
    'if:dev:RK-TEST0001:u10:1', 'if:dev:RK-TEST0001:u10:2',
    'if:dev:RK-TEST0001:u12:1', 'if:dev:RK-TEST0001:u12:2',
  ]);
  assert.ok(s.devices.every((d) => d.rackUid === 'rack:RK-TEST0001'));
});

test('with a key every rack-scoped uid is built on it and the hash is kept as the alias', () => {
  const s = snap({ rackId: 'RK-TEST0001', rackKey: KEY });
  assert.equal(s.rackUid, `rack:${KEY}`);
  assert.equal(s.aliasOf, 'rack:RK-TEST0001');
  assert.equal(s.racks[0].uid, `rack:${KEY}`);
  assert.equal(s.racks[0].name, 'A01', 'the display name is not the key');
  assert.deepEqual(s.devices.map((d) => d.uid), [`dev:${KEY}:u10`, `dev:${KEY}:u12`]);
  assert.deepEqual(s.interfaces.map((i) => i.uid), [
    `if:dev:${KEY}:u10:1`, `if:dev:${KEY}:u10:2`, `if:dev:${KEY}:u12:1`, `if:dev:${KEY}:u12:2`,
  ]);
  assert.ok(s.devices.every((d) => d.rackUid === `rack:${KEY}`));
  // Shared objects never carried the hash and do not carry the key either.
  for (const o of [...s.sites, ...s.manufacturers, ...s.deviceTypes, ...s.deviceRoles]) {
    assert.ok(!o.uid.includes(KEY) && !o.uid.includes('RK-TEST0001'), o.uid);
  }
});

test('a conflict names its subject by the key too', () => {
  const map = sampleMap();
  map.devices[1].units = ['u10'];   // both boxes claim U10
  const s = cv.toSnapshot(map, { rackId: 'RK-TEST0001', rackKey: KEY, siteName: 'S', rackName: 'A01' });
  assert.equal(s.conflicts.length, 1);
  assert.equal(s.conflicts[0].subjectUid, `dev:${KEY}:switch-u10`);
  assert.ok(!s.conflicts[0].subjectUid.includes('RK-TEST0001'));
});

test('the alias of a keyed uid is the uid the same object had under the hash', () => {
  const hash = 'RK-TEST0001';
  assert.equal(writer.aliasUid(`rack:${KEY}`, KEY, hash), 'rack:RK-TEST0001');
  assert.equal(writer.aliasUid(`dev:${KEY}:u10`, KEY, hash), 'dev:RK-TEST0001:u10');
  assert.equal(writer.aliasUid(`if:dev:${KEY}:u10:1`, KEY, hash), 'if:dev:RK-TEST0001:u10:1');
  assert.equal(writer.aliasUid('mfr:cisco', KEY, hash), null, 'a shared object has no alias');
  assert.equal(writer.aliasUid('dev:t7:51:u10', KEY, hash), null, 't7:5 is not t7:51');
});

test('the alias of a keyed cable uid swaps the slugged key for the slugged hash, whole tokens only', () => {
  // reconcile.js mints cable:<slug of both interface uids>, and slug turns
  // every colon into a dash, so the segment form cannot see ':t7:5' in it.
  const hash = 'RK-OLD00001';
  assert.equal(
    writer.aliasUid('cable:if-dev-t7-5-u10-1-if-dev-t7-5-u12-1', KEY, hash),
    'cable:if-dev-rk-old00001-u10-1-if-dev-rk-old00001-u12-1',
    'both ends of the cable go back to the hash');
  assert.equal(writer.aliasUid('cable:if-dev-t7-51-u10-1-if-dev-t7-51-u12-1', KEY, hash), null,
    't7-5 is not t7-51');
  assert.equal(writer.aliasUid('cable:if-dev-rk-other-u1-1-if-dev-rk-other-u2-1', KEY, hash), null,
    'a cable of another rack has no alias');
  // The slug rule is reconcile's own, so the two cannot drift apart.
  const { slug } = require('../../lib/netbox/reconcile');
  const cableUid = `cable:${slug(`if:dev:${KEY}:u10:1::if:dev:${KEY}:u12:1`)}`;
  assert.equal(writer.aliasUid(cableUid, KEY, hash),
    `cable:${slug(`if:dev:${hash}:u10:1::if:dev:${hash}:u12:1`)}`);
});

// ── a. two photos, one rack ─────────────────────────────────────────────────

test('a. two photos of one rack: the second write is all no-op, nothing created or deleted', async () => {
  const w = looseWorld();
  const first = await writer.push(snap({ rackId: 'RK-PHOTO0001', rackKey: KEY }), w.client());
  assert.equal(first.counts.create, RACK_SCOPED + SHARED);
  assert.equal(first.counts.fail || 0, 0);

  const second = await writer.push(snap({ rackId: 'RK-PHOTO0002', rackKey: KEY }), w.client());
  assert.equal(second.counts.create || 0, 0, 'the second photo creates nothing');
  assert.equal(second.counts.rebind || 0, 0, 'nothing to rebind: it is already on the key');
  assert.equal(second.counts.update || 0, 0);
  assert.equal(second.counts.fail || 0, 0);
  assert.equal(second.counts.noop, first.counts.create, 'every record is found and left alone');
  assert.ok(!w.methods().includes('DELETE'), 'it never deletes');
  assert.equal(w.rows('/api/dcim/racks/').length, 1, 'one rack in NetBox, not two');
  assert.equal(w.rows('/api/dcim/devices/').length, 2);
  assert.deepEqual(second.orphans, []);
  assertOneRecordPerUid(w);
});

// ── b. written under the hash, then keyed ───────────────────────────────────

test('b. a rack written under its hash is rebound to its key, never created twice', async () => {
  const w = looseWorld();
  const HASH = 'RK-OLD00001';
  const before = await writer.push(snap({ rackId: HASH }), w.client());
  assert.equal(before.counts.create, RACK_SCOPED + SHARED);

  const keyed = snap({ rackId: HASH, rackKey: KEY });
  assert.equal(keyed.aliasOf, `rack:${HASH}`);

  // The plan: every rack-scoped record is a rebind, nothing is a create.
  const planned = await writer.plan(keyed, w.client());
  assert.equal(planned.counts.create || 0, 0, 'nothing is created twice');
  assert.equal(planned.counts.rebind, RACK_SCOPED, 'the rack, two devices and four ports are rebinds');
  assert.equal(planned.counts.noop, SHARED, 'the shared records are found as they are');
  assert.equal(planned.counts.fail || 0, 0);
  const rebinds = planned.changes.filter((c) => c.action === 'rebind');
  for (const r of rebinds) {
    assert.ok(r.uid.includes(KEY) && !r.uid.includes(HASH), `${r.uid} is the new uid`);
    assert.ok(r.fromUid.includes(HASH) && !r.fromUid.includes(KEY), `${r.fromUid} is the old uid`);
    assert.deepEqual(r.diff, { [UID_FIELD]: { from: r.fromUid, to: r.uid } });
    assert.equal(typeof r.netboxId, 'number', 'it names the record it will rebind');
  }
  assert.deepEqual(planned.orphans, [], 'a device about to be rebound is not an orphan');
  assert.ok(!w.methods().includes('PATCH'), 'a plan writes nothing');

  // The fingerprint covers the rebinds and is stable, so preview and export agree.
  const fp = plans.fingerprint(planned.changes);
  const again = await writer.plan(keyed, w.client());
  assert.equal(plans.fingerprint(again.changes), fp, 'the same plan twice hashes the same');
  assert.notEqual(fp, plans.fingerprint(planned.changes.filter((c) => c.action !== 'rebind')),
    'the rebinds are part of the fingerprint');
  assert.ok(rebinds.every((r) => plans.ACTIONABLE.has(r.action)), 'a rebind is decided, not just reported');

  // The push: the custom field moves; nothing is posted, nothing deleted.
  const mark = w.calls.length;
  const pushed = await writer.push(keyed, w.client());
  assert.equal(pushed.counts.rebind, RACK_SCOPED);
  assert.equal(pushed.counts.create || 0, 0);
  assert.equal(pushed.counts.fail || 0, 0);
  const since = w.calls.slice(mark);
  assert.ok(!since.some((c) => c.method === 'POST' && !c.path.includes('/extras/')), 'no record is posted');
  assert.equal(since.filter((c) => c.method === 'PATCH').length, RACK_SCOPED, 'one patch per rebound record');
  assert.ok(!w.methods().includes('DELETE'), 'it never deletes');

  // Everything now carries the key and nothing carries the hash.
  for (const ep of RACK_SCOPED_ENDPOINTS) {
    for (const uid of w.uidsOn(ep)) {
      assert.ok(uid.includes(KEY), `${uid} on ${ep} carries the key`);
      assert.ok(!uid.includes(HASH), `${uid} on ${ep} no longer carries the hash`);
    }
  }
  assert.equal(w.rows('/api/dcim/racks/').length, 1);
  assert.equal(w.rows('/api/dcim/devices/').length, 2);
  assert.equal(w.rows('/api/dcim/interfaces/').length, 4);
  assertOneRecordPerUid(w);

  // A plan after the push is all no-op.
  const after = await writer.plan(keyed, w.client());
  assert.equal(after.counts.noop, RACK_SCOPED + SHARED);
  assert.equal(after.counts.create || 0, 0);
  assert.equal(after.counts.update || 0, 0);
  assert.equal(after.counts.rebind || 0, 0);
  assert.deepEqual(after.orphans, []);
});

test('b. a rebind refuses when the new uid has appeared since the plan, and patches nothing', async () => {
  const w = looseWorld();
  const HASH = 'RK-OLD00002';
  await writer.push(snap({ rackId: HASH }), w.client());
  const keyed = snap({ rackId: HASH, rackKey: KEY });
  const target = `dev:${KEY}:u10`;
  const oldUid = `dev:${HASH}:u10`;
  const oldRow = w.rows('/api/dcim/devices/').find((o) => o.custom_fields[UID_FIELD] === oldUid);

  // The plan finds the new uid absent and plans the rebind.
  const planned = await writer.plan(keyed, w.client());
  assert.equal(planned.changes.find((c) => c.uid === target).action, 'rebind');

  // Between plan and push somebody else writes a real device under the new
  // uid. It lands in NetBox the moment the push first asks for that uid, so
  // the push's own lookup says "absent" and only the re-check right before
  // the patch sees it: the same client, nothing faked on it.
  w.arriveOnLookup('/api/dcim/devices/', target, {
    name: 'somebody else wrote this', custom_fields: { [UID_FIELD]: target },
  });
  const mark = w.calls.length;
  const out = await writer.push(keyed, w.client());
  const twin = w.rows('/api/dcim/devices/').find((o) => o.name === 'somebody else wrote this');
  assert.ok(twin, 'the twin is a real row in NetBox');

  const dev = out.changes.find((c) => c.uid === target);
  assert.equal(dev.action, 'fail');
  assert.equal(dev.reason,
    'another record took this id while the plan was running. Run the plan again');
  assert.equal(dev.fromUid, oldUid);
  assert.equal(dev.netboxId, oldRow.id, 'it names the record it would have rebound');
  assert.ok(w.uidsOn('/api/dcim/devices/').includes(oldUid), 'the old record was not touched');
  assert.equal(oldRow.custom_fields[UID_FIELD], oldUid);
  const patched = w.calls.slice(mark).filter((c) => c.method === 'PATCH').map((c) => c.path);
  assert.ok(!patched.includes(`/api/dcim/devices/${oldRow.id}/`), 'no PATCH hit the old record');
  assert.ok(!patched.includes(`/api/dcim/devices/${twin.id}/`), 'and none hit the twin');
  const ports = out.changes.filter((c) => c.type === 'Interface' && c.uid.startsWith(`if:${target}:`));
  assert.equal(ports.length, 2);
  assert.ok(ports.every((p) => p.action === 'skip'), 'its ports wait rather than bind to a failed device');
  // The rest of the rack was rebound as planned.
  assert.equal(out.counts.rebind, RACK_SCOPED - 3, 'the rack, the other device and its two ports');
  assert.equal(out.counts.fail, 1);
  assert.ok(!w.methods().includes('DELETE'));
  assertOneRecordPerUid(w);
});

test('b. a twin left under the old hash beside the keyed record is reported, not touched', async () => {
  const w = looseWorld();
  const HASH = 'RK-OLD00003';
  await writer.push(snap({ rackId: HASH }), w.client());
  const keyed = snap({ rackId: HASH, rackKey: KEY });
  await writer.push(keyed, w.client());
  const clean = await writer.plan(keyed, w.client());
  assert.deepEqual(clean.warnings, [], 'nothing under the hash: nothing to warn about');

  // A record under the old rack uid appears again beside the rebound one.
  w.rows('/api/dcim/racks/').push({ id: 900, name: 'A01', custom_fields: { [UID_FIELD]: `rack:${HASH}` } });
  const mark = w.calls.length;
  const planned = await writer.plan(keyed, w.client());
  // The warning names the record in NetBox's own terms - its NetBox id, which an
  // admin can open - not in ours. A RackTrack uid names nothing on that screen.
  const line = planned.warnings.find((s) => s.includes('older record in NetBox'));
  assert.ok(line, `a warning names the twin: ${JSON.stringify(planned.warnings)}`);
  assert.ok(line.includes('(id 900)'), 'and the NetBox id of the older record');
  assert.match(line, /Nothing was merged or removed/);
  assert.equal(planned.warnings.length, 1, 'one twin, one line');
  assert.equal(planned.counts.noop, RACK_SCOPED + SHARED, 'the plan itself is unchanged');
  assert.equal(planned.counts.rebind || 0, 0);
  assert.equal(planned.counts.create || 0, 0);
  assert.ok(!w.calls.slice(mark).some((c) => c.method !== 'GET'), 'a plan still writes nothing');
  assert.equal(w.rows('/api/dcim/racks/').length, 2, 'the twin is still there');

  // The push does not touch it either.
  const pushed = await writer.push(keyed, w.client());
  assert.ok(pushed.warnings.some((s) => s.includes('older record in NetBox')));
  assert.ok(!w.methods().includes('DELETE'));
  const stale = w.rows('/api/dcim/racks/').find((o) => o.id === 900);
  assert.equal(stale.custom_fields[UID_FIELD], `rack:${HASH}`, 'the twin still carries the old uid');
});

// ── c. two tenants, one typed id ────────────────────────────────────────────

let orig;
beforeEach(() => { orig = { get: estate.getRackByRackId, list: estate.listRacks }; });
afterEach(() => { estate.getRackByRackId = orig.get; estate.listRacks = orig.list; });

// A NetBox that answers /api/dcim/racks/ from a canned list, on the filters the
// resolver uses (facility_id, then name).
// The rack lookup is scoped by site now, so the stand-in answers the site
// question too. A canned rack with no site of its own is taken to be at the site
// the scan is at.
const SITE = { id: 1, name: 'Site One' };
const netboxWith = (racks) => ({
  async get(path, params = {}) {
    const cap = (rows) => (params.limit === undefined ? rows : rows.slice(0, Number(params.limit)));
    if (path === '/api/dcim/sites/') {
      return { results: cap(params.name === SITE.name ? [SITE] : []) };
    }
    const at = (r) => (r.site && typeof r.site === 'object' ? r.site.id : r.site);
    return {
      results: cap(racks.filter((r) => {
        if (params.site_id !== undefined && Number(at(r) ?? SITE.id) !== Number(params.site_id)) return false;
        if (params.facility_id !== undefined && r.facility_id !== params.facility_id) return false;
        if (params.name !== undefined && r.name !== params.name) return false;
        return true;
      })),
    };
  },
});

test('c. two tenants typing the same rack id get two keys and two racks', async () => {
  // Each tenant typed RK-ROW1 as a rack of its own; the rows differ, the id does not.
  estate.getRackByRackId = (tenantId, rackId) => (rackId === 'RK-ROW1'
    ? { id: tenantId === 1 ? 31 : 32, rack_id: 'RK-ROW1', name: 'Row 1', facility_id: null, space_id: 3 }
    : null);
  estate.listRacks = () => { throw new Error('a typed row needs no look across the space'); };
  const one = await rackMatch.resolveRack(null, { tenantId: 1, rackId: 'RK-ROW1', fallbackName: 'RK-ROW1' });
  const two = await rackMatch.resolveRack(null, { tenantId: 2, rackId: 'RK-ROW1', fallbackName: 'RK-ROW1' });
  assert.equal(one.rackKey, 't1:31');
  assert.equal(two.rackKey, 't2:32');
  assert.equal(one.tenantId, 1);
  assert.equal(two.tenantId, 2);
  assert.notEqual(one.rackKey, two.rackKey);

  // In a NetBox both tenants share: two racks, and no uid in common.
  const w = looseWorld();
  await writer.push(snap({ rackId: 'RK-ROW1', rackKey: one.rackKey, rackName: 'Row 1', siteName: 'Tenant One' }), w.client());
  const second = await writer.push(snap({ rackId: 'RK-ROW1', rackKey: two.rackKey, rackName: 'Row 1', siteName: 'Tenant Two' }), w.client());
  assert.equal(second.counts.create, RACK_SCOPED + 1, "the second tenant's rack, devices, ports and site are new");
  assert.equal(second.counts.rebind || 0, 0, 'nothing of the first tenant is rebound');
  assert.equal(w.rows('/api/dcim/racks/').length, 2, 'two racks');
  assert.equal(w.rows('/api/dcim/devices/').length, 4);
  assertOneRecordPerUid(w);
});

// ── e. the resolver: a key only on explicit identification ──────────────────

const learned = { id: 10, rack_id: 'RK-HASH0001', name: null, facility_id: null, space_id: 3 };

test('e. the only rack set up in a space names the rack but never the key', async () => {
  estate.getRackByRackId = () => learned;
  estate.listRacks = () => [learned, { id: 11, rack_id: 'typed-1', name: 'Comms Rack 1', facility_id: null }];
  const r = await rackMatch.resolveRack(netboxWith([{ id: 42, name: 'Comms Rack 1', facility_id: null }]), {
    tenantId: 7, rackId: 'RK-HASH0001', fallbackName: 'RK-HASH0001', siteName: SITE.name,
  });
  assert.equal(r.name, 'Comms Rack 1', 'the contact side still resolves');
  assert.equal(r.confidence, 'confirmed');
  assert.equal(r.source, 'space');
  assert.equal(r.knownRackId, 11);
  assert.equal(r.rackKey, null, 'the space rule never chooses the write key');
  assert.equal(r.tenantId, 7);
});

test('e. ...even when NetBox confirms that rack by facility id', async () => {
  estate.getRackByRackId = () => learned;
  estate.listRacks = () => [learned, { id: 11, rack_id: 'typed-1', name: 'Comms Rack 1', facility_id: 'F-11' }];
  const r = await rackMatch.resolveRack(netboxWith([{ id: 42, name: 'Comms Rack 1', facility_id: 'F-11' }]), {
    tenantId: 7, rackId: 'RK-HASH0001', fallbackName: 'RK-HASH0001', siteName: SITE.name,
  });
  assert.equal(r.source, 'facility-id');
  assert.equal(r.confidence, 'confirmed');
  assert.equal(r.rackKey, null, 'how NetBox confirmed the rack does not make the space rule explicit');
});

test('e. a name match keys on the typed row it matched', async () => {
  estate.getRackByRackId = () => learned;
  estate.listRacks = () => [
    { id: 11, rack_id: 'typed-1', name: 'Rack One', facility_id: null },
    { id: 12, rack_id: 'typed-2', name: 'Rack Two', facility_id: null },
  ];
  const r = await rackMatch.resolveRack(netboxWith([]), {
    tenantId: 7, rackId: 'RK-HASH0001', scanName: 'rack two', fallbackName: 'RK-HASH0001',
  });
  assert.equal(r.source, 'name');
  assert.equal(r.knownRackId, 12);
  assert.equal(r.rackKey, 't7:12');
  assert.equal(r.tenantId, 7);
});

test('e. a rack set up directly keys on its own row, with or without NetBox', async () => {
  const typed = { id: 5, rack_id: 'RK-ABCD1234', name: 'A01', facility_id: 'F-A01', space_id: 3 };
  estate.getRackByRackId = () => typed;
  estate.listRacks = () => { throw new Error('should not look across the space'); };

  const alone = await rackMatch.resolveRack(null, { tenantId: 7, rackId: 'RK-ABCD1234', fallbackName: 'RK-ABCD1234' });
  assert.equal(alone.source, 'set-up-directly');
  assert.equal(alone.confidence, 'known');
  assert.equal(alone.rackKey, 't7:5');

  const confirmed = await rackMatch.resolveRack(netboxWith([{ id: 99, name: 'Rack A01', facility_id: 'F-A01' }]), {
    tenantId: 7, rackId: 'RK-ABCD1234', fallbackName: 'RK-ABCD1234', siteName: SITE.name,
  });
  assert.equal(confirmed.source, 'facility-id');
  assert.equal(confirmed.name, 'Rack A01');
  assert.equal(confirmed.rackKey, 't7:5', 'the key is the same whether or not NetBox knows the rack');

  // The key is minted by the server, never from anything the admin typed.
  for (const typedThing of ['A01', 'F-A01', 'RK-ABCD1234', 'Rack A01']) {
    assert.ok(!confirmed.rackKey.includes(typedThing), `the key does not carry ${typedThing}`);
  }
});

test('e. a rack typed with only a facility id, not in NetBox, stays unresolved with no key', async () => {
  // Set up directly, so the explicit rule would mint a key; but there is no
  // name anywhere to write under, and an unresolved result must not carry one.
  estate.getRackByRackId = () => ({ id: 5, rack_id: 'RK-FAC00001', name: null, facility_id: 'F-77', space_id: 3 });
  estate.listRacks = () => { throw new Error('should not look across the space'); };
  const r = await rackMatch.resolveRack(netboxWith([]), { tenantId: 7, rackId: 'RK-FAC00001', fallbackName: 'RK-FAC00001' });
  assert.equal(r.confidence, 'none');
  assert.equal(r.name, 'RK-FAC00001', 'the fallback name, not an invented one');
  assert.equal(r.rackKey, null, 'confidence none never carries a key');
  assert.equal(r.knownRackId, 5, 'the typed row is still named, for whoever wants to finish it');

  // The same rack once NetBox knows it by facility id is keyed as usual.
  const found = await rackMatch.resolveRack(netboxWith([{ id: 42, name: 'Rack 77', facility_id: 'F-77' }]), {
    tenantId: 7, rackId: 'RK-FAC00001', fallbackName: 'RK-FAC00001', siteName: SITE.name,
  });
  assert.equal(found.confidence, 'confirmed');
  assert.equal(found.rackKey, 't7:5');
});

test('e. an unbound scan has no key and keeps its fallback name', async () => {
  estate.getRackByRackId = () => null;
  estate.listRacks = () => [];
  const r = await rackMatch.resolveRack(netboxWith([]), { tenantId: 7, rackId: 'RK-HASH0001', fallbackName: 'RK-HASH0001' });
  assert.equal(r.name, 'RK-HASH0001');
  assert.equal(r.confidence, 'none');
  assert.equal(r.rackKey, null);
  assert.equal(r.tenantId, 7);
});

test('e. two typed racks and nothing to tell them apart: no rack, no key', async () => {
  estate.getRackByRackId = () => learned;
  estate.listRacks = () => [
    { id: 11, rack_id: 'typed-1', name: 'Rack One', facility_id: null },
    { id: 12, rack_id: 'typed-2', name: 'Rack Two', facility_id: null },
  ];
  const r = await rackMatch.resolveRack(netboxWith([]), { tenantId: 7, rackId: 'RK-HASH0001', fallbackName: 'RK-HASH0001' });
  assert.equal(r.confidence, 'none');
  assert.equal(r.rackKey, null);
});
