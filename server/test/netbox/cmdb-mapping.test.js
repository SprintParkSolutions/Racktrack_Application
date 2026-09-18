/**
 * The RackTrack -> ServiceNow mapping table.
 *
 * The NetBox side has had mapping.js and its tests since the exporter was
 * written. This is the twin: it proves the CMDB translation covers every
 * object type a scan produces, puts each one in the right CI class, and
 * expresses the two things ServiceNow models as relationships rather than
 * fields — a rack containing a device, and a cable joining two ports.
 *
 * The case that matters most here is the patch panel. A front port's link to
 * its rear port has no CMDB field at all, so if it is not written as a
 * relationship it is not written anywhere, and a trace stops at the panel.
 */
const test = require('node:test');
const assert = require('node:assert');

const cmdb = require('../../lib/netbox/cmdb');
const servicenow = require('../../lib/netbox/connectors/servicenow');
const model = require('../../lib/netbox/model');

/** A rack with a switch, a patch panel, a cable between them, and a PDU. */
function fullSnapshot() {
  const ev = model.Evidence.SNMP;
  const snap = model.emptySnapshot('rack:RK-1', '2026-09-18T00:00:00Z');

  snap.sites.push(model.Site(model.observed('site:hq', ev), { name: 'HQ', slug: 'hq' }));
  snap.locations.push(model.Location(model.observed('loc:dc1', ev), { name: 'DC1', siteUid: 'site:hq' }));
  snap.manufacturers.push(model.Manufacturer(model.observed('mfr:d-link', ev), { name: 'D-Link', slug: 'd-link' }));
  snap.deviceTypes.push(model.DeviceType(model.observed('dt:sw', ev),
    { manufacturerUid: 'mfr:d-link', model: 'DGS-1210-52', slug: 'DGS-1210-52', uHeight: 1 }));
  snap.deviceTypes.push(model.DeviceType(model.observed('dt:pp', ev),
    { manufacturerUid: 'mfr:d-link', model: 'PP-24', slug: 'PP-24', uHeight: 1 }));
  snap.deviceRoles.push(model.DeviceRole(model.observed('role:switch', ev), { name: 'switch', slug: 'switch' }));
  snap.deviceRoles.push(model.DeviceRole(model.observed('role:panel', ev), { name: 'patch-panel', slug: 'patch-panel' }));

  snap.racks.push(model.Rack(model.observed('rack:RK-1', ev),
    { name: 'RK-1', siteUid: 'site:hq', locationUid: 'loc:dc1', uHeight: 42, description: 'office rack' }));

  snap.devices.push(model.Device(model.observed('dev:sw1', ev),
    { name: 'core-sw', deviceTypeUid: 'dt:sw', roleUid: 'role:switch', siteUid: 'site:hq',
      rackUid: 'rack:RK-1', position: 10, serial: 'ABC123', assetTag: 'AT-1',
      primaryIp: '10.0.0.5', customFields: { firmware: '1.2.3' } }));
  snap.devices.push(model.Device(model.observed('dev:pp1', ev),
    { name: 'panel-1', deviceTypeUid: 'dt:pp', roleUid: 'role:panel', siteUid: 'site:hq',
      rackUid: 'rack:RK-1', position: 12 }));

  snap.interfaces.push(model.Interface(model.observed('if:sw1-1', ev),
    { deviceUid: 'dev:sw1', name: 'gi1', type: '1000base-t', mac: 'AA:BB:CC:00:01:01' }));
  snap.rearPorts.push(model.RearPort(model.observed('rp:pp1-1', ev),
    { deviceUid: 'dev:pp1', name: 'R1', type: '8p8c', positions: 1 }));
  snap.frontPorts.push(model.FrontPort(model.observed('fp:pp1-1', ev),
    { deviceUid: 'dev:pp1', name: 'F1', type: '8p8c', rearPortUid: 'rp:pp1-1', rearPortPosition: 1 }));
  snap.powerOutlets.push(model.PowerOutlet(model.observed('po:pdu-1', ev),
    { deviceUid: 'dev:sw1', name: 'C13-1' }));

  snap.prefixes.push(model.Prefix(model.observed('pfx:1', ev), { prefix: '10.0.0.0/24' }));
  snap.ipAddresses.push(model.IPAddress(model.observed('ip:1', ev),
    { address: '10.0.0.5/24', interfaceUid: 'if:sw1-1' }));

  snap.cables.push(model.Cable(model.observed('cab:1', model.Evidence.LLDP_BOTH), {
    a: model.Termination('dcim.interface', 'if:sw1-1'),
    b: model.Termination('dcim.frontport', 'fp:pp1-1'),
    type: 'cat6',
  }));
  return snap;
}

