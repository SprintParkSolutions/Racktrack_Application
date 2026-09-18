/**
 * Recognising the rack, phase 1.
 *
 * The rules that matter here:
 *   1. an unbound scan changes nothing — the fallback name is kept;
 *   2. a rack typed directly resolves to itself, and to its NetBox name;
 *   3. a scan learned into a space resolves to the one typed rack in that space;
 *   4. two typed racks and nothing to tell them apart resolves to nobody — it
 *      never guesses;
 *   5. the scan's own chosen name breaks that tie when it matches;
 *   6. a known rack that is not in NetBox still resolves to its typed name;
 *   7. the NetBox lookup is scoped by site: the same rack id at two sites
 *      resolves to the rack at THIS site, two racks answering inside one site
 *      resolve to nobody, and a rack name is never looked up with no site to
 *      look inside - "Rack 1" is at every site there is.
 *
 * The estate database is stubbed, so this never opens a real store.
 */
process.env.RACKTRACK_AUTH_DB = ':memory:';

const assert = require('node:assert/strict');
const { test, beforeEach } = require('node:test');

const estate = require('../../lib/estate');
const rackMatch = require('../../lib/netbox/rack_match');

// A NetBox stand-in: answers /api/dcim/sites/ and /api/dcim/racks/ from canned
// lists, on the filters the resolver uses (the site by name, then the rack by
// facility_id and by name inside it), and honours `limit` so "ask for two"
// means something.
function fakeNetBox(racks, sites = [{ id: 1, name: 'London DC' }]) {
  return {
    calls: [],
    async get(path, params = {}) {
      this.calls.push({ path, params });
      const cap = (rows) => (params.limit === undefined ? rows : rows.slice(0, Number(params.limit)));
      if (path === '/api/dcim/sites/') {
        return { results: cap(sites.filter((s) => params.name === undefined || s.name === params.name)) };
      }
      const at = (r) => (r.site && typeof r.site === 'object' ? r.site.id : r.site);
      return {
        results: cap(racks.filter((r) => {
          if (params.site_id !== undefined && Number(at(r) ?? 1) !== Number(params.site_id)) return false;
          if (params.facility_id !== undefined && r.facility_id !== params.facility_id) return false;
          if (params.name !== undefined && r.name !== params.name) return false;
          return true;
        })),
      };
    },
  };
}

const AT_SITE = { siteName: 'London DC' };

let orig;
beforeEach(() => {
  orig = { get: estate.getRackByRackId, list: estate.listRacks };
});
function restore() { estate.getRackByRackId = orig.get; estate.listRacks = orig.list; }

test('an unbound scan keeps the fallback name and does not resolve', async () => {
  estate.getRackByRackId = () => null;
  estate.listRacks = () => [];
  const r = await rackMatch.resolveRack(fakeNetBox([]), {
    tenantId: 7, rackId: 'RK-ABCD1234', fallbackName: 'RK-ABCD1234',
  });
  assert.equal(r.name, 'RK-ABCD1234');
  assert.equal(r.confidence, 'none');
  restore();
});

test('a rack typed directly resolves to its NetBox name by facility id', async () => {
  estate.getRackByRackId = () => ({ id: 5, rack_id: 'RK-ABCD1234', name: 'A01', facility_id: 'F-A01', space_id: 3 });
  estate.listRacks = () => { throw new Error('should not look across the space'); };
  const nb = fakeNetBox([{ id: 99, name: 'Rack A01', facility_id: 'F-A01' }]);
  const r = await rackMatch.resolveRack(nb, {
    tenantId: 7, rackId: 'RK-ABCD1234', fallbackName: 'RK-ABCD1234', ...AT_SITE,
  });
  assert.equal(r.name, 'Rack A01');
  assert.equal(r.netboxId, 99);
  assert.equal(r.confidence, 'confirmed');
  assert.equal(r.source, 'facility-id');
  restore();
});

