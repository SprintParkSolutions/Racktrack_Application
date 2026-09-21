/**
 * The ports section of a drift check: the photo against the switch and NetBox.
 *
 * Three layers, the way the code is split.
 *
 *   judge / compare   the verdict table, pure. Physical against logical: a
 *                     mismatch needs the camera to be sure and a logical
 *                     witness that answered to disagree; a match needs at least
 *                     one that answered and none that disagrees; everything
 *                     else is unknown. Counts that differ, or a stack, leave
 *                     that witness unknown for the whole box. Passive boxes are
 *                     left out.
 *   forPlan           the same, out of stored data: the scan's snapshot, the
 *                     switch readings filed against the rack, and the
 *                     interfaces of the record each box is known by. Kept for a
 *                     minute per check.
 *   the two doors     /api/nb/plans/:id/connectivity for whoever raised the
 *                     check, /api/approvals/plans/:id/connectivity for whoever
 *                     may read it; a stranger gets 404 from both, and the
 *                     routers behind them still answer everything else.
 *
 * Booted the way test/approvals/http.test.js boots the app. The switch list is
 * stubbed at the module boundary the way reconcile-route.test.js stubs it, and
 * NetBox at the client's one method this code calls.
 */
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

after(() => { setImmediate(() => process.exit(0)); });
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.PORT = process.env.PORT || '0';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-connectivity';
process.env.RACKTRACK_SKIP_WORKER_POOL = '1';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-connectivity-'));
process.env.RT_DATA_DIR = path.join(tmp, 'data', 'netbox');
process.env.RT_OUTPUTS_DIR = path.join(tmp, 'outputs');
// A NetBox "exists" for the env fallback; the one call made to it is stubbed below.
process.env.NETBOX_URL = 'http://netbox.test';
process.env.NETBOX_TOKEN = 'test-token';
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const switches = require('../../lib/netbox/switches');
let fleet = [];
switches.list = (rackId) => fleet.filter((f) => f.record.rackId === rackId).map((f) => f.record);
switches.loadData = (id) => fleet.find((f) => String(f.record.id) === String(id))?.reading || null;

const { NetBox } = require('../../lib/netbox/netbox');
let netboxInterfaces = {};   // device id -> the interfaces NetBox holds for it
let netboxCalls = [];
NetBox.prototype.paginate = async function paginate(endpoint, params = {}) {
  netboxCalls.push({ endpoint, params });
  if (endpoint !== '/api/dcim/interfaces/') throw new Error(`unexpected NetBox call ${endpoint}`);
  const rows = netboxInterfaces[params.device_id];
  if (rows === 'down') throw new Error('NetBox is not answering');
  return rows || [];
};

const auth = require('../../auth');
auth.sendNotice = async () => true;
const { app } = require('../../app');
const service = require('../../lib/approvals/service');
const scans = require('../../lib/netbox/store');
const connectivity = require('../../lib/approvals/connectivity');

const db = auth.db;
const stamp = Date.now();
const RACK = `RK-PORTS${String(stamp).slice(-5)}`;
const SWITCH_BOX = `dev:${RACK}:u18`;
const SERVER_BOX = `dev:${RACK}:u10`;
const PANEL_BOX = `dev:${RACK}:u01`;

// ── Builders ────────────────────────────────────────────────────────
const socket = (n, status) => ({ n, status, type: '', uplink: false, cable: null });
const box = (uid, cvClass, position, statuses, passive = false) => ({
  uid, name: `${cvClass} ${position}`, position, cvClass, passive,
  sockets: statuses.map((s, i) => socket(i + 1, s)),
});
const port = (n, operStatus, name = `Gi1/0/${n}`) => ({ ifIndex: n, name, type: 'ethernetCsmacd', operStatus });
const readingOf = (ports, members = []) => ({
  localChassisId: null,
  identity: { model: null, serial: null, manufacturer: null, stackMembers: Math.max(members.length, 1), members },
  system: { sysName: null, vendor: null },
  counts: { interfaces: ports.length },
  interfaces: ports, neighbours: [],
});
const nbPort = (n, cabled, extra = {}) => ({
  id: 900 + n, name: `GigabitEthernet1/0/${n}`, type: { value: '1000base-t' }, mgmt_only: false,
  cable: cabled ? { id: 5000 + n } : null, connected_endpoints: null, ...extra,
});

