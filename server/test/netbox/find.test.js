/**
 * Finding the customer's own record, and refusing to guess.
 *
 * The owner's sentence is "connect a rack to the database rack exactly the one,
 * I need 100 percent guarantee on that". The guarantee is not that the resolver
 * always answers. It is that it never names the wrong one. So most of what is
 * proved here is refusal:
 *
 *   1. a rack is found by the customer's own rack id, inside its site;
 *   2. the same rack id at two sites never reaches across: unscoped, nothing is
 *      looked up at all, and inside one site two answers refuse and name both;
 *   3. a device is found by its serial, however either side spelled it;
 *   4. a device is found by rack and shelf when there is no serial;
 *   5. two devices answering is a refusal that names both, never the first row;
 *   6. an object carrying somebody else's RackTrack id is never handed back;
 *   7. a name finds the record and is never an identity: it comes back as
 *      'possible', which identity.writable refuses to write;
 *   8. a CATALOGUE object - a site, a maker, a model - is found by the name
 *      NetBox itself keeps unique, whatever its slug, whatever the case, and
 *      whatever spaces are around it; inside the scope the name is unique in;
 *      two of a name refuses and names both; and nothing is ever written.
 */
const test = require('node:test');
const assert = require('node:assert');

const find = require('../../lib/netbox/find');
const identity = require('../../lib/netbox/identity');
const { NetBox, UID_FIELD } = require('../../lib/netbox/netbox');

/**
 * A NetBox that filters the way the real one does on the handful of fields this
 * resolver asks about, and honours `limit` so "ask for two" means something.
 *
 * `loose` makes one filter answer with more rows than it should, which is what
 * NetBox's own text filters do. The resolver has to verify every row it gets
 * back rather than trust the query, and that is what it proves.
 */
function fakeNetBox(rows = {}, { loose = false } = {}) {
  const nb = new NetBox('http://fake.invalid', 'nbt_test');
  const asked = [];
  nb.asked = asked;
  nb.rows = rows;
  const id = (v) => (v && typeof v === 'object' ? v.id : v);
  const same = (a, b) => String(a ?? '').toLowerCase() === String(b ?? '').toLowerCase();

  nb.request = async (method, path, body = null, params = null) => {
    assert.equal(method, 'GET', 'the resolver only ever reads');
    assert.equal(body, null, 'and it sends nothing');
    asked.push({ path, params });
    const p = params || {};
    let list = (rows[path] || []).filter((r) => {
      if (p.site_id !== undefined && Number(id(r.site)) !== Number(p.site_id)) return false;
      if (p.rack_id !== undefined && Number(id(r.rack)) !== Number(p.rack_id)) return false;
      if (p.id !== undefined && Number(r.id) !== Number(p.id)) return false;
      if (p.facility_id !== undefined && !same(r.facility_id, p.facility_id)) return false;
      if (p.asset_tag !== undefined && !same(r.asset_tag, p.asset_tag)) return false;
      if (p.position !== undefined && Number(r.position) !== Number(p.position)) return false;
      if (p.face !== undefined && !same((r.face || {}).value ?? r.face, p.face)) return false;
      if (p.name !== undefined && !same(r.name, p.name)) return false;
      // NetBox's case-insensitive lookups: __ie exact, __ic contains.
      for (const f of ['name', 'slug', 'model']) {
        if (p[`${f}__ie`] !== undefined && !same(r[f], p[`${f}__ie`])) return false;
        if (p[`${f}__ic`] !== undefined
          && !String(r[f] ?? '').toLowerCase().includes(String(p[`${f}__ic`]).toLowerCase())) return false;
      }
      if (p.manufacturer_id !== undefined
        && Number(id(r.manufacturer)) !== Number(p.manufacturer_id)) return false;
      if (p.serial !== undefined) {
        // Loose is the real NetBox behaviour this resolver has to survive: a
        // filter that answers with anything holding the text.
        const hit = loose
          ? String(r.serial ?? '').toLowerCase().includes(String(p.serial).toLowerCase())
          : same(r.serial, p.serial);
        if (!hit) return false;
      }
      return true;
    });
    if (p.limit !== undefined) list = list.slice(0, Number(p.limit));
    return { results: list, next: null };
  };
  return nb;
}

