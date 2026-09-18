/**
 * Matching a switch to a box: what it proposes, when it says nothing, and what
 * any of it is allowed to write.
 *
 * The rules being checked:
 *   1. a confirmation made against THIS photograph is a fact and is written; the
 *      same confirmation recalled against a LATER photograph is remembered,
 *      marked probable, and written nowhere (standard 10.1). A photograph that
 *      contradicts it is a move or a replacement and is reported as one;
 *   2. two boxes that cannot be told apart go BLANK. Our own office rack holds
 *      two identical switches, so a matcher that cannot answer "I do not know" is
 *      wrong. The reason has to say what would settle it - and an exact port
 *      count against a near miss is NOT two answers;
 *   3. a port count alone can never be better than 'possible', and it is rank 8
 *      evidence, never anything stronger;
 *   4. size is advice, not a veto. The rack unit figures in the "Device Size and
 *      Rack Unit Occupancy" table of docs/reference/rack-planning-guide.html are
 *      representative, by the guide's own statement, so they are recorded on the
 *      reason and they remove nothing. The one physical rule that stands is about
 *      the RACK: a stack of N separate units needs N boxes to sit in;
 *   5. two switches that both read as one box both go blank - one box holds one
 *      switch, and neither of them gets to be the lucky one;
 *   6. deterministic: reversing the switch list changes nothing;
 *   7. a passive box is never a candidate, and a switch nobody has read yet says
 *      so rather than being matched on nothing;
 *   8. only a confirmed match writes a hardware fact into the snapshot.
 *
 * The camera snapshot and the switch readings are both synthetic fixtures built
 * here. This proves the logic, not the hardware.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, beforeEach, after } = require('node:test');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-suggest-'));
process.env.RT_DATA_DIR = TMP;

const bindings = require('../../lib/netbox/bindings');
const identity = require('../../lib/netbox/identity');
const reconcile = require('../../lib/netbox/reconcile');

const RACK_UID = 'rack:t7:5';
const RACK_ID = 'RK-OFFICE01';
const SCAN_ID = 77;
const SCOPE = bindings.scopeOf({ tenantId: 7, rackId: RACK_ID });

beforeEach(() => { fs.rmSync(bindings.DIR, { recursive: true, force: true }); });
after(() => { fs.rmSync(TMP, { recursive: true, force: true }); });

/**
 * A camera snapshot with the fields cameraDevices reads, and nothing else.
 *
 * `boxes` entries: { uid, name, ports, model, make, cvClass, units, position }.
 */
function snapshotOf(boxes, { scannedAt = '2026-09-18T09:00:00Z' } = {}) {
  const snap = {
    racks: [{ uid: RACK_UID }],
    scannedAt,
    devices: [], deviceTypes: [], manufacturers: [], interfaces: [],
  };
  for (const b of boxes) {
    const typeUid = `dtype:${b.uid}`;
    const mfrUid = b.make ? `mfr:${b.make.toLowerCase()}` : '';
    if (b.make && !snap.manufacturers.some((m) => m.uid === mfrUid)) {
      snap.manufacturers.push({ uid: mfrUid, name: b.make });
    }
    snap.deviceTypes.push({
      uid: typeUid, model: b.model || 'Unidentified Switch',
      manufacturerUid: mfrUid, uHeight: b.units || 1,
    });
    const units = [];
    const first = b.position ?? 10;
    for (let u = 0; u < (b.units || 1); u += 1) units.push(`u${String(first + u).padStart(2, '0')}`);
    snap.devices.push({
      uid: b.uid, name: b.name, position: first, deviceTypeUid: typeUid, serial: b.serial || null,
      provenance: { cvClass: b.cvClass || 'Switch', cvUnits: units, box: null },
    });
    for (let i = 0; i < (b.ports || 0); i += 1) {
      snap.interfaces.push({ uid: `if:${b.uid}:${i}`, deviceUid: b.uid, name: `port ${i + 1}` });
    }
  }
  return snap;
}

