/**
 * A device name has to be unique per SITE, and a U is only unique per RACK.
 *
 * That gap is why writing to NetBox had never once succeeded on the demo box.
 * Five plans were written, five failed, and the newest of them, plan 52, failed
 * with three of these, verbatim from the stored result:
 *
 *   Device | {"__all__":["Device name must be unique per site."]}
 *
 * RK-3CD81888 and RK-B4DE04B1 both sit in the site called Default, and both
 * have a U12, so both produced a device called "Switch U12". The code believed
 * otherwise - its comment read "a placed device is named by its U, which is
 * already unique" - which is true inside one rack and false across a site.
 *
 * The other half of this is what must NOT change. A device's uid is what makes
 * it the same object on the next write: a placed device is keyed on its
 * position, an unplaced one on the slug of its name. If the rack were added to
 * the name the uid is built from, every unplaced device already in NetBox would
 * become an orphan and be created again beside itself. So the rack goes in the
 * name and nowhere near the uid.
 */
const test = require('node:test');
const assert = require('node:assert');

const cv = require('../../lib/netbox/cv');

const device = (units, cls = 'Switch', extra = {}) => ({
  class_name: cls,
  units,
  port_count: 24,
  ports: [{ box: [0, 0, 8, 8], confidence: 0.9, class_name: 'port' }],
  console_ports: [], sfp_ports: [], other_ports: [], connected_ports: [],
  ...extra,
});

const snapshotOf = (devices, { rackId, rackName }) => cv.toSnapshot(
  { image: 'rack.jpg', devices },
  { rackId, siteName: 'Default', rackName, uHeight: 42, scannedAt: '2026-09-18T00:00:00Z' },
);

const namesOf = (snap) => snap.devices.map((d) => d.name);
const uidsOf = (snap) => snap.devices.map((d) => d.uid);

test('two racks in one site do not both call their U12 device "Switch U12"', () => {
  const a = snapshotOf([device(['u12'])], { rackId: 'RK-3CD81888', rackName: 'RK-3CD81888' });
  const b = snapshotOf([device(['u12'])], { rackId: 'RK-B4DE04B1', rackName: 'RK-B4DE04B1' });

  const [nameA] = namesOf(a);
  const [nameB] = namesOf(b);
  assert.notEqual(nameA, nameB, 'the exact collision NetBox refused the write for');
  assert.match(nameA, /RK-3CD81888/, 'the name says which rack it is in');
  assert.match(nameB, /RK-B4DE04B1/);
  assert.match(nameA, /U12/, 'and still says which U, because that is how a person finds it');
});

test('the uid does not move, so the device stays the same object to NetBox', () => {
  // A placed device is keyed on its position. Adding the rack to the NAME must
  // not reach the uid, or every device already written becomes an orphan.
  const before = uidsOf(snapshotOf([device(['u12'])], { rackId: 'RK-3CD81888', rackName: 'RK-3CD81888' }));
  assert.deepEqual(before, ['dev:RK-3CD81888:u12']);

  // And the rack's own name changing does not move it either.
  const renamed = uidsOf(snapshotOf([device(['u12'])], { rackId: 'RK-3CD81888', rackName: 'Row 4 Cabinet 2' }));
  assert.deepEqual(renamed, before, 'the uid is the position, never the name');
});

test('a name the camera read off the box is left as the customer wrote it', () => {
  // An OCR read label is the customer's own name for the box. Appending our
  // rack id to it would be us renaming their hardware.
  const snap = snapshotOf([device(['u12'], 'Switch', { label: 'core-sw-01' })],
    { rackId: 'RK-3CD81888', rackName: 'RK-3CD81888' });
  assert.deepEqual(namesOf(snap), ['core-sw-01']);
});

test('an unplaced device is named for its rack too, and keeps the uid it had', () => {
  // Two racks each holding one unnameable box would otherwise both export
  // "Switch (unplaced 1)" into the same site.
  const a = snapshotOf([device([])], { rackId: 'RK-3CD81888', rackName: 'RK-3CD81888' });
  const b = snapshotOf([device([])], { rackId: 'RK-B4DE04B1', rackName: 'RK-B4DE04B1' });
  assert.notEqual(namesOf(a)[0], namesOf(b)[0]);

  // The uid of an unplaced device is the slug of its BASE name, without the
  // rack, because the rack is already in the key that prefixes it.
  assert.deepEqual(uidsOf(a), ['dev:RK-3CD81888:switch-unplaced-1']);
});

test('a rack with no name of its own falls back to its scan id, not to nothing', () => {
  const snap = snapshotOf([device(['u12'])], { rackId: 'RK-3CD81888', rackName: null });
  assert.match(namesOf(snap)[0], /RK-3CD81888/);
});

test('every device in one rack still has a name of its own', () => {
  const snap = snapshotOf(
    [device(['u12']), device(['u10']), device(['u7', 'u8'], 'Patch Panel')],
    { rackId: 'RK-3CD81888', rackName: 'RK-3CD81888' },
  );
  const names = namesOf(snap);
  assert.equal(new Set(names).size, names.length, `names collided inside one rack: ${names}`);
});