const rack = (id, name, siteId, facility, uid = null) => ({
  id, name, facility_id: facility, site: { id: siteId },
  custom_fields: uid ? { [UID_FIELD]: uid } : {},
});

const device = (id, name, o = {}) => ({
  id, name,
  site: o.siteId ? { id: o.siteId } : null,
  rack: o.rackId ? { id: o.rackId } : null,
  position: o.position ?? null,
  serial: o.serial ?? '',
  asset_tag: o.assetTag ?? null,
  face: o.face ? { value: o.face } : null,
  custom_fields: o.uid ? { [UID_FIELD]: o.uid } : {},
});

// ── the rack ────────────────────────────────────────────────────────────────

test('a rack is found by the customer\'s own rack id, inside its site', async () => {
  const nb = fakeNetBox({ [find.RACKS]: [rack(7, 'Row 1 Rack 4', 2, 'DC1-R04')] });
  const out = await find.findRack(nb, { siteId: 2, facilityId: 'DC1-R04', name: 'Anything Else' });
  assert.equal(out.id, 7);
  assert.equal(out.by, 'facility-id');
  assert.equal(out.rank, identity.EVIDENCE_RANK.modelled);
  assert.match(out.why, /DC1-R04/);
  assert.ok(nb.asked.every((a) => a.params.site_id === 2), 'every question named the site');
});

test('the same rack id at two sites: the site decides, and it is never the first row', async () => {
  const nb = fakeNetBox({
    [find.RACKS]: [rack(1, 'Rack 1', 1, 'R04'), rack(2, 'Rack 1', 2, 'R04')],
  });
  assert.equal((await find.findRack(nb, { siteId: 1, facilityId: 'R04' })).id, 1);
  assert.equal((await find.findRack(nb, { siteId: 2, facilityId: 'R04' })).id, 2);
});

test('with no site nothing is looked up at all, and the refusal says what would settle it', async () => {
  const nb = fakeNetBox({
    [find.RACKS]: [rack(1, 'Rack 1', 1, 'R04'), rack(2, 'Rack 1', 2, 'R04')],
  });
  const out = await find.findRack(nb, { facilityId: 'R04', name: 'Rack 1' });
  assert.equal(out.none, true);
  assert.match(out.why, /site/i);
  assert.equal(nb.asked.length, 0, 'it did not reach across the whole record to look');
});

test('two racks answering one rack id inside one site are refused, and both are named', async () => {
  const nb = fakeNetBox({
    [find.RACKS]: [rack(11, 'Rack A', 3, 'R09'), rack(12, 'Rack B', 3, 'R09')],
  });
  const out = await find.findRack(nb, { siteId: 3, facilityId: 'R09' });
  assert.ok(Array.isArray(out.ambiguous), 'it refuses rather than choosing');
  assert.deepEqual(out.ambiguous.map((r) => r.id).sort(), [11, 12]);
  assert.match(out.why, /Rack A/);
  assert.match(out.why, /Rack B/);
});

test('a rack found by name is never an identity: possible, and never written', async () => {
  const nb = fakeNetBox({ [find.RACKS]: [rack(4, 'Rack 1', 5, '')] });
  const out = await find.findRack(nb, { siteId: 5, name: 'Rack 1' });
  assert.equal(out.id, 4);
  assert.equal(out.by, 'name');
  assert.equal(out.confidence, 'possible');
  assert.equal(identity.writable(out.confidence), false, 'a name never writes');
});

test('a rack already carrying another RackTrack id is never handed back', async () => {
  const nb = fakeNetBox({ [find.RACKS]: [rack(8, 'Rack 1', 1, 'R01', 'rack:t9:77')] });
  const out = await find.findRack(nb, { siteId: 1, facilityId: 'R01', uid: 'rack:t7:5' });
  assert.equal(out.none, true);
  assert.match(out.why, /rack:t9:77/);
});

test('a rack with nothing to look it up by is refused, not guessed', async () => {
  const nb = fakeNetBox({ [find.RACKS]: [rack(1, 'Rack 1', 1, 'R01')] });
  const out = await find.findRack(nb, { siteId: 1 });
  assert.equal(out.none, true);
  assert.equal(nb.asked.length, 0);
});

// ── the device ──────────────────────────────────────────────────────────────