/** A switch record plus its reading, in the shape gatherSwitches returns. */
function sw({ id, label, host = '10.10.1.1', ports = 0, vendor = null, model = null,
  serial = null, chassisId = null, sysName = null, stackMembers = 1, members = null, read = true }) {
  return {
    record: { id, label: label || `switch ${id}`, host },
    reading: read ? {
      localChassisId: chassisId,
      identity: {
        model, serial, manufacturer: vendor,
        stackMembers: stackMembers ?? 1,
        members: members || [],
      },
      system: { sysName, vendor },
      counts: { interfaces: ports },
      interfaces: [],
      neighbours: [],
    } : null,
  };
}

const aliasesFor = (s) => identity.aliasesOf({ ...s.reading, host: s.record.host });
const ask = (snap, list, opts = {}) => reconcile.suggest(snap, list, { scope: SCOPE, scanId: SCAN_ID, ...opts });

/** Confirm a box the way the route does: against one photograph, with its print. */
function confirmHere(snap, s, deviceUid, { scanId = SCAN_ID } = {}) {
  const dev = reconcile.cameraDevices(snap).find((d) => d.uid === deviceUid);
  return bindings.confirm(SCOPE, {
    aliases: aliasesFor(s), deviceUid, position: dev?.position ?? null, switchId: String(s.record.id),
    by: 'tech@example.test',
    scanId, snapshotStamp: reconcile.snapshotStamp(snap), boxPrint: reconcile.printOf(dev),
  });
}

// ── 1. a confirmation, fresh and recalled ────────────────────────────────────

test('a confirmation against this photograph wins outright, whatever the port counts say', () => {
  // The box the person confirmed has the WRONG port count on purpose: the camera
  // counted 12 ports on a box holding a 24 port switch, because half the row was
  // in shadow. Scoring would reject it. The person's answer does not care.
  const snap = snapshotOf([
    { uid: 'dev:a', name: 'U10 box', ports: 12 },
    { uid: 'dev:b', name: 'U12 box', ports: 24, position: 12 },
  ]);
  const s = sw({ id: 1, ports: 24, chassisId: '30:DE:4B:23:70:AC' });
  confirmHere(snap, s, 'dev:a');

  const { matches, reasons } = ask(snap, [s]);
  assert.equal(matches[1], 'dev:a');
  assert.equal(reasons[1].confidence, 'confirmed');
  assert.equal(reasons[1].fromBinding, true);
  assert.equal(reasons[1].fresh, true);
  assert.equal(reasons[1].candidateCount, 1);
  assert.match(reasons[1].why, /confirmed at the rack as U10 box, matched on its chassis/);
  assert.deepStrictEqual(reasons[1].evidence.map((e) => e.rank), [1]);
});

test('the same confirmation against a LATER photograph is remembered, not restated', () => {
  // Standard 10.1: a position is observed fresh in each scan, and an earlier one
  // is retained as a rank 4 source and MUST NOT be presented as current. This is
  // the rule that stops two identical switches, swapped between two shelves,
  // each being written with the other's serial at the highest confidence we have.
  const first = snapshotOf([
    { uid: 'dev:a', name: 'U10 box', ports: 24, position: 10 },
    { uid: 'dev:b', name: 'U12 box', ports: 24, position: 12 },
  ]);
  const s = sw({ id: 1, ports: 24, chassisId: '30:DE:4B:23:70:AC' });
  confirmHere(first, s, 'dev:a');

  // The rack is photographed again. Same boxes, new photograph.
  const again = snapshotOf([
    { uid: 'dev:a', name: 'U10 box', ports: 24, position: 10 },
    { uid: 'dev:b', name: 'U12 box', ports: 24, position: 12 },
  ], { scannedAt: '2026-09-25T09:00:00Z' });
  const { matches, reasons } = ask(again, [s]);

  assert.equal(matches[1], 'dev:a', 'it is still shown in the box it was confirmed in');
  assert.equal(reasons[1].confidence, 'probable');
  assert.equal(reasons[1].fresh, false);
  assert.deepStrictEqual(reasons[1].evidence.map((e) => e.rank), [4]);
  assert.match(reasons[1].why, /Confirm it again/);
  assert.equal(identity.writable(reasons[1].confidence), false, 'and it writes nothing');
});

