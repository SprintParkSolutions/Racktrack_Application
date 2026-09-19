/**
 * A rack whose units are numbered differently is the same rack with its devices
 * moved - not new devices, and never one device's record handed to another.
 *
 * Found in a dry run on the demo rack, RK-3CD81888, the first time the trained
 * unit model was applied to a rack NetBox already held. A device's uid is built
 * from its U, and the better grid numbers the rack differently, so the plan was:
 *
 *   create dev:u15, u17, u18, u20            four devices that already exist
 *   update dev:u13  name, device_type, role  the Router's record turned into a Switch
 *   update dev:u11  name, device_type, role  a Switch's record turned into a Patch Panel
 *
 * Three things were wrong and all three are held down here:
 *
 *   1. Identity. The same photograph read again draws the same boxes over the
 *      same pixels, so a box keeps the uid it had, whatever U it now reads as.
 *   2. Type. A device type is shared by every rack, and its height belongs to
 *      the type. A panel that now reads as 2U is a different unidentified thing
 *      from a 1U one, not a new height for everybody's panels.
 *   3. Order. NetBox refuses a device into a U another device still holds, one
 *      PATCH at a time, so a renumbered rack cannot be written in any order that
 *      works. Every device that is about to move is taken out of its U first.
 */
const test = require('node:test');
const assert = require('node:assert');

const cv = require('../../lib/netbox/cv');
const writer = require('../../lib/netbox/writer');
const { NetBox, NetBoxError, UID_FIELD } = require('../../lib/netbox/netbox');

const RACK = 'RK-RENUM001';
const DEVICES = '/api/dcim/devices/';
const IFACES = '/api/dcim/interfaces/';

/**
 * A NetBox that behaves like NetBox where it matters here: it refuses to put a
 * device into a U another device in the same rack already holds.
 */
function strictNetBox() {
  const store = new Map();
  const calls = [];
  let nextId = 1;
  const rows = (p) => { if (!store.has(p)) store.set(p, []); return store.get(p); };
  const occupant = (rack, position, selfId) => rows(DEVICES).find((o) => o.id !== selfId
    && o.rack === rack && position !== null && position !== undefined && o.position === position);
  const sameName = (device, name, selfId) => rows(IFACES).find((o) => o.id !== selfId
    && o.device === device && String(o.name) === String(name));
  const refuseName = new Set();
  const nb = new NetBox('http://fake.invalid', 'nbt_test');
  nb.rows = rows;
  nb.calls = calls;
  nb.refuseName = refuseName;
  nb.request = async (method, path, body = null, params = null) => {
    calls.push({ method, path, body });
    if (method === 'GET') {
      const key = params && Object.keys(params).find((k) => k.startsWith(`cf_${UID_FIELD}`));
      const want = key ? params[key] : undefined;
      const list = rows(path).filter((o) => want === undefined
        || String((o.custom_fields || {})[UID_FIELD] || '').toLowerCase().includes(String(want).toLowerCase()));
      return { results: list, next: null };
    }
    if (method === 'POST') {
      if (path === DEVICES && occupant(body.rack, body.position, null)) {
        throw new NetBoxError(400, { position: [`U${body.position} is already occupied.`] }, path);
      }
      if (path === IFACES && sameName(body.device, body.name, null)) {
        throw new NetBoxError(400, { __all__: ['Interface with this Device and Name already exists.'] }, path);
      }
      const o = { id: nextId++, custom_fields: {}, ...body };
      rows(path).push(o);
      return o;
    }
    if (method === 'PATCH') {
      const m = path.match(/^(.*\/)(\d+)\/$/);
      const o = rows(m[1]).find((x) => x.id === Number(m[2]));
      if (m[1] === DEVICES && 'position' in body && occupant(o.rack, body.position, o.id)) {
        throw new NetBoxError(400, { position: [`U${body.position} is already occupied.`] }, path);
      }
      if (m[1] === IFACES && 'name' in body && refuseName.has(String(body.name))) {
        throw new NetBoxError(400, { name: ['NetBox refused this name for another reason.'] }, path);
      }
      if (m[1] === IFACES && 'name' in body && sameName(o.device, body.name, o.id)) {
        throw new NetBoxError(400, { __all__: ['Interface with this Device and Name already exists.'] }, path);
      }
      for (const [k, v] of Object.entries(body)) {
        if (k === 'custom_fields') o.custom_fields = { ...o.custom_fields, ...v };
        else o[k] = v;
      }
      return o;
    }
    throw new Error(`unexpected ${method}`);
  };
  return nb;
}

