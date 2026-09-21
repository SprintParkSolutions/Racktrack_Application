/**
 * The owner's demo, through the doors the phone and the Drift Desk use.
 *
 * The application is booted, the customer's NetBox is the demo rack held in
 * memory (test/fixtures/demo_rack.js) and ServiceNow is a fake instance handed
 * in through incidents._setDeps, so nothing here reaches a network. The box on
 * U20 carries eight camera-counted ports and the customer's record five of its
 * own: a port made on that record is the thing that must never happen.
 *
 *   the technician sends - the check is with the Site's SPOC, with ONE
 *   incident whose number is in the answer - the sender may not decide or
 *   approve - the SPOC is shown "same device, wrong shelf" for SP-R1-U20-ACT -
 *   accepts - the same check number, one item left - approves, leaving the
 *   incident Resolved - the server writes ONE patch, position 22 to 20 - the
 *   change registry shows ONE row - the incident is Resolved with what was
 *   written in its close notes - the sender is told twice
 *
 * The second walk is the write NetBox refuses: the incident hears it in a work
 * note and stays open, and resolves when an admin's retry goes through.
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
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-demo-http';
process.env.RACKTRACK_SKIP_WORKER_POOL = '1';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-demo-http-'));
process.env.RT_DATA_DIR = path.join(tmp, 'data', 'netbox');
process.env.RT_OUTPUTS_DIR = path.join(tmp, 'outputs');
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const stamp = Date.now();
const auth = require('../../auth');
auth.sendNotice = async () => true;

const { app } = require('../../app');
const service = require('../../lib/approvals/service');
const store = require('../../lib/approvals/store');
const write = require('../../lib/approvals/write');
const incidents = require('../../lib/approvals/incidents');
const writer = require('../../lib/netbox/writer');
const scans = require('../../lib/netbox/store');
const estate = require('../../lib/estate');
const F = require('../fixtures/demo_rack');

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
  const existing = db.prepare('SELECT * FROM users WHERE username = ?').get('demo-http-owner');
  if (existing) return existing;
  const tenantId = db.prepare(`SELECT id FROM tenants WHERE slug = 'default'`).get()?.id
                ?? db.prepare('SELECT id FROM tenants ORDER BY id LIMIT 1').get()?.id;
  db.prepare(`INSERT INTO users (email, username, password_hash, role, tenant_id, active)
              VALUES (?, ?, 'x', 'owner', ?, 1)`)
    .run('demo-http-owner@example.com', 'demo-http-owner', tenantId);
  return db.prepare('SELECT * FROM users WHERE username = ?').get('demo-http-owner');
}
function seedUser({ username, role, tenantId, orgId }) {
  db.prepare(`INSERT INTO users (email, username, password_hash, role, tenant_id, organization_id, active)
              VALUES (?, ?, 'x', ?, ?, ?, 1)`).run(`${username}@example.test`, username, role, tenantId, orgId);
  return db.prepare('SELECT * FROM users WHERE username = ?').get(username);
}

/** A ServiceNow that raises, patches and lists, and keeps every work note it is sent. */
function instance(spocEmail) {
  const sn = { calls: [], rows: new Map(), notes: [], n: 0 };
  const ok = (result, status = 200) => ({ ok: true, status, body: { result } });
  sn.fetch = async (url, method, headers, body) => {
    sn.calls.push({ url: decodeURIComponent(url), method, body });
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
      const row = { ...body, sys_id: `inc-${stamp}-${sn.n}`, number: `INC00300${sn.n}`, state: '1',
        assigned_to: body.assigned_to ? { value: body.assigned_to } : '' };
      sn.rows.set(row.sys_id, row);
      return ok(row, 201);
    }
    const row = sn.rows.get(u.pathname.split('/').pop());
    if (body.work_notes) sn.notes.push({ sysId: row.sys_id, text: body.work_notes });
    Object.assign(row, body, body.state ? { state: String(body.state) } : {});
    return ok(row);
  };
  sn.raised = () => sn.calls.filter((c) => c.method === 'POST' && /\/table\/incident$/.test(new URL(c.url).pathname));
  return sn;
}