test('a photograph that contradicts the confirmation reports a replacement, and binds nothing', () => {
  const first = snapshotOf([{ uid: 'dev:a', name: 'U10 box', ports: 24, model: 'TL-SG2428P', make: 'TP-Link' }]);
  const s = sw({ id: 1, ports: 24, chassisId: '30:DE:4B:23:70:AC' });
  confirmHere(first, s, 'dev:a');

  // The same shelf, a different box in it: the hardware was replaced (10.3).
  const later = snapshotOf([{ uid: 'dev:a', name: 'U10 box', ports: 24, model: 'WS-C2960X', make: 'Cisco' }],
    { scannedAt: '2026-10-01T09:00:00Z' });
  const { matches, reasons } = ask(later, [s]);
  assert.equal(matches[1], null);
  assert.equal(reasons[1].confidence, 'unidentified');
  assert.match(reasons[1].why, /is not the box that is there now/);
  assert.match(reasons[1].why, /TL-SG2428P.*WS-C2960X/);
});

test('a binding to a box this photograph does not show is a note, not a veto', () => {
  // It used to blank the switch outright and skip scoring, so a switch that moved
  // one shelf lost its model, its serial, its real ports and its cables, and the
  // only way back was a confirm that nothing in the app could send.
  const first = snapshotOf([{ uid: 'dev:u10', name: 'U10 box', ports: 24, position: 10 }]);
  const s = sw({ id: 1, ports: 24, chassisId: '30:DE:4B:23:70:AC' });
  confirmHere(first, s, 'dev:u10');

  const moved = snapshotOf([{ uid: 'dev:u12', name: 'U12 box', ports: 24, position: 12 }],
    { scannedAt: '2026-10-01T09:00:00Z' });
  const { matches, reasons } = ask(moved, [s]);
  assert.equal(matches[1], 'dev:u12', 'scoring still runs');
  assert.equal(reasons[1].confidence, 'possible');
  assert.ok(reasons[1].notes.some((n) => /photograph does not show/.test(n)),
    `the recollection should be reported, got ${JSON.stringify(reasons[1].notes)}`);
});

test('a remembered shelf settles a tie, and settles it at probable', () => {
  const first = snapshotOf([
    { uid: 'dev:u10', name: 'U10 box', ports: 24, position: 10 },
    { uid: 'dev:u12', name: 'U12 box', ports: 24, position: 12 },
  ]);
  const s = sw({ id: 1, ports: 24, chassisId: '30:DE:4B:23:70:AC' });
  confirmHere(first, s, 'dev:u10');

  // A new photograph in which the camera named the boxes differently, so the old
  // uid is gone but U10 is still U10.
  const later = snapshotOf([
    { uid: 'dev:new-a', name: 'U10 box', ports: 24, position: 10 },
    { uid: 'dev:new-b', name: 'U12 box', ports: 24, position: 12 },
  ], { scannedAt: '2026-10-01T09:00:00Z' });
  const { matches, reasons } = ask(later, [s]);
  assert.equal(matches[1], 'dev:new-a');
  assert.equal(reasons[1].confidence, 'probable');
  assert.ok(reasons[1].evidence.some((e) => e.rank === 4));
  assert.equal(identity.writable(reasons[1].confidence), false);
});

test('a confirmation found only by a name or an address is named, and bound to nothing', () => {
  const snap = snapshotOf([
    { uid: 'dev:a', name: 'U10 box', ports: 24, position: 10 },
    { uid: 'dev:b', name: 'U12 box', ports: 48, position: 12 },
  ]);
  const read = sw({ id: 1, host: '10.10.1.11', ports: 24, serial: '222B0K4000121', sysName: 'sw-a' });
  confirmHere(snap, read, 'dev:a');

  // Read again through a path that gives no serial and no chassis address.
  const thin = sw({ id: 1, host: '10.10.1.11', ports: 24, sysName: 'sw-a' });
  const { matches, reasons } = ask(snap, [thin]);
  assert.equal(matches[1], 'dev:a', 'scoring still places it');
  assert.equal(reasons[1].fromBinding, false, 'but not on the strength of a name');
  assert.ok(reasons[1].notes.some((n) => /did not publish/.test(n)),
    `say the confirmation exists, got ${JSON.stringify(reasons[1].notes)}`);
});

