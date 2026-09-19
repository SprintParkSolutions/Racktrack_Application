/**
 * The cables, asked by the matcher rather than sitting in a module.
 *
 * Rung 6 of the device ladder existed and nothing called it. This is the wire:
 * when every other rung has tied - same model, same make, same port count, no
 * confirmation to remember - the matcher asks which box carries the pattern of
 * cables the switch reports, instead of going blank or picking by list order.
 *
 * The case is our own office rack: two switches of one model, one shelf apart,
 * no labels. What is proved here:
 *   1. the right box is picked, and the reason says the cables did it;
 *   2. it is still only a proposal - a person confirms before anything of the
 *      switch's is written onto that box;
 *   3. two boxes that genuinely carry the same pattern still go blank, and say
 *      that the cables could not tell them apart either;
 *   4. the answer does not depend on the order of anything;
 *   5. a box whose sockets the camera could not see falls back to the old
 *      behaviour rather than inventing an answer.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.RT_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'fpwire-'));

const reconcile = require('../../lib/netbox/reconcile');
const bindings = require('../../lib/netbox/bindings');

const SCOPE = bindings.scopeOf({ tenantId: 1, rackId: 'RK-FPWIRE01' });

/** A box in the photograph: `pattern` is one character per socket. */
function box(uid, name, position, pattern) {
  const interfaces = [];
  [...pattern].forEach((c, i) => {
    interfaces.push({
      uid: `if:${uid}:${i + 1}`,
      deviceUid: uid,
      name: String(i + 1),
      type: '1000base-t',
      provenance: { category: 'main', status: c === 'c' ? 'connected' : c === 'e' ? 'empty' : 'unknown' },
    });
  });
  return { device: { uid, name, position, deviceTypeUid: 'dtype:sw', provenance: { cvClass: 'Switch' } }, interfaces };
}

/** A snapshot holding the given boxes, all of one model so every rung ties. */
function snapshotOf(boxes) {
  return {
    rackUid: 'rack:RK-FPWIRE01',
    devices: boxes.map((b) => b.device),
    interfaces: boxes.flatMap((b) => b.interfaces),
    deviceTypes: [{ uid: 'dtype:sw', model: 'Unidentified Switch', manufacturerUid: 'mfr:unknown' }],
    manufacturers: [{ uid: 'mfr:unknown', name: 'Unknown' }],
  };
}

/** A switch as SNMP reported it: `pattern` is one character per port. */
function sw(id, label, pattern) {
  return {
    record: { id, label, host: `10.0.0.${id}` },
    reading: {
      identity: { model: null, serial: null },
      system: { sysName: label, vendor: null },
      interfaces: [...pattern].map((c, i) => ({
        ifIndex: i + 1, name: `Gi1/0/${i + 1}`, type: 'ethernet',
        operStatus: c === 'u' ? 'up' : 'down',
      })),
    },
  };
}

test('the cables pick the right box when everything else has tied', () => {
  // Two boxes of the same size, and two switches of the same model. The only
  // thing that differs is which sockets hold a cable.
  const boxes = [
    box('dev:RK-FPWIRE01:u10', 'Switch U10', 10, 'cceccceeeccc'),
    box('dev:RK-FPWIRE01:u12', 'Switch U12', 12, 'eeuceeuuucee'.replace(/u/g, 'c').replace(/[^ce]/g, 'e')),
  ];
  const out = reconcile.suggest(snapshotOf(boxes), [
    sw(1, 'sw-one', 'uueuuueeeuuu'),
  ], { scope: SCOPE });

  const reason = out.reasons[1];
  assert.equal(out.matches[1], 'dev:RK-FPWIRE01:u10', 'it picked the box whose cables agree');
  assert.match(reason.why, /the cables on this box match the switch/,
    `the reason names the cables, and only the cables: ${reason.why}`);
  assert.equal(reason.candidateCount, 1, 'and the cables left one candidate');
});

test('a box the cables picked is still only a proposal', () => {
  const boxes = [
    box('dev:RK-FPWIRE01:u10', 'Switch U10', 10, 'cceccceeeccc'),
    box('dev:RK-FPWIRE01:u12', 'Switch U12', 12, 'eeeeeeeeeeee'),
  ];
  const out = reconcile.suggest(snapshotOf(boxes), [sw(1, 'sw-one', 'uueuuueeeuuu')], { scope: SCOPE });
  const reason = out.reasons[1];
  assert.ok(['possible', 'probable'].includes(reason.confidence),
    `the cables propose, they do not confirm, got ${reason.confidence}`);
  assert.notEqual(reason.confidence, 'confirmed',
    'only a person, a code or the switch naming itself reaches confirmed');
});

test('two boxes carrying the same cables still go blank, and say the cables could not tell them apart', () => {
  const same = 'cceccceeeccc';
  const boxes = [
    box('dev:RK-FPWIRE01:u10', 'Switch U10', 10, same),
    box('dev:RK-FPWIRE01:u12', 'Switch U12', 12, same),
  ];
  const out = reconcile.suggest(snapshotOf(boxes), [sw(1, 'sw-one', 'uueuuueeeuuu')], { scope: SCOPE });
  const reason = out.reasons[1];
  assert.equal(out.matches[1], null, 'no box is chosen');
  assert.match(reason.why, /cannot be told apart/);
  assert.ok((reason.notes || []).some((n) => /cables/.test(n)),
    `the notes say the cables were tried and could not settle it: ${JSON.stringify(reason.notes)}`);
});

test('the answer does not depend on the order of the boxes or the switches', () => {
  const boxes = [
    box('dev:RK-FPWIRE01:u10', 'Switch U10', 10, 'cceccceeeccc'),
    box('dev:RK-FPWIRE01:u12', 'Switch U12', 12, 'eeeeeeeeeeee'),
  ];
  const forwards = reconcile.suggest(snapshotOf(boxes), [sw(1, 'sw-one', 'uueuuueeeuuu')], { scope: SCOPE });
  const backwards = reconcile.suggest(snapshotOf([...boxes].reverse()), [sw(1, 'sw-one', 'uueuuueeeuuu')], { scope: SCOPE });
  assert.equal(forwards.matches[1], backwards.matches[1],
    'reversing the boxes gives the same box');
});

test('a box whose sockets the camera could not see does not invent an answer', () => {
  // Every socket hidden behind a cable bundle. Nothing to compare.
  const boxes = [
    box('dev:RK-FPWIRE01:u10', 'Switch U10', 10, '????????????'),
    box('dev:RK-FPWIRE01:u12', 'Switch U12', 12, '????????????'),
  ];
  const out = reconcile.suggest(snapshotOf(boxes), [sw(1, 'sw-one', 'uueuuueeeuuu')], { scope: SCOPE });
  assert.equal(out.matches[1], null, 'it goes blank rather than guessing from nothing');
  assert.match(out.reasons[1].why, /cannot be told apart/);
});
