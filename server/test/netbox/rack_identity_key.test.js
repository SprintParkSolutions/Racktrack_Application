/**
 * The answer to "which rack is this" has to be the rack the comparison uses.
 *
 * The six steps that identify a rack (lib/rack_identity) can say which of the
 * customer's racks a scan is, and a person can answer when the steps cannot. But
 * the uids every comparison and every write is built on come from one key, and
 * that key used to be minted by a second, simpler resolver that had never heard
 * of a person's answer: confirming an existing record wrote the identity table
 * and named nothing the resolver reads, so whether a confirmation reached the
 * comparison depended on which button the person pressed.
 *
 * What is proved here:
 *   1. a person's answer becomes the key, and the comparison is rebuilt on the
 *      customer's own rack instead of the hash of the photo;
 *   2. it does so whichever way they answered - an existing record, a NetBox
 *      rack, or a rack that is new - and it is always the key the confirmation
 *      itself handed out;
 *   3. a rack nobody has confirmed never becomes the key, however plausible: the
 *      only rack set up in a room still names the contact and nothing more;
 *   4. a second photograph of a confirmed rack is the same rack, with the same
 *      key: the saved answer is reused, the photo is not read again and NetBox is
 *      not asked;
 *   5. the name a comparison reports is the record's own name, never the hash.
 *
 * Against the real estate, tenant, identity and resolver modules and a seeded
 * throwaway database. NetBox is a stand-in, and the photo is a physical layer
 * report handed in from a map, so nothing is read from disk and python never runs.
 */
process.env.RACKTRACK_SKIP_WORKER_POOL = '1';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-rack-identity-key';

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-rack-key-'));
process.env.RACKTRACK_AUTH_DB = path.join(DIR, 'auth.db');
process.env.RT_DATA_DIR = path.join(DIR, 'netbox');
process.env.RT_OUTPUTS_DIR = path.join(DIR, 'outputs');
after(() => { try { fs.rmSync(DIR, { recursive: true, force: true }); } catch { /* best effort */ } });

const ORG = 10, SITE = 11, ADMIN = 2, TECH = 3;