test('a binding takes its box out of the running for every other switch', () => {
  const snap = snapshotOf([
    { uid: 'dev:a', name: 'U10 box', ports: 24, position: 10 },
    { uid: 'dev:b', name: 'U12 box', ports: 48, position: 12 },
  ]);
  const one = sw({ id: 1, ports: 24, chassisId: '30:DE:4B:23:70:AC' });
  const two = sw({ id: 2, ports: 24, chassisId: 'AA:BB:CC:DD:EE:FF' });
  confirmHere(snap, one, 'dev:a');

  const { matches, reasons } = ask(snap, [one, two]);
  assert.equal(matches[1], 'dev:a');
  assert.equal(matches[2], null);
  assert.match(reasons[2].why, /no box in this rack (looks like it|has the right number of sockets)/);
});

// ── 2. ties are blank ────────────────────────────────────────────────────────

test('two identical switches and two identical boxes: both blank, with what would settle it', () => {
  const snap = snapshotOf([
    { uid: 'dev:a', name: 'U10 box', ports: 24, position: 10 },
    { uid: 'dev:b', name: 'U12 box', ports: 24, position: 12 },
  ]);
  const one = sw({ id: 1, ports: 24 });
  const two = sw({ id: 2, ports: 24 });
  const { matches, reasons } = ask(snap, [one, two]);

  assert.equal(matches[1], null);
  assert.equal(matches[2], null);
  for (const id of [1, 2]) {
    assert.equal(reasons[id].confidence, 'unidentified');
    assert.equal(reasons[id].deviceUid, null);
    assert.equal(reasons[id].candidateCount, 2);
    assert.equal(reasons[id].margin, 0);
    assert.match(reasons[id].why, /cannot be told apart/);
    assert.match(reasons[id].why, /serial number, a chassis address or somebody at the rack/);
  }
});

test('an exact port count against a near miss is one answer, not a tie', () => {
  // The camera counts ports off a photograph, so a box beside the right one
  // routinely reads two ports out. Scored, that is 60 against 36 - a gap of 24,
  // which any fixed margin near the size of the port score swallows, and the
  // rack that matched yesterday goes blank today for no reason a person can see.
  const snap = snapshotOf([
    { uid: 'dev:a', name: 'U10 box', ports: 24, position: 10 },
    { uid: 'dev:b', name: 'U12 box', ports: 26, position: 12 },
  ]);
  const { matches, reasons } = ask(snap, [sw({ id: 1, ports: 24 })]);
  assert.equal(matches[1], 'dev:a');
  assert.match(reasons[1].why, /exact 24 ports/);
  assert.equal(reasons[1].candidateCount, 2, 'the near miss was still a candidate');
});

test('two boxes at the same near miss are still a tie', () => {
  const snap = snapshotOf([
    { uid: 'dev:a', name: 'U10 box', ports: 26, position: 10 },
    { uid: 'dev:b', name: 'U12 box', ports: 26, position: 12 },
  ]);
  const { matches, reasons } = ask(snap, [sw({ id: 1, ports: 24 })]);
  assert.equal(matches[1], null);
  assert.match(reasons[1].why, /cannot be told apart/);
});

test('a clear winner is still proposed', () => {
  const snap = snapshotOf([
    { uid: 'dev:a', name: 'U10 box', ports: 24, position: 10 },
    { uid: 'dev:b', name: 'U12 box', ports: 48, position: 12 },
  ]);
  const { matches, reasons } = ask(snap, [sw({ id: 1, ports: 24 })]);
  assert.equal(matches[1], 'dev:a');
  assert.equal(reasons[1].candidateCount, 1);
  assert.match(reasons[1].why, /the only box it could be/);
});

