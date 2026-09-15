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
 *   6. a known rack that is not in NetBox still resolves to its typed name.
 *
 * The estate database is stubbed, so this never opens a real store.
 */
process.env.RACKTRACK_AUTH_DB = ':memory:';

const assert = require('node:assert/strict');
const { test, beforeEach } = require('node:test');

const estate = require('../../lib/estate');
const rackMatch = require('../../lib/netbox/rack_match');

// A NetBox stand-in: answers /api/dcim/racks/ from a canned list, matching the
// same filters the resolver uses (facility_id, then name).
function fakeNetBox(racks) {
  return {
    calls: [],
    async get(path, params) {
      this.calls.push({ path, params });
      let hit = null;
      if (params.facility_id != null) hit = racks.find((r) => r.facility_id === params.facility_id);
      else if (params.name != null) hit = racks.find((r) => r.name === params.name);
      return { results: hit ? [hit] : [] };
    },
  };
}

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
  const r = await rackMatch.resolveRack(nb, { tenantId: 7, rackId: 'RK-ABCD1234', fallbackName: 'RK-ABCD1234' });
  assert.equal(r.name, 'Rack A01');
  assert.equal(r.netboxId, 99);
  assert.equal(r.confidence, 'confirmed');
  assert.equal(r.source, 'facility-id');
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
  const r = await rackMatch.resolveRack(nb, { tenantId: 7, rackId: 'RK-HASH0001', fallbackName: 'RK-HASH0001' });
  assert.equal(r.name, 'Comms Rack 1');
  assert.equal(r.netboxId, 42);
  assert.equal(r.confidence, 'confirmed');
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
