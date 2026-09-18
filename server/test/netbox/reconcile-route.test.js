/**
 * POST/GET /api/nb/scans/:id/reconcile - what it refuses, what confirms a box,
 * and what any of it is allowed to write.
 *
 * The rules being checked:
 *   1. a posted match has to be one of this rack's switches and one of this
 *      scan's boxes, and it is refused in plain English when it is not - per ROW,
 *      so one bad pick cannot discard the correct ones beside it;
 *   2. a box that cannot answer SNMP is refused: a patch panel, a power strip, a
 *      UPS, a power supply, a blanking plate;
 *   3. one box holds one switch;
 *   4. a bulk save mints NO binding. It stores the matching exactly as it always
 *      did, because the screen it comes from is agreeing with a port count;
 *   5. confirm: true with one switch id mints a binding, and only then;
 *   6. a confirm that cannot be kept does not throw away the save it came with;
 *   7. a confirmed box survives the scan payload being rewritten, which is the
 *      bug that put bindings in a file of their own - and so does a placement
 *      somebody made by hand, which a re-adopt used to drop;
 *   8. the identity a confirm stores is the whole set of aliases, not one field;
 *   9. only a confirmed box is written with the switch's own model and serial;
 *  10. a bulk save cannot quietly overrule a person standing at the rack;
 *  11. a scan belonging to another organisation's rack is not there at all.
 *
 * The router is driven directly, with the switch list stubbed at the module
 * boundary the way the other route tests stub NetBox, and rack ownership stubbed
 * because the auth database here holds no racks. Everything else - the store, the
 * bindings file, the validation - is the real thing.
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
const OUTPUTS = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-recroute-out-'));
process.env.RT_OUTPUTS_DIR = OUTPUTS;
after(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
  fs.rmSync(OUTPUTS, { recursive: true, force: true });
});

const bindings = require('../../lib/netbox/bindings');
const identity = require('../../lib/netbox/identity');
const store = require('../../lib/netbox/store');
const switches = require('../../lib/netbox/switches');
const tenant = require('../../lib/tenant');

const RACK = 'RK-ROUTE0001';
// A rack in another organisation, used by the refusal tests below.
const OTHER_RACK = 'RK-OTHERORG1';
void OTHER_RACK;
const ADOPT_RACK = 'RK-ADOPT0001';

// Who owns which rack. The auth database here has no rack tables, and the point
// of these tests is the reconcile rules, not the ownership query - but the
// ownership check has to run, because one of the rules IS that it runs.
const OWNED = new Set([RACK, ADOPT_RACK]);
tenant.tenantOwnsRack = (tenantId, rackId) => Number(tenantId) === 1 && OWNED.has(rackId);
tenant.rackInOrg = () => false;

const switchesFor = switches.list;
let fleet = [];
switches.list = () => fleet.map((f) => f.record);
switches.loadData = (id) => fleet.find((f) => String(f.record.id) === String(id))?.reading || null;
assert.equal(typeof switchesFor, 'function', 'switches.list should exist to be stubbed');

const router = require('../../routes/netbox/scans');

const SCOPE = bindings.scopeOf({ tenantId: 1, rackId: RACK });

/** A snapshot with four boxes: two switches, a patch panel and a UPS. */
function snapshot() {
  const boxes = [
    { uid: 'dev:t1:5:u10', name: 'U10 box', position: 10, cls: 'Switch', ports: 24 },
    { uid: 'dev:t1:5:u12', name: 'U12 box', position: 12, cls: 'Switch', ports: 48 },
    { uid: 'dev:t1:5:u01', name: 'U01 panel', position: 1, cls: 'Patch Panel', ports: 24 },
    { uid: 'dev:t1:5:u02', name: 'U02 ups', position: 2, cls: 'UPS', ports: 0 },
  ];
  const snap = {
    racks: [{ uid: 'rack:t1:5' }],
    scannedAt: '2026-09-18T09:00:00Z',
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
let who = { id: 1, email: 'tech@example.test', role: 'org_admin', tenant_id: 1, organization_id: 1 };
const app = express();
app.use(express.json());
app.use((req, res, next) => { req.user = who; next(); });
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

  await t.test('1. one bad row does not discard the good ones beside it', async () => {
    // The whole body used to be refused for one wrong pick, and both pickers
    // could produce one, so the control that exists to correct the matcher could
    // throw away the corrections made with it.
    const r = await call('POST', `/scans/${scanId}/reconcile`, {
      matches: { 1: 'dev:t1:5:u10', 2: 'dev:t1:5:u99' },
    });
    assert.equal(r.status, 200);
    assert.equal(r.json.rejected.length, 1);
    assert.equal(r.json.rejected[0].switchId, '2');
    assert.match(r.json.rejected[0].error, /no box called/);
    assert.deepStrictEqual(store.getScan(scanId).payload.matches, { 1: 'dev:t1:5:u10' });
  });

  await t.test('2. a patch panel and a UPS are both refused', async () => {
    const panel = await call('POST', `/scans/${scanId}/reconcile`, { matches: { 1: 'dev:t1:5:u01' } });
    assert.equal(panel.status, 400);
    assert.match(panel.json.error, /passive box \(Patch Panel\)/);
    // A UPS answers no SNMP either, and a confirm onto one used to put a switch's
    // serial and management address on that row and re-propose it every scan.
    const ups = await call('POST', `/scans/${scanId}/reconcile`, {
      matches: { 1: 'dev:t1:5:u02' }, confirm: true, switchId: 1,
    });
    assert.equal(ups.status, 400);
    assert.match(ups.json.error, /passive box \(UPS\)/);
    assert.deepStrictEqual(bindings.list(SCOPE), []);
  });

  await t.test('3. two switches in one box keeps the first and names the second', async () => {
    const r = await call('POST', `/scans/${scanId}/reconcile`, {
      matches: { 1: 'dev:t1:5:u10', 2: 'dev:t1:5:u10' },
    });
    assert.equal(r.status, 200);
    assert.equal(r.json.rejected.length, 1);
    assert.match(r.json.rejected[0].error, /One box holds one switch/);
    assert.deepStrictEqual(store.getScan(scanId).payload.matches, { 1: 'dev:t1:5:u10' });
  });

  await t.test('a matching that obeys every rule is taken, nulls and all', async () => {
    const r = await call('POST', `/scans/${scanId}/reconcile`, {
      matches: { 1: 'dev:t1:5:u10', 2: 'dev:t1:5:u12', 3: null },
    });
    assert.equal(r.status, 200);
    assert.equal(r.json.ok, true);
    assert.deepStrictEqual(r.json.rejected, []);
    assert.equal(r.json.summary.matched, 2);
    assert.deepStrictEqual(store.getScan(scanId).payload.matches,
      { 1: 'dev:t1:5:u10', 2: 'dev:t1:5:u12', 3: null });
  });

  await t.test('9. a match nobody confirmed writes no serial into the record', async () => {
    // The matching above is a port-count agreement. It is shown, and the report
    // joins the switch reading to the box, and nothing of the hardware goes into
    // the snapshot that Export writes to the customer's NetBox.
    const stored = store.getScan(scanId).payload.reconciled;
    const u10 = stored.devices.find((d) => d.uid === 'dev:t1:5:u10');
    assert.equal(u10.serial, null);
    assert.equal(u10.customFields, undefined);
    assert.equal(u10.name, 'U10 box', 'the box itself is written exactly as before');
    assert.equal(u10.position, 10);
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
    // The photograph it was observed against, so a later one recalls it rather
    // than restating it as current (standard 10.1).
    assert.equal(held[0].scanId, String(scanId));
    assert.ok(held[0].snapshotStamp, 'the detection it was confirmed against');
    assert.equal(held[0].boxPrint.position, 10);
    assert.equal(held[0].rackKey, 't1:5', 'the rack key is in the record, not in the file name');
  });

  await t.test('9. the box that was confirmed is written, and only that one', async () => {
    const stored = store.getScan(scanId).payload.reconciled;
    const u10 = stored.devices.find((d) => d.uid === 'dev:t1:5:u10');
    const u12 = stored.devices.find((d) => d.uid === 'dev:t1:5:u12');
    assert.equal(u10.serial, '222B0K4000121');
    assert.equal(u10.customFields.managementIp, '10.10.1.11');
    assert.equal(u12.serial, null, 'sw-two was matched on a port count and confirmed by nobody');
    assert.equal(u12.customFields, undefined);
  });

  await t.test('10. a bulk save cannot overrule the person at the rack', async () => {
    const r = await call('POST', `/scans/${scanId}/reconcile`, {
      matches: { 1: 'dev:t1:5:u12' },
    });
    assert.equal(r.status, 400);
    assert.match(r.json.error, /was confirmed at the rack as U10 box/);
    assert.equal(bindings.list(SCOPE)[0].deviceUid, 'dev:t1:5:u10');
    // And a confirm of the new box is how a person corrects it.
    const fix = await call('POST', `/scans/${scanId}/reconcile`, {
      matches: { 1: 'dev:t1:5:u12' }, confirm: true, switchId: 1,
    });
    assert.equal(fix.status, 200);
    assert.equal(bindings.list(SCOPE)[0].deviceUid, 'dev:t1:5:u12');
    await call('POST', `/scans/${scanId}/reconcile`, {
      matches: { 1: 'dev:t1:5:u10', 2: 'dev:t1:5:u12' }, confirm: true, switchId: 1,
    });
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

  await t.test('6. a confirm that cannot be kept does not throw the save away', async () => {
    // A cheap switch that answers SNMP and publishes neither a serial nor a
    // chassis address cannot be confirmed - there is nothing to confirm ABOUT.
    // Refusing the whole request lost the other switch's valid placement with it.
    fleet.push(switchRecord(4, { label: 'sw-cheap', host: '10.10.1.14', ports: 24 }));
    const r = await call('POST', `/scans/${scanId}/reconcile`, {
      matches: { 4: 'dev:t1:5:u12' }, confirm: true, switchId: 4,
    });
    assert.equal(r.status, 200);
    assert.equal(r.json.confirmed, null);
    assert.match(r.json.confirmNote, /published nothing that identifies it/);
    assert.equal(store.getScan(scanId).payload.matches['4'], 'dev:t1:5:u12', 'the save stands');
    assert.equal(bindings.list(SCOPE).filter((b) => b.switchId === '4').length, 0);
    fleet.pop();
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

    // And the fresh proposal picks it up again, by alias. The photograph is the
    // one it was confirmed against, so it is still a fact.
    const view = await call('GET', `/scans/${scanId}/reconcile`);
    assert.equal(view.status, 200);
    assert.equal(view.json.matches['1'], 'dev:t1:5:u10');
    assert.equal(view.json.reasons['1'].fromBinding, true);
    assert.equal(view.json.reasons['1'].confidence, 'confirmed');
    assert.equal(view.json.switches.find((s) => String(s.id) === '1').written, true);
  });

  await t.test('7. the same confirmation against a new photograph is remembered, not restated', async () => {
    // A rack photographed again is a fresh observation of the position, and an
    // earlier position is retained as a rank 4 source and must not be presented
    // as current (10.1). It is still shown; it is no longer written.
    const fresh = snapshot();
    fresh.scannedAt = '2026-10-02T09:00:00Z';
    store.setPayload(scanId, {
      snapshot: fresh, siteName: 'HQ', rackName: 'Row 1',
      rackKey: 't1:5', rackKeySource: 'name', tenantId: 1,
    });
    const view = await call('GET', `/scans/${scanId}/reconcile`);
    assert.equal(view.json.matches['1'], 'dev:t1:5:u10');
    assert.equal(view.json.reasons['1'].confidence, 'probable');
    assert.equal(view.json.reasons['1'].fresh, false);
    assert.equal(view.json.switches.find((s) => String(s.id) === '1').written, false);
    // Put the photograph it was confirmed against back for the tests below.
    store.setPayload(scanId, {
      snapshot: snapshot(), siteName: 'HQ', rackName: 'Row 1',
      rackKey: 't1:5', rackKeySource: 'name', tenantId: 1,
    });
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
    // The pickers need to know which boxes they may not offer.
    const panel = view.json.devices.find((d) => d.uid === 'dev:t1:5:u01');
    assert.equal(panel.passive, true);
    assert.equal(view.json.devices.find((d) => d.uid === 'dev:t1:5:u10').passive, false);
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

  await t.test('11. another organisation cannot see this scan, let alone confirm in it', async () => {
    // A role gate says what kind of user the caller is, not whose racks they may
    // touch. Before this, an admin of another organisation could mint a rank 1
    // binding in this tenant's rack - in a file that deliberately outlives the
    // scan, so it would outrank every score in every later photograph of it.
    const mine = who;
    who = { id: 9, email: 'manager@other-company.test', role: 'org_admin', tenant_id: 9, organization_id: 9 };
    const before = bindings.list(SCOPE).length;
    const get = await call('GET', `/scans/${scanId}/reconcile`);
    assert.equal(get.status, 404);
    assert.match(get.json.error, /no such scan/);
    const post = await call('POST', `/scans/${scanId}/reconcile`, {
      matches: { 1: 'dev:t1:5:u12' }, confirm: true, switchId: '1', why: 'not my rack',
    });
    assert.equal(post.status, 404);
    assert.equal((await call('GET', `/scans/${scanId}`)).status, 404);
    assert.equal((await call('GET', `/scans/${scanId}/report`)).status, 404);
    assert.equal((await call('DELETE', `/scans/${scanId}`)).status, 404);
    assert.equal(bindings.list(SCOPE).length, before, 'and nothing of theirs is in our file');
    who = mine;
    assert.ok(store.getScan(scanId), 'and the scan they tried to delete is still here');
  });
});

// ── 7b. a placement made by hand survives a re-adopt ─────────────────────────

test('a re-adopt of the same rack keeps the placements somebody made by hand', async (t) => {
  await new Promise((r) => { server = app.listen(0, '127.0.0.1', () => { port = server.address().port; r(); }); });
  t.after(() => new Promise((r) => server.close(r)));

  // The engine's output on disk, which adopt reads.
  const dir = path.join(OUTPUTS, ADOPT_RACK);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'device_unit_map.json'), JSON.stringify({
    devices: [
      { class_name: 'Switch', units: ['u10'], port_count: 24 },
      { class_name: 'Switch', units: ['u12'], port_count: 24 },
    ],
  }));
  fs.writeFileSync(path.join(dir, 'scan_meta.json'), JSON.stringify({ tenantId: 1 }));

  fleet = [
    switchRecord(1, { label: 'sw-one', host: '10.10.1.11', serial: '222B0K4000121', ports: 24 }),
    switchRecord(2, { label: 'sw-two', host: '10.10.1.12', serial: '222B0K4000217', ports: 24 }),
  ];

  const first = await call('POST', `/scans/adopt/${ADOPT_RACK}`);
  assert.equal(first.status, 201, first.raw);
  const id = first.json.id;

  // Two identical switches and two identical boxes: the matcher blanks both, as
  // it should, and the person picks. This is the rack the whole design is for.
  const view = await call('GET', `/scans/${id}/reconcile`);
  assert.equal(view.json.matches['1'], null);
  assert.equal(view.json.matches['2'], null);

  const uid10 = view.json.devices.find((d) => d.position === 10).uid;
  const uid12 = view.json.devices.find((d) => d.position === 12).uid;
  const saved = await call('POST', `/scans/${id}/reconcile`, { matches: { 1: uid10, 2: uid12 } });
  assert.equal(saved.status, 200);

  // The rack is opened again, which re-adopts it. setPayload rewrites the payload
  // whole, and that used to drop the answer - and the screen only re-posts a
  // matching that still has something in it, so for this rack nothing put it back.
  const again = await call('POST', `/scans/adopt/${ADOPT_RACK}?refresh=1`);
  assert.equal(again.status, 200);
  assert.deepStrictEqual(store.getScan(id).payload.matches, { 1: uid10, 2: uid12 });
  const after = await call('GET', `/scans/${id}/reconcile`);
  assert.equal(after.json.matches['1'], uid10);
  assert.equal(after.json.matches['2'], uid12);
  assert.equal(after.json.suggested, false);
});
