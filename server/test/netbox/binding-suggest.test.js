/**
 * Matching a switch to a box: what it proposes, and when it says nothing.
 *
 * The rules being checked:
 *   1. a stored binding wins outright - confirmed, from the binding, whatever the
 *      port counts say;
 *   2. two boxes that cannot be told apart go BLANK. Our own office rack holds
 *      two identical switches, so a matcher that cannot answer "I do not know" is
 *      wrong. The reason has to say what would settle it;
 *   3. a port count alone can never be better than 'possible', and it is rank 8
 *      evidence, never anything stronger;
 *   4. the size veto: a reading that cannot fit the box is not a candidate for it.
 *      The rack unit figures come from the "Device Size and Rack Unit Occupancy"
 *      table in docs/reference/rack-planning-guide.html;
 *   5. two switches that both read as one box both go blank - one box holds one
 *      switch, and neither of them gets to be the lucky one;
 *   6. deterministic: reversing the switch list changes nothing;
 *   7. a passive box is never a candidate, and a switch nobody has read yet says
 *      so rather than being matched on nothing.
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
const SCOPE = bindings.scopeOf({ rackKey: 't7:5' });

beforeEach(() => { fs.rmSync(bindings.DIR, { recursive: true, force: true }); });
after(() => { fs.rmSync(TMP, { recursive: true, force: true }); });

/**
 * A camera snapshot with the fields cameraDevices reads, and nothing else.
 *
 * `boxes` entries: { uid, name, ports, model, make, cvClass, units, position }.
 */
function snapshotOf(boxes) {
  const snap = {
    racks: [{ uid: RACK_UID }],
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
      uid: b.uid, name: b.name, position: first, deviceTypeUid: typeUid, serial: null,
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
  serial = null, chassisId = null, sysName = null, stackMembers = 1, read = true }) {
  return {
    record: { id, label: label || `switch ${id}`, host },
    reading: read ? {
      localChassisId: chassisId,
      identity: { model, serial, manufacturer: vendor, stackMembers, members: [] },
      system: { sysName, vendor },
      counts: { interfaces: ports },
      interfaces: [],
      neighbours: [],
    } : null,
  };
}

const aliasesFor = (s) => identity.aliasesOf({ ...s.reading, host: s.record.host });

// ── 1. a binding wins outright ───────────────────────────────────────────────

test('a stored binding wins outright, whatever the port counts say', () => {
  // The box the person confirmed has the WRONG port count on purpose: the camera
  // counted 12 ports on a box holding a 24 port switch, because half the row was
  // in shadow. Scoring would reject it. The person's answer does not care.
  const snap = snapshotOf([
    { uid: 'dev:a', name: 'U10 box', ports: 12 },
    { uid: 'dev:b', name: 'U12 box', ports: 24 },
  ]);
  const s = sw({ id: 1, ports: 24, chassisId: '30:DE:4B:23:70:AC' });
  bindings.confirm(SCOPE, { aliases: aliasesFor(s), deviceUid: 'dev:a', position: 10 });

  const { matches, reasons } = reconcile.suggest(snap, [s], { scope: SCOPE });
  assert.equal(matches[1], 'dev:a');
  assert.equal(reasons[1].confidence, 'confirmed');
  assert.equal(reasons[1].fromBinding, true);
  assert.equal(reasons[1].candidateCount, 1);
  assert.match(reasons[1].why, /confirmed before as U10 box, matched on its chassis/);
  // Rank 1 for the person's act, rank 4 for the fact that we are recalling it.
  assert.deepStrictEqual(reasons[1].evidence.map((e) => e.rank), [1, 4]);
});

test('a binding found by one reading holds for the next reading of the same switch', () => {
  const snap = snapshotOf([
    { uid: 'dev:a', name: 'U10 box', ports: 24 },
    { uid: 'dev:b', name: 'U12 box', ports: 24 },
  ]);
  // Confirmed off a reading that had a serial.
  const first = sw({ id: 1, ports: 24, serial: '222B0K4000121', chassisId: '30:DE:4B:23:70:AC' });
  bindings.confirm(SCOPE, { aliases: aliasesFor(first), deviceUid: 'dev:b', position: 12 });
  // Read again later: no serial this time, renamed, readdressed.
  const later = sw({ id: 1, host: '10.20.30.40', ports: 24, chassisId: '30de4b2370ac', sysName: 'core-1' });
  const { matches, reasons } = reconcile.suggest(snap, [later], { scope: SCOPE });
  assert.equal(matches[1], 'dev:b');
  assert.equal(reasons[1].fromBinding, true);
});

test('a switch bound to a box this photograph does not show says so, and matches nothing', () => {
  const snap = snapshotOf([{ uid: 'dev:a', name: 'U10 box', ports: 24 }]);
  const s = sw({ id: 1, ports: 24, chassisId: '30:DE:4B:23:70:AC' });
  bindings.confirm(SCOPE, { aliases: aliasesFor(s), deviceUid: 'dev:gone', position: 40 });
  const { matches, reasons } = reconcile.suggest(snap, [s], { scope: SCOPE });
  assert.equal(matches[1], null);
  assert.equal(reasons[1].confidence, 'unidentified');
  assert.match(reasons[1].why, /this photograph does not show/);
});

