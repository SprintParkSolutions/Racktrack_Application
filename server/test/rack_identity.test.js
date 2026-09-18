/**
 * Rack identity: which of the customer's racks a scan is.
 *
 * Against the real estate, profile and tenant modules, the real router, and a
 * seeded throwaway database, the way setup.test.js runs. Two things are stood
 * in at the module boundary: NetBox (a client that answers sites, racks and
 * devices from canned lists) and the physical layer report (io.readPhysicalLayer
 * answers from a map, so no file is read and python is never started).
 *
 * What is proved:
 *   - each rung of the ladder speaks when it should, and names its rule;
 *   - only the record and a label that equals one rack in the scan's space state
 *     a rack and hand out the rack key; NetBox, the devices and the only rack
 *     in the space only ever suggest, with no rack and no key;
 *   - NetBox is asked with a site filter, and with no site it gives candidates only;
 *   - a tie is never broken: two racks that fit stay two racks;
 *   - text is put in one shape first (case, separators), and a letter becomes a
 *     digit only where the organisation's rack pattern says digits;
 *   - a new rack's name is only ever a label that was read;
 *   - one organisation never sees another's racks, by lookup or by confirm;
 *   - GET writes nothing, and confirm is the one write.
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const Database = require('better-sqlite3');

const DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-rack-identity-'));
const DB_PATH = path.join(DB_DIR, 'auth.db');
process.env.RACKTRACK_AUTH_DB = DB_PATH;
process.env.RT_DATA_DIR = path.join(DB_DIR, 'netbox');

const ORG_A = 10, ORG_B = 20;
const SITE_A = 11, SITE_A2 = 12, SITE_B = 21;
const OWNER = 1, ADMIN_A = 2, TECH_A = 3, OTHER_A = 4, ADMIN_B = 5, TECH_B = 6, MGR_A = 7;

before(() => {
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE organizations (id INTEGER PRIMARY KEY, name TEXT, status TEXT DEFAULT 'active');
    CREATE TABLE tenants (id INTEGER PRIMARY KEY, slug TEXT, name TEXT, organization_id INTEGER);
    CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT, email TEXT, role TEXT,
                        tenant_id INTEGER, organization_id INTEGER, active INTEGER DEFAULT 1);
    CREATE TABLE rack_owners (rack_id TEXT, tenant_id INTEGER, created_by INTEGER,
                              created_at TEXT DEFAULT (datetime('now')),
                              PRIMARY KEY (tenant_id, rack_id));
  `);
  db.prepare('INSERT INTO organizations (id,name) VALUES (?,?)').run(ORG_A, 'Org A');
  db.prepare('INSERT INTO organizations (id,name) VALUES (?,?)').run(ORG_B, 'Org B');
  const t = db.prepare('INSERT INTO tenants (id,slug,name,organization_id) VALUES (?,?,?,?)');
  t.run(SITE_A, 'north-dc', 'North DC', ORG_A);
  t.run(SITE_A2, 'south-dc', 'South DC', ORG_A);
  t.run(SITE_B, 'b-dc', 'B DC', ORG_B);
  const u = db.prepare('INSERT INTO users (id,username,email,role,tenant_id,organization_id) VALUES (?,?,?,?,?,?)');
  u.run(OWNER, 'owner', 'owner@example.test', 'owner', null, null);
  u.run(ADMIN_A, 'admin_a', 'admin_a@example.test', 'org_admin', null, ORG_A);
  u.run(TECH_A, 'tech_a', 'tech_a@example.test', 'member', SITE_A, ORG_A);
  u.run(OTHER_A, 'other_a', 'other_a@example.test', 'member', SITE_A, ORG_A);
  u.run(ADMIN_B, 'admin_b', 'admin_b@example.test', 'org_admin', SITE_B, ORG_B);
  u.run(TECH_B, 'tech_b', 'tech_b@example.test', 'member', SITE_B, ORG_B);
  u.run(MGR_A, 'mgr_a', 'mgr_a@example.test', 'site_manager', SITE_A, ORG_A);
  db.close();
});

after(() => { try { fs.rmSync(DB_DIR, { recursive: true, force: true }); } catch { /* best effort */ } });

// -- Harness -----------------------------------------------------------
const estate = require('../lib/estate');
const profile = require('../lib/estate_profile');
const tenantLib = require('../lib/tenant');
const rackIdentity = require('../lib/rack_identity');
const rackMatch = require('../lib/netbox/rack_match');
const rackNames = require('../lib/netbox/rack_names');
const express = require('express');

// The physical layer report, answered from a map instead of outputs/<rackId>/.
const reports = new Map();
rackIdentity.io.readPhysicalLayer = (rackId) => reports.get(rackId) || null;

/** A report as pipeline/physical_layer.py writes it, cut down to what is read here. */
function report({ labels = [], devices = [] } = {}) {
  return {
    schema: 'racktrack-physical-layer/1',
    rack: { candidates: labels.map(([text, source = 'rail chip', conf = 0.9]) => ({ text, conf, source })) },
    units: devices.map((name, i) => ({ unit: `u${i + 1}`, devices: [{ device_type: 'Switch', label: { text: name } }] })),
  };
}

/** NetBox, answering the four lookups this feature makes from canned lists. */
function fakeNetBox({ sites = [], racks = [], devices = [] } = {}) {
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
        rows = sites.filter((s) => (params.name__ie == null || same(s.name, params.name__ie))
          && (params.slug == null || s.slug === params.slug));
      } else if (apiPath === '/api/dcim/racks/') {
        rows = racks.filter((r) => (params.site_id == null || r.site.id === Number(params.site_id))
          && (params.facility_id == null || r.facility_id === params.facility_id)
          && (params.name == null || r.name === params.name)
          && (params.name__ie == null || same(r.name, params.name__ie)));
      } else if (apiPath === '/api/dcim/devices/') {
        rows = devices.filter((d) => (params.site_id == null || d.site.id === Number(params.site_id))
          && same(d.name, params.name__ie));
      }
      return { count: rows.length, results: rows.slice(0, Number(params.limit || 50)) };
    },
  };
}
const NORTH = { id: 1, name: 'North DC', slug: 'north-dc' };
const ELSEWHERE = { id: 2, name: 'Some Other Site', slug: 'other' };
const nbRack = (id, name, facility_id = null, site = NORTH) => ({ id, name, facility_id, site: { id: site.id, name: site.name } });
const nbDevice = (name, rack, site = NORTH) => ({ name, site: { id: site.id }, rack: rack ? { id: rack.id, name: rack.name } : null });

let seq = 0;
const nextId = (prefix) => `RK-${prefix}${String(++seq).padStart(4, '0')}`;
const mkSpace = (tenantId, rackCount, parentId) => estate.createSpace(tenantId,
  { name: `Space ${++seq}`, rack_count: rackCount, ...(parentId ? { parent_id: parentId } : {}) }, ADMIN_A);