test('the demo, and the write NetBox refuses, at the doors', async (t) => {
  const { server, port } = await listen();
  let cleanup = async () => {};
  t.after(async () => {
    incidents._setDeps({});
    write._setDeps(null);
    service._setCompare(null);
    try { await cleanup(); } catch { /* best effort */ }
    await new Promise((r) => server.close(r));
  });

  const ownerTok = auth.makeToken(seedOwner());
  const created = await call(port, ownerTok, 'POST', '/api/orgs', {
    name: `Demo ${stamp}`, adminUsername: `demo.admin.${stamp}`,
    adminEmail: `demo.admin.${stamp}@example.test`, adminPassword: 'Approve@2026!',
  });
  assert.equal(created.status, 200, created.raw);
  const orgId = created.json.organization.id;
  cleanup = async () => {
    const gone = await call(port, ownerTok, 'DELETE', `/api/orgs/${orgId}`);
    if (gone.status !== 200) throw new Error(`cleanup ${orgId}: ${gone.status} ${gone.raw}`);
  };
  const site = await call(port, ownerTok, 'POST', `/api/orgs/${orgId}/sites`, { name: 'Office-Sprintpark Demo' });
  assert.equal(site.status, 200, site.raw);
  const siteId = site.json.site.id;
  const admin = db.prepare('SELECT * FROM users WHERE username = ?').get(`demo.admin.${stamp}`);
  const tech = seedUser({ username: `demo.tech.${stamp}`, role: 'member', tenantId: siteId, orgId });
  const holder = seedUser({ username: `demo.spoc.${stamp}`, role: 'site_manager', tenantId: siteId, orgId });
  estate.setApprover(siteId, { user_id: holder.id }, admin.id);
  const tok = { admin: auth.makeToken(admin), tech: auth.makeToken(tech), spoc: auth.makeToken(holder) };

  const sn = instance(holder.email);
  incidents._setDeps({ fetchImpl: sn.fetch,
    serviceNowFor: (who) => (Number(who.orgId) === Number(orgId)
      ? { instanceUrl: 'https://acme.service-now.com', username: 'svc', password: 'x', incidentTable: 'incident' } : null) });

  let racks = 0;
  /** A rack scanned and compared as the phone does it, and filed by the technician. */
  async function filed(nb) {
    racks += 1;
    const rackId = `RK-DEMO${String(stamp).slice(-5)}${racks}`;
    const scan = scans.addScan({ rackId, source: 'adopted', rackName: 'SP-HYB-RM01-R01-R1',
      payload: { snapshot: F.demoSnapshot(), tenantId: siteId, rackName: 'SP-HYB-RM01-R01-R1' } });
    // Every comparison of the check reads this NetBox: a client of its own for
    // a change tried before approving, and one client for the whole write.
    service._setCompare({ client: () => nb.client() });
    write._setDeps({ client: nb.client() });
    const out = service.createFromPreview({ scan: scans.getScan(scan.id), snap: F.demoSnapshot(),
      report: await writer.plan(F.demoSnapshot(), nb.client()), actor: tech, tenantId: siteId, reuse: true });
    return out.plan.id;
  }
  const desk = (who, id, what, body = {}) => call(port, tok[who], 'POST', `/api/approvals/plans/${id}/${what}`, body);
  const noticesOf = async (who, planId) => (await call(port, tok[who], 'GET', '/api/approvals/notifications'))
    .json.notifications.filter((n) => Number(n.planId) === Number(planId)).map((n) => n.event);
  const until = async (read, want, ms = 3000) => {
    const end = Date.now() + ms;
    let got = await read();
    while (!want(got) && Date.now() < end) { await new Promise((r) => setTimeout(r, 25)); got = await read(); }
    return got;
  };

  await t.test('sent, suggested, accepted, approved, written as one patch, recorded, resolved', async () => {
    const nb = F.seedDemoRack(F.fakeNetBox());
    const id = await filed(nb);

    // ---- The technician sends. One incident, and its number is in the answer.
    const sent = await call(port, tok.tech, 'POST', `/api/nb/plans/${id}/submit`, { note: 'the router is on shelf U20' });
    assert.equal(sent.status, 200, sent.raw);
    assert.equal(sent.json.state, 'assigned');
    assert.equal(sent.json.assignee.name, holder.username);
    assert.equal(sent.json.incident.system, 'servicenow');
    assert.equal(sent.json.incident.number, 'INC003001');
    assert.equal(sent.json.incident.assigned, true);
    assert.equal(sn.raised().length, 1, 'one incident for the check, not one for each item');

    // ---- The sender decides nothing and approves nothing.
    const barredDecide = await desk('tech', id, 'decide', { decisions: [{ uid: F.U20, decision: 'approved' }] });
    assert.equal(barredDecide.status, 403, barredDecide.raw);
    const barredApprove = await desk('tech', id, 'approve', {});
    assert.equal(barredApprove.status, 403, barredApprove.raw);
    assert.equal(store.getPlan(id, { heavy: false }).status, 'assigned');

    // ---- The SPOC is shown the suggestion.
    const opened = await call(port, tok.spoc, 'GET', `/api/approvals/plans/${id}`);
    assert.equal(opened.status, 200, opened.raw);
    assert.equal(opened.json.plan.status, 'assigned');
    assert.equal(opened.json.incident.number, 'INC003001');
    assert.deepEqual(opened.json.suggestions.map((s) => [s.rule, s.state, s.title]),
      [['wrong_shelf', 'open', 'Same device, wrong shelf: move record SP-R1-U20-ACT from U22 to U20']]);
    assert.equal(opened.json.items.filter((i) => i.type === 'Interface').length, 8, 'the box brings its eight ports');

    // ---- Accept. The same check, and one item left to decide.
    const accepted = await desk('spoc', id, `suggestions/${opened.json.suggestions[0].id}/accept`);
    assert.equal(accepted.status, 200, accepted.raw);
    assert.equal(accepted.json.plan.id, id, 'the same check number');
    const left = accepted.json.items.filter((i) => i.decidable);
    assert.deepEqual(left.map((i) => [i.action, i.netboxId, i.diff.position]), [['rebind', F.RECORD_ID, { from: 22, to: 20 }]]);
    assert.equal(accepted.json.items.filter((i) => i.type === 'Interface').length, 0);
    assert.equal(nb.writes().length, 0, 'nothing is in NetBox yet');
    assert.equal(sn.raised().length, 1, 'and the check keeps its one incident');

    // ---- Approve, leaving the incident Resolved. The server writes.
    const from = nb.calls.length;
    const before = structuredClone(nb.record());
    const approved = await desk('spoc', id, 'approve', { incidentState: 'resolved', comment: 'moved it myself last week' });
    assert.equal(approved.status, 200, approved.raw);
    assert.deepEqual([approved.json.write.state, approved.json.write.status, approved.json.write.written,
      approved.json.write.failed, approved.json.write.changes], ['written', 'completed', 1, 0, 1]);
    assert.equal(approved.json.plan.status, 'completed');

    // ---- NetBox saw one patch, and no port or device was made.
    const writes = nb.writes(from);
    assert.equal(writes.length, 1, JSON.stringify(writes));
    assert.deepEqual([writes[0].method, writes[0].path], ['PATCH', `${F.DEVICES}${F.RECORD_ID}/`]);
    assert.deepEqual(Object.keys(writes[0].body).sort(), ['custom_fields', 'position']);
    assert.equal(writes[0].body.position, 20);
    assert.deepEqual(Object.keys(writes[0].body.custom_fields).sort(), ['racktrack_bound', 'racktrack_uid']);
    assert.equal(nb.calls.slice(from).filter((c) => c.method === 'POST').length, 0, 'zero POSTs: no port, no device, no catalogue');
    const now = nb.record();
    assert.equal(now.position, 20);
    for (const field of ['name', 'rack', 'site', 'role', 'device_type', 'tenant', 'face', 'status', 'serial']) {
      assert.deepEqual(now[field], before[field], `${field} is as the customer had it`);
    }
    assert.equal(nb.rows(F.INTERFACES).length, 5, 'the record keeps its own five ports and gains none');
    // The site is the object that failed this write live: the scan's id for it
    // was on nothing, so it read as a create NetBox refused. It is found by its
    // name now, and a write that does not need it does not touch it at all.
    const sites = nb.rows('/api/dcim/sites/');
    assert.equal(sites.length, 1, 'no second site of the same name was made');
    assert.deepEqual([sites[0].slug, sites[0].custom_fields], ['office-sprint', {}],
      'their site keeps their own slug and carries nothing of ours');

    // ---- The change registry: one row a person sees.
    const changes = await call(port, tok.spoc, 'GET', `/api/approvals/changes?planId=${id}`);
    assert.equal(changes.status, 200, changes.raw);
    assert.equal(changes.json.changes.length, 1, changes.raw);
    const [row] = changes.json.changes;
    assert.deepEqual([row.planId, row.objectName, row.netboxId, row.field, row.before, row.after, row.result, row.source,
      row.rule, row.approvedBy, row.approvedById, row.writtenBy, row.incidentNumber, row.internal, row.checked],
    [id, 'SP-R1-U20-ACT', F.RECORD_ID, 'position', 22, 20, 'written', 'suggestion',
      'wrong_shelf', holder.username, holder.id, 'system', 'INC003001', false, 'verified']);
    assert.equal(row.itemUid, undefined);
    const asked = await call(port, tok.admin, 'GET', `/api/approvals/changes?planId=${id}&internal=1`);
    assert.ok(asked.json.changes.length > 1, 'RackTrack\'s own link fields are recorded, and shown only when asked for');
    // The check carries the same rows, link fields and all, for the screen that shows what its write did.
    const done = await call(port, tok.spoc, 'GET', `/api/approvals/plans/${id}`);
    assert.deepEqual(done.json.changes.filter((c) => !c.internal), [row]);
    assert.deepEqual(done.json.changes.filter((c) => c.internal).map((c) => c.field).sort(), ['racktrack_bound', 'racktrack_uid']);
    assert.equal(done.json.changes.some((c) => 'itemUid' in c), false);
    const barred = await call(port, tok.tech, 'GET', `/api/approvals/changes?planId=${id}`);
    assert.equal(barred.status, 403, barred.raw);

    // ---- The incident is Resolved, in the state the approver chose, and says what was written.
    assert.deepEqual(approved.json.incident, { number: 'INC003001', state: 'resolved', pushed: true, error: null });
    const inc = sn.rows.get(`inc-${stamp}-1`);
    assert.equal(inc.state, '6');
    assert.equal(inc.close_code, 'Solution provided');
    assert.equal(inc.close_notes, [
      `Approved by ${holder.username} in RackTrack check ${id}. Written to NetBox: 1 change.`,
      'SP-R1-U20-ACT: position 22 -> 20',
    ].join('\n'));
    assert.doesNotMatch(inc.close_notes, /racktrack_|recordId|dev:/);
    assert.equal(store.getPlan(id).incident.chosenState.state, 'resolved');

    // ---- The sender is told twice: approved, then written.
    const told = await until(() => noticesOf('tech', id), (events) => events.includes('approved') && events.includes('completed'));
    assert.deepEqual(told.filter((k) => ['approved', 'completed'].includes(k)).sort(), ['approved', 'completed']);
  });

  await t.test('a write NetBox refuses leaves the incident open with a work note, and the retry resolves it', async () => {
    const nb = F.seedDemoRack(F.fakeNetBox());
    const id = await filed(nb);
    const sent = await call(port, tok.tech, 'POST', `/api/nb/plans/${id}/submit`, {});
    assert.equal(sent.json.incident.number, 'INC003002');
    const opened = await call(port, tok.spoc, 'GET', `/api/approvals/plans/${id}`);
    const accepted = await desk('spoc', id, `suggestions/${opened.json.suggestions[0].id}/accept`);
    assert.equal(accepted.status, 200, accepted.raw);

    // NetBox refuses the patch on the record, once.
    const client = nb.client();
    const request = client.request;
    let refuse = true;
    client.request = async (method, p, ...rest) => {
      if (refuse && method === 'PATCH' && p === `${F.DEVICES}${F.RECORD_ID}/`) {
        nb.calls.push({ method, path: p, refused: true });
        throw Object.assign(new Error('400'), { status: 400, detail: 'U20 is reserved for another tenant' });
      }
      return request(method, p, ...rest);
    };
    write._setDeps({ client });

    const approved = await desk('spoc', id, 'approve', { incidentState: 'closed' });
    assert.equal(approved.status, 200, approved.raw);
    assert.deepEqual([approved.json.write.state, approved.json.write.status, approved.json.write.failed],
      ['failed', 'write_failed', 1]);
    assert.equal(nb.record().position, 22);

    // The incident hears it and stays open: no state, no close notes.
    const inc = sn.rows.get(`inc-${stamp}-2`);
    const notes = await until(async () => sn.notes.filter((n) => n.sysId === inc.sys_id), (got) => got.length > 0);
    assert.equal(notes.length, 1, JSON.stringify(notes));
    assert.match(notes[0].text, /^Approved, but NetBox refused 1 object:/);
    assert.match(notes[0].text, /This incident stays open\. An organization admin can try the write again\.$/);
    assert.equal(inc.state, '1');
    assert.equal(inc.close_notes, undefined);
    // `pushed` says ServiceNow has heard the outcome, which here is the note.
    assert.deepEqual(approved.json.incident, { number: 'INC003002', state: 'new', pushed: true, error: null });
    const failedRows = await call(port, tok.admin, 'GET', `/api/approvals/changes?planId=${id}&result=failed`);
    assert.deepEqual(failedRows.json.changes.map((c) => [c.objectName, c.result, c.incidentNumber]),
      [['SP-R1-U20-ACT', 'failed', 'INC003002']]);

    // The SPOC may not run it again; an organization admin may, and the state the approver chose still holds.
    const notTheirs = await desk('spoc', id, 'write', {});
    assert.equal(notTheirs.status, 403, notTheirs.raw);
    refuse = false;
    const retried = await desk('admin', id, 'write', {});
    assert.equal(retried.status, 200, retried.raw);
    assert.equal(nb.record().position, 20);
    const closed = await until(async () => inc.state, (state) => state === '7');
    assert.equal(closed, '7', 'Closed, as the approver asked when approving');
    assert.match(inc.close_notes, /Written to NetBox: 1 change\.\nSP-R1-U20-ACT: position 22 -> 20$/);
    assert.equal(sn.raised().length, 2, 'one incident a check, through the failure and the retry');
  });
});