const device = (cls, units, box, ports = 24) => ({
  class_name: cls, port_count: ports, units, box, center: [0, 0],
  ports: [], console_ports: [], sfp_ports: [], other_ports: [], connected_ports: [],
});

/** The demo rack in miniature: a Switch above a Router, then read with a better grid. */
const BOX_SWITCH = [100, 100, 900, 180];
const BOX_ROUTER = [100, 20, 900, 98];
const firstReading = () => ({ image: 'rack.jpg', devices: [
  device('Switch', ['u12'], BOX_SWITCH), device('Switch', ['u13'], BOX_ROUTER, 6),
] });
// The same photograph, the same boxes, numbered by the trained unit model:
// the Switch now reads as U13 - the Router's old U - and the Router as U20.
const secondReading = () => ({ image: 'rack.jpg', devices: [
  device('Switch', ['u13'], BOX_SWITCH), device('Switch', ['u20'], BOX_ROUTER, 6),
] });

const opts = (previous = null) => ({
  rackId: RACK, siteName: 'Test Site', rackName: RACK, uHeight: 42,
  scannedAt: '2026-09-19T00:00:00Z', previous,
});

const byBox = (snap, box) => snap.devices.find((d) => JSON.stringify(d.provenance.box) === JSON.stringify(box));

test('without the previous reading, a renumbered rack hands the Router its uid to the Switch', () => {
  // This is the bug, stated as a test so it cannot quietly come back: U13 was
  // the Router's, and a fresh reading gives "u13" to whichever box now sits there.
  const before = cv.toSnapshot(firstReading(), opts());
  const after = cv.toSnapshot(secondReading(), opts());
  assert.equal(byBox(before, BOX_ROUTER).uid, `dev:${RACK}:u13`);
  assert.equal(byBox(after, BOX_SWITCH).uid, `dev:${RACK}:u13`, 'the Switch took the Router\'s identity');
});

test('with the previous reading, every box keeps the identity it had', () => {
  const before = cv.toSnapshot(firstReading(), opts());
  const after = cv.toSnapshot(secondReading(), opts(before));
  assert.equal(byBox(after, BOX_SWITCH).uid, byBox(before, BOX_SWITCH).uid);
  assert.equal(byBox(after, BOX_ROUTER).uid, byBox(before, BOX_ROUTER).uid);
  // And only the position moved.
  assert.equal(byBox(after, BOX_SWITCH).position, 13);
  assert.equal(byBox(after, BOX_ROUTER).position, 20);
});

test('its ports keep their uids too, because they are built on the device uid', () => {
  const withPorts = (map) => {
    map.devices[0].ports = [{ box: [110, 120, 130, 140], confidence: 0.9, index: 1 }];
    return map;
  };
  const before = cv.toSnapshot(withPorts(firstReading()), opts());
  const after = cv.toSnapshot(withPorts(secondReading()), opts(before));
  const port = (snap) => snap.interfaces.find((i) => i.deviceUid === byBox(snap, BOX_SWITCH).uid);
  assert.equal(port(after).uid, port(before).uid);
});

test('a box that only grazes an old one is a new device, not an inherited one', () => {
  const before = cv.toSnapshot(firstReading(), opts());
  const moved = { image: 'rack.jpg', devices: [
    device('Switch', ['u5'], [100, 160, 900, 240]),   // overlaps the old Switch by a quarter
  ] };
  const after = cv.toSnapshot(moved, opts(before));
  assert.equal(after.devices[0].uid, `dev:${RACK}:u5`);
});

test('a box is matched to one old device at most, best overlap first', () => {
  const before = cv.toSnapshot(firstReading(), opts());
  // Two new boxes both over the old Switch; only the closer one inherits it.
  const map = { image: 'rack.jpg', devices: [
    device('Switch', ['u2'], [100, 104, 900, 184]),
    device('Switch', ['u3'], [100, 100, 900, 180]),
  ] };
  const after = cv.toSnapshot(map, opts(before));
  const inherited = after.devices.filter((d) => d.uid === byBox(before, BOX_SWITCH).uid);
  assert.equal(inherited.length, 1);
  assert.deepEqual(inherited[0].provenance.box, [100, 100, 900, 180]);
});