const mkRack = (tenantId, spaceId, name, facilityId) => estate.upsertRack(tenantId,
  { rack_id: nextId('TYPED'), space_id: spaceId, name, ...(facilityId ? { facility_id: facilityId } : {}) }, ADMIN_A).rack;
/** A scan as /api/analyze leaves it: claimed for the Site, and learned into the space. */
function mkScan(tenantId, spaceId, userId, rep) {
  const rackId = nextId('SCAN');
  tenantLib.claimRack(tenantId, rackId, userId);
  if (spaceId != null) estate.upsertRack(tenantId, { rack_id: rackId, space_id: spaceId, source: 'learned' }, userId);
  if (rep) reports.set(rackId, rep);
  return rackId;
}

// -- 1. record ---------------------------------------------------------
test('record: a scan whose own row was typed is that rack, with the resolver\'s key, and the photo is not read', async () => {
  const space = mkSpace(SITE_A, 4);
  const rackId = nextId('SCAN');
  tenantLib.claimRack(SITE_A, rackId, TECH_A);
  const row = estate.upsertRack(SITE_A, { rack_id: rackId, space_id: space.id, name: 'A01', facility_id: 'F-A01' }, ADMIN_A).rack;
  rackIdentity.io.readPhysicalLayer = () => { throw new Error('the record decides; the photo is not read'); };
  const nb = fakeNetBox({ sites: [NORTH], racks: [nbRack(77, 'Rack A01', 'F-A01')] });
  let r;
  try {
    r = await rackIdentity.identify(rackId, { tenantId: SITE_A, netboxClient: nb });
  } finally {
    rackIdentity.io.readPhysicalLayer = (id) => reports.get(id) || null;
  }
  assert.equal(r.decision, 'matched');
  assert.equal(r.confidence, 'confirmed');
  assert.equal(r.rule, 'record');
  // The NetBox id is the one rack_match found, by facility id.
  assert.deepEqual(r.rack, { source: 'known', id: row.id, name: 'A01', facilityId: 'F-A01', netboxId: 77 });
  assert.equal(r.rackKey, rackMatch.rackKeyFor(SITE_A, row.id));
  assert.equal(r.rackKey, `t${SITE_A}:${row.id}`);
  assert.equal(r.spaceId, space.id);
});

// -- 2. label ----------------------------------------------------------
test('label: a label that equals exactly one rack in the scan\'s space is that rack, by name or by facility id', async () => {
  const space = mkSpace(SITE_A, 6);
  const r07 = mkRack(SITE_A, space.id, 'RK-07', 'FAC-0007');
  const r08 = mkRack(SITE_A, space.id, 'RK-08', 'FAC-0008');
  const byName = await rackIdentity.identify(mkScan(SITE_A, space.id, TECH_A, report({ labels: [['RK-07']] })), { tenantId: SITE_A });
  assert.equal(byName.decision, 'matched');
  assert.equal(byName.confidence, 'probable');
  assert.equal(byName.rule, 'label');
  assert.deepEqual(byName.rack, { source: 'known', id: r07.id, name: 'RK-07', facilityId: 'FAC-0007' });
  assert.equal(byName.rackKey, rackMatch.rackKeyFor(SITE_A, r07.id));
  assert.equal(byName.candidates[0].score, 0.9);
  assert.match(byName.candidates[0].reasons[0], /"RK-07" \(rail chip, confidence 0\.9\) equals the name/);
  assert.deepEqual(byName.evidence.labels[0], { text: 'RK-07', normalized: 'RK-07', where: 'rail chip', confidence: 0.9, repaired: false });

  const byFacility = await rackIdentity.identify(mkScan(SITE_A, space.id, TECH_A, report({ labels: [['fac 0008', 'front label', 0.8]] })), { tenantId: SITE_A });
  assert.equal(byFacility.rule, 'label');
  assert.equal(byFacility.rack.name, 'RK-08');
  assert.equal(byFacility.rackKey, rackMatch.rackKeyFor(SITE_A, r08.id));
  assert.match(byFacility.candidates[0].reasons[0], /facility id/);
});

test('label: a rack in a space beneath the scan\'s space is in this space', async () => {
  const hall = mkSpace(SITE_A, null);
  const row = mkSpace(SITE_A, 4, hall.id);
  const rack = mkRack(SITE_A, row.id, 'H2-R03');
  const r = await rackIdentity.identify(mkScan(SITE_A, hall.id, TECH_A, report({ labels: [['H2-R03']] })), { tenantId: SITE_A });
  assert.equal(r.decision, 'matched');
  assert.equal(r.rule, 'label');
  assert.equal(r.rack.id, rack.id);
});

test('label: the name a person gave the scan is a reading too, and the key is the one the resolver hands out', async () => {
  const space = mkSpace(SITE_A, 6);
  mkRack(SITE_A, space.id, 'Rack One');
  const two = mkRack(SITE_A, space.id, 'Rack Two');
  const rackId = mkScan(SITE_A, space.id, TECH_A);
  rackNames.set(rackId, 'rack two');
  try {
    const resolved = await rackMatch.resolveRack(null, { tenantId: SITE_A, rackId, scanName: 'rack two', fallbackName: rackId });
    const r = await rackIdentity.identify(rackId, { tenantId: SITE_A });
    assert.equal(r.decision, 'matched');
    assert.equal(r.rule, 'label');
    assert.equal(r.rack.id, two.id);
    assert.equal(resolved.knownRackId, two.id);
    assert.equal(r.rackKey, resolved.rackKey);
    assert.equal(r.evidence.labels[0].where, 'record');
  } finally {
    rackNames.set(rackId, null);
  }
});

test('label: with no space chosen the whole Site is searched, and one hit is a suggestion with no rack and no key', async () => {
  const space = estate.createSpace(SITE_A2, { name: 'South Hall', rack_count: 4 }, ADMIN_A);
  const rack = estate.upsertRack(SITE_A2, { rack_id: nextId('TYPED'), space_id: space.id, name: 'S-14' }, ADMIN_A).rack;
  const r = await rackIdentity.identify(mkScan(SITE_A2, null, TECH_A, report({ labels: [['S-14']] })), { tenantId: SITE_A2 });
  assert.equal(r.decision, 'suggested');
  assert.equal(r.confidence, 'possible');
  assert.equal(r.rule, 'label');
  assert.equal(r.rack, null);
  assert.equal(r.rackKey, null);
  assert.equal(r.candidates.length, 1);
  assert.equal(r.candidates[0].id, rack.id);
  assert.match(r.candidates[0].reasons.join(' '), /not tied to a space/);
});