/** A stored snapshot: a switch at U18, a server at U10 and a patch panel at U1. */
function snapshot() {
  const boxes = [
    { uid: SWITCH_BOX, position: 18, cls: 'Switch', ports: ['connected', 'connected', 'empty', null] },
    { uid: SERVER_BOX, position: 10, cls: 'Server', ports: ['connected', 'empty'] },
    { uid: PANEL_BOX, position: 1, cls: 'Patch Panel', ports: ['connected', 'connected'] },
  ];
  const snap = {
    racks: [{ uid: `rack:${RACK}` }], scannedAt: '2026-09-21T09:00:00Z',
    devices: [], deviceTypes: [], manufacturers: [], interfaces: [], cables: [], conflicts: [],
  };
  for (const b of boxes) {
    snap.deviceTypes.push({ uid: `dtype:${b.uid}`, model: 'Unidentified', manufacturerUid: '', uHeight: 1 });
    snap.devices.push({
      uid: b.uid, name: `${b.cls} U${b.position} ${RACK}`, position: b.position,
      deviceTypeUid: `dtype:${b.uid}`, serial: null,
      provenance: { cvClass: b.cls, cvUnits: [`u${String(b.position).padStart(2, '0')}`] },
    });
    b.ports.forEach((status, i) => snap.interfaces.push({
      uid: `if:${b.uid}:${i + 1}`, deviceUid: b.uid, name: String(i + 1), type: '',
      provenance: { category: 'rj45', status },
    }));
  }
  return snap;
}

// ── The verdict table ───────────────────────────────────────────────
test('the verdict is the photo against whoever else answered', () => {
  const table = [
    // camera    switch     netbox           verdict
    ['cabled', 'up', 'connected', 'match'],
    ['cabled', 'up', 'unknown', 'match'],
    ['cabled', 'unknown', 'connected', 'match'],
    ['empty', 'down', 'not_connected', 'match'],
    ['empty', 'unknown', 'not_connected', 'match'],
    ['cabled', 'down', 'connected', 'mismatch'],
    ['cabled', 'up', 'not_connected', 'mismatch'],
    ['cabled', 'down', 'unknown', 'mismatch'],
    ['empty', 'up', 'not_connected', 'mismatch'],
    ['empty', 'unknown', 'connected', 'mismatch'],
    ['cabled', 'unknown', 'unknown', 'unknown'],
    ['empty', 'unknown', 'unknown', 'unknown'],
    ['unknown', 'up', 'connected', 'unknown'],
    ['unknown', 'down', 'not_connected', 'unknown'],
  ];
  for (const [camera, sw, nb, verdict] of table) {
    assert.equal(connectivity.judge(camera, sw, nb).verdict, verdict, `${camera} / ${sw} / ${nb}`);
  }
});

test('a mismatch says what the photo shows and who disagrees, in plain words', () => {
  assert.equal(connectivity.judge('cabled', 'down', 'connected').why,
    'The photo shows a cable. The switch says the port is down.');
  assert.equal(connectivity.judge('cabled', 'down', 'not_connected').why,
    'The photo shows a cable. The switch says the port is down. NetBox has no cable on this port.');
  assert.equal(connectivity.judge('empty', 'up', 'unknown').why,
    'The photo shows an empty socket. The switch says the port is up.');
  assert.equal(connectivity.judge('empty', 'unknown', 'connected').why,
    'The photo shows an empty socket. NetBox has a cable on this port.');
  assert.equal(connectivity.judge('cabled', 'up', 'connected').why, null);
  for (const [c, s, n] of [['cabled', 'down', 'not_connected'], ['unknown', 'up', 'connected'], ['empty', 'unknown', 'unknown']]) {
    assert.doesNotMatch(connectivity.judge(c, s, n).why, /[–—]/, 'plain hyphen only');
  }
});