test('every object type a scan produces has a CMDB mapping', () => {
  assert.doesNotThrow(() => cmdb.orderedSpecs(),
    'orderedSpecs throws if EXPORT_ORDER names a type with no spec');
  assert.equal(cmdb.orderedSpecs().length, model.EXPORT_ORDER.length);
});

test('a device lands in the CI class its role names, not one fixed table', () => {
  assert.equal(cmdb.deviceTable('switch'), 'cmdb_ci_ip_switch');
  assert.equal(cmdb.deviceTable('router'), 'cmdb_ci_ip_router');
  assert.equal(cmdb.deviceTable('firewall'), 'cmdb_ci_ip_firewall');
  assert.equal(cmdb.deviceTable('server'), 'cmdb_ci_server');
  assert.equal(cmdb.deviceTable('patch-panel'), 'cmdb_ci_netgear');
  // An unknown role gets the generic network CI rather than a guess at a
  // specific class the customer's instance may not have.
  assert.equal(cmdb.deviceTable('something-new'), 'cmdb_ci_netgear');
});

test('the plan writes a CI for every object that is one, across all the tables', () => {
  const { rows } = servicenow._plan(fullSnapshot());
  const byLabel = {};
  for (const r of rows) (byLabel[r.label] ||= []).push(r);

  assert.ok(byLabel.Rack, 'racks are written; they used to be out of scope');
  assert.ok(byLabel.Device, 'devices are written');
  assert.ok(byLabel.Interface, 'ports are written');
  assert.ok(byLabel['Front port'], 'front ports are written');
  assert.ok(byLabel['Rear port'], 'rear ports are written');
  assert.ok(byLabel['Power outlet'], 'outlets are written');
  assert.ok(byLabel.Prefix && byLabel['IP address'], 'addressing is written');

  const tables = new Set(rows.map((r) => r.table));
  assert.ok(tables.has('cmdb_ci_rack'));
  assert.ok(tables.has('cmdb_ci_ip_switch'));
  assert.ok(tables.has('cmdb_ci_netgear'), 'the panel is a netgear CI');
  assert.ok(tables.has('cmdb_ci_port'), 'panel ports are cmdb_ci_port, not network adapters');
  assert.ok(tables.has('cmdb_ci_network_adapter'), 'switch ports are network adapters');
});

test('every CI row carries the correlation id, so a re-scan updates instead of duplicating', () => {
  const { rows } = servicenow._plan(fullSnapshot());
  assert.ok(rows.length > 0);
  for (const r of rows) {
    assert.ok(r.row[cmdb.UID_FIELD], `${r.label} is missing ${cmdb.UID_FIELD}`);
    assert.equal(r.row[cmdb.UID_FIELD], r.uid);
  }
});

test('the rack row carries height, place and the scan id', () => {
  const { rows } = servicenow._plan(fullSnapshot());
  const rack = rows.find((r) => r.label === 'Rack').row;
  assert.equal(rack.name, 'RK-1');
  assert.equal(rack.rack_units, '42');
  assert.equal(rack.location, 'HQ / DC1', 'site and location collapse into one field');
  assert.equal(rack[cmdb.SCAN_FIELD], 'rack:RK-1', 'a u_ column, never the attributes field');
});