// -- Normalisation and the rack pattern --------------------------------
test('pattern: RK 07 matches RK-07 by separators alone; rk-o7 matches only when the pattern says digits', async () => {
  const space = mkSpace(SITE_A, 6);
  const rack = mkRack(SITE_A, space.id, 'RK-07');
  const spaced = mkScan(SITE_A, space.id, TECH_A, report({ labels: [['RK 07']] }));
  const misread = mkScan(SITE_A, space.id, TECH_A, report({ labels: [['rk-o7']] }));

  // No pattern: separators and case are set aside, but nobody says the O is a zero.
  let r = await rackIdentity.identify(spaced, { tenantId: SITE_A });
  assert.equal(r.rule, 'label');
  assert.equal(r.rack.id, rack.id);
  assert.equal(r.candidates[0].score, 0.86); // 0.95 for separators x 0.9 read confidence
  assert.deepEqual(r.evidence.pattern, { rackPattern: null, matches: false });
  r = await rackIdentity.identify(misread, { tenantId: SITE_A });
  assert.notEqual(r.decision, 'matched');
  assert.notEqual(r.decision, 'suggested');
  assert.equal(r.rack, null);
  assert.deepEqual(r.candidates, []);
  assert.equal(r.evidence.labels[0].repaired, false);

  // The organisation says racks are RK-##: now the O sits where a digit belongs.
  profile.putSection(SITE_A, 'conventions', { rack_pattern: 'RK-##' }, ADMIN_A);
  try {
    r = await rackIdentity.identify(misread, { tenantId: SITE_A });
    assert.equal(r.decision, 'matched');
    assert.equal(r.rule, 'label');
    assert.equal(r.rack.id, rack.id);
    assert.deepEqual(r.evidence.labels[0], { text: 'rk-o7', normalized: 'RK-07', where: 'rail chip', confidence: 0.9, repaired: true });
    assert.deepEqual(r.evidence.pattern, { rackPattern: 'RK-##', matches: true });
    assert.match(r.candidates[0].reasons[0], /repaired to "RK-07" because the rack pattern says digits there/);
    assert.equal(r.candidates[0].score, 0.77); // 0.85 for a repair x 0.9

    r = await rackIdentity.identify(spaced, { tenantId: SITE_A });
    assert.equal(r.rule, 'label');
    assert.equal(r.evidence.labels[0].normalized, 'RK-07');
    assert.equal(r.evidence.labels[0].repaired, false);

    // The same through a regular expression instead of a template.
    profile.putSection(SITE_A, 'conventions', { rack_pattern: '/RK-\\d{2}/' }, ADMIN_A);
    r = await rackIdentity.identify(misread, { tenantId: SITE_A });
    assert.equal(r.rule, 'label');
    assert.equal(r.evidence.labels[0].normalized, 'RK-07');
    assert.equal(r.evidence.labels[0].repaired, true);
  } finally {
    profile.deleteSection(SITE_A, 'conventions', ADMIN_A);
  }
});

test('pattern: only a letter where a digit belongs is repaired, and a guess between two repairs is refused', () => {
  assert.deepEqual(rackIdentity.fitToPattern('rk-o7', 'RK-##'), { text: 'RK-07', repaired: true });
  assert.deepEqual(rackIdentity.fitToPattern('RK 07', 'RK-##'), { text: 'RK-07', repaired: false });
  assert.deepEqual(rackIdentity.fitToPattern('RKO7', 'RK-##'), { text: 'RK-07', repaired: true });
  // A is not something OCR makes out of a digit; this is another label.
  assert.equal(rackIdentity.fitToPattern('RK-A7', 'RK-##'), null);
  // Letters where the pattern says letters are left alone.
  assert.deepEqual(rackIdentity.fitToPattern('RO-07', 'AA-##'), { text: 'RO-07', repaired: false });
  // A digit where a letter belongs is never turned back into one.
  assert.equal(rackIdentity.fitToPattern('R0-07', 'AA-##'), null);
  assert.equal(rackIdentity.fitToPattern('RK-007', 'RK-##'), null);
  // A literal digit in the template is repaired the same way.
  assert.deepEqual(rackIdentity.fitToPattern('DCI-RO7', 'DC1-R##'), { text: 'DC1-R07', repaired: true });
  // A regular expression that two different repairs satisfy: no repair is taken.
  assert.equal(rackIdentity.fitToPattern('SO', '/S0|5O/'), null);
  assert.deepEqual(rackIdentity.fitToPattern('RK-O7', '/RK-\\d{2}/'), { text: 'RK-07', repaired: true });
  assert.equal(rackIdentity.keyOf('rk 07'), rackIdentity.keyOf('RK-07'));
  assert.notEqual(rackIdentity.keyOf('RK-O7'), rackIdentity.keyOf('RK-07'));
});

// -- Ties --------------------------------------------------------------
test('tie: a label that fits two racks chooses neither, and a clean read is not dragged into it', async () => {
  const space = mkSpace(SITE_A, 6);
  const a = mkRack(SITE_A, space.id, 'R1-01');
  const b = mkRack(SITE_A, space.id, 'R10-1');
  // The hyphen was lost: R101 is R1-01 and R10-1 alike.
  let r = await rackIdentity.identify(mkScan(SITE_A, space.id, TECH_A, report({ labels: [['R101']] })), { tenantId: SITE_A });
  assert.equal(r.decision, 'ambiguous');
  assert.equal(r.confidence, 'unidentified');
  assert.equal(r.rack, null);
  assert.equal(r.rackKey, null);
  assert.equal(r.rule, null);
  assert.deepEqual(r.candidates.map((c) => c.id).sort(), [a.id, b.id].sort());
  for (const c of r.candidates) { assert.ok(c.score > 0); assert.ok(c.reasons.length > 0); }

  // Read with its hyphen, it equals one rack exactly and the looser match is not considered.
  r = await rackIdentity.identify(mkScan(SITE_A, space.id, TECH_A, report({ labels: [['R1-01']] })), { tenantId: SITE_A });
  assert.equal(r.decision, 'matched');
  assert.equal(r.rack.id, a.id);

  // Two labels in the frame naming two racks: a disagreement, not a choice, whatever their confidence.
  r = await rackIdentity.identify(mkScan(SITE_A, space.id, TECH_A,
    report({ labels: [['R1-01', 'rail chip', 0.99], ['R10-1', 'front label', 0.4]] })), { tenantId: SITE_A });
  assert.equal(r.decision, 'ambiguous');
  assert.equal(r.candidates.length, 2);
  assert.equal(r.candidates[0].id, a.id); // listed best first, but not chosen

  // Two racks typed with one name: the resolver's first-by-sort-order pick is not taken.
  const twins = mkSpace(SITE_A, 6);
  mkRack(SITE_A, twins.id, 'TW-01');
  mkRack(SITE_A, twins.id, 'TW-01');
  r = await rackIdentity.identify(mkScan(SITE_A, twins.id, TECH_A, report({ labels: [['TW-01']] })), { tenantId: SITE_A });
  assert.equal(r.decision, 'ambiguous');
  assert.equal(r.rackKey, null);
});