test('ports line up by the number the name ends in', () => {
  const { rows, summary } = connectivity.compare({
    devices: [box(SWITCH_BOX, 'Switch', 18, ['connected', 'connected', 'empty', 'unknown'])],
    readings: new Map([[SWITCH_BOX, readingOf([port(1, 'up'), port(2, 'down'), port(3, 1), port(4, 'up')])]]),
    records: new Map([[SWITCH_BOX, [nbPort(4, true), nbPort(3, false), nbPort(2, false), nbPort(1, true)]]]),
  });
  assert.deepEqual(rows.map((r) => [r.port, r.portName, r.camera, r.switch, r.netbox, r.verdict]), [
    [1, 'Gi1/0/1', 'cabled', 'up', 'connected', 'match'],
    [2, 'Gi1/0/2', 'cabled', 'down', 'not_connected', 'mismatch'],
    [3, 'Gi1/0/3', 'empty', 'up', 'not_connected', 'mismatch'],
    [4, 'Gi1/0/4', 'unknown', 'up', 'connected', 'unknown'],
  ]);
  assert.deepEqual(summary, { match: 1, mismatch: 2, unknown: 1 });
  assert.equal(rows[0].device, 'Switch on shelf U18');
  assert.equal(rows[0].deviceUid, SWITCH_BOX);
  for (const r of rows) assert.doesNotMatch(`${r.device} ${r.why || ''}`, /dev:|RK-|nb:device/, 'no internal names');
});

test('a port the switch never reported on, and a record found through its endpoints', () => {
  const { rows } = connectivity.compare({
    devices: [box(SWITCH_BOX, 'Switch', 18, ['connected', 'empty'])],
    readings: new Map([[SWITCH_BOX, readingOf([port(1, undefined), port(2, 'dormant')])]]),
    records: new Map([[SWITCH_BOX, [
      nbPort(1, false, { connected_endpoints: [{ id: 1 }] }), nbPort(2, false, { connected_endpoints: [] }),
    ]]]),
  });
  assert.deepEqual(rows.map((r) => [r.switch, r.netbox, r.verdict]),
    [['unknown', 'connected', 'match'], ['unknown', 'not_connected', 'match']]);
});

test('counts that differ leave that witness unknown for the whole box, and say so', () => {
  // The switch reports three sockets to the camera's two; NetBox has two and still answers.
  const half = connectivity.compare({
    devices: [box(SWITCH_BOX, 'Switch', 18, ['connected', 'empty'])],
    readings: new Map([[SWITCH_BOX, readingOf([port(1, 'down'), port(2, 'up'), port(3, 'up')])]]),
    records: new Map([[SWITCH_BOX, [nbPort(1, true), nbPort(2, false)]]]),
  });
  assert.deepEqual(half.rows.map((r) => [r.switch, r.netbox, r.verdict]),
    [['unknown', 'connected', 'match'], ['unknown', 'not_connected', 'match']]);

  // Neither side lines up: nothing is guessed, and the row says why.
  const none = connectivity.compare({
    devices: [box(SWITCH_BOX, 'Switch', 18, ['connected', 'empty'])],
    readings: new Map([[SWITCH_BOX, readingOf([port(1, 'down'), port(2, 'up'), port(3, 'up')])]]),
    records: new Map([[SWITCH_BOX, [nbPort(1, false)]]]),
  });
  for (const r of none.rows) {
    assert.deepEqual([r.switch, r.netbox, r.verdict, r.why],
      ['unknown', 'unknown', 'unknown', 'The port numbers could not be lined up.']);
    assert.equal(r.portName, null);
  }
  assert.deepEqual(none.summary, { match: 0, mismatch: 0, unknown: 2 });
});