test('a binding takes its box out of the running for every other switch', () => {
  const snap = snapshotOf([
    { uid: 'dev:a', name: 'U10 box', ports: 24 },
    { uid: 'dev:b', name: 'U12 box', ports: 48 },
  ]);
  const one = sw({ id: 1, ports: 24, chassisId: '30:DE:4B:23:70:AC' });
  const two = sw({ id: 2, ports: 24, chassisId: 'AA:BB:CC:DD:EE:FF' });
  bindings.confirm(SCOPE, { aliases: aliasesFor(one), deviceUid: 'dev:a', position: 10 });

  const { matches, reasons } = reconcile.suggest(snap, [one, two], { scope: SCOPE });
  assert.equal(matches[1], 'dev:a');
  assert.equal(matches[2], null);
  assert.match(reasons[2].why, /no box in this rack looks like it/);
});

// ── 2. ties are blank ────────────────────────────────────────────────────────

test('two identical switches and two identical boxes: both blank, with what would settle it', () => {
  const snap = snapshotOf([
    { uid: 'dev:a', name: 'U10 box', ports: 24, position: 10 },
    { uid: 'dev:b', name: 'U12 box', ports: 24, position: 12 },
  ]);
  const one = sw({ id: 1, ports: 24 });
  const two = sw({ id: 2, ports: 24 });
  const { matches, reasons } = reconcile.suggest(snap, [one, two], { scope: SCOPE });

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

test('a clear winner is still proposed', () => {
  const snap = snapshotOf([
    { uid: 'dev:a', name: 'U10 box', ports: 24, position: 10 },
    { uid: 'dev:b', name: 'U12 box', ports: 48, position: 12 },
  ]);
  const { matches, reasons } = reconcile.suggest(snap, [sw({ id: 1, ports: 24 })], { scope: SCOPE });
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
  const { matches, reasons } = reconcile.suggest(snap, [s], { scope: SCOPE });
  assert.equal(matches[1], 'dev:a');
  assert.ok(reasons[1].margin > 25, `margin ${reasons[1].margin} should clear the margin`);
  assert.equal(reasons[1].candidateCount, 2);
});

// ── 3. a port count is rank 8 and tops out at possible ───────────────────────

test('a port count alone is rank 8 evidence and never better than possible', () => {
  const snap = snapshotOf([
    { uid: 'dev:a', name: 'U10 box', ports: 24, position: 10 },
    { uid: 'dev:b', name: 'U12 box', ports: 48, position: 12 },
  ]);
  const { reasons } = reconcile.suggest(snap, [sw({ id: 1, ports: 24 })], { scope: SCOPE });
  assert.equal(reasons[1].confidence, 'possible');
  assert.deepStrictEqual(reasons[1].evidence.map((e) => e.rank), [8]);
  assert.equal(reasons[1].evidence[0].source, 'inferred');
});

test('even a model and a make agreement is only possible, because shape is not identity', () => {
  const snap = snapshotOf([
    { uid: 'dev:a', name: 'U10 box', ports: 24, model: 'TL-SG2428P', make: 'TP-Link' },
  ]);
  const s = sw({ id: 1, ports: 24, model: 'TL-SG2428P', vendor: 'TP-Link' });
  const { reasons } = reconcile.suggest(snap, [s], { scope: SCOPE });
  assert.equal(reasons[1].confidence, 'possible');
});

// ── 4. the size veto ─────────────────────────────────────────────────────────

test('a stack of three cannot be a box on one shelf', () => {
  const snap = snapshotOf([{ uid: 'dev:a', name: 'U10 box', ports: 24, units: 1 }]);
  const s = sw({ id: 1, ports: 24, stackMembers: 3 });
  const { matches, reasons } = reconcile.suggest(snap, [s], { scope: SCOPE });
  assert.equal(matches[1], null);
  assert.equal(reasons[1].candidateCount, 0);
  assert.match(reasons[1].why, /no box in this rack fits it/);
  assert.match(reasons[1].why, /stack of 3, which needs at least 3 shelves/);
});

test('a stack of three does fit a box three shelves tall', () => {
  const snap = snapshotOf([{ uid: 'dev:a', name: 'U10 box', ports: 24, units: 3 }]);
  const s = sw({ id: 1, ports: 24, stackMembers: 3 });
  assert.equal(reconcile.suggest(snap, [s], { scope: SCOPE }).matches[1], 'dev:a');
});

test('a single switch is not the four shelf box the camera called a switch', () => {
  const snap = snapshotOf([{ uid: 'dev:a', name: 'U10 box', ports: 24, units: 4, cvClass: 'Switch' }]);
  const { matches, reasons } = reconcile.suggest(snap, [sw({ id: 1, ports: 24 })], { scope: SCOPE });
  assert.equal(matches[1], null);
  assert.match(reasons[1].why, /takes up to 2 rack units, and this box takes up 4/);
});

test('a box class the guide does not name gets no ceiling', () => {
  // The camera could not say what it is, so we do not get to say it is too big.
  const snap = snapshotOf([{ uid: 'dev:a', name: 'U10 box', ports: 24, units: 4, cvClass: 'Unidentified' }]);
  assert.equal(reconcile.suggest(snap, [sw({ id: 1, ports: 24 })], { scope: SCOPE }).matches[1], 'dev:a');
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
  const { matches, reasons } = reconcile.suggest(snap, [one, two], { scope: SCOPE });
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
  bindings.confirm(SCOPE, { aliases: aliasesFor(list[3]), deviceUid: 'dev:a', position: 10 });

  const forwards = reconcile.suggest(snap, list, { scope: SCOPE });
  const backwards = reconcile.suggest(snap, [...list].reverse(), { scope: SCOPE });
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
  assert.deepStrictEqual(
    reconcile.suggest(snap, list, { scope: SCOPE }),
    reconcile.suggest(snap, list, { scope: SCOPE }),
  );
});

// ── 7. passive boxes, and a switch nobody read ───────────────────────────────

test('a patch panel, a PDU and an empty shelf are never candidates', () => {
  const snap = snapshotOf([
    { uid: 'dev:pp', name: 'U01 panel', ports: 24, cvClass: 'Patch Panel', position: 1 },
    { uid: 'dev:pdu', name: 'U02 strip', ports: 24, cvClass: 'PDU', position: 2 },
    { uid: 'dev:empty', name: 'U03 empty', ports: 24, cvClass: 'Empty', position: 3 },
  ]);
  const { matches, reasons } = reconcile.suggest(snap, [sw({ id: 1, ports: 24 })], { scope: SCOPE });
  assert.equal(matches[1], null);
  assert.equal(reasons[1].candidateCount, 0);
});

test('a switch nobody has read yet says so rather than being matched on nothing', () => {
  const snap = snapshotOf([{ uid: 'dev:a', name: 'U10 box', ports: 24 }]);
  const { matches, reasons } = reconcile.suggest(snap, [sw({ id: 1, read: false })], { scope: SCOPE });
  assert.equal(matches[1], null);
  assert.match(reasons[1].why, /has not been read yet/);
  assert.equal(reasons[1].fromBinding, false);
});

test('no switches at all is an empty answer, not a crash', () => {
  const snap = snapshotOf([{ uid: 'dev:a', name: 'U10 box', ports: 24 }]);
  assert.deepStrictEqual(reconcile.suggest(snap, [], { scope: SCOPE }), { matches: {}, reasons: {} });
});

test('a rack with no boxes leaves every switch blank', () => {
  const { matches, reasons } = reconcile.suggest(snapshotOf([]), [sw({ id: 1, ports: 24 })], { scope: SCOPE });
  assert.equal(matches[1], null);
  assert.equal(reasons[1].candidateCount, 0);
});

// ── the scope, when the caller does not pass one ──────────────────────────────

test('without a scope the rack uid in the snapshot is the scope', () => {
  const snap = snapshotOf([{ uid: 'dev:a', name: 'U10 box', ports: 12 }]);
  const s = sw({ id: 1, ports: 24, chassisId: '30:DE:4B:23:70:AC' });
  bindings.confirm(bindings.scopeOf({ rackKey: 't7:5' }), {
    aliases: aliasesFor(s), deviceUid: 'dev:a', position: 10,
  });
  // No scope passed: derived from racks[0].uid, which is rack:t7:5.
  assert.equal(reconcile.suggest(snap, [s]).matches[1], 'dev:a');
});

// ── every reason carries the fields the report and the screen need ───────────

test('every reason carries evidence, confidence, candidateCount, margin and fromBinding', () => {
  const snap = snapshotOf([
    { uid: 'dev:a', name: 'U10 box', ports: 24, position: 10 },
    { uid: 'dev:b', name: 'U12 box', ports: 24, position: 12 },
  ]);
  const list = [sw({ id: 1, ports: 24 }), sw({ id: 2, ports: 48 })];
  const { reasons } = reconcile.suggest(snap, list, { scope: SCOPE });
  for (const id of [1, 2]) {
    const r = reasons[id];
    assert.ok(r, `switch ${id} should have a reason`);
    for (const field of ['deviceUid', 'confidence', 'why', 'evidence', 'candidateCount', 'margin', 'fromBinding']) {
      assert.ok(Object.prototype.hasOwnProperty.call(r, field), `${field} missing on switch ${id}`);
    }
    assert.ok(['confirmed', 'probable', 'possible', 'unidentified'].includes(r.confidence));
    assert.ok(Array.isArray(r.evidence));
    assert.equal(typeof r.fromBinding, 'boolean');
    assert.ok(r.why.length > 10, 'a reason has to be readable');
    // House rule: the plain hyphen, never a long dash, in anything a person reads.
    assert.ok(!/[–—]/.test(r.why), 'plain hyphen only');
  }
});