// -- 3. label-netbox ---------------------------------------------------
test('label-netbox: one rack at this Site\'s NetBox site is suggested, never stated, and the lookup carries the site', async () => {
  const space = mkSpace(SITE_A, 6);
  mkRack(SITE_A, space.id, 'RK-01');
  const rackId = mkScan(SITE_A, space.id, TECH_A, report({ labels: [['RK 44']] }));
  const nb = fakeNetBox({
    sites: [NORTH, ELSEWHERE],
    racks: [nbRack(900, 'RK-44', 'F-44'), nbRack(901, 'RK-44', null, ELSEWHERE)],
  });
  const r = await rackIdentity.identify(rackId, { tenantId: SITE_A, netboxClient: nb });
  assert.equal(r.decision, 'suggested');
  assert.equal(r.confidence, 'possible');
  assert.equal(r.rule, 'label-netbox');
  assert.equal(r.rack, null);
  assert.equal(r.rackKey, null);
  assert.equal(r.candidates.length, 1); // the RK-44 at the other site never appears
  const { score, reasons, ...suggested } = r.candidates[0];
  assert.deepEqual(suggested, { source: 'netbox', id: 900, name: 'RK-44', facilityId: 'F-44' });
  assert.equal(score, 0.86);
  assert.match(reasons[0], /a rack at North DC in NetBox/);
  // Every rack lookup this module made carried the site filter. The resolver's
  // own lookups (by exact name, limit 1) are rack_match's and found nothing.
  const listed = nb.calls.filter((x) => x.path === '/api/dcim/racks/' && x.params.limit !== 1);
  assert.ok(listed.length > 0);
  for (const c of listed) assert.equal(c.params.site_id, NORTH.id);
});

test('label-netbox: with no NetBox site that is this Site, NetBox gives candidates only', async () => {
  const space = mkSpace(SITE_A, null);
  const other = { id: 3, name: 'Third', slug: 'third' };
  const x = nbRack(905, 'ZZ-1', null, other);
  // One hit, and three devices all under it: with a site this would be a suggestion twice over.
  const nb = fakeNetBox({
    sites: [ELSEWHERE, other], racks: [nbRack(904, 'RK-45', null, ELSEWHERE), x],
    devices: ['EE-1', 'EE-2', 'EE-3'].map((n) => nbDevice(n, x, other)),
  });
  let r = await rackIdentity.identify(mkScan(SITE_A, space.id, TECH_A, report({ labels: [['RK-45']] })), { tenantId: SITE_A, netboxClient: nb });
  assert.equal(r.decision, 'unknown');
  assert.equal(r.rule, null);
  assert.equal(r.rack, null);
  assert.equal(r.rackKey, null);
  assert.equal(r.candidates.length, 1);
  assert.equal(r.candidates[0].id, 904);
  assert.match(r.candidates[0].reasons.join(' '), /at Some Other Site in NetBox.*candidate only/);
  assert.ok(r.evidence.notes.some((n) => /no single site/.test(n)));

  r = await rackIdentity.identify(mkScan(SITE_A, space.id, TECH_A, report({ devices: ['EE-1', 'EE-2', 'EE-3'] })), { tenantId: SITE_A, netboxClient: nb });
  assert.equal(r.decision, 'unknown');
  assert.equal(r.candidates[0].id, 905);
  assert.equal(r.candidates[0].score, 1);
  assert.match(r.candidates[0].reasons.join(' '), /candidate only/);
});

// -- 4. devices --------------------------------------------------------
test('devices: most device names under one NetBox rack suggest it, and the share is the score', async () => {
  const space = mkSpace(SITE_A, 6);
  const x = nbRack(910, 'ROW2-R5');
  const y = nbRack(911, 'ROW2-R6');
  const rackId = mkScan(SITE_A, space.id, TECH_A, report({ devices: ['SW-01', 'SW-02', 'SW-03', 'SW-04'] }));
  const nb = fakeNetBox({
    sites: [NORTH], racks: [x, y],
    devices: [nbDevice('SW-01', x), nbDevice('sw-02', x), nbDevice('SW-03', x), nbDevice('SW-04', y)],
  });
  const r = await rackIdentity.identify(rackId, { tenantId: SITE_A, netboxClient: nb });
  assert.equal(r.decision, 'suggested');
  assert.equal(r.rule, 'devices');
  assert.equal(r.rack, null);
  assert.equal(r.rackKey, null);
  assert.equal(r.candidates[0].id, 910);
  assert.equal(r.candidates[0].source, 'netbox');
  assert.equal(r.candidates[0].score, 0.75);
  assert.match(r.candidates[0].reasons[0], /3 of the 4 device names/);
  assert.deepEqual(r.evidence.deviceHints[0], { device: 'SW-01', unit: 'u1', netboxRack: { id: 910, name: 'ROW2-R5' } });
  assert.equal(r.candidates.length, 2); // the rack that holds the fourth is still shown
  for (const c of nb.calls.filter((k) => k.path === '/api/dcim/devices/')) assert.equal(c.params.site_id, NORTH.id);
});

test('devices: fewer than 3 names, under 60 percent, or two racks within 10 points suggest nothing', async () => {
  const space = mkSpace(SITE_A, null);
  const x = nbRack(920, 'X-1');
  const y = nbRack(921, 'Y-1');

  // Two names, both under X: not enough devices.
  let nb = fakeNetBox({ sites: [NORTH], racks: [x, y], devices: [nbDevice('AA-1', x), nbDevice('AA-2', x)] });
  let r = await rackIdentity.identify(mkScan(SITE_A, space.id, TECH_A, report({ devices: ['AA-1', 'AA-2'] })), { tenantId: SITE_A, netboxClient: nb });
  assert.equal(r.decision, 'unknown');
  assert.equal(r.candidates.length, 1);
  assert.match(r.candidates[0].reasons.join(' '), /at least 3 are needed/);

  // Five names, two under X: 40 percent.
  nb = fakeNetBox({ sites: [NORTH], racks: [x, y], devices: [nbDevice('BB-1', x), nbDevice('BB-2', x)] });
  r = await rackIdentity.identify(mkScan(SITE_A, space.id, TECH_A, report({ devices: ['BB-1', 'BB-2', 'BB-3', 'BB-4', 'BB-5'] })), { tenantId: SITE_A, netboxClient: nb });
  assert.equal(r.decision, 'unknown');
  assert.equal(r.candidates[0].score, 0.4);
  assert.match(r.candidates[0].reasons.join(' '), /under the 60 percent/);

  // The same three names are recorded under both racks: 100 percent each, a tie.
  nb = fakeNetBox({ sites: [NORTH], racks: [x, y], devices: ['CC-1', 'CC-2', 'CC-3'].flatMap((n) => [nbDevice(n, x), nbDevice(n, y)]) });
  r = await rackIdentity.identify(mkScan(SITE_A, space.id, TECH_A, report({ devices: ['CC-1', 'CC-2', 'CC-3'] })), { tenantId: SITE_A, netboxClient: nb });
  assert.equal(r.decision, 'ambiguous');
  assert.equal(r.rack, null);
  assert.deepEqual(r.candidates.map((c) => c.id).sort(), [920, 921]);
  for (const c of r.candidates) assert.match(c.reasons.join(' '), /within 10 points/);
});

