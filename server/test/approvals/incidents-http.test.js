/**
 * The check's incident, through the doors the phone and the Drift Desk use.
 *
 * test/approvals/incidents.test.js pins incidents.js against a fake instance.
 * This boots the application and asks the same of the routes, with the same
 * kind of fake handed in through incidents._setDeps, so nothing here reaches a
 * network either:
 *
 *   - the phone's send answers with the incident: system, number, url, state,
 *     assigned, error - and the older builds still find the number on a ticket
 *   - opening the check from the phone asks ServiceNow nothing
 *   - the desk's reject, rework and cancel answer with the state they pushed
 *   - a ServiceNow that never answers holds neither the send nor a decision
 *
 * The shared auth.db is left as it was found: the organization is removed at
 * the end, which takes its members and every approval row with it.
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
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-incidents-http';
process.env.RACKTRACK_SKIP_WORKER_POOL = '1';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-incidents-http-'));
process.env.RT_DATA_DIR = path.join(tmp, 'data', 'netbox');
process.env.RT_OUTPUTS_DIR = path.join(tmp, 'outputs');
process.env.NETBOX_URL = 'http://netbox.test';
process.env.NETBOX_TOKEN = 'test-token';
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const stamp = Date.now();
const rackMatch = require('../../lib/netbox/rack_match');
rackMatch.resolveRack = async () => ({ name: 'RACK-01', rackKey: null, source: 'scan',
                                       confidence: 'none', why: 'stubbed for the test' });
const auth = require('../../auth');
auth.sendNotice = async () => true;

const { app } = require('../../app');
const service = require('../../lib/approvals/service');
const store = require('../../lib/approvals/store');
const incidents = require('../../lib/approvals/incidents');
const estate = require('../../lib/estate');

const db = auth.db;

function listen() {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}
function call(port, token, method, p, body) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : JSON.stringify(body);
    const req = http.request({
      host: '127.0.0.1', port, method, path: p,
      headers: {
        authorization: `Bearer ${token}`, 'x-client-platform': 'native',
        ...(data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {}),
      },
    }, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => { let json = null; try { json = JSON.parse(raw); } catch { /* not json */ } resolve({ status: res.statusCode, json, raw }); });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}
function seedOwner() {
  const existing = db.prepare('SELECT * FROM users WHERE username = ?').get('incidents-http-owner');
  if (existing) return existing;
  const tenantId = db.prepare(`SELECT id FROM tenants WHERE slug = 'default'`).get()?.id
                ?? db.prepare('SELECT id FROM tenants ORDER BY id LIMIT 1').get()?.id;
  db.prepare(`INSERT INTO users (email, username, password_hash, role, tenant_id, active)
              VALUES (?, ?, 'x', 'owner', ?, 1)`)
    .run('incidents-http-owner@example.com', 'incidents-http-owner', tenantId);
  return db.prepare('SELECT * FROM users WHERE username = ?').get('incidents-http-owner');
}
function seedUser({ username, email, role, tenantId, orgId }) {
  db.prepare(`INSERT INTO users (email, username, password_hash, role, tenant_id, organization_id, active)
              VALUES (?, ?, 'x', ?, ?, ?, 1)`).run(email, username, role, tenantId, orgId);
  return db.prepare('SELECT * FROM users WHERE username = ?').get(username);
}

const RACK = `RK-INC${String(stamp).slice(-6)}`;
const DEV = `dev:${RACK}:u12`;
const report = () => ({
  rackUid: `rack:${RACK}`, netboxUrl: 'http://netbox.test', customField: 'present',
  counts: { update: 1 }, warnings: [], orphans: [],
  changes: [{ type: 'Device', uid: DEV, name: 'FW-15', action: 'update', netboxId: 44,
    diff: { position: { from: 14, to: 15 } } }],
});