// Seeded before the modules that open this database are loaded, because one of
// them runs its own migrations the moment it is required.
{
  const db = new Database(process.env.RACKTRACK_AUTH_DB);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS organizations (id INTEGER PRIMARY KEY, name TEXT, status TEXT DEFAULT 'active');
    CREATE TABLE IF NOT EXISTS tenants (id INTEGER PRIMARY KEY, slug TEXT, name TEXT, organization_id INTEGER);
    CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, username TEXT, email TEXT, role TEXT,
                                      tenant_id INTEGER, organization_id INTEGER, active INTEGER DEFAULT 1);
    CREATE TABLE IF NOT EXISTS rack_owners (rack_id TEXT, tenant_id INTEGER, created_by INTEGER,
                                            created_at TEXT DEFAULT (datetime('now')),
                                            PRIMARY KEY (tenant_id, rack_id));
  `);
  db.prepare('INSERT INTO organizations (id,name) VALUES (?,?)').run(ORG, 'Org A');
  db.prepare('INSERT INTO tenants (id,slug,name,organization_id) VALUES (?,?,?,?)').run(SITE, 'north-dc', 'North DC', ORG);
  const u = db.prepare('INSERT INTO users (id,username,email,role,tenant_id,organization_id) VALUES (?,?,?,?,?,?)');
  u.run(ADMIN, 'admin_a', 'admin_a@example.test', 'org_admin', SITE, ORG);
  u.run(TECH, 'tech_a', 'tech_a@example.test', 'member', SITE, ORG);
  db.close();
}

const estate = require('../../lib/estate');
const tenantLib = require('../../lib/tenant');
const rackIdentity = require('../../lib/rack_identity');
const rackMatch = require('../../lib/netbox/rack_match');
const cv = require('../../lib/netbox/cv');
// The one place a scan's uids are keyed on a rack, as the adopt route calls it.
const { recogniseRack } = require('../../routes/netbox/scans');

// -- The photo ---------------------------------------------------------
const reports = new Map();
let photoReads = 0;
rackIdentity.io.readPhysicalLayer = (rackId) => { photoReads += 1; return reports.get(rackId) || null; };

/** A report as pipeline/physical_layer.py writes it, cut down to what is read. */
const report = ({ labels = [] } = {}) => ({
  schema: 'racktrack-physical-layer/1',
  rack: { candidates: labels.map((text) => ({ text, conf: 0.9, source: 'rail chip' })) },
  units: [],
});

// -- NetBox ------------------------------------------------------------
const NORTH = { id: 1, name: 'North DC', slug: 'north-dc' };
const nbRack = (id, name, facility_id = null) => ({ id, name, facility_id, site: { id: NORTH.id, name: NORTH.name } });
/** NetBox, answering the lookups this feature makes from canned lists. */
function fakeNetBox(racks = []) {
  const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
  return {
    calls: [],
    async get(apiPath, params = {}) {
      this.calls.push({ path: apiPath, params });
      const one = /^\/api\/dcim\/racks\/(\d+)\/$/.exec(apiPath);
      if (one) {
        const hit = racks.find((r) => r.id === Number(one[1]));
        if (!hit) { const e = new Error('not found'); e.status = 404; throw e; }
        return hit;
      }
      let rows = [];
      if (apiPath === '/api/dcim/sites/') {
        rows = [NORTH].filter((s) => (params.name__ie == null || same(s.name, params.name__ie))
          && (params.slug == null || s.slug === params.slug));
      } else if (apiPath === '/api/dcim/racks/') {
        rows = racks.filter((r) => (params.site_id == null || r.site.id === Number(params.site_id))
          && (params.facility_id == null || r.facility_id === params.facility_id)
          && (params.name == null || r.name === params.name)
          && (params.name__ie == null || same(r.name, params.name__ie)));
      }
      return { count: rows.length, results: rows.slice(0, Number(params.limit || 50)) };
    },
  };
}

// -- The estate --------------------------------------------------------
let seq = 0;
const nextId = (prefix) => `RK-${prefix}${String(++seq).padStart(4, '0')}`;
const mkSpace = (rackCount) => estate.createSpace(SITE, { name: `Room ${++seq}`, rack_count: rackCount }, ADMIN);
const mkRack = (spaceId, name, facilityId) => estate.upsertRack(SITE,
  { rack_id: nextId('TYPED'), space_id: spaceId, name, ...(facilityId ? { facility_id: facilityId } : {}) }, ADMIN).rack;
/** A scan as the camera leaves it: claimed for the Site, learned into the space. */
function mkScan(spaceId, rep) {
  const rackId = nextId('SCAN');
  tenantLib.claimRack(SITE, rackId, TECH);
  estate.upsertRack(SITE, { rack_id: rackId, space_id: spaceId, source: 'learned' }, TECH);
  if (rep) reports.set(rackId, rep);
  return rackId;
}

// -- The comparison ----------------------------------------------------
// Two switches with two visible ports each: enough for a rack, devices and
// interfaces to be keyed. The same map shape the engine hands the adopt route.
const box = (units, ports) => ({
  class_name: 'Switch', port_count: ports, units, box: [10, 10, 900, 60], center: [455, 35],
  ports: [{ box: [20, 20, 40, 40], confidence: 0.9, class_name: 'port' },
          { box: [60, 20, 80, 40], confidence: 0.9, class_name: 'port' }],
  console_ports: [], sfp_ports: [], other_ports: [], connected_ports: [],
});
const sampleMap = () => ({ image: 'rack.jpg', devices: [box(['u10'], 48), box(['u12'], 24)] });

/** What the adopt route would stamp on this scan right now. */
const recognise = (rackId) => recogniseRack({ user: { id: TECH, tenant_id: SITE, role: 'member' } },
  { tenantId: SITE, rackId, fallbackName: rackId });

/** The snapshot that comparison would then be built from. */
const snapshotFor = (rackId, known) => cv.toSnapshot(sampleMap(), {
  rackId, rackKey: known.rackKey, siteName: 'North DC', rackName: known.rackName,
  uHeight: 42, scannedAt: '2026-09-18T00:00:00Z',
});

// -- 1. a person's answer becomes the key ------------------------------
test('a person picking the rack becomes the key the next comparison is built on', async () => {
  const room = mkSpace(2);
  const r07 = mkRack(room.id, 'RK-07', 'F-07');
  mkRack(room.id, 'RK-08', 'F-08');
  // Both labels were read, so two racks fit and nothing can choose between them.
  const scan = mkScan(room.id, report({ labels: ['RK-07', 'RK-08'] }));

  let ladder = await rackIdentity.identify(scan, { tenantId: SITE });
  assert.equal(ladder.decision, 'ambiguous');
  assert.equal(ladder.rackKey, null);
  assert.equal(ladder.candidates.length, 2);

  // Before: no key, so the comparison is against a rack keyed on the photo.
  const before = await recognise(scan);
  assert.equal(before.rackKey, null);
  assert.equal(before.rackName, scan);
  assert.equal(snapshotFor(scan, before).rackUid, `rack:${scan}`);

  const bound = await rackIdentity.confirm(scan, { tenantId: SITE, userId: TECH, knownRackId: r07.id });
  assert.equal(bound.rackKey, rackMatch.rackKeyFor(SITE, r07.id));

  // The resolver the write key is built from now answers with that rack.
  const resolved = await rackMatch.resolveRack(null, { tenantId: SITE, rackId: scan, fallbackName: scan });
  assert.equal(resolved.rackKey, bound.rackKey);
  assert.equal(resolved.knownRackId, r07.id);
  assert.equal(resolved.source, 'confirmed');
  assert.equal(resolved.name, 'RK-07');
  assert.match(resolved.why, /a person confirmed/);

  // And so does the comparison: the same rack, by the record's own name, and
  // every rack-scoped uid keyed on it with the photo kept only as the alias.
  const after = await recognise(scan);
  assert.equal(after.rackKey, bound.rackKey);
  assert.equal(after.rackName, 'RK-07');
  const snap = snapshotFor(scan, after);
  assert.equal(snap.rackUid, `rack:${bound.rackKey}`);
  assert.equal(snap.aliasOf, `rack:${scan}`);
  assert.deepEqual(snap.devices.map((d) => d.uid), [`dev:${bound.rackKey}:u10`, `dev:${bound.rackKey}:u12`]);
  assert.equal(snap.racks[0].name, 'RK-07');

  ladder = await rackIdentity.identify(scan, { tenantId: SITE });
  assert.equal(ladder.decision, 'matched');
  assert.equal(ladder.rule, 'record');
  assert.equal(ladder.rackKey, bound.rackKey);
});

// -- 2. whichever button they pressed ----------------------------------
test('an existing record, a NetBox rack or a new name: all three reach the comparison', async () => {
  const room = mkSpace(2);
  const kept = mkRack(room.id, 'RK-11', 'F-11');
  mkRack(room.id, 'RK-12', 'F-12');
  const nb = fakeNetBox([nbRack(950, 'Rack 12', 'F-12')]);

  const byRecord = mkScan(room.id, report());
  const byNetBox = mkScan(room.id, report());
  const byName = mkScan(room.id, report());

  // The name each answer ties the scan to, as the customer's own record has it.
  const answers = [
    ['a record already set up here', byRecord, { knownRackId: kept.id }, 'RK-11'],
    ['a rack picked in NetBox', byNetBox, { netboxRackId: 950 }, 'RK-12'],
    ['a rack that is new', byName, { name: 'RK-13' }, 'RK-13'],
  ];
  for (const [what, scan, body, name] of answers) {
    const bound = await rackIdentity.confirm(scan, { tenantId: SITE, userId: ADMIN, netboxClient: nb, ...body });
    assert.ok(bound.rackKey, `${what}: the confirmation hands out a key`);
    const resolved = await rackMatch.resolveRack(nb, { tenantId: SITE, rackId: scan, fallbackName: scan });
    assert.equal(resolved.rackKey, bound.rackKey, `${what}: the resolver hands out the same key`);
    assert.equal(resolved.knownRackId, bound.knownRackId, `${what}: and names the same record`);
    const known = await recognise(scan);
    assert.equal(known.rackKey, bound.rackKey, `${what}: and so is the comparison keyed`);
    assert.equal(known.rackName, name, `${what}: named as the record names it`);
    assert.equal(snapshotFor(scan, known).rackUid, `rack:${bound.rackKey}`);
  }
  // With NetBox to hand, the rack a person picked there is read back by the id
  // they picked - the record they were looking at - and it names the rack.
  const inNetBox = await rackMatch.resolveRack(nb, { tenantId: SITE, rackId: byNetBox, fallbackName: byNetBox });
  assert.equal(inNetBox.name, 'Rack 12');
  assert.equal(inNetBox.netboxId, 950);
  assert.equal(inNetBox.confidence, 'confirmed');
  assert.equal(inNetBox.source, 'confirmed');
  assert.ok(nb.calls.some((c) => c.path === '/api/dcim/racks/950/'));
});

// -- 3. nothing unconfirmed is ever the key ----------------------------
test('the only rack in a room names the contact and never becomes the key', async () => {
  const room = mkSpace(1);
  const only = mkRack(room.id, 'Comms Rack');
  const scan = mkScan(room.id, report());

  const ladder = await rackIdentity.identify(scan, { tenantId: SITE });
  assert.equal(ladder.decision, 'suggested');   // a question for a person
  assert.equal(ladder.rule, 'only-rack');
  assert.equal(ladder.rack, null);
  assert.equal(ladder.rackKey, null);

  // The resolver names the rack, because the contact has to be looked up
  // somewhere, and hands out no key.
  const resolved = await rackMatch.resolveRack(null, { tenantId: SITE, rackId: scan, fallbackName: scan });
  assert.equal(resolved.knownRackId, only.id);
  assert.equal(resolved.name, 'Comms Rack');
  assert.equal(resolved.rackKey, null);

  // So the comparison is against a rack keyed on the photo, as it always was.
  const known = await recognise(scan);
  assert.equal(known.rackKey, null);
  assert.equal(known.rackName, scan);
  const snap = snapshotFor(scan, known);
  assert.equal(snap.rackUid, `rack:${scan}`);
  assert.equal(snap.aliasOf, null);
  assert.ok(snap.devices.every((d) => d.rackUid === `rack:${scan}`));
});

// -- 4. a second photograph --------------------------------------------
test('a second photograph of a confirmed rack is the same rack, and nothing is asked again', async () => {
  const room = mkSpace(2);
  const r21 = mkRack(room.id, 'RK-21', 'F-21');
  mkRack(room.id, 'RK-22', 'F-22');
  const first = mkScan(room.id, report({ labels: ['RK-21', 'RK-22'] }));
  const bound = await rackIdentity.confirm(first, { tenantId: SITE, userId: TECH, knownRackId: r21.id });

  // The same photograph, asked again: the saved answer is reused, the photo is
  // not read and NetBox is not asked.
  const nb = fakeNetBox([nbRack(960, 'RK-21', 'F-21')]);
  photoReads = 0;
  const again = await rackIdentity.identify(first, { tenantId: SITE, netboxClient: nb });
  assert.equal(again.decision, 'matched');
  assert.equal(again.rule, 'record');
  assert.equal(again.rackKey, bound.rackKey);
  assert.equal(photoReads, 0, 'the photo is not read again');
  assert.deepEqual(nb.calls, [], 'NetBox is not asked again');

  // A second photograph is a second scan with a second hash. Its label names the
  // rack that was confirmed, so it lands on the same record, with the same key,
  // and nobody is asked a second time.
  const second = mkScan(room.id, report({ labels: ['RK-21'] }));
  const ladder = await rackIdentity.identify(second, { tenantId: SITE });
  assert.equal(ladder.decision, 'matched');
  assert.equal(ladder.rule, 'label');
  assert.equal(ladder.rack.id, r21.id);
  assert.equal(ladder.rackKey, bound.rackKey);

  const one = await recognise(first);
  const two = await recognise(second);
  assert.equal(two.rackKey, one.rackKey);
  assert.equal(two.rackName, 'RK-21');
  assert.equal(two.rackKeySource, 'identified-label');
  // Two photographs, one set of records: every rack-scoped uid is the same.
  assert.deepEqual(snapshotFor(second, two).devices.map((d) => d.uid),
    snapshotFor(first, one).devices.map((d) => d.uid));
});