test('a device is found by its serial, however either side spelled it', async () => {
  const nb = fakeNetBox({
    [find.DEVICES]: [device(21, 'core-sw-01', { siteId: 1, rackId: 7, serial: 'FDO2117A0X9' })],
  });
  const out = await find.findDevice(nb, { siteId: 1, rackId: 7, serial: 'FDO-2117-A0X9' });
  assert.equal(out.id, 21);
  assert.equal(out.by, 'serial');
  assert.equal(out.rank, identity.EVIDENCE_RANK.modelled);
});

test('a loose serial filter does not turn a near miss into a match', async () => {
  // NetBox answers with everything holding the text, so 'A0X9' brings back
  // 'FDO2117A0X90' as well. Only the row whose serial really is the one asked
  // for counts.
  const nb = fakeNetBox({
    [find.DEVICES]: [
      device(21, 'core-sw-01', { siteId: 1, serial: 'FDO2117A0X9' }),
      device(22, 'core-sw-02', { siteId: 1, serial: 'FDO2117A0X90' }),
    ],
  }, { loose: true });
  const out = await find.findDevice(nb, { siteId: 1, serial: 'FDO2117A0X9' });
  assert.equal(out.id, 21, 'the longer serial is a different device');
});

test('two devices with one serial are refused, and both are named', async () => {
  const nb = fakeNetBox({
    [find.DEVICES]: [
      device(31, 'sw-a', { siteId: 1, serial: 'ABC123' }),
      device(32, 'sw-b', { siteId: 1, serial: 'ABC123' }),
    ],
  });
  const out = await find.findDevice(nb, { siteId: 1, serial: 'ABC123' });
  assert.ok(Array.isArray(out.ambiguous));
  assert.deepEqual(out.ambiguous.map((r) => r.id).sort(), [31, 32]);
  assert.match(out.why, /sw-a/);
  assert.match(out.why, /sw-b/);
});

test('a serial that identifies nothing is not looked up at all', async () => {
  const nb = fakeNetBox({
    [find.DEVICES]: [device(41, 'sw-a', { siteId: 1, rackId: 7, position: 10, serial: 'N/A' })],
  });
  const out = await find.findDevice(nb, { siteId: 1, rackId: 7, position: 10, serial: 'N/A' });
  // It fell through to the shelf, which is the honest answer, and the serial
  // was never sent.
  assert.equal(out.id, 41);
  assert.equal(out.by, 'rack-position');
  assert.ok(nb.asked.every((a) => a.params.serial === undefined), 'a junk serial is never asked about');
});

test('a device is found by rack and shelf when there is no serial', async () => {
  const nb = fakeNetBox({
    [find.DEVICES]: [
      device(51, 'edge-01', { siteId: 1, rackId: 7, position: 18, face: 'front' }),
      device(52, 'edge-02', { siteId: 1, rackId: 7, position: 20, face: 'front' }),
    ],
  });
  const out = await find.findDevice(nb, { siteId: 1, rackId: 7, position: 18, face: 'front' });
  assert.equal(out.id, 51);
  assert.equal(out.by, 'rack-position');
  assert.match(out.why, /U18/);
});

test('an asset tag beats a shelf, and a shelf beats a name', async () => {
  const nb = fakeNetBox({
    [find.DEVICES]: [
      device(61, 'right-one', { siteId: 1, rackId: 7, position: 5, assetTag: 'AT-900' }),
      device(62, 'wrong-one', { siteId: 1, rackId: 7, position: 9 }),
    ],
  });
  const byTag = await find.findDevice(nb, {
    siteId: 1, rackId: 7, position: 9, assetTag: 'AT-900', name: 'wrong-one',
  });
  assert.equal(byTag.id, 61);
  assert.equal(byTag.by, 'asset-tag');

  const byShelf = await find.findDevice(nb, { siteId: 1, rackId: 7, position: 9, name: 'right-one' });
  assert.equal(byShelf.id, 62);
  assert.equal(byShelf.by, 'rack-position');
});

test('a device found by name alone is possible and never written', async () => {
  const nb = fakeNetBox({
    [find.DEVICES]: [device(71, 'lon-r12-a01', { siteId: 4, rackId: 3 })],
  });
  const out = await find.findDevice(nb, { siteId: 4, rackId: 3, name: 'lon-r12-a01' });
  assert.equal(out.id, 71);
  assert.equal(out.by, 'name');
  assert.equal(out.confidence, 'possible');
  assert.equal(identity.writable(out.confidence), false);
});