test('a panel that reads as 2U is its own type, not a new height for everyone else\'s', () => {
  const one = cv.toSnapshot({ image: 'x', devices: [device('Patch Panel', ['u7'], [0, 0, 9, 9], 48)] }, opts());
  const two = cv.toSnapshot({ image: 'x', devices: [device('Patch Panel', ['u7', 'u8'], [0, 0, 9, 9], 48)] }, opts());
  const t1 = one.deviceTypes[0];
  const t2 = two.deviceTypes[0];
  assert.notEqual(t1.uid, t2.uid, 'two different types');
  assert.equal(t1.uHeight, 1);
  assert.equal(t2.uHeight, 2);
  assert.match(t2.model, /2U/);
  assert.doesNotMatch(t1.model, /1U/, 'a 1U name is left as it always was');
});

test('a renumbered rack is written as moves, with no new devices and no refusals', async () => {
  const nb = strictNetBox();
  const before = cv.toSnapshot(firstReading(), opts());
  const first = await writer.push(before, nb);
  assert.equal(first.counts.fail || 0, 0, 'the first write is clean');
  const countBefore = nb.rows(DEVICES).length;

  const after = cv.toSnapshot(secondReading(), opts(before));
  const out = await writer.push(after, nb);

  const fails = out.changes.filter((c) => c.action === 'fail');
  assert.deepEqual(fails, [], `NetBox refused: ${JSON.stringify(fails.map((f) => f.reason))}`);
  assert.equal(nb.rows(DEVICES).length, countBefore, 'no device was created');
  const where = (box) => nb.rows(DEVICES).find((o) => o.custom_fields[UID_FIELD] === byBox(before, box).uid);
  assert.equal(where(BOX_SWITCH).position, 13, 'the Switch moved into the Router\'s old U');
  assert.equal(where(BOX_ROUTER).position, 20, 'and the Router moved out of the way first');
  assert.ok(out.warnings.some((w) => /taken out of .* U before being placed again/.test(w)),
    'and it says it did so');
});

test('without making room, the same move is refused - which is why the step exists', async () => {
  // Drive the same second write with the make-room step switched off, to prove
  // the strict NetBox really does refuse this order and the step is load bearing.
  const nb = strictNetBox();
  const before = cv.toSnapshot(firstReading(), opts());
  await writer.push(before, nb);
  const switchId = nb.rows(DEVICES).find((o) => o.custom_fields[UID_FIELD] === byBox(before, BOX_SWITCH).uid).id;
  await assert.rejects(nb.patch(DEVICES, switchId, { position: 13 }), /already occupied/);
});

test('an unchanged rack is not touched by the make-room step at all', async () => {
  const nb = strictNetBox();
  const snap = cv.toSnapshot(firstReading(), opts());
  await writer.push(snap, nb);
  const mark = nb.calls.length;
  const again = cv.toSnapshot(firstReading(), opts(snap));
  await writer.push(again, nb);
  const patches = nb.calls.slice(mark).filter((c) => c.method === 'PATCH');
  assert.deepEqual(patches, [], 'nothing was patched');
});

// -- ports renumbered on the same device ---------------------------------

const switchWithPorts = (reads) => ({ image: 'rack.jpg', devices: [{
  class_name: 'Switch', port_count: reads.length, units: ['u12'], box: BOX_SWITCH, center: [0, 0],
  ports: reads.map((read, k) => ({ box: [110 + k * 40, 120, 140 + k * 40, 150], confidence: 0.9, index: read })),
  console_ports: [], sfp_ports: [], other_ports: [], connected_ports: [],
}] });
const namesOf = (nb) => nb.rows(IFACES)
  .sort((a, b) => String(a.custom_fields[UID_FIELD]).localeCompare(String(b.custom_fields[UID_FIELD])))
  .map((o) => String(o.name));

