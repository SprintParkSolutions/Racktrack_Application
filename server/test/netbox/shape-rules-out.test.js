/**
 * Rung 5 rules a candidate out, it does not merely score it down.
 *
 * Found on a real rack, RK-3CD81888, with three switches actually read over
 * SNMP: a 52 port D-Link was proposed for a box with 10 sockets, because both
 * had been read as D-Link, while the 52 socket box beside it carried no
 * readable maker at all. The maker outranked the shape, which is the wrong way
 * round: a 10 socket box cannot be a 52 port switch, whoever made it.
 *
 * The two bounds are deliberately not symmetric, because the camera's errors
 * are not. It undercounts, because a bottom row behind a cable bundle reads as
 * unknown, so a 48 port switch can honestly come back as 24 sockets. It does
 * not invent sockets, so a box showing far more sockets than the switch has is
 * simply not that switch.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.RT_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'shape-'));

const reconcile = require('../../lib/netbox/reconcile');
const bindings = require('../../lib/netbox/bindings');

const SCOPE = bindings.scopeOf({ tenantId: 1, rackId: 'RK-SHAPE001' });

/** A box the camera found: name, shelf, how many sockets, and the maker read off it. */
function box(position, sockets, make) {
  const uid = `dev:RK-SHAPE001:u${position}`;
  return {
    device: {
      uid,
      name: `Switch U${position}`,
      position,
      deviceTypeUid: make ? `dtype:${make}` : 'dtype:unknown',
      provenance: { cvClass: 'Switch' },
    },
    interfaces: Array.from({ length: sockets }, (_, i) => ({
      uid: `if:${uid}:${i + 1}`,
      deviceUid: uid,
      name: String(i + 1),
      type: '1000base-t',
      provenance: { category: 'main', status: 'unknown' },
    })),
    make,
  };
}

function snapshotOf(boxes) {
  const makes = [...new Set(boxes.map((b) => b.make).filter(Boolean))];
  return {
    rackUid: 'rack:RK-SHAPE001',
    devices: boxes.map((b) => b.device),
    interfaces: boxes.flatMap((b) => b.interfaces),
    deviceTypes: [
      { uid: 'dtype:unknown', model: 'Unidentified Switch', manufacturerUid: 'mfr:unknown' },
      ...makes.map((m) => ({ uid: `dtype:${m}`, model: 'Unidentified Switch', manufacturerUid: `mfr:${m}` })),
    ],
    manufacturers: [
      { uid: 'mfr:unknown', name: 'Unknown' },
      ...makes.map((m) => ({ uid: `mfr:${m}`, name: m })),
    ],
  };
}

/** A switch as SNMP reported it. */
function sw(id, label, ports, vendor, model) {
  return {
    record: { id, label, host: `10.0.0.${id}` },
    reading: {
      identity: { model: model || null, serial: null, manufacturer: vendor || null },
      system: { sysName: label, vendor: vendor || null },
      interfaces: Array.from({ length: ports }, (_, i) => ({
        ifIndex: i + 1, name: `Gi1/0/${i + 1}`, type: 'ethernet', operStatus: 'down',
      })),
    },
  };
}

const run = (boxes, switches) => reconcile.suggest(snapshotOf(boxes), switches, { scope: SCOPE });

test('a 52 port switch is not put in a 10 socket box, however the makers agree', () => {
  // The shape of the real rack this was found on.
  const out = run(
    [box(12, 10, 'D-Link'), box(8, 52, null)],
    [sw(1, 'Corr', 52, 'D-Link', null)],
  );
  assert.notEqual(out.matches[1], 'dev:RK-SHAPE001:u12',
    'the 10 socket box must not be chosen');
  assert.equal(out.matches[1], 'dev:RK-SHAPE001:u8',
    'the box whose panel actually fits is chosen instead');
});

test('a box ruled out on its shape is named, so nobody wonders where it went', () => {
  const out = run(
    [box(12, 10, 'D-Link'), box(8, 52, null)],
    [sw(1, 'Corr', 52, 'D-Link', null)],
  );
  const notes = (out.reasons[1] && out.reasons[1].notes) || [];
  assert.ok(notes.some((n) => /Switch U12/.test(n) && /sockets/.test(n)),
    `the ruled out box is named with a reason, got ${JSON.stringify(notes)}`);
});

test('a box showing more sockets than the switch has is not that switch', () => {
  // The camera does not invent sockets it cannot see.
  const out = run([box(10, 48, null)], [sw(1, 'small', 8, null, null)]);
  assert.equal(out.matches[1], null, 'an 8 port switch is not a 48 socket box');
});

test('a half seen panel is not ruled out on size, because the camera undercounts', () => {
  // A 48 port switch whose bottom row is behind a cable bundle reads as 24.
  // On its own that is still not evidence of anything - no model, no maker,
  // and a count half out - so it is honestly left unmatched. What must NOT
  // happen is the size rule striking it off: the bottom row is the camera's
  // fault, not the box's.
  const out = run([box(10, 24, null)], [sw(1, 'big', 48, null, null)]);
  const notes = (out.reasons[1] && out.reasons[1].notes) || [];
  assert.ok(!notes.some((n) => /too few/.test(n)),
    `it is not struck off for showing half its sockets, got ${JSON.stringify(notes)}`);

  // And when the maker is readable, the half seen panel does win.
  const withMake = run([box(10, 24, 'Cisco')], [sw(1, 'big', 48, 'Cisco', null)]);
  assert.equal(withMake.matches[1], 'dev:RK-SHAPE001:u10',
    'with one more signal the half seen panel is chosen');
});

test('the exact fit still wins when both boxes are plausible', () => {
  const out = run([box(10, 24, null), box(12, 28, null)], [sw(1, 'sw', 28, null, null)]);
  assert.equal(out.matches[1], 'dev:RK-SHAPE001:u12');
});

test('ruling out on shape never invents a match when nothing fits', () => {
  const out = run([box(10, 4, null)], [sw(1, 'sw', 48, null, null)]);
  assert.equal(out.matches[1], null);
  assert.ok((out.reasons[1].why || '').length > 0, 'and it says something about why');
});

test('a stack member is judged against its own share, not the whole stack', () => {
  // Two chassis of 24, reported as one 48 port reading, drawn as two boxes.
  const stacked = {
    record: { id: 1, label: 'stack', host: '10.0.0.1' },
    reading: {
      identity: {
        model: null, serial: 'AAA111', manufacturer: null,
        members: [{ serial: 'AAA111' }, { serial: 'BBB222' }],
      },
      system: { sysName: 'stack', vendor: null },
      interfaces: Array.from({ length: 48 }, (_, i) => ({
        ifIndex: i + 1, name: `Gi1/0/${i + 1}`, type: 'ethernet', operStatus: 'down',
      })),
    },
  };
  const out = run([box(10, 24, null), box(12, 24, null)], [stacked]);
  // Both boxes hold a member's share, so this is a tie and must stay blank -
  // but neither may be ruled out for showing 24 sockets against 48.
  const notes = (out.reasons[1] && out.reasons[1].notes) || [];
  assert.ok(!notes.some((n) => /too few/.test(n)),
    `a stack member is not ruled out on size, got ${JSON.stringify(notes)}`);
});