test('a model agreement beats a port count, and is not a tie', () => {
  const snap = snapshotOf([
    { uid: 'dev:a', name: 'U10 box', ports: 24, model: 'TL-SG2428P', make: 'TP-Link', position: 10 },
    { uid: 'dev:b', name: 'U12 box', ports: 24, position: 12 },
  ]);
  const s = sw({ id: 1, ports: 24, model: 'TL-SG2428P', vendor: 'TP-Link' });
  const { matches, reasons } = ask(snap, [s]);
  assert.equal(matches[1], 'dev:a');
  assert.ok(reasons[1].margin > 25, `margin ${reasons[1].margin} should clear the runner-up`);
  assert.equal(reasons[1].candidateCount, 2);
});

// ── 3. a port count is rank 8 and tops out at possible ───────────────────────

test('a port count alone is rank 8 evidence and never better than possible', () => {
  const snap = snapshotOf([
    { uid: 'dev:a', name: 'U10 box', ports: 24, position: 10 },
    { uid: 'dev:b', name: 'U12 box', ports: 48, position: 12 },
  ]);
  const { reasons } = ask(snap, [sw({ id: 1, ports: 24 })]);
  assert.equal(reasons[1].confidence, 'possible');
  assert.deepStrictEqual(reasons[1].evidence.map((e) => e.rank), [8]);
  assert.equal(reasons[1].evidence[0].source, 'inferred');
});

test('even a model and a make agreement is only possible, because shape is not identity', () => {
  const snap = snapshotOf([
    { uid: 'dev:a', name: 'U10 box', ports: 24, model: 'TL-SG2428P', make: 'TP-Link' },
  ]);
  const s = sw({ id: 1, ports: 24, model: 'TL-SG2428P', vendor: 'TP-Link' });
  const { reasons } = ask(snap, [s]);
  assert.equal(reasons[1].confidence, 'possible');
});

// ── 4. size is advice, and the stack rule is about the rack ──────────────────

test('a multi-shelf chassis switch is not deleted by a class ceiling', () => {
  // The guide lists a network switch as 1U-2U and says in the same table that the
  // figures are representative and must be checked against the manufacturer. As a
  // ceiling it removed every chassis switch, and every box whose span the detector
  // merged from two shelves, from every rack.
  const snap = snapshotOf([{ uid: 'dev:a', name: 'U10 chassis', ports: 48, units: 7, cvClass: 'Switch' }]);
  const { matches, reasons } = ask(snap, [sw({ id: 1, ports: 48 })]);
  assert.equal(matches[1], 'dev:a');
  assert.ok(reasons[1].notes.some((n) => /usually 1 to 2 rack units/.test(n)),
    `the size should be reported, got ${JSON.stringify(reasons[1].notes)}`);
});

test('an unusual size never turns a tie into an answer', () => {
  // Two boxes that cannot be told apart, one of them taller than its class
  // usually is. Dropping the tall one for its size answered a question nobody
  // could answer, at the confidence of one that could be.
  const snap = snapshotOf([
    { uid: 'dev:a', name: 'U10 box', ports: 24, units: 1, cvClass: 'Switch', position: 10 },
    { uid: 'dev:b', name: 'U20 box', ports: 24, units: 4, cvClass: 'Switch', position: 20 },
  ]);
  const { matches, reasons } = ask(snap, [sw({ id: 1, ports: 24 })]);
  assert.equal(matches[1], null);
  assert.equal(reasons[1].candidateCount, 2);
  assert.match(reasons[1].why, /cannot be told apart/);
});

test('a stack matches the box one of its members sits in', () => {
  // A stack is separate 1U chassis and the camera draws one box per chassis, so
  // no box in a real rack is ever as tall as the member count. Demanding one was
  // how a stack came to match nothing at all in its own rack.
  const snap = snapshotOf([
    { uid: 'dev:a', name: 'U10 box', ports: 24, units: 1, position: 10, model: 'WS-C2960X-24TS-L', make: 'Cisco' },
    { uid: 'dev:b', name: 'U11 box', ports: 24, units: 1, position: 11 },
  ]);
  const s = sw({ id: 1, ports: 48, model: 'WS-C2960X-24TS-L', vendor: 'Cisco', stackMembers: 2,
    members: [{ serial: 'FOC1' }, { serial: 'FOC2' }] });
  const { matches, reasons } = ask(snap, [s]);
  assert.equal(matches[1], 'dev:a');
  assert.match(reasons[1].why, /one member of a stack of 2/);
});