test('a rack id is never looked up with no site to look inside either', async () => {
  // The same typed rack as above, and the same NetBox, with one thing missing:
  // nobody has said which site this scan is at. A rack id is unique inside a
  // site and nowhere else, and one NetBox holds every customer's estate, so a
  // single answer across all of it is a coincidence rather than a proof. This
  // used to come back as 'confirmed' by facility-id and bind.
  estate.getRackByRackId = () => ({ id: 5, rack_id: 'RK-ABCD1234', name: 'A01', facility_id: 'F-A01', space_id: 3 });
  estate.listRacks = () => { throw new Error('should not look across the space'); };
  const nb = fakeNetBox([{ id: 99, name: 'Rack A01', facility_id: 'F-A01' }]);
  const r = await rackMatch.resolveRack(nb, {
    tenantId: 7, rackId: 'RK-ABCD1234', fallbackName: 'RK-ABCD1234',
  });
  assert.equal(r.netboxId, null, 'nothing is claimed with no site to claim it inside');
  assert.equal(r.netboxBy, null);
  assert.equal(r.confidence, 'known', 'the typed rack still names the scan');
  assert.equal(r.name, 'A01');
  assert.ok(!nb.calls.some((c) => c.path === '/api/dcim/racks/'),
    'and the whole instance was never asked');
  assert.match(r.netboxWhy, /site/);
  restore();
});

test('a scan learned into a space resolves to the one typed rack there', async () => {
  // The scan's own row is learned: space only, no name.
  estate.getRackByRackId = () => ({ id: 10, rack_id: 'RK-HASH0001', name: null, facility_id: null, space_id: 3 });
  estate.listRacks = () => [
    { id: 10, rack_id: 'RK-HASH0001', name: null, facility_id: null },   // itself, excluded
    { id: 11, rack_id: 'typed-1', name: 'Comms Rack 1', facility_id: null },
  ];
  const nb = fakeNetBox([{ id: 42, name: 'Comms Rack 1', facility_id: null }]);
  const r = await rackMatch.resolveRack(nb, {
    tenantId: 7, rackId: 'RK-HASH0001', fallbackName: 'RK-HASH0001', ...AT_SITE,
  });
  assert.equal(r.name, 'Comms Rack 1');
  assert.equal(r.netboxId, 42);
  assert.equal(r.confidence, 'confirmed');
  assert.equal(r.siteId, 1, 'and it was found inside the site the scan is at');
  assert.equal(r.netboxBy, 'name', 'by its name, which the writer refuses to bind on');
  restore();
});

test('the same rack id at two sites resolves to the rack at THIS site', async () => {
  estate.getRackByRackId = () => ({ id: 5, rack_id: 'RK-1', name: 'Rack 1', facility_id: 'DC1-R04', space_id: null });
  estate.listRacks = () => [];
  const racks = [
    { id: 31, name: 'Rack 1', facility_id: 'DC1-R04', site: { id: 1 } },
    { id: 32, name: 'Rack 1', facility_id: 'DC1-R04', site: { id: 9 } },
  ];
  const sites = [{ id: 1, name: 'London DC' }, { id: 9, name: 'Frankfurt DC' }];
  const london = await rackMatch.resolveRack(fakeNetBox(racks, sites), {
    tenantId: 7, rackId: 'RK-1', fallbackName: 'RK-1', siteName: 'London DC',
  });
  const frankfurt = await rackMatch.resolveRack(fakeNetBox(racks, sites), {
    tenantId: 7, rackId: 'RK-1', fallbackName: 'RK-1', siteName: 'Frankfurt DC',
  });
  assert.equal(london.netboxId, 31, 'the London scan gets the London rack');
  assert.equal(frankfurt.netboxId, 32, 'and the Frankfurt scan gets the Frankfurt one');
  assert.equal(london.netboxBy, 'facility-id');
  restore();
});

test('two racks answering one rack id inside one site resolve to nobody, and both are named', async () => {
  estate.getRackByRackId = () => ({ id: 5, rack_id: 'RK-1', name: null, facility_id: 'DC1-R04', space_id: null });
  estate.listRacks = () => [];
  const nb = fakeNetBox([
    { id: 41, name: 'Rack A', facility_id: 'DC1-R04', site: { id: 1 } },
    { id: 42, name: 'Rack B', facility_id: 'DC1-R04', site: { id: 1 } },
  ]);
  const r = await rackMatch.resolveRack(nb, {
    tenantId: 7, rackId: 'RK-1', fallbackName: 'RK-1', ...AT_SITE,
  });
  assert.equal(r.netboxId, null, 'a tie is never broken by sort order');
  assert.equal(r.confidence, 'none');
  assert.deepEqual((r.candidates || []).map((c) => c.id).sort(), [41, 42]);
  assert.match(r.netboxWhy, /Rack A/);
  assert.match(r.netboxWhy, /Rack B/);
  restore();
});