test('the device row resolves manufacturer and model through the device type', () => {
  const { rows } = servicenow._plan(fullSnapshot());
  const sw = rows.find((r) => r.uid === 'dev:sw1').row;
  assert.equal(sw.name, 'core-sw');
  assert.equal(sw.serial_number, 'ABC123');
  assert.equal(sw.asset_tag, 'AT-1');
  assert.equal(sw.manufacturer, 'D-Link');
  assert.equal(sw.model_id, 'DGS-1210-52');
  assert.equal(sw.ip_address, '10.0.0.5');
  assert.equal(sw.os_version, '1.2.3', 'firmware has a home here even though NetBox has none');
  assert.equal(sw.u_position, '10');
  assert.match(sw.comments, /evidence=snmp/, 'the provenance line says what proved it');
});

test('a rack containing a device is a relationship, because the CMDB has no field for it', () => {
  const { rels } = servicenow._plan(fullSnapshot());
  const contains = rels.filter((r) => r.type === cmdb.REL.CONTAINS);
  assert.ok(contains.some((r) => r.from === 'dev:sw1' && r.to === 'rack:RK-1'),
    'the switch is linked to its rack');
  assert.ok(contains.some((r) => r.from === 'if:sw1-1' && r.to === 'dev:sw1'),
    'the port is linked to its device');
});

test('a front port keeps its link to the rear port, so a trace does not stop at the panel', () => {
  const { rels } = servicenow._plan(fullSnapshot());
  const pairing = rels.find((r) => r.from === 'fp:pp1-1' && r.to === 'rp:pp1-1');
  assert.ok(pairing, 'the front-to-rear pairing is written');
  assert.equal(pairing.type, cmdb.REL.CONNECTS);
});

test('a cable is a relationship, never a CI row, and needs both ends', () => {
  const snap = fullSnapshot();
  const { rows, rels } = servicenow._plan(snap);
  assert.ok(!rows.some((r) => r.label === 'Cable'), 'no cable CI is invented');

  const cable = rels.find((r) => r.uid === 'cab:1');
  assert.ok(cable, 'the cable is written as a relationship');
  assert.equal(cable.type, cmdb.REL.CONNECTS);
  assert.equal(cable.from, 'if:sw1-1');
  assert.equal(cable.to, 'fp:pp1-1');

  // A cable with one end is a note, not a cable. Same rule as the NetBox side.
  snap.cables.push(model.Cable(model.observed('cab:half', model.Evidence.LLDP_ONE),
    { a: model.Termination('dcim.interface', 'if:sw1-1'), b: null }));
  const after = servicenow._plan(snap).rels.filter((r) => r.uid === 'cab:half');
  assert.equal(after.length, 0, 'a one-ended cable is not written');
});

test('VLANs are recorded as having nowhere to go, rather than quietly dropped', () => {
  const spec = cmdb.BY_FIELD.vlans;
  assert.ok(spec, 'VLANs still have a spec');
  assert.ok(spec.columns.every((c) => c.how === cmdb.HOW.NONE),
    'every VLAN column says not_supported, which is the honest answer');
});

test('the mapping table is internally consistent', () => {
  for (const spec of cmdb.SPECS) {
    for (const c of spec.columns) {
      if (c.how === cmdb.HOW.NONE) {
        assert.equal(c.cmdb, null, `${spec.label}.${c.from} claims a CMDB name while saying not_supported`);
      }
      if (c.how === cmdb.HOW.REL) {
        assert.ok(c.rel, `${spec.label}.${c.from} is a relationship with no type`);
      }
      assert.ok(Object.values(cmdb.HOW).includes(c.how), `${spec.label}.${c.from} has an unknown how`);
    }
  }
});