test('a stack needs enough boxes in the rack to sit in', () => {
  const snap = snapshotOf([{ uid: 'dev:a', name: 'U10 box', ports: 24, units: 1 }]);
  const s = sw({ id: 1, ports: 48, stackMembers: 3,
    members: [{ serial: 'FOC1' }, { serial: 'FOC2' }, { serial: 'FOC3' }] });
  const { matches, reasons } = ask(snap, [s]);
  assert.equal(matches[1], null);
  assert.match(reasons[1].why, /stack of 3 separate units and this rack has only 1 box/);
});

test('chassis rows with no separate serials are not a stack', () => {
  // stackMembers is a count of the rows the device calls a chassis, not a
  // measurement. A single 1U switch that lists two of them lost its match, its
  // serial and its cables, and was told it was a stack.
  const snap = snapshotOf([{ uid: 'dev:a', name: 'U10 box', ports: 48, units: 1 }]);
  const s = sw({ id: 1, ports: 48, stackMembers: 2, members: [{ serial: null }, { serial: null }] });
  const { matches, reasons } = ask(snap, [s]);
  assert.equal(matches[1], 'dev:a');
  assert.match(reasons[1].why, /exact 48 ports/);
  assert.ok(reasons[1].notes.some((n) => /2 chassis entries/.test(n)));
});

// ── 5. one box, one switch ───────────────────────────────────────────────────

test('two switches that both read as one box both go blank', () => {
  // Only one box could be either of them, and it cannot be both.
  const snap = snapshotOf([
    { uid: 'dev:a', name: 'U10 box', ports: 24, position: 10 },
    { uid: 'dev:b', name: 'U12 box', ports: 48, position: 12 },
  ]);
  const one = sw({ id: 1, label: 'sw-one', ports: 24 });
  const two = sw({ id: 2, label: 'sw-two', ports: 24 });
  const { matches, reasons } = ask(snap, [one, two]);
  assert.equal(matches[1], null);
  assert.equal(matches[2], null);
  assert.match(reasons[1].why, /sw-two read as the same box as this one/);
  assert.match(reasons[2].why, /sw-one read as the same box as this one/);
});

// ── 6. determinism ───────────────────────────────────────────────────────────

test('reversing the switch list changes nothing', () => {
  const snap = snapshotOf([
    { uid: 'dev:a', name: 'U10 box', ports: 24, position: 10 },
    { uid: 'dev:b', name: 'U12 box', ports: 48, position: 12 },
    { uid: 'dev:c', name: 'U14 box', ports: 24, model: 'TL-SG2428P', make: 'TP-Link', position: 14 },
    { uid: 'dev:d', name: 'U16 box', ports: 8, position: 16 },
  ]);
  const list = [
    sw({ id: 1, ports: 48 }),
    sw({ id: 2, ports: 24, model: 'TL-SG2428P', vendor: 'TP-Link' }),
    sw({ id: 3, ports: 8 }),
    sw({ id: 4, ports: 24, chassisId: 'AA:BB:CC:DD:EE:FF' }),
  ];
  confirmHere(snap, list[3], 'dev:a');

  const forwards = ask(snap, list);
  const backwards = ask(snap, [...list].reverse());
  assert.deepStrictEqual(backwards, forwards);
  // And it actually decided something, so the comparison is not of two blanks.
  assert.equal(forwards.matches[4], 'dev:a');
  assert.equal(forwards.matches[1], 'dev:b');
  assert.equal(forwards.matches[2], 'dev:c');
  assert.equal(forwards.matches[3], 'dev:d');
});

test('the same inputs twice give the same answer', () => {
  const snap = snapshotOf([
    { uid: 'dev:a', name: 'U10 box', ports: 24, position: 10 },
    { uid: 'dev:b', name: 'U12 box', ports: 24, position: 12 },
  ]);
  const list = [sw({ id: 1, ports: 24 }), sw({ id: 2, ports: 48 })];
  assert.deepStrictEqual(ask(snap, list), ask(snap, list));
});