test('devices: they may speak where a label tied, by agreeing with one rack on the list, never by naming a third', async () => {
  const space = mkSpace(SITE_A, 6);
  const a = mkRack(SITE_A, space.id, 'R2-01');
  mkRack(SITE_A, space.id, 'R20-1');
  const names = ['DD-1', 'DD-2', 'DD-3'];
  const nbA = nbRack(930, 'R2-01');
  const third = nbRack(931, 'R9-99');

  let nb = fakeNetBox({ sites: [NORTH], racks: [nbA, third], devices: names.map((n) => nbDevice(n, nbA)) });
  let r = await rackIdentity.identify(mkScan(SITE_A, space.id, TECH_A, report({ labels: [['R201']], devices: names })), { tenantId: SITE_A, netboxClient: nb });
  assert.equal(r.decision, 'suggested');
  assert.equal(r.rule, 'devices');
  assert.equal(r.rack, null);
  assert.equal(r.rackKey, null);
  // The customer's own record is the one suggested; NetBox rides along.
  const { score, reasons, ...suggested } = r.candidates[0];
  assert.deepEqual(suggested, { source: 'known', id: a.id, name: 'R2-01', facilityId: null, netboxId: 930 });
  assert.equal(score, 1);
  assert.equal(reasons.length, 2); // what the label said, and what the devices said
  assert.equal(r.candidates.length, 2);

  nb = fakeNetBox({ sites: [NORTH], racks: [nbA, third], devices: names.map((n) => nbDevice(n, third)) });
  r = await rackIdentity.identify(mkScan(SITE_A, space.id, TECH_A, report({ labels: [['R201']], devices: names })), { tenantId: SITE_A, netboxClient: nb });
  assert.equal(r.decision, 'ambiguous');
  assert.equal(r.rack, null);
  assert.equal(r.candidates.length, 3);
});

// -- 5. only-rack ------------------------------------------------------
test('only-rack: a suggestion, and only in a space said to hold one rack with no other scan unaccounted for', async () => {
  const space = mkSpace(SITE_A, 1);
  const only = mkRack(SITE_A, space.id, 'Comms Rack');
  const first = mkScan(SITE_A, space.id, TECH_A, report());
  let r = await rackIdentity.identify(first, { tenantId: SITE_A });
  assert.equal(r.decision, 'suggested');
  assert.equal(r.confidence, 'possible');
  assert.equal(r.rule, 'only-rack');
  assert.equal(r.rack, null);
  assert.equal(r.rackKey, null);
  assert.equal(r.candidates.length, 1);
  assert.equal(r.candidates[0].id, only.id);
  assert.match(r.candidates[0].reasons[0], /the only rack set up in this space/);
  // The resolver names this rack for the contact too, and hands out no key for it either.
  const resolved = await rackMatch.resolveRack(null, { tenantId: SITE_A, rackId: first, fallbackName: first });
  assert.equal(resolved.knownRackId, only.id);
  assert.equal(resolved.rackKey, null);

  // A second scan nobody has tied to a rack: it may be another photo of the same
  // rack, or the first of eleven racks the count forgot. The space stops speaking.
  const second = mkScan(SITE_A, space.id, TECH_A, report());
  for (const id of [first, second]) {
    r = await rackIdentity.identify(id, { tenantId: SITE_A });
    assert.equal(r.decision, 'new'); // room for one rack, none tied to a scan yet
    assert.equal(r.rule, null);
    assert.equal(r.rack, null);
    assert.equal(r.candidates.length, 1);
    assert.equal(r.candidates[0].id, only.id);
    assert.match(r.candidates[0].reasons.join(' '), /not tied to a rack yet/);
  }

  // Once a person has said the first scan is that rack, the second is alone again.
  const bound = await rackIdentity.confirm(first, { tenantId: SITE_A, userId: TECH_A, knownRackId: only.id });
  assert.equal(bound.rackKey, rackMatch.rackKeyFor(SITE_A, only.id));
  r = await rackIdentity.identify(first, { tenantId: SITE_A });
  assert.equal(r.decision, 'matched');
  assert.equal(r.rule, 'record');
  assert.equal(r.rackKey, bound.rackKey);
  r = await rackIdentity.identify(second, { tenantId: SITE_A });
  assert.equal(r.decision, 'suggested');
  assert.equal(r.rule, 'only-rack');
  assert.equal(r.rackKey, null);

  // One rack set up in a space said to hold twelve: the space says nothing at all.
  const big = mkSpace(SITE_A, 12);
  mkRack(SITE_A, big.id, 'The One Typed');
  r = await rackIdentity.identify(mkScan(SITE_A, big.id, TECH_A, report()), { tenantId: SITE_A });
  assert.equal(r.decision, 'new');
  assert.deepEqual(r.candidates, []);
});

test('only-rack: a rack label that says otherwise stops the space from speaking; other print does not', async () => {
  const space = mkSpace(SITE_A, 1);
  const only = mkRack(SITE_A, space.id, 'RK-07');
  const r = await rackIdentity.identify(mkScan(SITE_A, space.id, TECH_A, report({ labels: [['RK-09']] })), { tenantId: SITE_A });
  assert.equal(r.decision, 'new');
  assert.equal(r.rack, null);
  assert.deepEqual(r.proposal, { name: 'RK-09', where: 'rail chip', confidence: 0.9 });
  assert.equal(r.candidates[0].id, only.id);
  assert.match(r.candidates[0].reasons.join(' '), /"RK-09", which is not this rack/);

  // Print that is not a rack identifier (the word ROUTER off a front panel) does not.
  const quiet = mkSpace(SITE_A, 1);
  mkRack(SITE_A, quiet.id, 'Solo');
  const noisy = await rackIdentity.identify(mkScan(SITE_A, quiet.id, TECH_A, report({ labels: [['ROUTER', 'front label', 0.99]] })), { tenantId: SITE_A });
  assert.equal(noisy.decision, 'suggested');
  assert.equal(noisy.rule, 'only-rack');
});

