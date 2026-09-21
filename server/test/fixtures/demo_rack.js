/**
 * The owner's demo rack, for the tests that walk it: SP-HYB-RM01-R01-R1 is
 * rack 26 in the customer's NetBox, and the record SP-R1-U20-ACT (device 199)
 * is held on U22 while the photograph shows that box on U20.
 *
 * The box on U20 is a camera "Router" - a Switch with eight ports - so it
 * brings eight camera-counted ports with it, and the customer's record has
 * five ports of its own. That is on purpose: a fixture whose box has no ports
 * hides the very thing that must never happen, which is a port the camera
 * counted being made on the customer's record.
 *
 * Nothing here reaches a network. Require it after RT_DATA_DIR is set.
 */
const RACK_KEY = 't32:16';
const RACK_UID = `rack:${RACK_KEY}`;
const U20 = `dev:${RACK_KEY}:u20`;
const RECORD_ID = 199;
const RACK_ID = 26;
const DEVICES = '/api/dcim/devices/';
const INTERFACES = '/api/dcim/interfaces/';

/** A NetBox in memory. `calls` is every request, `writes()` every one that was not a read. */
function fakeNetBox() {
  const { NetBox, UID_FIELD, BOUND_FIELD } = require('../../lib/netbox/netbox');
  const store = new Map();
  const calls = [];
  let nextId = 1000;
  const rows = (p) => { if (!store.has(p)) store.set(p, []); return store.get(p); };
  // An instance RackTrack has written to before: both of its fields are there
  // and cover every type, so a write makes no change to the schema.
  rows('/api/extras/custom-fields/').push(
    { id: 1, name: UID_FIELD, object_types: require('../../lib/netbox/mapping').objectTypes(), filter_logic: 'exact' },
    { id: 2, name: BOUND_FIELD, object_types: ['dcim.device', 'dcim.rack'], filter_logic: 'exact' });

  const request = async (method, path, body = null, params = null) => {
    calls.push({ method, path, body, params });
    if (method === 'GET') {
      const q = params || {};
      const cf = Object.keys(q).find((k) => k.startsWith(`cf_${UID_FIELD}`));
      const list = rows(path).filter((o) => {
        if (cf) {
          const held = String((o.custom_fields || {})[UID_FIELD] || '');
          return cf.endsWith('__ic') ? held.toLowerCase().includes(String(q[cf]).toLowerCase()) : held === q[cf];
        }
        if (q.id !== undefined && Number(o.id) !== Number(q.id)) return false;
        if (q.rack_id !== undefined && Number((o.rack || {}).id ?? o.rack) !== Number(q.rack_id)) return false;
        if (q.device_id !== undefined && Number((o.device || {}).id ?? o.device) !== Number(q.device_id)) return false;
        if (q.name !== undefined && o.name !== q.name) return false;
        if (q.slug !== undefined && o.slug !== q.slug) return false;
        if (q.model !== undefined && o.model !== q.model) return false;
        return true;
      });
      return { results: list, next: null };
    }
    if (method === 'POST') { const o = { id: nextId++, ...body }; rows(path).push(o); return o; }
    if (method === 'PATCH') {
      const m = path.match(/^(.*\/)(\d+)\/$/);
      const o = rows(m[1]).find((x) => x.id === Number(m[2]));
      const { custom_fields: cf, ...rest } = body;
      // NetBox hands a choice back nested, whatever was sent.
      if (typeof rest.status === 'string') rest.status = { value: rest.status };
      Object.assign(o, rest);
      if (cf) o.custom_fields = { ...(o.custom_fields || {}), ...cf };
      return o;
    }
    throw new Error(`unexpected ${method}`);
  };

  /** A client on this NetBox. Each one has a memory of its own, as each phase of a write should. */
  const client = () => {
    const nb = new NetBox('http://fake.invalid', 'nbt_test');
    nb.request = request;
    return nb;
  };
  return {
    client, rows, calls,
    writes: (from = 0) => calls.slice(from).filter((c) => c.method !== 'GET'),
    record: (id = RECORD_ID) => rows(DEVICES).find((d) => d.id === id),
  };
}

