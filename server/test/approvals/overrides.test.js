/**
 * What a person changed on a check, laid over the scan.
 *
 * Pure: a snapshot and override rows in, a snapshot out. What is pinned here
 * is the closed list of what may be changed, what each kind does to the
 * snapshot, and that a box left out of a write takes its own answers with it.
 */
const assert = require('node:assert/strict');
const { describe, it } = require('node:test');

const overrides = require('../../lib/approvals/overrides');
const shape = require('../../lib/approvals/shape');

const U20 = 'dev:t32:16:u20';
const U05 = 'dev:t32:16:u5';
const snapshot = () => ({
  rackUid: 'rack:t32:16',
  recordBinding: { rackNetboxId: 26, deviceNetboxIds: {}, by: 'Aasritha', at: '2026-09-21' },
  manufacturers: [{ uid: 'mfr:unknown', name: 'Unknown' }, { uid: 'mfr:acme', name: 'Acme' }],
  deviceTypes: [
    { uid: 'dtype:router-8', manufacturerUid: 'mfr:acme', model: 'Unidentified Router (8-port)' },
    { uid: 'dtype:server', manufacturerUid: 'mfr:unknown', model: 'Unidentified Server' },
  ],
  deviceRoles: [{ uid: 'role:router', name: 'Router' }, { uid: 'role:server', name: 'Server' }],
  devices: [
    { uid: U20, name: 'Router U20', deviceTypeUid: 'dtype:router-8', roleUid: 'role:router', position: 20, serial: null },
    { uid: U05, name: 'Server U5', deviceTypeUid: 'dtype:server', roleUid: 'role:server', position: 5, serial: null },
  ],
  interfaces: [
    ...[1, 2, 3].map((n) => ({ uid: `if:${U20}:${n}`, deviceUid: U20, name: String(n) })),
    { uid: `if:${U05}:1`, deviceUid: U05, name: '1' },
  ],
  powerPorts: [{ uid: `pp:${U20}:1`, deviceUid: U20, name: 'PSU1' }],
});
const MOVE = { id: 7, kind: 'move', itemUid: U20, netboxId: 199, recordName: 'SP-R1-U20-ACT',
  fields: { position: { from: 22, to: 20 } }, shown: { name: 'SP-R1-U20-ACT', position: 22, serial: null },
  createdBy: 'dc007.spoc', createdAt: '2026-09-22T09:00:00Z' };
const OFFLINE = { id: 8, kind: 'offline', itemUid: null, netboxId: 205, recordName: 'SP-R1-U11-FW',
  fields: { status: { from: 'active', to: 'offline' } } };

describe('what may be changed is a closed list', () => {
  it('takes a shelf move, a mark offline, and a serial, asset tag or description', () => {
    assert.ok(overrides.validate('move', { position: { from: 22, to: 20 } }));
    assert.ok(overrides.validate('move', { position: { from: 22, to: 20 }, face: { from: 'rear', to: 'front' } }));
    assert.ok(overrides.validate('offline', { status: { from: 'active', to: 'offline' } }));
    assert.ok(overrides.validate('value', { serial: { from: null, to: 'FOC1234A1BC' } }));
    assert.ok(overrides.validate('value', { asset_tag: { from: null, to: 'A-100' }, description: { from: '', to: 'core' } }));
  });

  it('refuses everything else, in words', () => {
    assert.throws(() => overrides.validate('rename', { name: { from: 'a', to: 'b' } }), /not a change a person can make/);
    assert.throws(() => overrides.validate('move', { position: { from: 22, to: 20 }, name: { from: 'a', to: 'b' } }),
      /the shelf and nothing else, not name/);
    assert.throws(() => overrides.validate('move', { face: { from: 'rear', to: 'front' } }), /has to name the shelf/);
    assert.throws(() => overrides.validate('move', { position: { from: 22, to: 20.5 } }), /whole number/);
    assert.throws(() => overrides.validate('offline', { status: { from: 'active', to: 'decommissioning' } }),
      /offline and nothing else/);
    for (const field of ['position', 'name', 'role', 'device_type', 'rack', 'site', 'tenant', 'status']) {
      assert.throws(() => overrides.validate('value', { [field]: { from: 1, to: 2 } }),
        /only a serial number, an asset tag or a description/, field);
    }
    assert.throws(() => overrides.validate('value', { serial: 'FOC1' }), /what it was and what it becomes/);
    assert.throws(() => overrides.validate('value', { serial: { from: null, to: 'x'.repeat(51) } }), /50 characters/);
    assert.throws(() => overrides.validate('value', {}), /what it changes/);
  });
});

