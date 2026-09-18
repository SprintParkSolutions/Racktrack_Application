/**
 * The port fingerprint, rung 6 of the device ladder.
 *
 * The case this exists for is the one in our own office: two switches, same
 * model, same firmware, no labels, one shelf apart. Every rung above this one
 * ties. The cables do not.
 *
 * What is proved here:
 *   1. the right switch is picked out of two identical ones by its cables;
 *   2. the answer does not depend on the order the switches came in;
 *   3. two switches genuinely carrying the same pattern settle nothing, and
 *      say what would settle it, rather than picking the first one;
 *   4. a cabled socket on a port that is down is never a mismatch;
 *   5. sockets hidden behind a bundle drop out and are never read as empty;
 *   6. an uplink cage is worth more than a copper port;
 *   7. a VLAN interface is not a socket, so a 28 port switch is 28 ports.
 */
const test = require('node:test');
const assert = require('node:assert');

const fp = require('../../lib/netbox/fingerprint');

// ---- fixtures ------------------------------------------------------------

/** A box as the camera reported it: `pattern` is one character per socket. */
function box(pattern, { uplinks = '' } = {}) {
  const ports = [];
  let n = 1;
  for (const c of pattern) {
    ports.push({
      port_number: n,
      port_type: 'RJ45',
      status: c === 'c' ? 'connected' : c === 'e' ? 'empty' : 'unknown',
    });
    n += 1;
  }
  for (const c of uplinks) {
    ports.push({
      port_number: n,
      port_type: 'SFP',
      status: c === 'c' ? 'connected' : c === 'e' ? 'empty' : 'unknown',
    });
    n += 1;
  }
  return { ports };
}

/** A switch as SNMP reported it: `pattern` is one character per port. */
function reading(pattern, { uplinks = '', extra = [] } = {}) {
  const interfaces = [];
  let ix = 1;
  for (const c of pattern) {
    interfaces.push({ ifIndex: ix, name: `Gi1/0/${ix}`, type: 'ethernet', operStatus: c === 'u' ? 'up' : 'down' });
    ix += 1;
  }
  for (const c of uplinks) {
    interfaces.push({ ifIndex: ix, name: `Te1/1/${ix}`, type: 'ethernet', operStatus: c === 'u' ? 'up' : 'down' });
    ix += 1;
  }
  return { interfaces: interfaces.concat(extra) };
}

// ---- the case this rung exists for ---------------------------------------

test('two identical switches are told apart by their cables', () => {
  // Same model, same port count, no labels. Only the cables differ.
  const seen = box('cceccceeeccc');
  const a = { id: 'sw-a', reading: reading('uueuuueeeuuu') };   // the same face
  const b = { id: 'sw-b', reading: reading('eeuceeuuucee') };   // a different one

  const out = fp.rank(fp.socketsOf(seen), [a, b]);
  assert.equal(out.settled, true, 'the cables settle it');
  assert.equal(out.best.id, 'sw-a');
  assert.match(out.why, /agree with the switch/);
});

test('the answer does not depend on the order the switches arrive in', () => {
  const seen = fp.socketsOf(box('cceccceeeccc'));
  const a = { id: 'sw-a', reading: reading('uueuuueeeuuu') };
  const b = { id: 'sw-b', reading: reading('eeuceeuuucee') };

  const forwards = fp.rank(seen, [a, b]);
  const backwards = fp.rank(seen, [b, a]);
  assert.deepEqual(
    { settled: forwards.settled, best: forwards.best.id, shortlist: forwards.shortlist },
    { settled: backwards.settled, best: backwards.best.id, shortlist: backwards.shortlist },
    'reversing the list gives the identical answer',
  );
});

test('two switches carrying the same pattern settle nothing and say why', () => {
  const seen = fp.socketsOf(box('ccccceeeee'));
  const a = { id: 'sw-a', reading: reading('uuuuuddddd') };
  const b = { id: 'sw-b', reading: reading('uuuuuddddd') };

  const out = fp.rank(seen, [a, b]);
  assert.equal(out.settled, false, 'a tie is never broken by picking the first one');
  assert.equal(out.best, null);
  assert.deepEqual(out.shortlist.sort(), ['sw-a', 'sw-b'], 'both stay on the shortlist');
  assert.match(out.why, /same pattern of cables/);
  assert.match(out.why, /cannot tell them apart/);

  const reversed = fp.rank(seen, [b, a]);
  assert.equal(reversed.settled, false, 'and it is still not settled the other way round');
});

// ---- the comparison rules ------------------------------------------------

test('a cabled socket on a port that is down is unknown, never a mismatch', () => {
  // Every socket cabled; the switch has three of them down. A dark spare, a
  // dead far end and a port somebody shut down all look like this.
  const out = fp.compare(fp.socketsOf(box('cccccc')), fp.physicalPorts(reading('uuuddd')));
  assert.equal(out.darkCable, 3);
  assert.equal(out.miss, 0, 'none of them counts as a miss');
  assert.equal(out.score, 1, 'and the three that do agree give a clean score');
  assert.match(out.why, /cabled but not carrying a link/);
});

test('an empty socket on a port that is up counts against, lightly', () => {
  const clean = fp.compare(fp.socketsOf(box('cccc')), fp.physicalPorts(reading('uuuu')));
  const oneMiss = fp.compare(fp.socketsOf(box('ccce')), fp.physicalPorts(reading('uuuu')));
  assert.equal(clean.score, 1);
  assert.equal(oneMiss.miss, 1);
  assert.ok(oneMiss.score < clean.score, 'it costs something');
  assert.ok(oneMiss.score > 0.5, 'but it is a light cost, not a refutation');
});