// -- new and unknown ---------------------------------------------------
test('new: room left in the space and nothing matched; the name offered is the label read, or none', async () => {
  const space = mkSpace(SITE_A, 3);
  mkRack(SITE_A, space.id, 'RACK 1');
  let r = await rackIdentity.identify(mkScan(SITE_A, space.id, TECH_A, report({ labels: [['RACK 12', 'front label', 0.72]] })), { tenantId: SITE_A });
  assert.equal(r.decision, 'new');
  assert.equal(r.confidence, 'unidentified');
  assert.equal(r.rack, null);
  assert.equal(r.rackKey, null);
  assert.equal(r.rule, null);
  assert.deepEqual(r.proposal, { name: 'RACK 12', where: 'front label', confidence: 0.72 });

  // Nothing read: still a new rack by the count, and no name is made up for it.
  r = await rackIdentity.identify(mkScan(SITE_A, space.id, TECH_A, report()), { tenantId: SITE_A });
  assert.equal(r.decision, 'new');
  assert.equal(r.proposal, null);

  // Print that is not a rack identifier is never offered as a name.
  r = await rackIdentity.identify(mkScan(SITE_A, space.id, TECH_A, report({ labels: [['ROUTER', 'front label', 0.99]] })), { tenantId: SITE_A });
  assert.equal(r.decision, 'new');
  assert.equal(r.proposal, null);

  // Two different rack labels in the frame: neither is picked.
  r = await rackIdentity.identify(mkScan(SITE_A, space.id, TECH_A, report({ labels: [['RACK 12'], ['RACK 13']] })), { tenantId: SITE_A });
  assert.equal(r.proposal, null);
  assert.equal(r.evidence.labels.length, 2);

  // With a rack pattern, only a label that fits it is offered, in the pattern's own form.
  profile.putSection(SITE_A, 'conventions', { rack_pattern: 'RACK-##' }, ADMIN_A);
  try {
    r = await rackIdentity.identify(mkScan(SITE_A, space.id, TECH_A, report({ labels: [['rack 1z'], ['R9']] })), { tenantId: SITE_A });
    assert.equal(r.decision, 'new');
    assert.equal(r.proposal.name, 'RACK-12');
  } finally {
    profile.deleteSection(SITE_A, 'conventions', ADMIN_A);
  }
});

test('unknown: no room left in the space, or nothing to go on at all', async () => {
  // Both racks the space holds have a scan tied to them already.
  const space = mkSpace(SITE_A, 2);
  const a = mkRack(SITE_A, space.id, 'U-1');
  const b = mkRack(SITE_A, space.id, 'U-2');
  await rackIdentity.confirm(mkScan(SITE_A, space.id, TECH_A), { tenantId: SITE_A, userId: TECH_A, knownRackId: a.id });
  await rackIdentity.confirm(mkScan(SITE_A, space.id, TECH_A), { tenantId: SITE_A, userId: TECH_A, knownRackId: b.id });
  let r = await rackIdentity.identify(mkScan(SITE_A, space.id, TECH_A, report({ labels: [['U-9']] })), { tenantId: SITE_A });
  assert.equal(r.decision, 'unknown');
  assert.equal(r.proposal, null);
  assert.equal(r.evidence.labels[0].text, 'U-9'); // what was read is still shown, verbatim

  // No report, no space, nothing the label could equal: nothing at all.
  r = await rackIdentity.identify(mkScan(SITE_A2, null, TECH_A), { tenantId: SITE_A2 });
  assert.equal(r.decision, 'unknown');
  assert.equal(r.spaceId, null);
  assert.deepEqual(r.candidates, []);
  assert.deepEqual(r.evidence.labels, []);
  assert.ok(r.evidence.notes.some((n) => /no physical layer report/.test(n)));

  r = await rackIdentity.identify('RK-NOBODY01', {});
  assert.equal(r.decision, 'unknown');
});

// -- Organisation isolation --------------------------------------------
test('isolation: another organisation\'s racks are never candidates, and a foreign space is not found', async () => {
  const spaceB = estate.createSpace(SITE_B, { name: 'B Hall', rack_count: 4 }, ADMIN_B);
  estate.upsertRack(SITE_B, { rack_id: nextId('TYPED'), space_id: spaceB.id, name: 'ISO-01' }, ADMIN_B);
  const spaceA = mkSpace(SITE_A, null);
  const rackId = mkScan(SITE_A, spaceA.id, TECH_A, report({ labels: [['ISO-01']] }));

  const r = await rackIdentity.identify(rackId, { tenantId: SITE_A });
  assert.equal(r.decision, 'unknown');
  assert.deepEqual(r.candidates, []);
  // Not tied to a space, the whole Site is searched, and still only this Site.
  const loose = await rackIdentity.identify(mkScan(SITE_A2, null, TECH_A, report({ labels: [['ISO-01']] })), { tenantId: SITE_A2 });
  assert.deepEqual(loose.candidates, []);

  await assert.rejects(rackIdentity.identify(rackId, { tenantId: SITE_A, spaceId: spaceB.id }),
    (err) => err instanceof rackIdentity.IdentityError && err.status === 404);
});

// -- The routes --------------------------------------------------------
const auditLog = [];
const built = [];
let netboxNow = null;
const app = express();
app.use(express.json());
app.use(require('../routes/rack_identity')({
  // Stands in for auth.requireAuth: the seeded user row named by x-user, else 401.
  requireAuth: (req, res, next) => {
    const id = Number(req.headers['x-user'] || 0);
    if (!id) return res.status(401).json({ error: 'Authentication required' });
    const db = new Database(DB_PATH, { readonly: true });
    req.user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    db.close();
    if (!req.user) return res.status(401).json({ error: 'User no longer exists' });
    next();
  },
  audit: { log: (entry) => auditLog.push(entry) },
  // Stands in for app.js's one builder of the physical layer report.
  physicalLayer: async (rackId) => {
    built.push(rackId);
    return { status: 200, body: report({ labels: [['BUILT-01']] }) };
  },
  netboxClientFor: () => netboxNow,
}));

let server, port;
before(() => new Promise((resolve) => {
  server = app.listen(0, '127.0.0.1', () => { port = server.address().port; resolve(); });
}));
after(() => server && server.close());