test('a re-read that lists the ports in another order keeps every port on its own record', async () => {
  // Found live: re-reading the demo rack failed 120 port renames in one write.
  // A port's uid was its place in the list, and a second reading lists ports in
  // a different order, so every port looked renamed. On a re-read a port now
  // inherits the record of the old port with the same printed number.
  const nb = strictNetBox();
  const before = cv.toSnapshot(switchWithPorts([1, 2, 3]), opts());
  await writer.push(before, nb);
  const mark = nb.calls.length;
  const after = cv.toSnapshot(switchWithPorts([2, 3, 1]), opts(before));
  const uidOf = (snap, name) => snap.interfaces.find((i) => i.name === name).uid;
  for (const n of ['1', '2', '3']) assert.equal(uidOf(after, n), uidOf(before, n), `port ${n} kept its record`);
  const out = await writer.push(after, nb);
  assert.deepEqual(out.changes.filter((c) => c.action === 'fail'), []);
  assert.deepEqual(nb.calls.slice(mark).filter((c) => c.method !== 'GET'), [], 'nothing needed writing at all');
});

test('a port nobody saw this time keeps its record and its number, and the new ports route round it', async () => {
  // The other half of the live failure: 23 port records the new reading did
  // not see still held numbers the new ports wanted. A port that inherits
  // nothing must not take over one of those records.
  const nb = strictNetBox();
  const before = cv.toSnapshot(switchWithPorts([1, 2, 3, 4]), opts());
  await writer.push(before, nb);
  const after = cv.toSnapshot(switchWithPorts([2, 1, 3]), opts(before));   // port 4 not seen
  const oldUids = new Set(before.interfaces.map((i) => i.uid));
  assert.ok(after.interfaces.every((i) => oldUids.has(i.uid)), 'all three seen ports inherited');
  const out = await writer.push(after, nb);
  assert.deepEqual(out.changes.filter((c) => c.action === 'fail'), []);
  assert.equal(nb.rows(IFACES).length, 4, 'the unseen port is still there; nothing was created or deleted');
});

test('a snapshot with no previous reading still renames ports in one write when their names swap', async () => {
  // Renames still happen where there is no previous reading to inherit from,
  // and NetBox still checks one at a time. That is what the temporary name
  // step is for.
  const nb = strictNetBox();
  const before = cv.toSnapshot(switchWithPorts([1, 2, 3]), opts());
  await writer.push(before, nb);
  assert.deepEqual(namesOf(nb), ['1', '2', '3']);

  const after = cv.toSnapshot(switchWithPorts([2, 3, 1]), opts());
  const out = await writer.push(after, nb);
  const fails = out.changes.filter((c) => c.action === 'fail');
  assert.deepEqual(fails, [], `refused: ${JSON.stringify(fails.map((f) => f.reason))}`);
  assert.deepEqual(namesOf(nb), ['2', '3', '1'], 'every port has its new name');
  assert.equal(nb.rows(IFACES).length, 3, 'and none was created twice');
  assert.ok(!nb.rows(IFACES).some((o) => String(o.name).startsWith('~')), 'no temporary name is left behind');
});

test('a port whose rename is refused gets its old name back, not a temporary one', async () => {
  const nb = strictNetBox();
  const before = cv.toSnapshot(switchWithPorts([1, 2, 3]), opts());
  await writer.push(before, nb);
  nb.refuseName.add('9');
  const after = cv.toSnapshot(switchWithPorts([9, 2, 3]), opts());
  const out = await writer.push(after, nb);
  assert.equal(out.changes.filter((c) => c.action === 'fail').length, 1, 'the one refused rename is reported');
  assert.deepEqual(namesOf(nb), ['1', '2', '3'], 'and the port kept the name it had');
  assert.ok(!nb.rows(IFACES).some((o) => String(o.name).startsWith('~')));
});

test('a port whose name is not changing is not touched', async () => {
  const nb = strictNetBox();
  const before = cv.toSnapshot(switchWithPorts([1, 2, 3]), opts());
  await writer.push(before, nb);
  const mark = nb.calls.length;
  await writer.push(cv.toSnapshot(switchWithPorts([1, 2, 3]), opts(before)), nb);
  assert.deepEqual(nb.calls.slice(mark).filter((c) => c.method === 'PATCH'), []);
});