// ── 7. passive boxes, and a switch nobody read ───────────────────────────────

test('nothing that cannot answer SNMP is ever a candidate', () => {
  // The engine emits UPS, PSU and Closed Unit as well as the three that were
  // listed here, and none of them has anything to answer SNMP with.
  const snap = snapshotOf([
    { uid: 'dev:pp', name: 'U01 panel', ports: 24, cvClass: 'Patch Panel', position: 1 },
    { uid: 'dev:pdu', name: 'U02 strip', ports: 24, cvClass: 'PDU', position: 2 },
    { uid: 'dev:empty', name: 'U03 empty', ports: 24, cvClass: 'Empty', position: 3 },
    { uid: 'dev:ups', name: 'U04 ups', ports: 24, cvClass: 'UPS', position: 4 },
    { uid: 'dev:psu', name: 'U06 psu', ports: 24, cvClass: 'PSU', position: 6 },
    { uid: 'dev:shut', name: 'U07 blank', ports: 24, cvClass: 'Closed Unit', position: 7 },
  ]);
  const { matches, reasons } = ask(snap, [sw({ id: 1, ports: 24 })]);
  assert.equal(matches[1], null);
  assert.equal(reasons[1].candidateCount, 0);
  for (const d of reconcile.cameraDevices(snap)) {
    assert.equal(d.passive, true, `${d.name} should be flagged for the pickers`);
  }
});

test('a switch nobody has read yet says so rather than being matched on nothing', () => {
  const snap = snapshotOf([{ uid: 'dev:a', name: 'U10 box', ports: 24 }]);
  const { matches, reasons } = ask(snap, [sw({ id: 1, read: false })]);
  assert.equal(matches[1], null);
  assert.match(reasons[1].why, /has not been read yet/);
  assert.equal(reasons[1].fromBinding, false);
});

test('no switches at all is an empty answer, not a crash', () => {
  const snap = snapshotOf([{ uid: 'dev:a', name: 'U10 box', ports: 24 }]);
  assert.deepStrictEqual(ask(snap, []), { matches: {}, reasons: {} });
});

test('a rack with no boxes leaves every switch blank', () => {
  const { matches, reasons } = ask(snapshotOf([]), [sw({ id: 1, ports: 24 })]);
  assert.equal(matches[1], null);
  assert.equal(reasons[1].candidateCount, 0);
});

// ── the scope, which the caller must give ────────────────────────────────────

test('a caller that does not say which rack is refused, not guessed at', () => {
  // The fallback derived the scope from the snapshot's rack uid and left the
  // tenant off, so it read a different file from the one the route writes: a
  // confirmed box came back as unidentified, silently, for any caller that forgot.
  const snap = snapshotOf([{ uid: 'dev:a', name: 'U10 box', ports: 24 }]);
  assert.throws(() => reconcile.suggest(snap, [sw({ id: 1, ports: 24 })]), /needs opts\.scope/);
  assert.throws(() => reconcile.suggest(snap, [sw({ id: 1, ports: 24 })], {}), /needs opts\.scope/);
});

// ── 8. what any of it is allowed to write ────────────────────────────────────

test('a possible match is shown and written nowhere', () => {
  const snap = snapshotOf([{ uid: 'dev:a', name: 'U10 box', ports: 24 }]);
  const s = sw({ id: 1, ports: 24, serial: 'SN-POSSIBLE-1', model: 'TL-SG2428P', vendor: 'TP-Link' });
  const { matches, reasons } = ask(snap, [s]);
  assert.equal(matches[1], 'dev:a');
  assert.equal(reasons[1].confidence, 'possible');

  const levels = reconcile.levelsFor(reasons, matches);
  const { snapshot, summary } = reconcile.reconcile(snap, [s], matches, { levels });
  const dev = snapshot.devices.find((d) => d.uid === 'dev:a');
  assert.equal(dev.serial, null, 'a port count agreement is not a serial number');
  assert.equal(dev.customFields, undefined, 'and not a management address either');
  assert.deepStrictEqual(summary.changes, []);
  assert.equal(summary.written, 0);
  assert.equal(summary.withheld.length, 1);
  assert.match(summary.withheld[0].why, /shown, not written/);
});