/** A ServiceNow that raises, patches and lists; `hang` stops it answering at all. */
function instance(spocEmail) {
  const sn = { calls: [], rows: new Map(), hang: false, n: 0 };
  const ok = (result, status = 200) => ({ ok: true, status, body: { result } });
  sn.fetch = async (url, method, headers, body) => {
    sn.calls.push({ url: decodeURIComponent(url), method, body });
    if (sn.hang) return new Promise(() => {});
    const u = new URL(url);
    const query = u.searchParams.get('sysparm_query') || '';
    if (u.pathname.endsWith('/table/sys_user')) {
      return ok(query.includes(spocEmail.toLowerCase()) ? [{ sys_id: 'u-spoc', name: 'The SPOC', email: spocEmail }] : []);
    }
    if (u.pathname.endsWith('/table/sys_choice')) {
      return ok(/element=close_code/.test(query)
        ? [{ value: 'Solution provided', label: 'Solution provided', sequence: 1 },
          { value: 'No resolution provided', label: 'No resolution provided', sequence: 2 }]
        : [{ value: '5', label: 'Awaiting Change', sequence: 1 }]);
    }
    if (u.pathname === '/api/now/attachment/file') return ok({ sys_id: `att-${sn.calls.length}` }, 201);
    if (method === 'GET') return ok([...sn.rows.values()].filter((r) => query.includes(r.correlation_id)));
    if (method === 'POST') {
      sn.n += 1;
      const row = { ...body, sys_id: `inc-${stamp}-${sn.n}`, number: `INC00200${sn.n}`, state: '1',
        assigned_to: body.assigned_to ? { value: body.assigned_to } : '' };
      sn.rows.set(row.sys_id, row);
      return ok(row, 201);
    }
    const row = sn.rows.get(u.pathname.split('/').pop());
    Object.assign(row, body, body.state ? { state: String(body.state) } : {});
    return ok(row);
  };
  return sn;
}