test('a name with no rack and no site is never looked up across the whole record', async () => {
  const nb = fakeNetBox({ [find.DEVICES]: [device(81, 'sw1', { siteId: 1, rackId: 2 })] });
  const out = await find.findDevice(nb, { name: 'sw1' });
  assert.equal(out.none, true);
  assert.equal(nb.asked.length, 0);
  assert.match(out.why, /nothing in the record matches this box/i);
});

test('a device carrying another RackTrack id is never handed back, and no weaker clue overrules it', async () => {
  const nb = fakeNetBox({
    [find.DEVICES]: [
      device(91, 'theirs', { siteId: 1, rackId: 7, position: 12, serial: 'SN-1', uid: 'dev:t9:77:u12' }),
      device(92, 'mine', { siteId: 1, rackId: 7, position: 12 }),
    ],
  });
  const out = await find.findDevice(nb, {
    siteId: 1, rackId: 7, position: 12, serial: 'SN-1', uid: 'dev:t7:5:u12',
  });
  assert.equal(out.none, true);
  assert.match(out.why, /dev:t9:77:u12/);
  assert.ok(!out.id, 'the shelf did not go on to name the other box instead');
});

test('a record that cannot be reached claims nothing, and does not read as empty', async () => {
  const nb = fakeNetBox({ [find.DEVICES]: [] });
  nb.request = async () => { throw new Error('unreachable'); };
  const out = await find.findDevice(nb, { siteId: 1, serial: 'SN-1' });
  assert.equal(out.none, true);
  assert.equal(out.blocked, true, 'not knowing is not the same as nothing being there');
});

// ── an object a person already named ────────────────────────────────────────

test('an object a person named is checked before it is used', async () => {
  const nb = fakeNetBox({ [find.RACKS]: [rack(7, 'Row 1 Rack 4', 2, 'DC1-R04')] });
  const out = await find.byId(nb, find.RACKS, 7, { uid: 'rack:t7:5' });
  assert.equal(out.id, 7);
  assert.equal(out.by, 'record-binding');
  assert.equal(out.rank, identity.EVIDENCE_RANK.confirmed, 'a person is rank 1');
});

test('a named object that carries somebody else\'s id is refused', async () => {
  const nb = fakeNetBox({ [find.RACKS]: [rack(7, 'Row 1 Rack 4', 2, 'DC1-R04', 'rack:t9:1')] });
  const out = await find.byId(nb, find.RACKS, 7, { uid: 'rack:t7:5' });
  assert.equal(out.none, true);
  assert.match(out.why, /rack:t9:1/);
});

test('a named object that has gone is refused rather than created around', async () => {
  const nb = fakeNetBox({ [find.RACKS]: [] });
  const out = await find.byId(nb, find.RACKS, 7, { uid: 'rack:t7:5' });
  assert.equal(out.none, true);
  assert.match(out.why, /nothing at id 7/);
});

// ── a rack has no shelf ─────────────────────────────────────────────────────
//
// A record binding keeps what the person was reading, and the check refuses the
// binding when the live row no longer matches it. A rack's own row has no
// position: it is not mounted in anything. The stored answer kept a zero for it
// and the live row gave null, so confirming "this is our RACK-1" was refused
// with "the shelf was 0 and is now null" - on the customer's real rack, in the
// one step the whole compare waits for.
test('a shelf of zero is not a shelf, so it never contradicts the record', () => {
  const { disagreements } = require('../../lib/netbox/find');
  assert.deepEqual(disagreements({ id: 26, name: 'RACK-1' }, { name: 'RACK-1', position: 0 }), []);
});

test('a real shelf that moved is still caught', () => {
  const { disagreements } = require('../../lib/netbox/find');
  const moved = disagreements({ id: 5, name: 'SW01', position: 18 }, { name: 'SW01', position: 13 });
  assert.equal(moved.length, 1);
  assert.match(moved[0], /the shelf was 13 and is now 18/);
});


// ── the catalogue ───────────────────────────────────────────────────────────
//
// The write of 21 September: the scan's id for the site was on nothing, the slug
// RackTrack mints from the site's name was not the customer's slug, so the site
// read as a create and NetBox refused it - and an approved shelf move wrote
// nothing at all. A catalogue object is asked for by its name now.
const SITES = '/api/dcim/sites/';