test('NetBox interfaces that are not sockets do not count against the line-up', () => {
  const { rows } = connectivity.compare({
    devices: [box(SWITCH_BOX, 'Switch', 18, ['connected', 'empty'])],
    records: new Map([[SWITCH_BOX, [
      nbPort(1, true), nbPort(2, true),
      { id: 1, name: 'Vlan1', type: { value: 'virtual' }, cable: null },
      { id: 2, name: 'Port-channel1', type: { value: 'lag' }, cable: null },
      { id: 3, name: 'mgmt0', type: { value: '1000base-t' }, mgmt_only: true, cable: null },
    ]]]),
  });
  assert.deepEqual(rows.map((r) => [r.netbox, r.verdict]), [['connected', 'match'], ['connected', 'mismatch']]);
});

test('a stack answering as one switch lines up with nothing', () => {
  const stack = readingOf([port(1, 'up'), port(2, 'up')], [{ serial: 'FOC1111A' }, { serial: 'FOC2222B' }]);
  const { rows } = connectivity.compare({
    devices: [box(SWITCH_BOX, 'Switch', 18, ['connected', 'empty'])],
    readings: new Map([[SWITCH_BOX, stack]]),
    records: new Map([[SWITCH_BOX, [nbPort(1, true), nbPort(2, true)]]]),
  });
  for (const r of rows) {
    assert.deepEqual([r.switch, r.netbox, r.verdict, r.why],
      ['unknown', 'unknown', 'unknown', 'The port numbers could not be lined up.']);
  }
});

test('a number two ports share answers for neither', () => {
  const { rows } = connectivity.compare({
    devices: [box(SWITCH_BOX, 'Switch', 18, ['connected', 'connected', 'connected'])],
    readings: new Map([[SWITCH_BOX, readingOf([port(1, 'up'), port(2, 'up'), port(1, 'down', 'Te1/1/1')])]]),
  });
  assert.deepEqual(rows.map((r) => [r.port, r.switch]), [[1, 'unknown'], [2, 'up'], [3, 'unknown']]);
});

test('passive boxes and boxes with no sockets are left out', () => {
  const { rows } = connectivity.compare({
    devices: [
      box(PANEL_BOX, 'Patch Panel', 1, ['connected', 'connected'], true),
      box('dev:x:u02', 'PDU', 2, ['connected']),
      box('dev:x:u03', 'Server', 3, []),
      box(SERVER_BOX, 'Server', 10, ['connected']),
    ],
  });
  assert.deepEqual(rows.map((r) => r.deviceUid), [SERVER_BOX]);
  assert.equal(rows[0].why, 'Neither the switch nor NetBox has anything for this port.');
});

// ── Out of stored data, and through the two doors ───────────────────
function listen() {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}
function call(portNo, token, method, p) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1', port: portNo, method, path: p,
      headers: token ? { authorization: `Bearer ${token}`, 'x-client-platform': 'native' } : {},
    }, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => { let json = null; try { json = JSON.parse(raw); } catch { /* not json */ } resolve({ status: res.statusCode, json, raw }); });
    });
    req.on('error', reject);
    req.end();
  });
}
async function post(portNo, token, p, body) {
  const data = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1', port: portNo, method: 'POST', path: p,
      headers: { authorization: `Bearer ${token}`, 'x-client-platform': 'native',
        'content-type': 'application/json', 'content-length': Buffer.byteLength(data) },
    }, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => { let json = null; try { json = JSON.parse(raw); } catch { /* not json */ } resolve({ status: res.statusCode, json, raw }); });
    });
    req.on('error', reject);
    req.end(data);
  });
}
function seedOwner() {
  const existing = db.prepare('SELECT * FROM users WHERE username = ?').get('connectivity-owner');
  if (existing) return existing;
  const tenantId = db.prepare(`SELECT id FROM tenants WHERE slug = 'default'`).get()?.id
                ?? db.prepare('SELECT id FROM tenants ORDER BY id LIMIT 1').get()?.id;
  db.prepare(`INSERT INTO users (email, username, password_hash, role, tenant_id, active)
              VALUES (?, ?, 'x', 'owner', ?, 1)`)
    .run('connectivity-owner@example.com', 'connectivity-owner', tenantId);
  return db.prepare('SELECT * FROM users WHERE username = ?').get('connectivity-owner');
}
function seedUser({ username, role, tenantId, orgId }) {
  db.prepare(`INSERT INTO users (email, username, password_hash, role, tenant_id, organization_id, active)
              VALUES (?, ?, 'x', ?, ?, ?, 1)`).run(`${username}@example.test`, username, role, tenantId, orgId);
  return db.prepare('SELECT * FROM users WHERE username = ?').get(username);
}