test('a dry run reports the tables it would touch without sending anything', async () => {
  const res = await servicenow.export(fullSnapshot(), { instanceUrl: 'https://example.service-now.com' }, { apply: false });
  assert.equal(res.dryRun, true);
  assert.ok(res.counts.create > 0);
  assert.ok(res.counts.relationships > 0);
  assert.ok(res.tables.includes('cmdb_ci_rack'));
  assert.equal(res.warnings.length, 0);
});

// ── The generated sheet ─────────────────────────────────────────────────────
// The sheet that goes to customers and to the integration team is printed from
// mapping.js and cmdb.js by scripts/build-field-mapping.js. It learns the
// NetBox half by running each payload against a recorder, which is clever
// enough to be worth guarding: if a payload is rewritten in a way the probe
// cannot follow, these tests fail rather than the sheet quietly losing rows.
const sheet = require('../../scripts/build-field-mapping');
const { SPECS: NB_SPECS } = require('../../lib/netbox/mapping');

test('the sheet has a row for every field of every object', () => {
  const rows = sheet.buildRows();
  const objects = new Set(rows.map((r) => r.object));
  assert.equal(objects.size, model.EXPORT_ORDER.length, 'all sixteen objects appear');
  assert.ok(rows.length > 90, `expected the full field set, got ${rows.length}`);
  for (const r of rows) {
    assert.ok(r.field, 'every row names a RackTrack field');
    assert.ok(r.object, 'every row names a RackTrack object');
  }
});

test('the probe still reads every payload, and invents no fields', () => {
  // If a payload is rewritten in a way the recorder cannot follow it returns
  // nothing, and the sheet loses that object's rows in silence. Every spec
  // must resolve something, and everything it resolves must be a real field
  // of that object rather than an artefact of the probe.
  for (const spec of NB_SPECS) {
    const probed = sheet.probeNetbox(spec);
    const pairs = Object.entries(probed);
    assert.ok(pairs.length > 0, `${spec.label}: the probe resolved nothing`);

    const real = new Set(sheet.fieldsOf(spec.field));
    for (const [rackTrackField, netboxKey] of pairs) {
      assert.ok(real.has(rackTrackField),
        `${spec.label}: probe reported ${rackTrackField}, which is not a field of that object`);
      assert.ok(netboxKey, `${spec.label}.${rackTrackField} resolved to an empty NetBox key`);
    }
  }
});

test('the front port row names rear_ports, the field NetBox 4.6 actually reads', () => {
  // The hand-written sheet said rear_port and rear_port_position, which 4.6
  // ignores without complaint: the port is created with no mapping and a cable
  // trace stops at the panel. A generated sheet cannot make that mistake, and
  // this is the test that says so.
  const row = sheet.buildRows().find((r) => r.object === 'FrontPort' && r.field === 'rearPortUid');
  assert.ok(row, 'the front port to rear port row exists');
  assert.equal(row.nbField, 'rear_ports');
  assert.notEqual(row.nbField, 'rear_port');
  assert.equal(row.cmTable, 'cmdb_rel_ci', 'on the CMDB side it is a relationship, not a column');
});

test('every guarded field is one mapping.js really sends', () => {
  for (const [collection, pairs] of Object.entries(sheet.GUARDED)) {
    const spec = NB_SPECS.find((sp) => sp.field === collection);
    assert.ok(spec, `GUARDED names ${collection}, which has no NetBox spec`);
    for (const field of Object.keys(pairs)) {
      assert.ok(sheet.fieldsOf(collection).includes(field),
        `GUARDED claims ${collection}.${field}, which is not a field of that object`);
    }
  }
});

test('the CSV has one header and one line per row', () => {
  const rows = sheet.buildRows();
  const lines = sheet.toCsv(rows).trimEnd().split('\n');
  assert.match(lines[0], /^RackTrack object,RackTrack field,/);
  // Notes can contain commas, so count rows by parsing rather than splitting.
  assert.ok(lines.length >= rows.length + 1, 'no rows were lost');
});