// -- ports aligned to the records NetBox already holds --------------------

const { alignPortsToNetBox } = require('../../lib/netbox/align');

test('a port takes the record already carrying its number, even one no reading knows about', async () => {
  // The last failure on the demo rack's 52 port switch: NetBox held "45" under
  // a uid no current reading used, and the write asked for a second "45".
  const nb = strictNetBox();
  const first = cv.toSnapshot(switchWithPorts([1, 2, 3, 4]), opts());
  await writer.push(first, nb);

  // A reading built with no previous one to inherit from: its uids are places,
  // so ":1" is now port 4, and port 3 was not seen at all.
  const raw = cv.toSnapshot(switchWithPorts([4, 1, 2]), opts());
  const rawOut = await writer.plan(raw, nb);
  assert.ok(rawOut.changes.some((c) => c.type === 'Interface' && c.action === 'update'),
    'unaligned, it plans renames that NetBox would refuse');

  const { snapshot, rebound } = await alignPortsToNetBox(raw, nb);
  assert.ok(rebound > 0);
  const mark = nb.calls.length;
  const out = await writer.push(snapshot, nb);
  assert.deepEqual(out.changes.filter((c) => c.action === 'fail'), []);
  // Three ports makes the switch a Router, so the device itself changes; the
  // ports must not.
  assert.deepEqual(nb.calls.slice(mark).filter((c) => (c.method === 'PATCH' || c.method === 'POST')
    && c.path.startsWith(IFACES)), [], 'aligned, no port needs writing: every one is already right');
  assert.equal(nb.rows(IFACES).length, 4, 'and port 3, not seen, is still there');
});

test('a port whose number nobody holds gets a record of its own, never an unseen port\'s', async () => {
  const nb = strictNetBox();
  await writer.push(cv.toSnapshot(switchWithPorts([1, 2]), opts()), nb);
  // Place 1 now reads "2" and place 2 reads "7", a number nobody holds.
  const { snapshot } = await alignPortsToNetBox(cv.toSnapshot(switchWithPorts([2, 7]), opts()), nb);
  const byName = Object.fromEntries(snapshot.interfaces.map((i) => [i.name, i.uid]));
  assert.equal(byName['2'], `if:dev:${RACK}:u12:2`, '"2" takes the record that is 2');
  const out = await writer.push(snapshot, nb);
  assert.deepEqual(out.changes.filter((c) => c.action === 'fail'), []);
  // Place 2's own record was taken by port "2", and the record holding "1" is
  // port 1, which was simply not seen this time. So "7" is created, and port 1
  // keeps its record and its number rather than being renamed into port 7.
  assert.deepEqual(namesOf(nb).sort(), ['1', '2', '7']);
  assert.ok(byName['7'].endsWith('.r1'), 'a fresh uid, not one an unseen port carries');
});

test('with no NetBox to ask, the snapshot is left exactly as the camera made it', async () => {
  const snap = cv.toSnapshot(switchWithPorts([1, 2]), opts());
  const broken = { paginate: async () => { throw new Error('down'); } };
  const out = await alignPortsToNetBox(snap, broken);
  assert.equal(out.snapshot, snap);
  assert.equal(out.rebound, 0);
});

test('a cable follows its port to the record the port was aligned to', async () => {
  const snap = { rackUid: `rack:${RACK}`, devices: [{ uid: 'dev:A' }],
    interfaces: [{ uid: 'if:dev:A:1', deviceUid: 'dev:A', name: '5' }],
    cables: [{ uid: 'cable:x', a: { objectType: 'dcim.interface', uid: 'if:dev:A:1' }, b: null }] };
  const fake = { paginate: async (p) => (p.includes('devices')
    ? [{ id: 1, custom_fields: { [UID_FIELD]: 'dev:A' } }]
    : [{ id: 9, name: '5', device: { id: 1 }, custom_fields: { [UID_FIELD]: 'if:dev:A:7' } }]) };
  const { snapshot } = await alignPortsToNetBox(snap, fake);
  assert.equal(snapshot.interfaces[0].uid, 'if:dev:A:7');
  assert.equal(snapshot.cables[0].a.uid, 'if:dev:A:7', 'the cable end moved with it');
});