test('a rack name is never looked up with no site to look inside', async () => {
  estate.getRackByRackId = () => ({ id: 5, rack_id: 'RK-1', name: 'Rack 1', facility_id: null, space_id: null });
  estate.listRacks = () => [];
  const nb = fakeNetBox([{ id: 51, name: 'Rack 1', facility_id: null, site: { id: 9 } }], []);
  const r = await rackMatch.resolveRack(nb, { tenantId: 7, rackId: 'RK-1', fallbackName: 'RK-1' });
  assert.equal(r.netboxId, null, 'the rack at another site is not adopted');
  assert.equal(r.name, 'Rack 1', 'the typed name still stands');
  assert.equal(r.confidence, 'known');
  assert.ok(!nb.calls.some((c) => c.path === '/api/dcim/racks/' && c.params.name !== undefined),
    'no name was asked about across the whole record');
  restore();
});

test('two typed racks and no name resolves to nobody, never a guess', async () => {
  estate.getRackByRackId = () => ({ id: 10, rack_id: 'RK-HASH0001', name: null, facility_id: null, space_id: 3 });
  estate.listRacks = () => [
    { id: 11, rack_id: 'typed-1', name: 'Rack One', facility_id: null },
    { id: 12, rack_id: 'typed-2', name: 'Rack Two', facility_id: null },
  ];
  const r = await rackMatch.resolveRack(fakeNetBox([]), {
    tenantId: 7, rackId: 'RK-HASH0001', fallbackName: 'RK-HASH0001',
  });
  assert.equal(r.name, 'RK-HASH0001');
  assert.equal(r.confidence, 'none');
  restore();
});

test("the scan's own chosen name breaks a tie between two racks", async () => {
  estate.getRackByRackId = () => ({ id: 10, rack_id: 'RK-HASH0001', name: null, facility_id: null, space_id: 3 });
  estate.listRacks = () => [
    { id: 11, rack_id: 'typed-1', name: 'Rack One', facility_id: null },
    { id: 12, rack_id: 'typed-2', name: 'Rack Two', facility_id: null },
  ];
  // Not in NetBox, so it resolves to the typed name at 'known'.
  const r = await rackMatch.resolveRack(fakeNetBox([]), {
    tenantId: 7, rackId: 'RK-HASH0001', scanName: 'rack two', fallbackName: 'RK-HASH0001',
  });
  assert.equal(r.name, 'Rack Two');
  assert.equal(r.confidence, 'known');
  assert.equal(r.source, 'name');
  restore();
});

test('a known rack that is not in NetBox still resolves to its typed name', async () => {
  estate.getRackByRackId = () => ({ id: 10, rack_id: 'RK-HASH0001', name: null, facility_id: null, space_id: 3 });
  estate.listRacks = () => [{ id: 11, rack_id: 'typed-1', name: 'Lonely Rack', facility_id: null }];
  const r = await rackMatch.resolveRack(fakeNetBox([]), {
    tenantId: 7, rackId: 'RK-HASH0001', fallbackName: 'RK-HASH0001',
  });
  assert.equal(r.name, 'Lonely Rack');
  assert.equal(r.confidence, 'known');
  restore();
});

test('no NetBox client: resolves to the typed name without throwing', async () => {
  estate.getRackByRackId = () => ({ id: 10, rack_id: 'RK-HASH0001', name: null, facility_id: null, space_id: 3 });
  estate.listRacks = () => [{ id: 11, rack_id: 'typed-1', name: 'Solo', facility_id: null }];
  const r = await rackMatch.resolveRack(null, {
    tenantId: 7, rackId: 'RK-HASH0001', fallbackName: 'RK-HASH0001',
  });
  assert.equal(r.name, 'Solo');
  assert.equal(r.confidence, 'known');
  restore();
});