function call(method, urlPath, { user, body } = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : JSON.stringify(body);
    const req = http.request({
      host: '127.0.0.1', port, method, path: urlPath,
      headers: {
        ...(user ? { 'x-user': String(user) } : {}),
        ...(data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {}),
      },
    }, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(raw); } catch { /* not JSON */ }
        resolve({ status: res.statusCode, json, raw });
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

/** Everything a GET could have written to, as one comparable value: every row of every table, and the name file. */
function everythingStored() {
  const db = new Database(DB_PATH, { readonly: true });
  try {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all().map((t) => t.name);
    const rows = {};
    for (const t of tables) rows[t] = db.prepare(`SELECT * FROM ${t}`).all();
    let names = null;
    try { names = fs.readFileSync(rackNames.FILE, 'utf8'); } catch { names = null; }
    return JSON.stringify({ tables, rows, names });
  } finally { db.close(); }
}

test('GET: signed in, scoped to the rack\'s organisation and Site, and it writes nothing', async () => {
  const space = mkSpace(SITE_A, 6);
  const rack = mkRack(SITE_A, space.id, 'GET-01');
  const rackId = mkScan(SITE_A, space.id, TECH_A, report({ labels: [['GET 01']], devices: ['GG-1', 'GG-2', 'GG-3'] }));
  const unmatched = mkScan(SITE_A, space.id, TECH_A, report({ labels: [['GET 99']], devices: ['GG-1', 'GG-2', 'GG-3'] }));
  const bare = mkScan(SITE_A, mkSpace(SITE_A, 1).id, TECH_A);
  const url = `/api/scan/${rackId}/identity`;

  assert.equal((await call('GET', url)).status, 401);
  assert.equal((await call('GET', '/api/scan/not-a-rack/identity', { user: TECH_A })).status, 400);
  // Another organisation's technician and admin are told the rack is not there.
  assert.equal((await call('GET', url, { user: TECH_B })).status, 404);
  assert.equal((await call('GET', url, { user: ADMIN_B })).status, 404);

  profile.tenantProfile(SITE_A); // the profile tables are made on first read; that is schema, not this route
  const stored = everythingStored();
  const audited = auditLog.length;
  const x = nbRack(960, 'GET-99');
  netboxNow = fakeNetBox({ sites: [NORTH], racks: [x], devices: ['GG-1', 'GG-2', 'GG-3'].map((n) => nbDevice(n, x)) });
  try {
    for (const user of [TECH_A, OTHER_A, MGR_A, ADMIN_A, OWNER]) {
      const r = await call('GET', url, { user });
      assert.equal(r.status, 200, `user ${user}`);
      assert.equal(r.json.ok, true);
      assert.equal(r.json.rackId, rackId);
      assert.equal(r.json.spaceId, space.id);
      assert.equal(r.json.decision, 'matched');
      assert.equal(r.json.rule, 'label');
      assert.deepEqual(r.json.rack, { source: 'known', id: rack.id, name: 'GET-01', facilityId: null });
      assert.equal(r.json.rackKey, `t${SITE_A}:${rack.id}`);
      assert.deepEqual(Object.keys(r.json).sort(), ['candidates', 'confidence', 'decision', 'evidence', 'ok', 'proposal',
        'rack', 'rackId', 'rackKey', 'rule', 'spaceId']);
      assert.deepEqual(Object.keys(r.json.evidence).sort(), ['deviceHints', 'labels', 'notes', 'pattern']);
    }
    // Every other outcome reads only, too: a suggestion from NetBox, a scan with no report, a refusal.
    let r = await call('GET', `/api/scan/${unmatched}/identity`, { user: TECH_A });
    assert.equal(r.json.decision, 'suggested');
    assert.equal(r.json.rule, 'label-netbox');
    built.length = 0;
    r = await call('GET', `/api/scan/${bare}/identity`, { user: TECH_A });
    assert.equal(r.json.decision, 'new');
    assert.deepEqual(built, [bare]);
    assert.equal((await call('GET', `${url}?spaceId=999999`, { user: TECH_A })).status, 404);
    assert.equal((await call('GET', `${url}?spaceId=abc`, { user: TECH_A })).status, 400);
    assert.equal((await call('GET', `${url}?tenantId=${SITE_B}`, { user: ADMIN_A })).status, 404);
  } finally {
    netboxNow = null;
  }
  assert.equal(everythingStored(), stored);
  assert.equal(auditLog.length, audited);
});

test('GET: the report is built once through the shared builder only when there is none and it is needed', async () => {
  const space = mkSpace(SITE_A, 6);
  const rack = mkRack(SITE_A, space.id, 'BUILT-01');
  const noReport = mkScan(SITE_A, space.id, TECH_A);
  const cached = mkScan(SITE_A, space.id, TECH_A, report({ labels: [['BUILT-01']] }));
  built.length = 0;

  let r = await call('GET', `/api/scan/${noReport}/identity`, { user: TECH_A });
  assert.equal(r.json.rule, 'label');
  assert.equal(r.json.rack.id, rack.id);
  assert.deepEqual(built, [noReport]);

  r = await call('GET', `/api/scan/${cached}/identity`, { user: TECH_A });
  assert.equal(r.json.rule, 'label');
  assert.deepEqual(built, [noReport]); // the cached report was enough

  // A scan the record already names never needs the photo.
  await rackIdentity.confirm(noReport, { tenantId: SITE_A, userId: TECH_A, knownRackId: rack.id });
  r = await call('GET', `/api/scan/${noReport}/identity`, { user: TECH_A });
  assert.equal(r.json.rule, 'record');
  assert.deepEqual(built, [noReport]);
});

test('confirm: the technician who scanned it or an admin, never another member, never across organisations', async () => {
  const space = mkSpace(SITE_A, 6);
  const rack = mkRack(SITE_A, space.id, 'CF-01', 'F-CF-01');
  const rackId = mkScan(SITE_A, space.id, TECH_A, report({ labels: [['CF-01'], ['CF-02']] }));
  const other = mkRack(SITE_A, space.id, 'CF-02');
  const url = `/api/scan/${rackId}/identity/confirm`;
  const spaceB = estate.createSpace(SITE_B, { name: 'B Row', rack_count: 2 }, ADMIN_B);
  const foreign = estate.upsertRack(SITE_B, { rack_id: nextId('TYPED'), space_id: spaceB.id, name: 'CF-01' }, ADMIN_B).rack;

  let r = await call('GET', `/api/scan/${rackId}/identity`, { user: TECH_A });
  assert.equal(r.json.decision, 'ambiguous');

  assert.equal((await call('POST', url, { body: { knownRackId: rack.id } })).status, 401);
  assert.equal((await call('POST', url, { user: TECH_B, body: { knownRackId: rack.id } })).status, 404);
  // A member of the Site who did not scan this rack may read it but not confirm it.
  r = await call('POST', url, { user: OTHER_A, body: { knownRackId: rack.id } });
  assert.equal(r.status, 403);
  // Exactly one of the three; and a rack of another organisation is not there.
  assert.equal((await call('POST', url, { user: TECH_A, body: {} })).status, 400);
  assert.equal((await call('POST', url, { user: TECH_A, body: { knownRackId: rack.id, name: 'X' } })).status, 400);
  assert.equal((await call('POST', url, { user: ADMIN_A, body: { knownRackId: foreign.id } })).status, 404);
  assert.equal((await call('POST', url, { user: OWNER, body: { knownRackId: foreign.id } })).status, 404);
  assert.equal(rackIdentity.confirmedRack(SITE_A, rackId), null);

  const audited = auditLog.length;
  r = await call('POST', url, { user: TECH_A, body: { knownRackId: rack.id } });
  assert.equal(r.status, 200);
  assert.equal(r.json.rackKey, rackMatch.rackKeyFor(SITE_A, rack.id));
  assert.deepEqual(r.json.bound, {
    rackId, knownRackId: rack.id, netboxRackId: null, name: 'CF-01', facilityId: 'F-CF-01',
    rackKey: `t${SITE_A}:${rack.id}`, created: false, source: 'confirmed',
  });
  assert.equal(r.json.identity.decision, 'matched');
  assert.equal(r.json.identity.confidence, 'confirmed');
  assert.equal(r.json.identity.rule, 'record');
  assert.equal(r.json.identity.rack.id, rack.id);
  assert.equal(r.json.identity.rackKey, r.json.rackKey);

  const entry = auditLog[auditLog.length - 1];
  assert.equal(auditLog.length, audited + 1);
  assert.equal(entry.action, 'rack.identity.confirm');
  assert.equal(entry.status, 'ok');
  assert.equal(entry.targetType, 'rack');
  assert.equal(entry.targetId, rackId);
  assert.equal(entry.payload.knownRackId, rack.id);
  assert.equal(entry.payload.rackKey, r.json.rackKey);
  assert.equal(entry.payload.by, 'technician');

  const db = new Database(DB_PATH, { readonly: true });
  const row = db.prepare('SELECT * FROM rack_identity WHERE tenant_id = ? AND rack_id = ?').get(SITE_A, rackId);
  db.close();
  assert.equal(row.source, 'confirmed');
  assert.equal(row.known_rack_id, rack.id);
  assert.equal(row.confirmed_by, TECH_A);

  // The ladder was ambiguous before; the record now decides for everyone who may see it.
  r = await call('GET', `/api/scan/${rackId}/identity`, { user: ADMIN_A });
  assert.equal(r.json.rule, 'record');
  assert.match(r.json.candidates[0].reasons[0], /a person confirmed/);
  // An admin may correct it, and the key follows the rack.
  r = await call('POST', url, { user: MGR_A, body: { knownRackId: other.id } });
  assert.equal(r.status, 200);
  assert.equal(r.json.identity.rack.id, other.id);
  assert.equal(r.json.rackKey, rackMatch.rackKeyFor(SITE_A, other.id));
  assert.equal(auditLog[auditLog.length - 1].payload.by, 'admin');
});

test('confirm: a new rack takes the confirmed name on the scan\'s own row, created when there is none', async () => {
  const space = mkSpace(SITE_A, 4);
  const existing = mkRack(SITE_A, space.id, 'NEW-01');
  const learned = mkScan(SITE_A, space.id, TECH_A, report({ labels: [['RACK 7']] }));
  const url = `/api/scan/${learned}/identity/confirm`;
  let r = await call('GET', `/api/scan/${learned}/identity`, { user: TECH_A });
  assert.equal(r.json.decision, 'new');
  assert.equal(r.json.proposal.name, 'RACK 7');

  // A name that is already a rack here is pointed at, not duplicated.
  r = await call('POST', url, { user: TECH_A, body: { name: 'new 01' } });
  assert.equal(r.status, 409);
  assert.equal(r.json.knownRackId, existing.id);
  assert.equal((await call('POST', url, { user: TECH_A, body: { name: '   ' } })).status, 400);
  assert.equal((await call('POST', url, { user: TECH_A, body: { name: 'x'.repeat(121) } })).status, 400);

  r = await call('POST', url, { user: TECH_A, body: { name: 'RACK 7' } });
  assert.equal(r.status, 200);
  assert.equal(r.json.bound.name, 'RACK 7');
  assert.equal(r.json.bound.created, false); // the learned row was named in place
  const own = estate.getRackByRackId(SITE_A, learned);
  assert.equal(own.id, r.json.bound.knownRackId);
  assert.equal(own.name, 'RACK 7');
  assert.equal(own.space_id, space.id);
  assert.equal(r.json.identity.rule, 'record');
  // The row is now typed for the scan, so the resolver the rest of the system
  // uses answers with the same rack and the same key, with nothing changed there.
  const resolved = await rackMatch.resolveRack(null, { tenantId: SITE_A, rackId: learned, fallbackName: learned });
  assert.equal(resolved.name, 'RACK 7');
  assert.equal(resolved.rackKey, r.json.rackKey);

  // The next photo of that rack is recognised by its label.
  const again = mkScan(SITE_A, space.id, TECH_A, report({ labels: [['RACK 7']] }));
  r = await call('GET', `/api/scan/${again}/identity`, { user: TECH_A });
  assert.equal(r.json.decision, 'matched');
  assert.equal(r.json.rule, 'label');
  assert.equal(r.json.rack.id, own.id);

  // A scan that was never tied to a space has no row yet: one is created.
  const unbound = mkScan(SITE_A2, null, TECH_A);
  r = await call('POST', `/api/scan/${unbound}/identity/confirm`, { user: ADMIN_A, body: { name: 'South 1' } });
  assert.equal(r.status, 200);
  assert.equal(r.json.bound.created, true);
  assert.equal(estate.getRackByRackId(SITE_A2, unbound).name, 'South 1');
});

test('confirm: a NetBox rack of this Site is tied to the rack set up here that it is, else names the scan\'s row', async () => {
  const space = mkSpace(SITE_A, 6);
  const twin = mkRack(SITE_A, space.id, 'Cage 4 Rack 2', 'F-4-2');
  netboxNow = fakeNetBox({
    sites: [NORTH, ELSEWHERE],
    racks: [nbRack(950, 'C4-R2', 'F-4-2'), nbRack(951, 'C4-R3', 'F-4-3'), nbRack(952, 'C4-R9', null, ELSEWHERE)],
  });
  try {
    const first = mkScan(SITE_A, space.id, TECH_A);
    let r = await call('POST', `/api/scan/${first}/identity/confirm`, { user: TECH_A, body: { netboxRackId: 950 } });
    assert.equal(r.status, 200);
    assert.equal(r.json.bound.knownRackId, twin.id); // same facility id: the same rack
    assert.equal(r.json.bound.netboxRackId, 950);
    assert.equal(r.json.rackKey, rackMatch.rackKeyFor(SITE_A, twin.id));
    assert.equal(r.json.identity.rack.netboxId, 950);

    const second = mkScan(SITE_A, space.id, TECH_A);
    r = await call('POST', `/api/scan/${second}/identity/confirm`, { user: TECH_A, body: { netboxRackId: 951 } });
    assert.equal(r.status, 200);
    assert.equal(r.json.bound.name, 'C4-R3');
    assert.equal(r.json.bound.facilityId, 'F-4-3');
    assert.equal(estate.getRackByRackId(SITE_A, second).name, 'C4-R3');

    // A rack at another NetBox site, and one that does not exist, are not there.
    const third = mkScan(SITE_A, space.id, TECH_A);
    assert.equal((await call('POST', `/api/scan/${third}/identity/confirm`, { user: TECH_A, body: { netboxRackId: 952 } })).status, 404);
    assert.equal((await call('POST', `/api/scan/${third}/identity/confirm`, { user: TECH_A, body: { netboxRackId: 99999 } })).status, 404);
    assert.equal(rackIdentity.confirmedRack(SITE_A, third), null);
    const failed = auditLog[auditLog.length - 1];
    assert.equal(failed.action, 'rack.identity.confirm');
    assert.equal(failed.status, 'fail');
  } finally {
    netboxNow = null;
  }
  const none = mkScan(SITE_A, space.id, TECH_A);
  assert.equal((await call('POST', `/api/scan/${none}/identity/confirm`, { user: TECH_A, body: { netboxRackId: 950 } })).status, 409);
});