test('the incident of a check, at the doors', async (t) => {
  const { server, port } = await listen();
  let cleanup = async () => {};
  t.after(async () => {
    incidents._setDeps({});
    delete process.env.RT_INCIDENT_WAIT_MS;
    delete process.env.RT_INCIDENT_PUSH_WAIT_MS;
    try { await cleanup(); } catch { /* best effort */ }
    await new Promise((r) => server.close(r));
  });

  const ownerTok = auth.makeToken(seedOwner());
  const created = await call(port, ownerTok, 'POST', '/api/orgs', {
    name: `Incidents ${stamp}`, adminUsername: `inc.admin.${stamp}`,
    adminEmail: `inc.admin.${stamp}@example.test`, adminPassword: 'Approve@2026!',
  });
  assert.equal(created.status, 200, created.raw);
  const orgId = created.json.organization.id;
  cleanup = async () => {
    const gone = await call(port, ownerTok, 'DELETE', `/api/orgs/${orgId}`);
    if (gone.status !== 200) throw new Error(`cleanup ${orgId}: ${gone.status} ${gone.raw}`);
  };
  const site = await call(port, ownerTok, 'POST', `/api/orgs/${orgId}/sites`, { name: 'Incidents Site' });
  assert.equal(site.status, 200, site.raw);
  const siteId = site.json.site.id;
  const admin = db.prepare('SELECT * FROM users WHERE username = ?').get(`inc.admin.${stamp}`);
  const tech = seedUser({ username: `inc.tech.${stamp}`, email: `inc.tech.${stamp}@example.test`,
    role: 'member', tenantId: siteId, orgId });
  const holder = seedUser({ username: `inc.spoc.${stamp}`, email: `inc.spoc.${stamp}@example.test`,
    role: 'site_manager', tenantId: siteId, orgId });
  estate.setApprover(siteId, { user_id: holder.id }, admin.id);
  const tok = { admin: auth.makeToken(admin), tech: auth.makeToken(tech), spoc: auth.makeToken(holder) };

  const sn = instance(holder.email);
  incidents._setDeps({ fetchImpl: sn.fetch,
    serviceNowFor: (who) => (Number(who.orgId) === Number(orgId)
      ? { instanceUrl: 'https://acme.service-now.com', username: 'svc', password: 'x', incidentTable: 'incident' } : null) });

  const file = () => service.create({ scanId: 1, rackId: RACK, rackName: 'RACK-01', report: report(),
    actor: tech, orgId, tenantId: siteId, reuse: false }).plan.id;
  const desk = (who, id, what, body = {}) => call(port, tok[who], 'POST', `/api/approvals/plans/${id}/${what}`, body);

  // ---- The phone sends, and the answer carries the incident.
  const p1 = file();
  const sent = await call(port, tok.tech, 'POST', `/api/nb/plans/${p1}/submit`, { note: 'U15 looks wrong to me' });
  assert.equal(sent.status, 200, sent.raw);
  assert.equal(sent.json.state, 'assigned');
  assert.equal(sent.json.status, 'submitted', 'the word the older builds read');
  assert.equal(sent.json.assignee.name, holder.username);
  assert.deepEqual(sent.json.incident, { system: 'servicenow', number: 'INC002001',
    url: `https://acme.service-now.com/nav_to.do?uri=incident.do?sys_id=inc-${stamp}-1`,
    state: 'new', assigned: true, error: null });

  // ---- The older builds read the number off a ticket, and opening the check
  // asks ServiceNow nothing: what it says is heard by the poller, for the check.
  const before = sn.calls.length;
  const opened = await call(port, tok.tech, 'GET', `/api/nb/plans/${p1}`);
  assert.equal(opened.status, 200, opened.raw);
  const item = opened.json.items.find((i) => i.uid === DEV);
  assert.equal(item.ticket.external.number, 'INC002001');
  assert.equal(sn.calls.slice(before).filter((c) => /sys_idIN/.test(c.url)).length, 0);

  // ---- The desk reads it whole, with the states a person may leave it in.
  const view = await call(port, tok.spoc, 'GET', `/api/approvals/plans/${p1}`);
  assert.equal(view.status, 200, view.raw);
  assert.equal(view.json.incident.number, 'INC002001');
  assert.equal(view.json.incident.raisedFor.username, holder.username);
  assert.deepEqual(view.json.incidentStates.defaults, { approve: 'resolved', reject: 'cancelled', rework: 'on_hold' });

  // ---- Reject, rework and cancel answer with the state they pushed.
  const rejected = await desk('spoc', p1, 'reject', { reasonCode: 'insufficient_evidence',
    comment: 'the photo does not show the label' });
  assert.equal(rejected.status, 200, rejected.raw);
  assert.deepEqual(rejected.json.incident, { number: 'INC002001', state: 'cancelled', pushed: true, error: null });
  assert.equal(sn.rows.get(`inc-${stamp}-1`).state, '8');
  assert.match(sn.rows.get(`inc-${stamp}-1`).close_notes, /^Rejected by inc\.spoc\.\d+ in RackTrack check \d+ \(not enough evidence\)/);

  const p2 = file();
  await call(port, tok.tech, 'POST', `/api/nb/plans/${p2}/submit`, {});
  const back = await desk('spoc', p2, 'rework', { reasonCode: 'other', comment: 'scan it again',
    incidentState: 'in_progress' });
  assert.equal(back.status, 200, back.raw);
  assert.deepEqual(back.json.incident, { number: 'INC002002', state: 'in progress', pushed: true, error: null });

  const p3 = file();
  await call(port, tok.tech, 'POST', `/api/nb/plans/${p3}/submit`, {});
  const cancelled = await desk('admin', p3, 'cancel', { reason: 'scanned the wrong rack' });
  assert.equal(cancelled.status, 200, cancelled.raw);
  assert.deepEqual(cancelled.json.incident, { number: 'INC002003', state: 'cancelled', pushed: true, error: null });

  // ---- An approval pushes nothing by itself: the write has not happened.
  const p4 = file();
  await call(port, tok.tech, 'POST', `/api/nb/plans/${p4}/submit`, {});
  await desk('spoc', p4, 'decide', { decisions: [{ uid: DEV, decision: 'approved' }] });
  const approved = await desk('spoc', p4, 'approve', { incidentState: 'closed' });
  assert.equal(approved.status, 200, approved.raw);
  assert.deepEqual(approved.json.incident, { number: 'INC002004', state: 'new', pushed: false, error: null });
  assert.equal(store.getPlan(p4).incident.chosenState.state, 'closed', 'what the approver chose waits for the write');

  // ---- A ServiceNow that never answers holds nobody up.
  process.env.RT_INCIDENT_WAIT_MS = '60';
  process.env.RT_INCIDENT_PUSH_WAIT_MS = '60';
  const p5 = file();
  await call(port, tok.tech, 'POST', `/api/nb/plans/${p5}/submit`, {});
  sn.hang = true;
  const started = Date.now();
  const slow = await desk('spoc', p5, 'reject', { reasonCode: 'other', comment: 'no' });
  assert.equal(slow.status, 200, slow.raw);
  assert.equal(slow.json.plan.status, 'rejected', 'the decision stands');
  assert.deepEqual(slow.json.incident, { number: 'INC002005', state: 'new', pushed: false, error: null, pending: true });

  const p6 = file();
  const dead = await call(port, tok.tech, 'POST', `/api/nb/plans/${p6}/submit`, {});
  assert.ok(Date.now() - started < 5000);
  assert.equal(dead.status, 200, dead.raw);
  assert.equal(dead.json.state, 'assigned', 'the check is with its SPOC whatever ServiceNow does');
  assert.deepEqual(dead.json.incident, { system: 'servicenow', number: null, url: null, state: 'raising',
    assigned: false, error: null });
});