test('sockets hidden behind a bundle drop out and are never read as empty', () => {
  // Four sockets the camera could not see. If they were read as empty against
  // four ports that are up, this would score badly. They must not count.
  const hidden = fp.compare(fp.socketsOf(box('cc????cc')), fp.physicalPorts(reading('uuuuuuuu')));
  assert.equal(hidden.notVisible, 4);
  assert.equal(hidden.miss, 0);
  assert.equal(hidden.score, 1, 'what was seen agrees completely');
});

test('an uplink cage is worth more than a copper port', () => {
  // Same number of disagreements, one on copper and one on a cage.
  const onCopper = fp.compare(fp.socketsOf(box('ce', { uplinks: 'cc' })),
    fp.physicalPorts(reading('uu', { uplinks: 'uu' })));
  const onCage = fp.compare(fp.socketsOf(box('cc', { uplinks: 'ce' })),
    fp.physicalPorts(reading('uu', { uplinks: 'uu' })));
  assert.equal(onCopper.miss, 1);
  assert.equal(onCage.miss, 1);
  assert.ok(onCage.score < onCopper.score, 'a cage that disagrees hurts more');
});

// ---- what counts as a socket --------------------------------------------

test('a VLAN interface is not a socket, so a 28 port switch is 28 ports', () => {
  // The TP-Link SG2428P reports Vlan-interface1 as ethernetCsmacd, the same
  // type as the sockets on its front. Believing it made 28 ports into 29.
  const r = reading('uuuuuuuuuuuuuuuuuuuuuuuuuuuu', {
    extra: [
      { ifIndex: 99, name: 'Vlan-interface1', type: 'ethernet', operStatus: 'up' },
      { ifIndex: 98, name: 'loopback0', type: 'loopback', operStatus: 'up' },
      { ifIndex: 97, name: 'Port-Channel1', type: 'ethernet', operStatus: 'up' },
      { ifIndex: 96, name: 'Tunnel0', type: 131, operStatus: 'up' },
    ],
  });
  assert.equal(fp.physicalPorts(r).length, 28, 'four of them are not sockets on the front');
});

test('console, USB and management sockets are not part of the pattern', () => {
  const seen = {
    ports: [
      { port_number: 1, port_type: 'RJ45', status: 'connected' },
      { port_number: 2, port_type: 'RJ45', status: 'empty' },
      { port_number: 3, port_type: 'CONSOLE', status: 'empty' },
      { port_number: 4, port_type: 'USB', status: 'empty' },
      { port_number: 5, port_type: 'MGMT', status: 'connected' },
    ],
  };
  assert.equal(fp.socketsOf(seen).length, 2, 'only the two front sockets');
});

test('a snapshot interface is read the same way as a physical layer port', () => {
  // The same box, described by the two shapes the codebase already has.
  const fromReport = fp.socketsOf(box('ce'));
  const fromSnapshot = fp.socketsOf({
    interfaces: [
      { name: '1', type: '1000base-t', provenance: { category: 'main', status: 'connected' } },
      { name: '2', type: '1000base-t', provenance: { category: 'main', status: 'empty' } },
    ],
  });
  assert.deepEqual(fromSnapshot.map((s) => s.status), fromReport.map((s) => s.status));
});

// ---- refusing -------------------------------------------------------------

test('a switch with a different number of sockets is not lined up socket by socket', () => {
  const out = fp.compare(fp.socketsOf(box('cccc')), fp.physicalPorts(reading('uuuuuuuu')));
  assert.equal(out.alignment, 'count', 'it says the two sides are not the same face');
  assert.match(out.why, /count a different number of sockets/);
});

test('a count-only comparison never settles the rung on its own', () => {
  const seen = fp.socketsOf(box('cccc'));
  const out = fp.rank(seen, [{ id: 'sw-a', reading: reading('uuuuuuuu') }]);
  assert.equal(out.settled, false, 'a weak signal narrows, it does not decide');
  assert.match(out.why, /cannot be compared socket by socket/);
});

test('no candidate matching the cables settles nothing and says so', () => {
  const seen = fp.socketsOf(box('cccccccccc'));
  const out = fp.rank(seen, [{ id: 'sw-a', reading: reading('dddddddddd') }]);
  assert.equal(out.settled, false);
  assert.equal(out.shortlist.length, 0, 'nothing is even shortlisted');
  assert.match(out.why, /no switch matches the cables/);
});

test('a port the switch never reported on is not read as down', () => {
  const r = { interfaces: [
    { ifIndex: 1, name: 'Gi1/0/1', type: 'ethernet', operStatus: 'up' },
    { ifIndex: 2, name: 'Gi1/0/2', type: 'ethernet', operStatus: null },
  ] };
  const out = fp.compare(fp.socketsOf(box('cc')), fp.physicalPorts(r));
  assert.equal(out.miss, 0);
  assert.equal(out.agree, 1, 'only the port that answered is compared');
  assert.equal(out.score, 1);
});

test('no switches read for this rack is said plainly', () => {
  const out = fp.rank(fp.socketsOf(box('cc')), []);
  assert.equal(out.settled, false);
  assert.equal(out.best, null);
  assert.match(out.why, /no switch has been read/);
});

test('a settled fingerprint is probable, not confirmed', () => {
  // Only the switch naming itself, a code or a person reaches confirmed. The
  // cables are behaviour, and behaviour is strong evidence, not proof.
  assert.equal(fp.CONFIDENCE, 'probable');
});
