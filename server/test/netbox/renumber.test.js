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
  const nb = new NetBox('http://fake.invalid', 'nbt_test');
  nb.rows = rows;
  nb.calls = calls;
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