test('a confirmed match writes the switch facts onto the box, and leaves the box itself alone', () => {
  const snap = snapshotOf([{ uid: 'dev:a', name: 'U10 box', ports: 24, position: 10 }]);
  const s = sw({ id: 1, ports: 24, serial: '222B0K4000121', model: 'TL-SG2428P',
    vendor: 'TP-Link', chassisId: '30:DE:4B:23:70:AC' });
  confirmHere(snap, s, 'dev:a');

  const { matches, reasons } = ask(snap, [s]);
  const levels = reconcile.levelsFor(reasons, matches);
  const { snapshot, summary } = reconcile.reconcile(snap, [s], matches, { levels });
  const dev = snapshot.devices.find((d) => d.uid === 'dev:a');
  assert.equal(dev.serial, '222B0K4000121');
  assert.equal(dev.customFields.managementIp, '10.10.1.1');
  assert.equal(summary.written, 1);
  assert.deepStrictEqual(summary.withheld, []);
  // Design rule 3: the box is written as it always was. Its name and its shelf
  // are the camera's, and the binding level never decides whether a row exists.
  assert.equal(dev.name, 'U10 box');
  assert.equal(dev.position, 10);
  assert.equal(snapshot.devices.length, snap.devices.length);
});

test('a hand placement that disagrees with the reasoning writes nothing', () => {
  // Somebody moved a dropdown. That is worth storing and worth showing; it is
  // not a person at the rack, and it is not evidence about hardware.
  const snap = snapshotOf([
    { uid: 'dev:a', name: 'U10 box', ports: 24, position: 10 },
    { uid: 'dev:b', name: 'U12 box', ports: 48, position: 12 },
  ]);
  const s = sw({ id: 1, ports: 24, serial: 'SN-HAND-1' });
  const { reasons } = ask(snap, [s]);
  const byHand = { 1: 'dev:b' };
  const levels = reconcile.levelsFor(reasons, byHand);
  assert.equal(levels[1], 'unidentified');
  const { snapshot } = reconcile.reconcile(snap, [s], byHand, { levels });
  assert.equal(snapshot.devices.find((d) => d.uid === 'dev:b').serial, null);
});

test('reconcile refuses to run without being told what may be written', () => {
  const snap = snapshotOf([{ uid: 'dev:a', name: 'U10 box', ports: 24 }]);
  assert.throws(() => reconcile.reconcile(snap, [sw({ id: 1, ports: 24 })], { 1: 'dev:a' }),
    /needs opts\.levels/);
});

// ── every reason carries the fields the report and the screen need ───────────

test('every reason carries evidence, confidence, candidateCount, margin and fromBinding', () => {
  const snap = snapshotOf([
    { uid: 'dev:a', name: 'U10 box', ports: 24, position: 10 },
    { uid: 'dev:b', name: 'U12 box', ports: 24, position: 12 },
  ]);
  const list = [sw({ id: 1, ports: 24 }), sw({ id: 2, ports: 48 })];
  const { reasons } = ask(snap, list);
  for (const id of [1, 2]) {
    const r = reasons[id];
    assert.ok(r, `switch ${id} should have a reason`);
    for (const field of ['deviceUid', 'confidence', 'why', 'evidence', 'candidateCount',
      'margin', 'fromBinding', 'fresh', 'notes']) {
      assert.ok(Object.prototype.hasOwnProperty.call(r, field), `${field} missing on switch ${id}`);
    }
    assert.ok(['confirmed', 'probable', 'possible', 'unidentified'].includes(r.confidence));
    assert.ok(Array.isArray(r.evidence));
    assert.ok(Array.isArray(r.notes));
    assert.equal(typeof r.fromBinding, 'boolean');
    assert.ok(r.why.length > 10, 'a reason has to be readable');
    // House rule: the plain hyphen, never a long dash, in anything a person reads.
    assert.ok(!/[–—]/.test(r.why), 'plain hyphen only');
    for (const note of r.notes) assert.ok(!/[–—]/.test(note), 'plain hyphen only');
  }
});