/** The customer's rack as it stands before the demo: 199 on U22, U20 empty, nothing of ours on the record. */
function seedDemoRack(nb, { position = 22, role = { id: 9, name: 'Router', slug: 'router' } } = {}) {
  const { UID_FIELD, BOUND_FIELD } = require('../../lib/netbox/netbox');
  nb.rows('/api/dcim/sites/').push({ id: 7, name: 'Office-Sprintpark', slug: 'office-sprintpark',
    custom_fields: { [UID_FIELD]: 'site:office-sprintpark' } });
  nb.rows('/api/dcim/racks/').push({ id: RACK_ID, name: 'RACK-1', facility_id: 'SP-HYB-RM01-R01-R1',
    site: { id: 7 }, u_height: 24,
    custom_fields: { [UID_FIELD]: RACK_UID, [BOUND_FIELD]: 'bound by a person' } });
  nb.rows(DEVICES).push({ id: RECORD_ID, name: 'SP-R1-U20-ACT', rack: { id: RACK_ID }, site: { id: 7 },
    position, face: { value: 'front' }, status: { value: 'active' }, role,
    device_type: { id: 55, model: 'ISR 4331', manufacturer: { id: 3, name: 'Cisco' }, u_height: 1 },
    tenant: { id: 4 }, serial: '', asset_tag: null, custom_fields: {} });
  for (let n = 1; n <= 5; n += 1) {
    nb.rows(INTERFACES).push({ id: 4000 + n, device: { id: RECORD_ID }, name: `GigabitEthernet0/${n}`,
      type: { value: '1000base-t' }, custom_fields: {} });
  }
  return nb;
}

const port = (x) => ({ box: [x, 10, x + 20, 30], confidence: 0.9, class_name: 'rj45' });
const cameraBox = (cls, ports, units) => ({
  class_name: cls, port_count: ports, units, box: [10, 10, 900, 60], center: [455, 35],
  ports: Array.from({ length: ports }, (_, i) => port(20 + i * 40)),
  console_ports: [], sfp_ports: [], other_ports: [], connected_ports: [],
});

/** The scan: a Router with eight ports on U20, and whatever else a test puts beside it. */
function demoSnapshot({ boxes = [], deviceNetboxIds = {}, shown = null } = {}) {
  const cv = require('../../lib/netbox/cv');
  return cv.toSnapshot({ image: 'rack.jpg', devices: [cameraBox('Switch', 8, ['u20']), ...boxes] }, {
    rackId: 'RK-2F85EE94', rackKey: RACK_KEY, siteName: 'Office-Sprintpark',
    rackName: 'SP-HYB-RM01-R01-R1', uHeight: 24, scannedAt: '2026-09-21T00:00:00Z',
    recordBinding: { rackNetboxId: RACK_ID, deviceNetboxIds, ...(shown ? { shown } : {}), by: 'Aasritha', at: '2026-09-21' },
    recordMatch: { siteId: 7, rackNetboxId: RACK_ID, by: 'facility-id', confidence: 'confirmed', why: 'the rack id matches' },
  });
}

/** The override the wrong_shelf suggestion makes when the SPOC accepts it. */
const MOVE = Object.freeze({
  kind: 'move', itemUid: U20, netboxId: RECORD_ID, recordName: 'SP-R1-U20-ACT',
  fields: { position: { from: 22, to: 20 } }, shown: { name: 'SP-R1-U20-ACT', position: 22, serial: null },
  source: 'suggestion', rule: 'wrong_shelf', createdBy: 'dc007.spoc', createdAt: '2026-09-22T09:00:00Z',
});

module.exports = {
  fakeNetBox, seedDemoRack, demoSnapshot, cameraBox, MOVE,
  RACK_KEY, RACK_UID, RACK_ID, RECORD_ID, U20, DEVICES, INTERFACES,
};
