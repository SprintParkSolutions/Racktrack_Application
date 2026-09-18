/**
 * Bindings: a person's answer, kept where a re-scan cannot delete it.
 *
 * The rules being checked:
 *   1. the scope is stable for one rack and separate for two tenants, even when
 *      both tenants type the same rack id;
 *   2. a confirm is a record with a date, a source and an identity (standard 6.1);
 *   3. it is found again by alias, not by the photo it was given about - so the
 *      SECOND photograph of the same rack finds it, which is the bug that made
 *      this a file of its own rather than a field in the scan payload;
 *   4. one box has one binding, and one identity is bound in one box: a confirm
 *      replaces whatever it contradicts, by box and by strong alias;
 *   5. a binding whose only identity is a name is refused (standard 4.4);
 *   6. it lives on disk, outside the scan, so it survives anything that rewrites
 *      a scan payload.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, beforeEach, after } = require('node:test');

// A data directory of its own, set before the store is loaded, so nothing here
// can touch a real scan.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-bindings-'));
process.env.RT_DATA_DIR = TMP;

const bindings = require('../../lib/netbox/bindings');
const identity = require('../../lib/netbox/identity');

const SCOPE = bindings.scopeOf({ tenantId: 7, rackKey: 't7:5' });

beforeEach(() => {
  fs.rmSync(bindings.DIR, { recursive: true, force: true });
});

after(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
});

// ── 1. the scope ─────────────────────────────────────────────────────────────

test('one rack is one scope, whichever way it is asked for', () => {
  assert.equal(bindings.scopeOf({ tenantId: 7, rackKey: 't7:5' }), 't7|t7:5');
  assert.equal(bindings.scopeOf({ tenantId: 7, rackKey: 't7:5', rackId: 'RK-OLD' }), 't7|t7:5');
  // No key means the scan was never identified, so the photo's own rack id keys it.
  assert.equal(bindings.scopeOf({ tenantId: 7, rackId: 'RK-ABC' }), 't7|RK-ABC');
  assert.equal(bindings.scopeOf({ rackId: 'RK-ABC' }), 't0|RK-ABC');
  assert.equal(bindings.scopeOf({}), 't0|unknown');
});

test('two tenants that type the same rack id do not share bindings', () => {
  const a = bindings.scopeOf({ tenantId: 7, rackId: 'RK-ROW1' });
  const b = bindings.scopeOf({ tenantId: 9, rackId: 'RK-ROW1' });
  assert.notEqual(a, b);
  assert.notEqual(bindings.fileFor(a), bindings.fileFor(b));

  bindings.confirm(a, { aliases: ['serial:aaa111'], deviceUid: 'dev:1:u10' });
  assert.equal(bindings.list(a).length, 1);
  assert.equal(bindings.list(b).length, 0);
});

test('two scopes never land in one file, however they are spelled', () => {
  const a = bindings.scopeOf({ tenantId: 7, rackId: 'RK a' });
  const b = bindings.scopeOf({ tenantId: 7, rackId: 'RK-a' });
  assert.notEqual(bindings.fileFor(a), bindings.fileFor(b));
});

// ── 2. what a confirm records ────────────────────────────────────────────────

test('a confirm is a dated, sourced record of one identity in one box', () => {
  const aliases = identity.aliasesOf({
    identity: { serial: '222B0K4000121' },
    localChassisId: '30:DE:4B:23:70:AC',
    system: { sysName: 'SG2428P' },
    host: '10.10.1.11',
  });
  const { binding } = bindings.confirm(SCOPE, {
    aliases, deviceUid: 'dev:t7:5:u10', position: 10, switchId: '3',
    by: 'tech@example.com', why: 'read the label on the box',
  });

  assert.equal(binding.deviceUid, 'dev:t7:5:u10');
  assert.equal(binding.position, 10);
  assert.equal(binding.switchId, '3');
  assert.equal(binding.by, 'tech@example.com');
  assert.equal(binding.confidence, 'confirmed');
  assert.deepStrictEqual(binding.evidence.map((e) => e.rank), [1]);
  assert.match(binding.at, /^\d{4}-\d{2}-\d{2}T/);
  assert.deepStrictEqual(binding.aliases, aliases);
  assert.deepStrictEqual(bindings.list(SCOPE), [binding]);
});

test('the evidence a caller passes is the evidence that is stored', () => {
  const { binding } = bindings.confirm(SCOPE, {
    aliases: ['serial:aaa111'],
    deviceUid: 'dev:t7:5:u10',
    evidence: [identity.evidence('confirmed', 'somebody at the rack said so')],
  });
  assert.deepStrictEqual(binding.evidence, [
    { source: 'confirmed', rank: 1, why: 'somebody at the rack said so' },
  ]);
});

// ── 3. found again by alias, not by photograph ───────────────────────────────

test('a second photograph of the same rack finds the binding again by alias', () => {
  // Photograph one. The switch answered with a serial and a chassis address, and
  // somebody confirmed which box it was.
  const firstRead = {
    identity: { serial: '222B0K4000121' },
    localChassisId: '30:DE:4B:23:70:AC',
    system: { sysName: 'SG2428P' },
    host: '10.10.1.11',
  };
  bindings.confirm(SCOPE, {
    aliases: identity.aliasesOf(firstRead), deviceUid: 'dev:t7:5:u10', position: 10,
  });

  // Photograph two, weeks later. Same rack, so the same scope. This time the
  // maker's private tree did not answer, so there is no serial at all - only the
  // chassis address, and the switch has been renamed and readdressed since.
  const secondRead = {
    identity: { serial: null },
    localChassisId: '30de4b2370ac',
    system: { sysName: 'core-sw-1' },
    host: '10.20.30.40',
  };
  const hit = bindings.find(SCOPE, identity.aliasesOf(secondRead));
  assert.ok(hit, 'the binding should still be found');
  assert.equal(hit.binding.deviceUid, 'dev:t7:5:u10');
  assert.equal(hit.by, 'chassis');
  assert.equal(hit.rank, 3);
});

test('a different switch does not find somebody else\'s binding', () => {
  bindings.confirm(SCOPE, { aliases: ['serial:aaa111'], deviceUid: 'dev:t7:5:u10' });
  assert.equal(bindings.find(SCOPE, ['serial:bbb222']), null);
  // Same name, same management address, different hardware: still not it.
  assert.equal(bindings.find(SCOPE, ['sysname:sg2428p', 'host:10.10.1.11']), null);
  assert.equal(bindings.find(SCOPE, []), null);
});

test('a rack nobody has confirmed anything about answers nothing, not an error', () => {
  assert.deepStrictEqual(bindings.list(bindings.scopeOf({ rackId: 'RK-NEW' })), []);
  assert.equal(bindings.find(bindings.scopeOf({ rackId: 'RK-NEW' }), ['serial:aaa111']), null);
});

// ── 4. one box, one binding ─────────────────────────────────────────────────

test('confirming the same box again replaces the binding, it does not add one', () => {
  bindings.confirm(SCOPE, { aliases: ['serial:aaa111'], deviceUid: 'dev:t7:5:u10' });
  const second = bindings.confirm(SCOPE, { aliases: ['serial:bbb222'], deviceUid: 'dev:t7:5:u10' });
  assert.equal(bindings.list(SCOPE).length, 1);
  assert.equal(second.replaced.length, 1);
  assert.deepStrictEqual(second.replaced[0].aliases, ['serial:aaa111']);
  // The hardware that was there is no longer bound to it.
  assert.equal(bindings.find(SCOPE, ['serial:aaa111']), null);
  assert.equal(bindings.find(SCOPE, ['serial:bbb222']).binding.deviceUid, 'dev:t7:5:u10');
});

test('one identity is bound in one box: moving it down two shelves does not bind it twice', () => {
  const aliases = ['chassis:30de4b2370ac', 'serial:222b0k4000121'];
  bindings.confirm(SCOPE, { aliases, deviceUid: 'dev:t7:5:u10', position: 10 });
  // The next scan finds it two shelves lower, and only the chassis address this
  // time. Standard 10.2: the device moved, so the old binding retires.
  const moved = bindings.confirm(SCOPE, {
    aliases: ['chassis:30de4b2370ac'], deviceUid: 'dev:t7:5:u08', position: 8,
  });
  assert.equal(bindings.list(SCOPE).length, 1);
  assert.equal(moved.replaced.length, 1);
  assert.equal(moved.replaced[0].position, 10);
  assert.equal(bindings.find(SCOPE, aliases).binding.position, 8);
});

test('two different switches in two different boxes both stand', () => {
  bindings.confirm(SCOPE, { aliases: ['serial:aaa111'], deviceUid: 'dev:t7:5:u10' });
  bindings.confirm(SCOPE, { aliases: ['serial:bbb222'], deviceUid: 'dev:t7:5:u12' });
  assert.equal(bindings.list(SCOPE).length, 2);
  assert.equal(bindings.find(SCOPE, ['serial:aaa111']).binding.deviceUid, 'dev:t7:5:u10');
  assert.equal(bindings.find(SCOPE, ['serial:bbb222']).binding.deviceUid, 'dev:t7:5:u12');
});

// ── 5. what it refuses ───────────────────────────────────────────────────────

test('a binding whose only identity is a name is refused', () => {
  const r = bindings.confirm(SCOPE, {
    aliases: ['sysname:sg2428p', 'host:10.10.1.11'], deviceUid: 'dev:t7:5:u10',
  });
  assert.match(r.error, /published nothing that identifies it/);
  assert.equal(bindings.list(SCOPE).length, 0);
});

test('a binding with no box is refused', () => {
  const r = bindings.confirm(SCOPE, { aliases: ['serial:aaa111'], deviceUid: '' });
  assert.match(r.error, /which box/);
  assert.equal(bindings.list(SCOPE).length, 0);
});

test('forget removes one box\'s binding, and says so when there is none', () => {
  bindings.confirm(SCOPE, { aliases: ['serial:aaa111'], deviceUid: 'dev:t7:5:u10' });
  assert.deepStrictEqual(bindings.forget(SCOPE, 'dev:t7:5:u10'), { ok: true, forgot: 'dev:t7:5:u10' });
  assert.equal(bindings.list(SCOPE).length, 0);
  assert.match(bindings.forget(SCOPE, 'dev:t7:5:u10').error, /Nothing is bound/);
});

// ── 6. it is on disk, not in the scan ───────────────────────────────────────

test('a binding is a file of its own, so rewriting a scan payload cannot drop it', () => {
  bindings.confirm(SCOPE, { aliases: ['serial:aaa111'], deviceUid: 'dev:t7:5:u10' });
  const file = bindings.fileFor(SCOPE);
  assert.ok(fs.existsSync(file), 'the binding should be on disk');
  assert.ok(file.startsWith(path.join(TMP, 'bindings')), 'and under bindings/, not under scans/');
  assert.ok(!file.includes(`${path.sep}scans${path.sep}`));

  // Load the store fresh, as a later request would, and it is still there.
  delete require.cache[require.resolve('../../lib/netbox/bindings')];
  const reloaded = require('../../lib/netbox/bindings');
  assert.equal(reloaded.list(SCOPE).length, 1);
  assert.equal(reloaded.find(SCOPE, ['serial:aaa111']).binding.deviceUid, 'dev:t7:5:u10');
});

test('a corrupt file reads as nobody having confirmed anything, not as a failure', () => {
  fs.mkdirSync(bindings.DIR, { recursive: true });
  fs.writeFileSync(bindings.fileFor(SCOPE), '{ this is not json');
  assert.deepStrictEqual(bindings.list(SCOPE), []);
  assert.equal(bindings.find(SCOPE, ['serial:aaa111']), null);
});
