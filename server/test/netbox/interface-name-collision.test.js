/**
 * Two ports of one device may not share a name, and the fix for that may not
 * take a name a third port is still going to ask for.
 *
 * NetBox uniques an interface on (device, name). The camera sometimes reads two
 * ports as the same number, so a duplicate is renamed before the write. The
 * rename used to pick the port's place in the list and check it only against
 * the names it had ALREADY walked past - which is the bug, because the list is
 * not sorted by name and a later port can legitimately read as that number.
 *
 * Found on the live demo, on the 52 port switch at U8, in the plan's own
 * warnings:
 *
 *   two ports both read as "3",  so the second is recorded as "46"
 *   two ports both read as "46", so the second is recorded as "49"
 *
 * The first line took 46 for a port whose place was 46. The port that actually
 * read 46 came later. NetBox refused it with "Interface with this Device and
 * Name already exists", and one item of an otherwise clean 281 item plan was
 * lost - the last remaining cause of a failed write on that box.
 */
const test = require('node:test');
const assert = require('node:assert');

const writer = require('../../lib/netbox/writer');

const { uniqueInterfaceNames } = writer._internal || writer;

const iface = (place, name, deviceUid = 'dev:RK-T:u8') => ({
  uid: `if:${deviceUid}:${place}`, deviceUid, name: String(name),
});

function run(interfaces, devices = [{ uid: 'dev:RK-T:u8', name: 'Switch U8' }]) {
  const report = { warnings: [] };
  uniqueInterfaceNames({ devices, interfaces }, report);
  return { names: interfaces.map((i) => i.name), report };
}

const noDuplicates = (names) =>
  assert.equal(new Set(names).size, names.length, `names collided: ${names.join(', ')}`);

test('the live case: a rename may not take a number a later port really reads', () => {
  // Place 3 and place 45 both read "3"; place 46 genuinely reads "46".
  const ports = [iface(3, '3'), iface(45, '3'), iface(46, '46')];
  const { names } = run(ports);
  noDuplicates(names);
  assert.equal(names[0], '3', 'the first keeps the number printed on the panel');
  assert.equal(names[2], '46', 'the port that really is 46 keeps 46');
  assert.notEqual(names[1], '46', 'and the duplicate is not put on top of it');
});

test('a plain duplicate still falls back to the port place, which is free', () => {
  const ports = [iface(7, '7'), iface(20, '7')];
  const { names, report } = run(ports);
  assert.deepEqual(names, ['7', '20']);
  assert.match(report.warnings[0], /two ports both read as "7"/);
  assert.match(report.warnings[0], /recorded as "20"/);
});

test('when the place is taken too, the name is suffixed rather than guessed at', () => {
  // Place 9 reads "4"; place 4 reads "4" as well, so its place, 4, is the very
  // name in dispute. There is nowhere obvious to go, so it is said plainly.
  const ports = [iface(4, '4'), iface(9, '4'), iface(12, '9')];
  const { names } = run(ports);
  noDuplicates(names);
  assert.equal(names[0], '4');
  assert.equal(names[2], '9', 'the port that reads 9 keeps 9');
  assert.match(names[1], /^4-\d+$/, `expected a suffixed name, got ${names[1]}`);
});

test('three ports reading the same number all end up somewhere of their own', () => {
  const ports = [iface(1, '5'), iface(2, '5'), iface(3, '5')];
  const { names, report } = run(ports);
  noDuplicates(names);
  assert.equal(names[0], '5');
  assert.equal(report.warnings.length, 2, 'one warning per port that had to move');
});

test('a device whose ports are all distinct is left completely alone', () => {
  const ports = [iface(1, '1'), iface(2, '2'), iface(3, '3')];
  const { names, report } = run(ports);
  assert.deepEqual(names, ['1', '2', '3']);
  assert.equal(report.warnings.length, 0);
});

test('two devices may each have a port called 1, because NetBox uniques per device', () => {
  const ports = [
    iface(1, '1', 'dev:RK-T:u8'),
    iface(1, '1', 'dev:RK-T:u9'),
  ];
  const { names, report } = run(ports, [
    { uid: 'dev:RK-T:u8', name: 'Switch U8' },
    { uid: 'dev:RK-T:u9', name: 'Switch U9' },
  ]);
  assert.deepEqual(names, ['1', '1'], 'nothing is renamed across devices');
  assert.equal(report.warnings.length, 0);
});

test('the warning names the box a person has to go back and photograph', () => {
  const { report } = run([iface(1, '2'), iface(8, '2')]);
  assert.match(report.warnings[0], /^Switch U8:/);
  assert.match(report.warnings[0], /Photograph the rack again/);
});

test('the exact five warnings from the live plan now leave five distinct names', () => {
  // Reconstructed from plan 115 on RK-3CD81888: the reads that produced those
  // five warnings, in the order the snapshot held them.
  const ports = [
    iface(1, '1'), iface(45, '1'),
    iface(3, '3'), iface(46, '3'),
    iface(2, '2'), iface(51, '2'),
    iface(4, '4'), iface(52, '4'),
    iface(49, '49'),
  ];
  const { names } = run(ports);
  noDuplicates(names);
  // And every port that read a number nobody else claimed still has it.
  assert.equal(names[0], '1');
  assert.equal(names[2], '3');
  assert.equal(names[4], '2');
  assert.equal(names[6], '4');
  assert.equal(names[8], '49');
});

test('a port whose place carries a record suffix is named by the place, not the suffix', () => {
  // cv.js gives a port "…:46.1" when place 46 is already another port's record.
  // The ".1" is an id; a duplicate falls back to "46", or "46-2" if that is taken.
  const ports = [iface(46, '46'), iface('46.1', '46')];
  const { names } = run(ports);
  assert.deepEqual(names, ['46', '46-2']);
});
