/**
 * Identity: a device is a SET of hardware aliases, never one field.
 *
 * The rules being checked, all from docs/design/rack-binding-standard.md:
 *   1. every alias kind is read, normalised and spelled one way;
 *   2. junk a device puts in a serial field is not an identity;
 *   3. the ladder's rungs are the ones section 4.1 lists;
 *   4. only a serial, chassis, bridge or management MAC proves identity - a name
 *      (4.4) or a management address (4.3) never does on its own;
 *   5. the case this module exists for: the phone read a serial off a switch and
 *      the server read a chassis address off the same switch. Keying on the best
 *      single field makes that two devices. Keying on the set makes it one;
 *   6. confidence is the four levels of section 7 and nothing else;
 *   7. no code path in this version can mint rank 2, 5, 6 or 7.
 *
 * Pure module, so no store, no clock, no network.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const identity = require('../../lib/netbox/identity');

// ── 1. aliases ───────────────────────────────────────────────────────────────

test('every kind the hardware can publish becomes an alias', () => {
  const aliases = identity.aliasesOf({
    localChassisId: 'C8:78:7D:3D:E5:30',
    bridgeAddress: '30de4b237 0ac',
    mgmtMac: '00-1b-44-11-3a-b7',
    host: '10.10.1.12',
    identity: { serial: '222B0K4000121', members: [{ serial: '222B0K4000121' }] },
    system: { sysName: 'SG2428P' },
  });
  assert.deepStrictEqual(aliases, [
    'bridge:30de4b2370ac',
    'chassis:c8787d3de530',
    'host:10.10.1.12',
    'mac:001b44113ab7',
    'serial:222b0k4000121',
    'sysname:sg2428p',
  ]);
});

test('the same address with different separators is one alias', () => {
  const a = identity.aliasesOf({ localChassisId: 'C8:78:7D:3D:E5:30' });
  const b = identity.aliasesOf({ localChassisId: 'c8.78.7d.3d.e5.30' });
  const c = identity.aliasesOf({ localChassisId: 'c8787d3de530' });
  assert.deepStrictEqual(a, ['chassis:c8787d3de530']);
  assert.deepStrictEqual(a, b);
  assert.deepStrictEqual(b, c);
});

test('a stack contributes one serial per member', () => {
  const aliases = identity.aliasesOf({
    identity: { serial: 'AAA111', members: [{ serial: 'AAA111' }, { serial: 'BBB222' }] },
  });
  assert.deepStrictEqual(aliases, ['serial:aaa111', 'serial:bbb222']);
});

test('a management address keeps its dots, so two addresses stay two', () => {
  const a = identity.aliasesOf({ host: '10.10.1.1' });
  const b = identity.aliasesOf({ host: '1.0.101.1' });
  assert.deepStrictEqual(a, ['host:10.10.1.1']);
  assert.notDeepStrictEqual(a, b);
});

test('aliases come back sorted, whatever order the fields arrived in', () => {
  const one = identity.aliasesOf({ identity: { serial: 'ZZZ999' }, localChassisId: 'aabbccddeeff' });
  const two = identity.aliasesOf({ localChassisId: 'AABBCCDDEEFF', identity: { serial: 'zzz999' } });
  assert.deepStrictEqual(one, two);
  assert.deepStrictEqual(one, ['chassis:aabbccddeeff', 'serial:zzz999']);
});

// ── 2. junk ──────────────────────────────────────────────────────────────────

test('a field a device filled in because it had to is not an identity', () => {
  for (const junk of ['', '   ', 'unknown', 'UNKNOWN', 'N/A', 'n/a', 'none', 'null',
    'not available', 'To Be Filled By O.E.M.', '00:00:00:00:00:00', '000000',
    'ff:ff:ff:ff:ff:ff', 'enterprise 1916', 'enterprise2011', 'TP-Link', 'd-link',
    'Cisco', 'ab']) {
    assert.equal(identity.isJunkValue(junk), true, `${JSON.stringify(junk)} should be junk`);
    assert.equal(identity.alias('serial', junk), null, `${JSON.stringify(junk)} should not be an alias`);
  }
});

test('a real serial, a real address and a real name survive', () => {
  assert.equal(identity.alias('serial', '222B0K4000121'), 'serial:222b0k4000121');
  assert.equal(identity.alias('chassis', 'C8:78:7D:3D:E5:30'), 'chassis:c8787d3de530');
  assert.equal(identity.alias('sysname', '  SG2428P  '), 'sysname:sg2428p');
  assert.equal(identity.alias('host', '10.10.1.100'), 'host:10.10.1.100');
});

test('a kind nobody defined is not an alias', () => {
  assert.equal(identity.alias('assettag', 'RT-0001'), null);
});

// ── 3. the ladder ────────────────────────────────────────────────────────────

test('the rungs are the ones section 4.1 lists, and a name is on none of them', () => {
  assert.equal(identity.rankOf('serial'), 1);
  assert.equal(identity.rankOf('chassis'), 3);
  assert.equal(identity.rankOf('bridge'), 4);
  assert.equal(identity.rankOf('mac'), 5);
  assert.equal(identity.rankOf('host'), 6);
  assert.equal(identity.rankOf('sysname'), null);
  assert.equal(identity.rankOf('nonsense'), null);
});

// ── 4. what counts as the same device ────────────────────────────────────────

test('a shared serial is the same device, and it says which alias said so', () => {
  const hit = identity.sameDevice(['serial:abc123', 'sysname:sw1'], ['serial:abc123', 'host:10.0.0.9']);
  assert.deepStrictEqual(hit,
    { same: true, by: 'serial', rank: 1, alias: 'serial:abc123', refutedBy: null });
});

test('a shared name alone is NOT the same device', () => {
  const hit = identity.sameDevice(['sysname:sg2428p', 'serial:aaa111'], ['sysname:sg2428p', 'serial:bbb222']);
  assert.equal(hit.same, false);
  assert.equal(hit.by, null);
});

test('a shared management address alone is NOT the same device', () => {
  const hit = identity.sameDevice(['host:10.10.1.12'], ['host:10.10.1.12']);
  assert.equal(hit.same, false);
});

test('when several aliases are shared the strongest one is reported', () => {
  const a = ['serial:aaa111', 'chassis:c8787d3de530', 'sysname:sw1'];
  const b = ['chassis:c8787d3de530', 'serial:aaa111'];
  assert.equal(identity.sameDevice(a, b).by, 'serial');
  assert.equal(identity.sameDevice(b, a).by, 'serial');
});

test('nothing shared is not the same device, and neither is nothing at all', () => {
  assert.equal(identity.sameDevice(['serial:aaa111'], ['serial:bbb222']).same, false);
  assert.equal(identity.sameDevice([], []).same, false);
  assert.equal(identity.sameDevice(null, undefined).same, false);
});

// ── 5. the case this module exists for ───────────────────────────────────────

test('the phone read a serial and the server read a chassis address: ONE device', () => {
  // What the phone got out of the switch: the maker's private tree answered, and
  // LLDP answered too.
  const fromPhone = identity.aliasesOf({
    identity: { serial: '222B0K4000121' },
    localChassisId: '30:DE:4B:23:70:AC',
    system: { sysName: 'SG2428P' },
    host: '10.10.1.11',
  });
  // What the server got out of the same switch, minutes later: no private tree
  // this time, so no serial at all - only the chassis address.
  const fromServer = identity.aliasesOf({
    identity: { serial: null },
    localChassisId: '30de4b2370ac',
    system: { sysName: 'SG2428P' },
    host: '10.10.1.11',
  });

  // Keying on one field - the strongest each reading has - splits the switch in
  // two, which is the bug.
  const strongestOf = (aliases) => aliases
    .filter((a) => identity.isStrong(a))
    .sort((x, y) => identity.rankOf(identity.kindOf(x)) - identity.rankOf(identity.kindOf(y)))[0];
  assert.equal(strongestOf(fromPhone), 'serial:222b0k4000121');
  assert.equal(strongestOf(fromServer), 'chassis:30de4b2370ac');
  assert.notEqual(strongestOf(fromPhone), strongestOf(fromServer));

  // Keying on the set keeps it one switch, matched on the chassis address both
  // readings happened to publish.
  const hit = identity.sameDevice(fromPhone, fromServer);
  assert.equal(hit.same, true);
  assert.equal(hit.by, 'chassis');
  assert.equal(hit.rank, 3);
});

// ── 6. confidence ────────────────────────────────────────────────────────────

test('confidence is the four levels of section 7', () => {
  const confirmed = [identity.evidence('confirmed', 'a person placed it')];
  const remembered = [identity.evidence('remembered', 'bound here before')];
  const inferred1 = [identity.evidence('inferred', 'exact 24 ports', { candidateCount: 1 })];
  const inferred2 = [identity.evidence('inferred', 'exact 24 ports', { candidateCount: 2 })];

  assert.equal(identity.confidenceOf(confirmed), 'confirmed');
  assert.equal(identity.confidenceOf(remembered), 'probable');
  assert.equal(identity.confidenceOf(inferred1), 'possible');
  assert.equal(identity.confidenceOf(inferred2), 'unidentified');
  assert.equal(identity.confidenceOf([]), 'unidentified');
  assert.equal(identity.confidenceOf(null), 'unidentified');
});

test('the strongest rank in a list is the one that decides', () => {
  // confidenceOf takes the best rank present, so a list holding a person's own
  // act reads as confirmed whatever else is in it. That is why the matcher does
  // NOT carry the rank 1 entry forward when it recalls a binding against a later
  // photograph: standard 10.1 says an earlier position is retained as a rank 4
  // source and must not be presented as current, and a list holding both would
  // present it as current. See binding-suggest.test.js for the rule in action.
  const both = [
    identity.evidence('confirmed', 'a person placed it'),
    identity.evidence('remembered', 'recalled from the binding'),
  ];
  assert.equal(identity.confidenceOf(both), 'confirmed');
  assert.equal(identity.confidenceOf([identity.evidence('remembered', 'recalled')]), 'probable');
  assert.deepStrictEqual(both.map((e) => e.rank), [1, 4]);
});

test('a rank 8 entry that never counted its candidates claims nothing', () => {
  assert.equal(identity.confidenceOf([identity.evidence('inferred', 'ports agree')]), 'unidentified');
});

test('only a confirmed binding may be written to a system of record', () => {
  // Standard 7.2 allows probable as well, marked at the destination. There is
  // nowhere in the snapshot to carry the mark - a serial on a device row reads
  // as a fact to everything downstream - so this version writes rank 1 to 3 and
  // nothing else, and shows the rest.
  assert.equal(identity.writable('confirmed'), true);
  assert.equal(identity.writable('probable'), false);
  assert.equal(identity.writable('possible'), false);
  assert.equal(identity.writable('unidentified'), false);
});

// ── 6b. one address, published under three names ─────────────────────────────

test('one base address read as a chassis id and as a management MAC is one device', () => {
  // The same 48 bits, from two different tables of the same switch. Compared as
  // whole strings these were two devices, which is how one switch became two.
  const hit = identity.sameDevice(['chassis:c8787d3de530'], ['mac:c8787d3de530']);
  assert.equal(hit.same, true);
  // The weaker of the two claims is what a shared value proves.
  assert.equal(hit.by, 'mac');
  assert.equal(hit.rank, identity.LADDER.mac);
  assert.equal(identity.sameDevice(['bridge:c8787d3de530'], ['chassis:c8787d3de530']).by, 'bridge');
});

test('a serial that happens to look like a MAC does not merge with an address', () => {
  assert.equal(identity.sameDevice(['serial:c8787d3de530'], ['mac:c8787d3de530']).same, false);
});

test('a value that is not an address keeps its own kind', () => {
  // Only a 48-bit value collapses. "core-stack" as a chassis id is not an
  // address and must not match a management MAC or anything else.
  assert.equal(identity.matchKey('chassis:c8787d3de530'), 'hw:c8787d3de530');
  assert.equal(identity.matchKey('chassis:corestack'), 'chassis:corestack');
});

test('two different serials refute a shared chassis string', () => {
  // A vendor that publishes a stack name as its LLDP chassis id gives two units
  // the same chassis alias. Their serials say plainly that they are two units,
  // and the stronger rung wins (6.3).
  const a = ['serial:realserialone', 'chassis:corestack'];
  const b = ['serial:realserialtwo', 'chassis:corestack'];
  const hit = identity.sameDevice(a, b);
  assert.equal(hit.same, false);
  assert.equal(hit.refutedBy, 'serial');
  // A shared serial is not refuted by anything, and one side with no serial at
  // all refutes nothing either - absence is not disagreement.
  assert.equal(identity.sameDevice(a, ['serial:realserialone', 'chassis:other']).same, true);
  assert.equal(identity.sameDevice(a, ['chassis:corestack']).same, true);
});

test('a weak alias is reported as a weak alias and never as identity', () => {
  const shared = identity.weakOverlap(['host:10.10.1.11', 'sysname:sw-a', 'serial:aaa111'],
    ['host:10.10.1.11', 'sysname:sw-a', 'serial:bbb222']);
  assert.deepStrictEqual(shared, ['host:10.10.1.11', 'sysname:sw-a']);
  assert.equal(identity.sameDevice(['host:10.10.1.11'], ['host:10.10.1.11']).same, false);
});

// ── 6c. a serial field that is not a serial ──────────────────────────────────

test('a serial that is the device model is not an identity', () => {
  // Two NETGEAR GS724Tv4 switches both report "GS724Tv4" in the ENTITY serial
  // field. Believing it makes them one device at rung 1, and a binding made on
  // one is then applied to the other as a fact.
  const one = identity.aliasesOf({
    identity: { serial: 'GS724Tv4', model: 'GS724Tv4' },
    system: { sysName: 'sw-a' }, host: '10.10.1.11',
  });
  const two = identity.aliasesOf({
    identity: { serial: 'gs724tv4', model: 'GS724Tv4' },
    system: { sysName: 'sw-b' }, host: '10.10.1.12',
  });
  assert.ok(!one.some((a) => a.startsWith('serial:')), `no serial alias, got ${one.join()}`);
  assert.equal(identity.sameDevice(one, two).same, false);
  // A real serial on the same reading is still a real serial.
  assert.ok(identity.aliasesOf({ identity: { serial: '222B0K4000121', model: 'TL-SG2428P' } })
    .includes('serial:222b0k4000121'));
});

// ── 6d. a chassis id that is not an address ──────────────────────────────────

test('only a chassis id published as an address is an identity', () => {
  const asMac = { localChassisId: 'C8:78:7D:3D:E5:30', localChassisIdSubtype: 4 };
  assert.ok(identity.aliasesOf(asMac).includes('chassis:c8787d3de530'));
  // Subtype 7 is "local": a name somebody typed, which two switches share.
  const asName = { localChassisId: 'C8:78:7D:3D:E5:30', localChassisIdSubtype: 7 };
  assert.ok(!identity.aliasesOf(asName).some((a) => a.startsWith('chassis:')));
  // No subtype recorded at all - every reading taken before it was collected -
  // is believed only where the value is plainly an address.
  assert.ok(identity.aliasesOf({ localChassisId: '30:DE:4B:23:70:AC' }).includes('chassis:30de4b2370ac'));
  assert.ok(!identity.aliasesOf({ localChassisId: 'core-stack' }).some((a) => a.startsWith('chassis:')));
});

// ── 7. the ranks nothing here may produce ────────────────────────────────────

test('all eight ranks are in the enum, spelled as the standard spells them', () => {
  assert.deepStrictEqual(identity.EVIDENCE_RANK, {
    confirmed: 1, reported: 2, modelled: 3, remembered: 4,
    read: 5, ordered: 6, adjacent: 7, inferred: 8,
  });
  assert.equal(identity.RANK_7_IS_MEMBERSHIP, true);
});

test('nothing can mint rank 2, 5, 6 or 7: the factory refuses', () => {
  for (const source of ['reported', 'read', 'ordered', 'adjacent']) {
    assert.throws(() => identity.evidence(source, 'why'),
      new RegExp(`nothing in this version can produce ${source}`),
      `${source} must be refused`);
  }
  assert.throws(() => identity.evidence('invented', 'why'), /unknown evidence source/);
  // And the four it can mint still work.
  for (const source of ['confirmed', 'modelled', 'remembered', 'inferred']) {
    assert.equal(identity.evidence(source, 'why').source, source);
  }
});

test('no producer for rank 2, 5, 6 or 7 exists anywhere in the server', () => {
  // The factory refusing is only half of it: a file could build the object by
  // hand. Every evidence object in the codebase has to come through
  // identity.evidence, so no file outside identity.js may write a rank literal,
  // and no file at all may name one of the four blocked sources to the factory.
  const root = path.resolve(__dirname, '..', '..');
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (e.name === 'node_modules' || e.name === 'data' || e.name.startsWith('.')) return [];
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : (e.name.endsWith('.js') ? [p] : []);
  });
  const files = [...walk(path.join(root, 'lib')), ...walk(path.join(root, 'routes'))];
  assert.ok(files.length > 20, 'the walk should have found the server sources');

  const identityFile = path.join(root, 'lib', 'netbox', 'identity.js');
  for (const file of files) {
    const src = fs.readFileSync(file, 'utf8');
    for (const source of ['reported', 'read', 'ordered', 'adjacent']) {
      assert.ok(!new RegExp(`evidence\\(\\s*['"\`]${source}['"\`]`).test(src),
        `${file} asks for ${source} evidence, which this version cannot produce`);
    }
    if (file === identityFile) continue;
    assert.ok(!/\brank\s*:\s*\d/.test(src),
      `${file} writes a rank literal instead of going through identity.evidence`);
  }
});