test('a site is found by its name however different its slug is', async () => {
  const nb = fakeNetBox({ [SITES]: [
    { id: 7, name: 'Office-Sprintpark', slug: 'office-sprint', custom_fields: {} },
  ] });
  const hit = await find.byName(nb, SITES, { name: 'Office-Sprintpark', what: 'site' });
  assert.equal(hit.id, 7);
  assert.equal(hit.by, 'unique-name');
  assert.ok(identity.writable(hit.confidence), 'the name NetBox keeps unique IS the key here');
  assert.match(hit.why, /Office-Sprintpark \(id 7\)/);
});

test('the case and the spaces around a name do not matter', async () => {
  const nb = fakeNetBox({ [SITES]: [
    { id: 7, name: '  office-SPRINTPARK ', slug: 'office-sprint', custom_fields: {} },
  ] });
  assert.equal((await find.byName(nb, SITES, { name: 'Office-Sprintpark' })).id, 7);
  assert.equal((await find.byName(nb, SITES, { name: ' Office-Sprintpark  ' })).id, 7);
});

test('a name that is only part of another name is not that object', async () => {
  const nb = fakeNetBox({ [SITES]: [
    { id: 7, name: 'Office-Sprintpark North', slug: 'ospn', custom_fields: {} },
  ] });
  const out = await find.byName(nb, SITES, { name: 'Office-Sprintpark', what: 'site' });
  assert.ok(out.none, 'a contains filter answers it, and the verification throws it out');
  assert.match(out.why, /nothing in the record has the name Office-Sprintpark/);
});

test('two of one name refuses and names both', async () => {
  const nb = fakeNetBox({ [SITES]: [
    { id: 7, name: 'Office-Sprintpark', slug: 'a', custom_fields: {} },
    { id: 8, name: 'office-sprintpark', slug: 'b', custom_fields: {} },
  ] });
  const out = await find.byName(nb, SITES, { name: 'Office-Sprintpark', what: 'site' });
  assert.deepEqual(out.ambiguous.map((r) => r.id), [7, 8]);
  assert.match(out.why, /none of them is claimed/);
});

test('a model is asked for inside its maker and never across the estate', async () => {
  const TYPES = '/api/dcim/device-types/';
  const nb = fakeNetBox({ [TYPES]: [
    { id: 90, model: 'DGS-1210', slug: 'dgs-1210', manufacturer: { id: 3 }, custom_fields: {} },
    { id: 91, model: 'DGS-1210', slug: 'dgs-1210-x', manufacturer: { id: 4 }, custom_fields: {} },
  ] });
  const hit = await find.byName(nb, TYPES, { name: 'DGS-1210', field: 'model',
    scope: { manufacturer_id: 4 }, what: 'model' });
  assert.equal(hit.id, 91, 'one maker\'s model is not another maker\'s');
  assert.equal(nb.asked.every((a) => a.params.manufacturer_id === 4), true, 'the scope is in every question');
});

test('a site another scan put its id on is still the customer\'s one site', async () => {
  const nb = fakeNetBox({ [SITES]: [
    { id: 7, name: 'Office-Sprintpark', slug: 'office-sprint',
      custom_fields: { [UID_FIELD]: 'site:office-sprint' } },
  ] });
  const hit = await find.byName(nb, SITES, { name: 'Office-Sprintpark', uid: 'site:office-sprintpark' });
  assert.equal(hit.id, 7, 'there is one site of that name and NetBox will not hold a second');
  assert.equal(hit.carried, 'site:office-sprint', 'and what it carries is said, not hidden');
});

test('a site that cannot be asked about is not a site that is missing', async () => {
  const nb = fakeNetBox({ [SITES]: [] });
  nb.request = async () => { throw Object.assign(new Error('Forbidden'), { status: 403 }); };
  const out = await find.byName(nb, SITES, { name: 'Office-Sprintpark', what: 'site' });
  assert.ok(out.none && out.blocked, 'nothing is claimed and nothing is called absent');
  assert.match(out.why, /token may have expired/);
});

test('a name nobody stated asks NetBox nothing at all', async () => {
  const nb = fakeNetBox({ [SITES]: [] });
  const out = await find.byName(nb, SITES, { name: '   ', what: 'site' });
  assert.ok(out.none);
  assert.equal(nb.asked.length, 0);
});
