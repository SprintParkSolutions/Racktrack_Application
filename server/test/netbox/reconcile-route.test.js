/**
 * POST /api/nb/scans/:id/reconcile - what it refuses, and what confirms a box.
 *
 * The rules being checked:
 *   1. a posted match has to be one of this rack's switches and one of this
 *      scan's boxes, and it is refused in plain English when it is not;
 *   2. a passive box is refused: a patch panel has nothing to answer SNMP with;
 *   3. one box holds one switch - a mapping that puts two switches in one box is
 *      refused before anything is stored;
 *   4. a bulk save mints NO binding. It stores the matching exactly as it always
 *      did, because the screen it comes from is agreeing with a port count;
 *   5. confirm: true with one switch id mints a binding, and only then;
 *   6. a confirm on a switch that published nothing identifying is refused rather
 *      than stored as a guess;
 *   7. a confirmed box survives the scan payload being rewritten, which is the
 *      bug that put bindings in a file of their own;
 *   8. the identity a confirm stores is the whole set of aliases, not one field.
 *
 * The router is driven directly, with the switch list stubbed at the module
 * boundary the way the other route tests stub NetBox. Everything else - the
 * store, the bindings file, the validation - is the real thing.
 */
const assert = require('node:assert/strict');
const express = require('express');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { test, after } = require('node:test');

process.env.RACKTRACK_AUTH_DB = ':memory:';
process.env.RACKTRACK_SKIP_WORKER_POOL = '1';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-reconcile-route';
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-recroute-'));
process.env.RT_DATA_DIR = TMP;
after(() => fs.rmSync(TMP, { recursive: true, force: true }));

const bindings = require('../../lib/netbox/bindings');
const identity = require('../../lib/netbox/identity');
const store = require('../../lib/netbox/store');
const switches = require('../../lib/netbox/switches');

// The rack's switches, stubbed at the store rather than at the matcher, so the
// real gatherSwitches runs and the GET and the POST see the same fleet.
let fleet = [];
switches.list = () => fleet.map((f) => f.record);
switches.loadData = (id) => fleet.find((f) => String(f.record.id) === String(id))?.reading || null;

const router = require('../../routes/netbox/scans');

const RACK = 'RK-ROUTE0001';
const SCOPE = bindings.scopeOf({ tenantId: 1, rackKey: 't1:5', rackId: RACK });

/** A snapshot with three boxes: two switches and a patch panel. */
function snapshot() {
  const boxes = [
    { uid: 'dev:t1:5:u10', name: 'U10 box', position: 10, cls: 'Switch', ports: 24 },
    { uid: 'dev:t1:5:u12', name: 'U12 box', position: 12, cls: 'Switch', ports: 48 },
    { uid: 'dev:t1:5:u01', name: 'U01 panel', position: 1, cls: 'Patch Panel', ports: 24 },
  ];
  const snap = {
    racks: [{ uid: 'rack:t1:5' }],
    devices: [], deviceTypes: [], manufacturers: [], interfaces: [], cables: [], conflicts: [],
  };
  for (const b of boxes) {
    const typeUid = `dtype:${b.uid}`;
    snap.deviceTypes.push({ uid: typeUid, model: 'Unidentified Switch', manufacturerUid: '', uHeight: 1 });
    snap.devices.push({
      uid: b.uid, name: b.name, position: b.position, deviceTypeUid: typeUid, serial: null,
      provenance: { cvClass: b.cls, cvUnits: [`u${String(b.position).padStart(2, '0')}`] },
    });
    for (let i = 0; i < b.ports; i += 1) {
      snap.interfaces.push({ uid: `if:${b.uid}:${i}`, deviceUid: b.uid, name: `port ${i + 1}` });
    }
  }
  return snap;
}

function switchRecord(id, { label, host, serial = null, chassisId = null, ports = 24, read = true }) {
  return {
    record: { id, label, host, rackId: RACK },
    reading: read ? {
      localChassisId: chassisId,
      identity: { model: null, serial, manufacturer: null, stackMembers: 1, members: [] },
      system: { sysName: null, vendor: null },
      counts: { interfaces: ports },
      interfaces: [],
      neighbours: [],
    } : null,
  };
}

// ── a bare app, authenticated as an org admin ───────────────────────────────
const app = express();
app.use(express.json());
app.use((req, res, next) => {
  req.user = { id: 1, email: 'tech@example.test', role: 'org_admin', tenant_id: 1 };
  next();
});
app.use('/scans', router);

let server;
let port;
let scanId;

function call(method, p, body) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : JSON.stringify(body);
    const req = http.request({
      host: '127.0.0.1', port, method, path: p,
      headers: data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {},
    }, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(raw); } catch { /* not json */ }
        resolve({ status: res.statusCode, json, raw });
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