test('the ports of a check come out of what is stored, through both doors', async (t) => {
  const { server, port: portNo } = await listen();
  let cleanup = async () => {};
  t.after(async () => {
    try { await cleanup(); } catch { /* best effort */ }
    await new Promise((r) => server.close(r));
  });

  const ownerTok = auth.makeToken(seedOwner());
  const makeOrg = async (name, who) => {
    const created = await post(portNo, ownerTok, '/api/orgs', {
      name: `${name} ${stamp}`, adminUsername: `${who}.admin.${stamp}`,
      adminEmail: `${who}.admin.${stamp}@example.test`, adminPassword: 'Approve@2026!',
    });
    assert.equal(created.status, 200, created.raw);
    const orgId = created.json.organization.id;
    const site = await post(portNo, ownerTok, `/api/orgs/${orgId}/sites`, { name: `${name} Site` });
    assert.equal(site.status, 200, site.raw);
    return { orgId, siteId: site.json.site.id,
      admin: db.prepare('SELECT * FROM users WHERE username = ?').get(`${who}.admin.${stamp}`) };
  };
  const a = await makeOrg('Ports A', 'pta');
  const b = await makeOrg('Ports B', 'ptb');
  cleanup = async () => {
    for (const orgId of [a.orgId, b.orgId]) {
      const gone = await call(portNo, ownerTok, 'DELETE', `/api/orgs/${orgId}`);
      if (gone.status !== 200) throw new Error(`cleanup ${orgId}: ${gone.status} ${gone.raw}`);
    }
    // The owner made for this file goes last: the organizations name it as their maker.
    db.prepare('DELETE FROM users WHERE username = ?').run('connectivity-owner');
  };
  const tech = seedUser({ username: `pta.tech.${stamp}`, role: 'member', tenantId: a.siteId, orgId: a.orgId });
  const otherTech = seedUser({ username: `pta.tech2.${stamp}`, role: 'member', tenantId: a.siteId, orgId: a.orgId });
  const auditor = seedUser({ username: `pta.audit.${stamp}`, role: 'auditor', tenantId: a.siteId, orgId: a.orgId });
  const tok = Object.fromEntries(Object.entries({ tech, otherTech, auditor, admin: a.admin, bAdmin: b.admin })
    .map(([k, u]) => [k, auth.makeToken(u)]));

  // The stored scan, the switch filed against its rack and matched to the box
  // at U18, and a check whose Device items carry the NetBox records.
  const scan = scans.addScan({ rackId: RACK, source: 'racktrack', rackName: 'RACK-01', siteName: 'HQ',
    payload: { snapshot: snapshot(), tenantId: a.siteId, matches: { 7: SWITCH_BOX } } });
  fleet = [{
    record: { id: 7, label: 'core', host: '10.0.0.7', rackId: RACK },
    reading: readingOf([port(1, 'up'), port(2, 'down'), port(3, 'up'), port(4, 'up')]),
  }];
  netboxInterfaces = {
    44: [nbPort(1, true), nbPort(2, false), nbPort(3, false), nbPort(4, true)],
    45: [nbPort(1, true), nbPort(2, true), nbPort(3, true)],     // three to the camera's two
  };
  const planId = service.create({
    scanId: scan.id, rackId: RACK, rackName: 'RACK-01', actor: tech, orgId: a.orgId, tenantId: a.siteId,
    report: {
      rackUid: `rack:${RACK}`, netboxUrl: 'http://netbox.test', customField: 'present',
      counts: { update: 1 }, warnings: [],
      // The server's record was found sitting on its box, not yet bound to it.
      orphans: [{ netboxId: 45, name: 'SRV-10', seen: true, matchedBox: SERVER_BOX, matchedBy: 'a box on shelf U10' }],
      changes: [{ type: 'Device', uid: SWITCH_BOX, name: 'SW-18', action: 'update', netboxId: 44,
        diff: { position: { from: 17, to: 18 } } }],
    },
  }).plan.id;

  // ---- the phone's door
  connectivity._forget();
  netboxCalls = [];
  const phone = await call(portNo, tok.tech, 'GET', `/api/nb/plans/${planId}/connectivity`);
  assert.equal(phone.status, 200, phone.raw);
  assert.equal(phone.json.ok, true);
  assert.equal(phone.json.planId, planId);
  assert.deepEqual(phone.json.sources, { camera: true, switch: true, netbox: true });
  assert.deepEqual(phone.json.summary, { match: 1, mismatch: 2, unknown: 3 });
  assert.equal(phone.json.note, null);
  assert.deepEqual(Object.keys(phone.json.rows[0]),
    ['deviceUid', 'device', 'port', 'portName', 'camera', 'switch', 'netbox', 'verdict', 'why']);
  assert.deepEqual(phone.json.rows.map((r) => [r.device, r.port, r.camera, r.switch, r.netbox, r.verdict]), [
    ['Switch on shelf U18', 1, 'cabled', 'up', 'connected', 'match'],
    ['Switch on shelf U18', 2, 'cabled', 'down', 'not_connected', 'mismatch'],
    ['Switch on shelf U18', 3, 'empty', 'up', 'not_connected', 'mismatch'],
    ['Switch on shelf U18', 4, 'unknown', 'up', 'connected', 'unknown'],
    ['Server on shelf U10', 1, 'cabled', 'unknown', 'unknown', 'unknown'],
    ['Server on shelf U10', 2, 'empty', 'unknown', 'unknown', 'unknown'],
  ]);
  assert.equal(phone.json.rows[1].why,
    'The photo shows a cable. The switch says the port is down. NetBox has no cable on this port.');
  assert.equal(phone.json.rows[4].why, 'The port numbers could not be lined up.');
  assert.ok(!phone.json.rows.some((r) => r.deviceUid === PANEL_BOX), 'the patch panel is left out');
  assert.deepEqual(netboxCalls.map((c) => c.params.device_id).sort(), [44, 45],
    'NetBox is asked once per box that has a record, and for nothing else');

  // ---- the desk's door: the same answer, and inside the minute nobody asks NetBox again
  const desk = await call(portNo, tok.auditor, 'GET', `/api/approvals/plans/${planId}/connectivity`);
  assert.equal(desk.status, 200, desk.raw);
  assert.deepEqual(desk.json, phone.json);
  assert.equal(netboxCalls.length, 2, 'kept for a minute per check');
  assert.equal((await call(portNo, tok.admin, 'GET', `/api/approvals/plans/${planId}/connectivity`)).status, 200);
  assert.equal((await call(portNo, tok.admin, 'GET', `/api/nb/plans/${planId}/connectivity`)).status, 200);

  // ---- who is refused
  assert.equal((await call(portNo, null, 'GET', `/api/nb/plans/${planId}/connectivity`)).status, 401);
  assert.equal((await call(portNo, null, 'GET', `/api/approvals/plans/${planId}/connectivity`)).status, 401);
  assert.equal((await call(portNo, tok.otherTech, 'GET', `/api/nb/plans/${planId}/connectivity`)).status, 404,
    'a technician sees the ports of the checks they raised');
  assert.equal((await call(portNo, tok.bAdmin, 'GET', `/api/nb/plans/${planId}/connectivity`)).status, 404,
    'another organization\'s check is not there');
  assert.equal((await call(portNo, tok.bAdmin, 'GET', `/api/approvals/plans/${planId}/connectivity`)).status, 404);
  assert.equal((await call(portNo, tok.auditor, 'GET', `/api/nb/plans/${planId}/connectivity`)).status, 403,
    'the phone\'s door is for technicians');
  assert.equal((await call(portNo, tok.tech, 'GET', '/api/nb/plans/99999999/connectivity')).status, 404);

  // ---- the routers behind the two doors still answer everything else
  const plainPhone = await call(portNo, tok.tech, 'GET', `/api/nb/plans/${planId}`);
  assert.equal(plainPhone.status, 200, plainPhone.raw);
  assert.equal(plainPhone.json.id, planId);
  const plainDesk = await call(portNo, tok.auditor, 'GET', `/api/approvals/plans/${planId}`);
  assert.equal(plainDesk.status, 200, plainDesk.raw);
  assert.equal(plainDesk.json.plan.id, planId);
  assert.equal((await call(portNo, tok.tech, 'GET', '/api/nb/plans')).status, 200);
  assert.equal((await call(portNo, tok.auditor, 'GET', '/api/approvals/plans')).status, 200);

  // ---- forPlan, asked directly
  const full = service.get(planId, a.admin);
  const ask = (client, now) => connectivity.forPlan(full.plan, full.items, { client, now });

  // No NetBox anywhere: that column is unknown and nothing else changes.
  connectivity._forget();
  const bare = await ask(null);
  assert.deepEqual(bare.sources, { camera: true, switch: true, netbox: false });
  assert.deepEqual(bare.rows.slice(0, 3).map((r) => [r.switch, r.netbox, r.verdict]),
    [['up', 'unknown', 'match'], ['down', 'unknown', 'mismatch'], ['up', 'unknown', 'mismatch']]);
  assert.equal(bare.rows[4].why, 'Neither the switch nor NetBox has anything for this port.');

  // A minute on, the answer is worked out again.
  const client = new NetBox('http://netbox.test', 'test-token');
  connectivity._forget();
  netboxCalls = [];
  const t0 = Date.now();
  await ask(client, t0);
  await ask(client, t0 + connectivity.CACHE_MS - 1);
  assert.equal(netboxCalls.length, 2);
  await ask(client, t0 + connectivity.CACHE_MS);
  assert.equal(netboxCalls.length, 4);

  // NetBox failing for one box is that box unknown, not the page.
  connectivity._forget();
  netboxInterfaces[44] = 'down';
  const partial = await ask(client);
  assert.deepEqual(partial.rows.slice(0, 2).map((r) => [r.switch, r.netbox, r.verdict]),
    [['up', 'unknown', 'match'], ['down', 'unknown', 'mismatch']]);

  // No switch read for the rack: the note says so, and the photo still stands beside NetBox.
  connectivity._forget();
  netboxInterfaces[44] = [nbPort(1, true), nbPort(2, false), nbPort(3, false), nbPort(4, true)];
  fleet = [];
  const unread = await ask(client);
  assert.equal(unread.sources.switch, false);
  assert.equal(unread.note, 'No switch has been read for this rack yet.');
  assert.deepEqual(unread.rows.slice(0, 3).map((r) => [r.switch, r.netbox, r.verdict]),
    [['unknown', 'connected', 'match'], ['unknown', 'not_connected', 'mismatch'], ['unknown', 'not_connected', 'match']]);

  // A check whose scan is gone answers an empty section, not an error.
  connectivity._forget();
  const orphaned = await connectivity.forPlan({ ...full.plan, id: -1, scanId: 99999999 }, full.items, { client });
  assert.deepEqual(orphaned.rows, []);
  assert.deepEqual(orphaned.sources, { camera: false, switch: false, netbox: false });
  assert.equal(orphaned.note, 'The scan behind this check could not be read.');
});