describe('a shelf move', () => {
  it('binds the box to the record, allows the shelf and nothing else, and takes the box\'s own ports out', () => {
    const snap = overrides.applyTo(snapshot(), [MOVE]);
    assert.equal(snap.recordBinding.deviceNetboxIds[U20], 199);
    assert.equal(snap.recordBinding.rackNetboxId, 26, 'what was already answered about the rack stays');
    assert.deepEqual(snap.recordBinding.shown.devices[U20], { name: 'SP-R1-U20-ACT', position: 22, serial: null });
    assert.equal(snap.recordBinding.by, 'dc007.spoc');
    assert.deepEqual(snap.approvedMoves, { [U20]: { netboxId: 199, fields: { position: { from: 22, to: 20 } } } });
    assert.deepEqual(snap.interfaces.map((i) => i.uid), [`if:${U05}:1`], 'the ports of another box stay');
    assert.deepEqual(snap.powerPorts, [], 'every kind of child goes, not only the ports');
    assert.equal(snap.devices.length, 2, 'the box itself stays');
  });

  it('names the catalogue entries only that box used, and leaves the shared ones', () => {
    const snap = overrides.applyTo(snapshot(), [MOVE]);
    assert.deepEqual(snap.deferScaffolding, ['dtype:router-8', 'mfr:acme', 'role:router']);
    assert.equal(snap.deviceTypes.length, 2, 'nothing is taken out: the box still refers to them');

    const shared = snapshot();
    shared.devices[1].roleUid = 'role:router';
    shared.deviceTypes[0].manufacturerUid = 'mfr:unknown';
    assert.deepEqual(overrides.applyTo(shared, [MOVE]).deferScaffolding, ['dtype:router-8']);
  });

  it('carries the face only when it differs, and is the same applied twice', () => {
    const faced = { ...MOVE, fields: { position: { from: 22, to: 20 }, face: { from: 'rear', to: 'front' } } };
    assert.deepEqual(overrides.applyTo(snapshot(), [faced]).approvedMoves[U20].fields.face, { from: 'rear', to: 'front' });
    const same = { ...MOVE, fields: { position: { from: 22, to: 20 }, face: { from: 'front', to: 'front' } } };
    assert.equal(overrides.applyTo(snapshot(), [same]).approvedMoves[U20].fields.face, undefined);

    const once = overrides.applyTo(snapshot(), [MOVE]);
    const twice = overrides.applyTo(structuredClone(once), [MOVE]);
    assert.deepEqual(twice, once);
  });

  it('does nothing when it was taken back, and nothing at all without overrides', () => {
    assert.deepEqual(overrides.applyTo(snapshot(), [{ ...MOVE, revokedAt: '2026-09-22T10:00:00Z' }]), snapshot());
    assert.deepEqual(overrides.applyTo(snapshot(), []), snapshot());
  });
});

describe('a mark offline and a typed value', () => {
  it('names the record to mark, by its NetBox id, and never a box', () => {
    const snap = overrides.applyTo(snapshot(), [OFFLINE]);
    assert.deepEqual(snap.approvedOffline, { 205: { uid: 'nb:device:205', name: 'SP-R1-U11-FW', from: 'active', to: 'offline' } });
    assert.equal(snap.devices.length, 2);
    assert.equal(snap.approvedMoves, undefined);
  });

  it('puts a typed serial, asset tag and description on the box', () => {
    const snap = overrides.applyTo(snapshot(), [{ kind: 'value', itemUid: U05,
      fields: { serial: { from: null, to: 'FOC1234A1BC' }, asset_tag: { from: null, to: 'A-100' },
        description: { from: '', to: 'core' } } }]);
    const box = snap.devices.find((d) => d.uid === U05);
    assert.deepEqual([box.serial, box.assetTag, box.description], ['FOC1234A1BC', 'A-100', 'core']);
    assert.equal(box.position, 5, 'and never its shelf');
  });
});

describe('a box left out of the write takes its answers with it', () => {
  it('drops a rejected mark offline, and the binding and the allowance of a rejected move', () => {
    const snap = overrides.applyTo(snapshot(), [MOVE, OFFLINE]);
    const frozen = structuredClone(snap);
    const out = shape.filterSnapshot(snap, new Set([U20, 'nb:device:205']));
    assert.deepEqual(out.devices.map((d) => d.uid), [U05]);
    assert.deepEqual(out.approvedOffline, {});
    assert.deepEqual(out.approvedMoves, {});
    assert.deepEqual(out.recordBinding.deviceNetboxIds, {});
    assert.deepEqual(out.recordBinding.shown.devices, {});
    assert.equal(out.recordBinding.rackNetboxId, 26, 'the rack\'s own answer is not the box\'s');
    assert.deepEqual(snap, frozen, 'the snapshot handed in is not changed');
  });

  it('names the catalogue only that box used, so nothing is made for a box that was turned down', () => {
    const out = shape.filterSnapshot(snapshot(), new Set([U20]));
    assert.deepEqual(out.deferScaffolding, ['dtype:router-8', 'mfr:acme', 'role:router']);
    assert.equal(out.deviceTypes.length, 2, 'named, not removed');
    assert.equal(shape.filterSnapshot(snapshot(), new Set(['if:x:1'])).deferScaffolding, undefined,
      'a port left out brings no catalogue with it');
  });

  it('keeps them when the box is approved', () => {
    const snap = overrides.applyTo(snapshot(), [MOVE, OFFLINE]);
    const out = shape.filterSnapshot(snap, new Set([U05]));
    assert.equal(out.recordBinding.deviceNetboxIds[U20], 199);
    assert.ok(out.approvedMoves[U20]);
    assert.ok(out.approvedOffline[205]);
  });
});