test('the reconcile route holds its rules', async (t) => {
  await new Promise((r) => { server = app.listen(0, '127.0.0.1', () => { port = server.address().port; r(); }); });
  t.after(() => new Promise((r) => server.close(r)));

  // The subtests run in order and build on one another on purpose: a save, then
  // a confirm, then a payload rewrite over the top of it. Nothing is reset
  // between them, because the point is what survives.
  fleet = [
    switchRecord(1, { label: 'sw-one', host: '10.10.1.11', serial: '222B0K4000121', ports: 24 }),
    switchRecord(2, { label: 'sw-two', host: '10.10.1.12', chassisId: '30:DE:4B:23:71:0C', ports: 48 }),
    switchRecord(3, { label: 'sw-quiet', host: '10.10.1.13', read: false }),
  ];

  const rec = store.addScan({
    rackId: RACK, source: 'adopted', rackName: 'Row 1', siteName: 'HQ',
    payload: {
      snapshot: snapshot(), siteName: 'HQ', rackName: 'Row 1',
      rackKey: 't1:5', rackKeySource: 'name', tenantId: 1,
    },
  });
  scanId = rec.id;

  await t.test('1. a switch that is not in this rack is refused', async () => {
    const r = await call('POST', `/scans/${scanId}/reconcile`, { matches: { 99: 'dev:t1:5:u10' } });
    assert.equal(r.status, 400);
    assert.match(r.json.error, /not one of this rack's switches/);
  });

  await t.test('1. a box that is not in this scan is refused', async () => {
    const r = await call('POST', `/scans/${scanId}/reconcile`, { matches: { 1: 'dev:t1:5:u99' } });
    assert.equal(r.status, 400);
    assert.match(r.json.error, /no box called dev:t1:5:u99/);
  });

  await t.test('2. a patch panel is refused', async () => {
    const r = await call('POST', `/scans/${scanId}/reconcile`, { matches: { 1: 'dev:t1:5:u01' } });
    assert.equal(r.status, 400);
    assert.match(r.json.error, /passive box \(Patch Panel\)/);
  });

  await t.test('3. two switches in one box is refused', async () => {
    const r = await call('POST', `/scans/${scanId}/reconcile`, {
      matches: { 1: 'dev:t1:5:u10', 2: 'dev:t1:5:u10' },
    });
    assert.equal(r.status, 400);
    assert.match(r.json.error, /One box holds one switch/);
  });

  await t.test('a matching that obeys every rule is taken, nulls and all', async () => {
    const r = await call('POST', `/scans/${scanId}/reconcile`, {
      matches: { 1: 'dev:t1:5:u10', 2: 'dev:t1:5:u12', 3: null },
    });
    assert.equal(r.status, 200);
    assert.equal(r.json.ok, true);
    assert.equal(r.json.summary.matched, 2);
    assert.deepStrictEqual(store.getScan(scanId).payload.matches,
      { 1: 'dev:t1:5:u10', 2: 'dev:t1:5:u12', 3: null });
  });

  await t.test('4. a bulk save mints no binding at all', async () => {
    assert.deepStrictEqual(bindings.list(SCOPE), []);
    const r = await call('POST', `/scans/${scanId}/reconcile`, {
      matches: { 1: 'dev:t1:5:u10', 2: 'dev:t1:5:u12' },
    });
    assert.equal(r.status, 200);
    assert.equal(r.json.confirmed, null);
    assert.deepStrictEqual(bindings.list(SCOPE), [], 'a save is not a confirmation');
  });

  await t.test('5. confirm with a switch id mints exactly one binding', async () => {
    const r = await call('POST', `/scans/${scanId}/reconcile`, {
      matches: { 1: 'dev:t1:5:u10', 2: 'dev:t1:5:u12' },
      confirm: true, switchId: 1, why: 'read the label on the box',
    });
    assert.equal(r.status, 200);
    assert.equal(r.json.confirmed.switchId, '1');
    assert.equal(r.json.confirmed.deviceUid, 'dev:t1:5:u10');

    const held = bindings.list(SCOPE);
    assert.equal(held.length, 1, 'one confirm, one binding');
    assert.equal(held[0].deviceUid, 'dev:t1:5:u10');
    assert.equal(held[0].position, 10);
    assert.equal(held[0].switchId, '1');
    assert.equal(held[0].confidence, 'confirmed');
    assert.equal(held[0].by, 'tech@example.test');
    assert.deepStrictEqual(held[0].evidence.map((e) => e.rank), [1]);
    assert.ok(held[0].aliases.includes('serial:222b0k4000121'));
  });

  await t.test('5. confirm without saying which switch is refused', async () => {
    const r = await call('POST', `/scans/${scanId}/reconcile`, {
      matches: { 1: 'dev:t1:5:u10', 2: 'dev:t1:5:u12' }, confirm: true,
    });
    assert.equal(r.status, 400);
    assert.match(r.json.error, /Confirm one switch at a time/);
  });

  await t.test('5. confirm for a switch that is not in the save is refused', async () => {
    const r = await call('POST', `/scans/${scanId}/reconcile`, {
      matches: { 1: 'dev:t1:5:u10' }, confirm: true, switchId: 2,
    });
    assert.equal(r.status, 400);
    assert.match(r.json.error, /nothing to confirm about it/);
  });

  await t.test('6. a switch that published nothing identifying cannot be confirmed', async () => {
    const r = await call('POST', `/scans/${scanId}/reconcile`, {
      matches: { 3: 'dev:t1:5:u12' }, confirm: true, switchId: 3,
    });
    assert.equal(r.status, 400);
    assert.match(r.json.error, /published nothing that identifies it/);
    assert.equal(bindings.list(SCOPE).filter((b) => b.switchId === '3').length, 0);
  });

  await t.test('5. confirming "not in this rack" undoes the confirmation', async () => {
    await call('POST', `/scans/${scanId}/reconcile`, {
      matches: { 1: 'dev:t1:5:u10' }, confirm: true, switchId: 1,
    });
    assert.equal(bindings.list(SCOPE).length, 1);
    const r = await call('POST', `/scans/${scanId}/reconcile`, {
      matches: { 1: null }, confirm: true, switchId: 1,
    });
    assert.equal(r.status, 200);
    assert.equal(r.json.confirmed.deviceUid, null);
    assert.equal(r.json.confirmed.forgot, 'dev:t1:5:u10');
    assert.deepStrictEqual(bindings.list(SCOPE), []);
  });

  await t.test('7. a confirmed box survives the scan payload being rewritten', async () => {
    await call('POST', `/scans/${scanId}/reconcile`, {
      matches: { 1: 'dev:t1:5:u10' }, confirm: true, switchId: 1,
    });
    assert.equal(bindings.list(SCOPE).length, 1);

    // What a re-adopt or a re-detect does: the whole payload, matches included,
    // is replaced. This used to take every confirmed match with it.
    store.setPayload(scanId, {
      snapshot: snapshot(), siteName: 'HQ', rackName: 'Row 1',
      rackKey: 't1:5', rackKeySource: 'name', tenantId: 1,
    });
    assert.equal(store.getScan(scanId).payload.matches, undefined, 'the matches are gone');
    assert.equal(bindings.list(SCOPE).length, 1, 'the confirmation is not');

    // And the fresh proposal picks it up again, by alias, as confirmed.
    const view = await call('GET', `/scans/${scanId}/reconcile`);
    assert.equal(view.status, 200);
    assert.equal(view.json.matches['1'], 'dev:t1:5:u10');
    assert.equal(view.json.reasons['1'].fromBinding, true);
    assert.equal(view.json.reasons['1'].confidence, 'confirmed');
  });

  await t.test('the proposal the GET returns says why for every switch', async () => {
    const view = await call('GET', `/scans/${scanId}/reconcile`);
    for (const id of ['1', '2', '3']) {
      const r = view.json.reasons[id];
      assert.ok(r, `switch ${id} should carry a reason`);
      assert.ok(['confirmed', 'probable', 'possible', 'unidentified'].includes(r.confidence));
      assert.ok(Array.isArray(r.evidence));
      assert.equal(typeof r.fromBinding, 'boolean');
    }
    assert.match(view.json.reasons['3'].why, /has not been read yet/);
  });

  await t.test('a scan that does not exist is still a 404, and one with no detection a 409', async () => {
    assert.equal((await call('POST', '/scans/99999/reconcile', { matches: {} })).status, 404);
    const bare = store.addScan({ rackId: RACK, source: 'capture', payload: {} });
    assert.equal((await call('POST', `/scans/${bare.id}/reconcile`, { matches: {} })).status, 409);
  });

  await t.test('8. the identity a confirm stores is the SET, not one field', async () => {
    const held = bindings.list(SCOPE).find((b) => b.switchId === '1');
    assert.ok(held);
    const expected = identity.aliasesOf({
      ...fleet[0].reading, host: fleet[0].record.host,
    });
    assert.deepStrictEqual(held.aliases, expected);
    assert.ok(held.aliases.some((a) => a.startsWith('host:')), 'the weak aliases are kept too');
    assert.ok(held.aliases.some((a) => identity.isStrong(a)), 'and at least one strong one');
  });
});
