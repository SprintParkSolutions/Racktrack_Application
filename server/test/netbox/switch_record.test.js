/**
 * Placing a switch on the shelf the customer's record puts it on.
 *
 * The join the owner asked for on 23 September 2026: the rack is identified,
 * so the record's rows for that rack are known, and each row carries a serial
 * and a management address - the same two things a switch states about itself
 * over SNMP. What is tested here is the rule that keeps it honest: only an
 * identity places a switch, and an identity that leads nowhere says so instead
 * of guessing.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { placeByRecord, recordsFrom, boxAtShelf } = require('../../lib/netbox/switch_record');

/* One rack: a 1U switch at U20, a 2U switch at U10, a patch panel at U42. */
const DEVICES = [
  { uid: 'dev:a', name: 'Box at 20', position: 20, units: 1, passive: false },
  { uid: 'dev:b', name: 'Box at 10', position: 10, units: 2, passive: false },
  { uid: 'dev:p', name: 'Patch panel', position: 42, units: 1, passive: true },
];

const RECORDS = [
  { id: 101, name: 'SP-R1-U20-ACT', serial: 'FX2938401', primaryIp: '10.10.1.21/24', position: 20 },
  { id: 102, name: 'SP-R1-U10-CORE', serial: 'QQ1000', primaryIp: '10.10.1.10/24', position: 10 },
];

describe('the record places the switch', () => {
  test('a serial the record holds names the shelf, and the shelf names the box', () => {
    const { placed } = placeByRecord({
      devices: DEVICES,
      facts: [{ id: 's1', label: 'sw1', serial: 'fx-2938401', host: '10.10.9.9' }],
      records: RECORDS,
    });
    const got = placed.get('s1');
    assert.equal(got.deviceUid, 'dev:a');
    assert.equal(got.position, 20);
    assert.equal(got.evidence[0].source, 'modelled');
    assert.equal(got.evidence[0].rank, 3, 'the system of record says so');
    assert.match(got.why, /U20/);
  });

  test('the management address does it too, mask or port and all', () => {
    const { placed } = placeByRecord({
      devices: DEVICES,
      facts: [{ id: 's2', label: 'sw2', serial: null, host: '10.10.1.10:161' }],
      records: RECORDS,
    });
    assert.equal(placed.get('s2').deviceUid, 'dev:b', 'a 2U box is found by the shelf it starts on');
    assert.equal(placed.get('s2').evidence[0].how, 'address');
  });

  test('a name agreement places nothing, and says why', () => {
    const { placed, notes } = placeByRecord({
      devices: DEVICES,
      facts: [{ id: 's3', label: 'sw3', serial: null, host: null, sysName: 'SP-R1-U20-ACT' }],
      records: RECORDS,
    });
    assert.equal(placed.size, 0, 'a name is a label somebody typed');
    assert.match(notes.get('s3').join(' '), /not an identity/);
  });

  test('two records with one serial place nothing', () => {
    const twins = [...RECORDS, { id: 103, name: 'spare', serial: 'FX2938401', position: 30 }];
    const { placed } = placeByRecord({
      devices: DEVICES,
      facts: [{ id: 's4', serial: 'FX2938401', host: null }],
      records: twins,
    });
    assert.equal(placed.size, 0, 'the record itself cannot tell them apart');
  });

  test('a junk serial is not a serial', () => {
    const junk = [{ id: 104, name: 'x', serial: 'unknown', position: 20 }];
    const { placed } = placeByRecord({
      devices: DEVICES,
      facts: [{ id: 's5', serial: 'Unknown', host: null }],
      records: junk,
    });
    assert.equal(placed.size, 0);
  });

  test('a shelf this photograph has no box on is said out loud, not guessed at', () => {
    const { placed, notes } = placeByRecord({
      devices: DEVICES,
      facts: [{ id: 's6', serial: 'QQ9999', host: null }],
      records: [{ id: 105, name: 'y', serial: 'QQ9999', position: 31 }],
    });
    assert.equal(placed.size, 0);
    assert.match(notes.get('s6').join(' '), /U31.*no box there/s);
  });

  test('a box a person already confirmed is never taken', () => {
    const { placed, notes } = placeByRecord({
      devices: DEVICES,
      facts: [{ id: 's7', serial: 'FX2938401', host: null }],
      records: RECORDS,
      taken: new Set(['dev:a']),
    });
    assert.equal(placed.size, 0, 'a person at the rack outranks the record');
    assert.match(notes.get('s7').join(' '), /already confirmed/);
  });

  test('a passive box is never a switch, whatever the record says', () => {
    const { placed } = placeByRecord({
      devices: DEVICES,
      facts: [{ id: 's8', serial: 'PP1', host: null }],
      records: [{ id: 106, name: 'panel', serial: 'PP1', position: 42 }],
    });
    assert.equal(placed.size, 0);
  });

  test('two switches take two shelves, and neither takes the other', () => {
    const { placed } = placeByRecord({
      devices: DEVICES,
      facts: [
        { id: 's9', serial: 'FX2938401', host: null },
        { id: 's10', serial: 'QQ1000', host: null },
      ],
      records: RECORDS,
    });
    assert.equal(placed.get('s9').deviceUid, 'dev:a');
    assert.equal(placed.get('s10').deviceUid, 'dev:b');
  });

  test('no record at all is not an error: the rung simply does nothing', () => {
    const { placed, notes } = placeByRecord({
      devices: DEVICES,
      facts: [{ id: 's11', serial: 'FX2938401', host: null }],
      records: [],
    });
    assert.equal(placed.size, 0);
    assert.equal(notes.size, 0);
  });
});

describe('reading the rack out of what NetBox answered', () => {
  test('the address comes off primary_ip, whichever shape it arrives in', () => {
    const rows = recordsFrom([
      { id: 1, name: 'a', serial: 'S1', position: 4, primary_ip: { address: '10.0.0.4/24' } },
      { id: 2, name: 'b', serial: 'S2', position: 6, primary_ip4: { display: '10.0.0.6/24' } },
      { id: 3, name: 'c', serial: null, position: null },
    ]);
    assert.equal(rows[0].primaryIp, '10.0.0.4/24');
    assert.equal(rows[1].primaryIp, '10.0.0.6/24');
    assert.equal(rows[2].primaryIp, null);
    assert.equal(rows.length, 3);
  });
});

describe('the shelf to the box', () => {
  test('a shelf inside a tall box belongs to that box', () => {
    assert.equal(boxAtShelf(DEVICES, 11).uid, 'dev:b');
  });
  test('two boxes on one shelf mean nothing can be said', () => {
    const muddle = [
      { uid: 'x', position: 20, units: 1 },
      { uid: 'y', position: 20, units: 1 },
    ];
    assert.equal(boxAtShelf(muddle, 20), null);
  });
});
