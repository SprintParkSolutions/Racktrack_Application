/**
 * The approval that writes, and the registry of what it wrote, at the doors.
 *
 * Driven through the real routes, booted the way http.test.js boots them. The
 * writer and the NetBox client are handed to the write through its test seam
 * (write._setDeps), so nothing here reaches a network: the fake below is a
 * NetBox that remembers what was written to it, which is what makes the check
 * after a write mean something.
 *
 *   - the final approval writes in the same request: written, then completed,
 *     in the approver's name, by the system
 *   - a write that outlasts the wait answers `writing` and still finishes
 *   - a stale approval sends the check back to its holder, with why
 *   - with two approvals asked for, the write waits for the second
 *   - a write NetBox refused part of is write_failed; the SPOC cannot run it
 *     again, an organization admin can
 *   - the registry: an admin and an auditor read the organization, a SPOC
 *     their own Site and the checks they hold or held, nobody else, never
 *     another organization; the link fields only when asked; the same as a file
 *   - the rows go when the organization goes
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
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-changes-http';
process.env.RACKTRACK_SKIP_WORKER_POOL = '1';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-changes-'));
process.env.RT_DATA_DIR = path.join(tmp, 'data', 'netbox');
process.env.RT_OUTPUTS_DIR = path.join(tmp, 'outputs');
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const stamp = Date.now();
const auth = require('../../auth');
const mails = [];
auth.sendNotice = async (m) => { mails.push(m); return true; };

const { app } = require('../../app');
const service = require('../../lib/approvals/service');
const store = require('../../lib/approvals/store');
const write = require('../../lib/approvals/write');
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
      res.on('end', () => { let json = null; try { json = JSON.parse(raw); } catch { /* not json */ } resolve({ status: res.statusCode, json, raw, headers: res.headers }); });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}
function seedOwner() {
  const existing = db.prepare('SELECT * FROM users WHERE username = ?').get('changes-http-owner');
  if (existing) return existing;
  const tenantId = db.prepare(`SELECT id FROM tenants WHERE slug = 'default'`).get()?.id
                ?? db.prepare('SELECT id FROM tenants ORDER BY id LIMIT 1').get()?.id;
  db.prepare(`INSERT INTO users (email, username, password_hash, role, tenant_id, active)
              VALUES (?, ?, 'x', 'owner', ?, 1)`)
    .run('changes-http-owner@example.com', 'changes-http-owner', tenantId);
  return db.prepare('SELECT * FROM users WHERE username = ?').get('changes-http-owner');
}
function seedUser({ username, role, tenantId, orgId }) {
  db.prepare(`INSERT INTO users (email, username, password_hash, role, tenant_id, organization_id, active)
              VALUES (?, ?, 'x', ?, ?, ?, 1)`).run(`${username}@example.test`, username, role, tenantId, orgId);
  return db.prepare('SELECT * FROM users WHERE username = ?').get(username);
}

// -- A NetBox that remembers ---------------------------------------------------
/**
 * One rack as the comparison sees it: a new switch with a port, a firewall one
 * shelf out, and the customer's own record found two shelves from where the
 * photo shows it. `held` is what NetBox now holds; a comparison wants whatever
 * is not there yet.
 */
function rack(n) {
  const RACK = `RK-CHG${String(stamp).slice(-4)}${n}`;
  const DEV = `dev:${RACK}:u12`;
  const DEV2 = `dev:${RACK}:u15`;
  const BOUND = `dev:${RACK}:u20`;
  const changes = [
    { type: 'Manufacturer', uid: `mfr:cisco:${n}`, name: 'Cisco', action: 'create', created: { name: 'Cisco' } },
    { type: 'Device', uid: DEV, name: `SW-12 ${RACK}`, action: 'create', created: { name: 'SW-12', position: 12 } },
    { type: 'Interface', uid: `if:${DEV}:1`, name: 'Gi1/0/1', action: 'create', created: { name: 'Gi1/0/1' } },
    { type: 'Device', uid: DEV2, name: 'FW-15', action: 'update', netboxId: 44,
      diff: { position: { from: 14, to: 15 } } },
    { type: 'Device', uid: BOUND, name: `Router U20 ${RACK}`, action: 'rebind', netboxId: 199,
      diff: { racktrack_uid: { from: null, to: BOUND }, recordId: { from: null, to: 199 },
        position: { from: 22, to: 20 } } },
  ];
  const world = {
    RACK, DEV, DEV2, BOUND, held: new Set(), refuse: new Set(), moved: false, gate: null, pushes: 0,
    snapshot: { rackUid: `rack:${RACK}`, manufacturers: [{ uid: `mfr:cisco:${n}`, name: 'Cisco' }],
      devices: [{ uid: DEV, name: 'SW-12' }, { uid: DEV2, name: 'FW-15' }, { uid: BOUND, name: 'Router U20' }],
      interfaces: [{ uid: `if:${DEV}:1`, deviceUid: DEV, name: 'Gi1/0/1' }] },
  };
  world.wants = () => changes.filter((c) => !world.held.has(c.uid)).map((c) => ({ ...c,
    ...(world.moved && c.uid === DEV2 ? { diff: { position: { from: 13, to: 15 } } } : {}) }));
  world.report = () => ({ rackUid: `rack:${RACK}`, netboxUrl: 'http://netbox.test', customField: 'present',
    counts: {}, warnings: [], orphans: [],
    changes: world.wants().map((c) => { const row = { ...c }; delete row.created; return row; }) });
  world.writer = {
    plan: async () => world.report(),
    push: async (snap) => {
      world.pushes += 1;
      if (world.gate) await world.gate;
      const sent = new Set(Object.values(snap).filter(Array.isArray).flat().map((o) => o.uid));
      const rows = [];
      for (const c of world.wants().filter((x) => sent.has(x.uid))) {
        if (world.refuse.has(c.uid)) {
          rows.push({ type: c.type, uid: c.uid, name: c.name, action: 'fail',
            reason: 'NetBox refused this change: a device with this name already exists' });
        } else {
          world.held.add(c.uid);
          rows.push({ ...c, netboxId: c.netboxId ?? 300 });
        }
      }
      return { counts: {}, changes: rows };
    },
  };
  return world;
}
const client = { url: 'http://netbox.test', findByUid: async () => null };
const use = (world, extra = {}) => write._setDeps({ writer: world.writer, client, snapshot: world.snapshot, ...extra });

test('the final approval writes, and the registry says what it wrote and to whom', async (t) => {
  const { server, port } = await listen();
  let cleanup = async () => {};
  t.after(async () => {
    write._setDeps(null);
    try { await cleanup(); } catch { /* best effort */ }
    await new Promise((r) => server.close(r));
  });

  const ownerTok = auth.makeToken(seedOwner());
  const makeOrg = async (name, who) => {
    const created = await call(port, ownerTok, 'POST', '/api/orgs', {
      name: `${name} ${stamp}`, adminUsername: `${who}.admin.${stamp}`,
      adminEmail: `${who}.admin.${stamp}@example.test`, adminPassword: 'Changes@2026!',
    });
    assert.equal(created.status, 200, created.raw);
    const orgId = created.json.organization.id;
    const site = await call(port, ownerTok, 'POST', `/api/orgs/${orgId}/sites`, { name: `${name} Site` });
    assert.equal(site.status, 200, site.raw);
    return { orgId, siteId: site.json.site.id,
      admin: db.prepare('SELECT * FROM users WHERE username = ?').get(`${who}.admin.${stamp}`) };
  };
  const a = await makeOrg('Changes A', 'cha');
  const b = await makeOrg('Changes B', 'chb');
  const gone = new Set();
  const removeOrg = async (orgId) => {
    if (gone.has(orgId)) return;
    const out = await call(port, ownerTok, 'DELETE', `/api/orgs/${orgId}`);
    if (out.status !== 200) throw new Error(`cleanup ${orgId}: ${out.status} ${out.raw}`);
    gone.add(orgId);
  };
  cleanup = async () => { for (const orgId of [a.orgId, b.orgId]) await removeOrg(orgId); };
  const site2 = await call(port, ownerTok, 'POST', `/api/orgs/${a.orgId}/sites`, { name: 'Changes A Second Site' });
  assert.equal(site2.status, 200, site2.raw);

  const mk = (name, role, tenantId = a.siteId) => seedUser({ username: `cha.${name}.${stamp}`, role, tenantId, orgId: a.orgId });
  const tech = mk('tech', 'member');
  const meera = mk('meera', 'member');                       // the SPOC of the Site
  const sita = mk('sita', 'site_manager', site2.json.site.id); // the SPOC of the other Site
  const ravi = mk('ravi', 'member');                         // nobody's SPOC
  const auditor = mk('audit', 'auditor');
  const second = mk('second', 'approver');
  estate.setApprover(a.siteId, { user_id: meera.id }, a.admin.id);
  estate.setApprover(site2.json.site.id, { user_id: sita.id }, a.admin.id);
  const tok = Object.fromEntries(Object.entries({ admin: a.admin, tech, meera, sita, ravi, auditor, second,
    bAdmin: b.admin }).map(([k, u]) => [k, auth.makeToken(u)]));

  const post = (who, id, what, body = {}) => call(port, tok[who], 'POST', `/api/approvals/plans/${id}/${what}`, body);
  const get = (who, p) => call(port, tok[who], 'GET', `/api/approvals${p}`);
  /** A check sent by the technician, decided by the SPOC, ready for her approval. */
  const ready = async (world, decisions = null) => {
    const id = service.create({ scanId: 1, rackId: world.RACK, rackName: world.RACK, report: world.report(),
      actor: tech, orgId: a.orgId, tenantId: a.siteId }).plan.id;
    const sent = await post('tech', id, 'submit');
    assert.equal(sent.json.plan.status, 'assigned', sent.raw);
    const said = await post('meera', id, 'decide', { decisions: decisions
      || [world.DEV, world.DEV2, world.BOUND].map((uid) => ({ uid, decision: 'approved' })) });
    assert.equal(said.json.refused.length, 0, said.raw);
    return id;
  };

  // ================= 1. Approved, written, completed: one request =================
  const w1 = rack(1);
  const p1 = await ready(w1, [{ uid: w1.DEV, decision: 'approved' }, { uid: w1.BOUND, decision: 'approved' },
    { uid: w1.DEV2, decision: 'rejected', reasonCode: 'wrong_asset', note: 'leave it at 14' }]);
  use(w1);
  mails.length = 0;
  const approved = await post('meera', p1, 'approve', { comment: 'checked against the report' });
  assert.equal(approved.status, 200, approved.raw);
  assert.equal(approved.json.final, true);
  assert.deepEqual(approved.json.write, { state: 'written', status: 'completed', written: 4, failed: 0,
    failures: [], changes: 4, why: null });
  assert.equal(approved.json.plan.status, 'completed', 'the answer carries the check as the write left it');
  assert.equal(w1.pushes, 1);
  assert.equal(w1.held.has(w1.DEV2), false, 'what she rejected was never sent');
  const detail = await get('admin', `/plans/${p1}`);
  assert.equal(detail.json.plan.writtenBy, 'system');
  await new Promise((r) => setTimeout(r, 50));
  assert.ok(mails.some((m) => m.to === tech.email && /is written/.test(m.subject)), 'the sender hears it is written');

  // ================= 2. The registry, and who may read it =================
  const all = await get('admin', `/changes?planId=${p1}`);
  assert.equal(all.status, 200, all.raw);
  assert.deepEqual(all.json.changes.map((c) => [c.objectType, c.action, c.field]).reverse(), [
    ['Manufacturer', 'create', '*'], ['Device', 'create', '*'], ['Interface', 'create', '*'],
    ['Device', 'rebind', 'position']], 'newest first; the link fields are not listed');
  const moved = all.json.changes.find((c) => c.field === 'position');
  assert.deepEqual([moved.before, moved.after], [22, 20], 'before and after come back as the values they were');
  assert.equal(moved.netboxId, 199);
  assert.equal(moved.netboxUrl, 'http://netbox.test/dcim/devices/199/');
  assert.equal(moved.objectName, 'Router U20', 'the rack is not repeated in the name of everything in it');
  assert.equal(moved.approvedBy, meera.username);
  assert.equal(moved.approvedById, meera.id);
  assert.equal(moved.writtenBy, 'system');
  assert.equal(moved.result, 'written');
  assert.equal(moved.checked, 'verified', 'and the check after the write is read back on the row');
  assert.equal(moved.siteName, 'Changes A Site');
  assert.equal(moved.rackId, w1.RACK);
  assert.ok(!('itemUid' in moved), 'no uid of ours reaches a screen');
  const created = all.json.changes.find((c) => c.objectType === 'Device' && c.action === 'create');
  assert.deepEqual(created.after, { name: 'SW-12', position: 12 });
  const withLinks = await get('admin', `/changes?planId=${p1}&internal=1`);
  assert.deepEqual(withLinks.json.changes.filter((c) => c.internal).map((c) => c.field), ['racktrack_uid']);
  assert.equal((await get('admin', `/changes?planId=${p1}&field=position`)).json.changes.length, 1);
  assert.equal((await get('admin', `/changes?planId=${p1}&limit=1`)).json.nextCursor, all.json.changes[0].id);

  assert.equal((await get('auditor', `/changes?planId=${p1}`)).json.changes.length, 4, 'an auditor reads the organization');
  assert.equal((await get('meera', `/changes?planId=${p1}`)).json.changes.length, 4, 'the SPOC reads her own Site');
  const otherSite = await get('sita', '/changes');
  assert.equal(otherSite.status, 200, otherSite.raw);
  assert.deepEqual(otherSite.json.changes, [], 'the SPOC of another Site reads her own, which holds nothing yet');
  for (const who of ['ravi', 'tech']) {
    const no = await get(who, '/changes');
    assert.equal(no.status, 403, `${who}: ${no.raw}`);
    assert.equal(no.json.error, 'The change registry is for an admin, an auditor, or the SPOC of a site.');
  }
  assert.deepEqual((await get('bAdmin', '/changes')).json.changes, [], 'another organization sees none of it');
  assert.deepEqual((await get('bAdmin', `/changes?planId=${p1}`)).json.changes, []);

  const file = await get('meera', `/changes.csv?planId=${p1}`);
  assert.equal(file.status, 200);
  assert.match(file.headers['content-type'], /text\/csv/);
  const lines = file.raw.trim().split('\n');
  assert.equal(lines[0], 'When,Site,Rack,Object type,Object,NetBox id,Field,Before,After,Result,Reason,Source,'
    + 'Approved by,Written by,Check,Incident');
  assert.equal(lines.length, 5);
  assert.match(lines[1], new RegExp(`,Device,Router U20,199,position,22,20,written,,scan,${meera.username},system,${p1},`));
  assert.equal((await get('ravi', '/changes.csv')).status, 403);
  const counted = await get('admin', '/reports/changes');
  assert.equal(counted.status, 200, counted.raw);
  assert.deepEqual(counted.json.rows.map((r) => [r.planId, r.written, r.failed]), [[p1, 4, 0]]);

  // ================= 3. A write that outlasts the wait =================
  const w2 = rack(2);
  const p2 = await ready(w2);
  let release;
  w2.gate = new Promise((r) => { release = r; });
  use(w2, { waitMs: 30 });
  const slow = await post('meera', p2, 'approve');
  assert.equal(slow.status, 200, slow.raw);
  assert.deepEqual(slow.json.write, { state: 'writing', status: 'write_in_progress', written: 0, failed: 0,
    failures: [], changes: 0, why: null });
  assert.equal(slow.json.plan.status, 'write_in_progress');
  assert.equal((await post('admin', p2, 'write')).status, 409, 'a second write cannot start beside it');
  release();
  for (let i = 0; i < 50 && (await get('meera', `/plans/${p2}`)).json.plan.status !== 'completed'; i += 1) {
    await new Promise((r) => setTimeout(r, 20));
  }
  assert.equal((await get('meera', `/plans/${p2}`)).json.plan.status, 'completed', 'it finishes behind the answer');
  assert.equal((await get('admin', `/changes?planId=${p2}`)).json.changes.length, 5);

  // ================= 4. NetBox moved: back to the holder =================
  const w3 = rack(3);
  const p3 = await ready(w3);
  w3.moved = true;
  use(w3);
  const bounced = await post('meera', p3, 'approve');
  assert.equal(bounced.status, 200, bounced.raw);
  assert.equal(bounced.json.write.state, 'bounced');
  assert.equal(bounced.json.write.status, 'assigned');
  assert.match(bounced.json.write.why, /^NetBox changed after you approved, so nothing was written\./);
  assert.equal(bounced.json.plan.status, 'assigned');
  assert.equal(w3.pushes, 0);
  const again = await get('meera', `/plans/${p3}`);
  assert.equal(again.json.plan.status, 'assigned');
  assert.equal(again.json.holder.userId, meera.id, 'it is with her again');
  assert.deepEqual((await get('admin', `/changes?planId=${p3}`)).json.changes, []);

  // ================= 5. Two approvals asked for: the write waits =================
  assert.equal((await call(port, tok.admin, 'PUT', '/api/approvals/settings/dual_approval_risks',
    { value: ['critical'] })).status, 200);
  const w4 = rack(4);
  const p4 = await ready(w4);
  assert.equal((await post('admin', p4, 'triage', { risk: 'critical' })).json.plan.risk, 'critical');
  use(w4);
  const first = await post('meera', p4, 'approve');
  assert.equal(first.json.needsSecond, true, first.raw);
  assert.equal(first.json.write, null);
  assert.equal(first.json.plan.status, 'approval_pending');
  assert.equal(w4.pushes, 0, 'nothing is written on one name when two are asked for');
  const last = await post('second', p4, 'approve');
  assert.equal(last.status, 200, last.raw);
  assert.equal(last.json.write.state, 'written');
  assert.equal(w4.pushes, 1);
  assert.equal((await get('admin', `/changes?planId=${p4}`)).json.changes[0].approvedBy, second.username,
    'the name that made it final');
  assert.equal((await call(port, tok.admin, 'PUT', '/api/approvals/settings/dual_approval_risks',
    { value: [] })).status, 200);

  // ================= 6. NetBox refuses part: failed, and the retry is an admin's =================
  const w5 = rack(5);
  const p5 = await ready(w5);
  w5.refuse.add(w5.DEV2);
  use(w5);
  mails.length = 0;
  const failed = await post('meera', p5, 'approve');
  assert.equal(failed.status, 200, failed.raw);
  assert.equal(failed.json.write.state, 'failed');
  assert.equal(failed.json.write.status, 'write_failed');
  assert.equal(failed.json.write.failed, 1);
  assert.deepEqual(failed.json.write.failures.map((f) => f.uid), [w5.DEV2]);
  await new Promise((r) => setTimeout(r, 50));
  assert.deepEqual([...new Set(mails.filter((m) => /did not finish/.test(m.subject)).map((m) => m.to))].sort(),
    [a.admin.email, meera.email].sort(), 'the admins and the holder are told, once each');
  const refusedRow = (await get('admin', `/changes?planId=${p5}&result=failed`)).json.changes;
  assert.deepEqual(refusedRow.map((c) => [c.objectName, c.field, c.result]), [['FW-15', '*', 'failed']]);
  assert.match(refusedRow[0].reason, /already exists/);
  assert.equal((await post('meera', p5, 'write')).status, 403, 'the retry is not the SPOC\'s');
  w5.refuse.clear();
  const retried = await post('admin', p5, 'write');
  assert.equal(retried.status, 200, retried.raw);
  assert.equal(retried.json.status, 'completed');
  const second5 = (await get('admin', `/changes?planId=${p5}`)).json.changes.filter((c) => c.attempt === 2);
  assert.deepEqual(second5.map((c) => [c.field, c.before, c.after, c.writtenBy, c.approvedBy]),
    [['position', 14, 15, a.admin.username, meera.username]]);

  // ================= 7. A check somebody holds who is no Site's SPOC =================
  const dev = mk('dev', 'member', site2.json.site.id);
  tok.dev = auth.makeToken(dev);
  assert.equal((await get('dev', '/changes')).status, 403, 'not yet anybody the registry is for');
  const w6 = rack(6);
  const p6 = service.create({ scanId: 1, rackId: w6.RACK, rackName: w6.RACK, report: w6.report(),
    actor: tech, orgId: a.orgId, tenantId: site2.json.site.id }).plan.id;
  assert.equal((await post('tech', p6, 'submit')).json.holder.userId, sita.id);
  const given = await post('admin', p6, 'assign', { userId: dev.id, reason: 'Sita is away' });
  assert.equal(given.status, 200, given.raw);
  await post('dev', p6, 'decide', { decisions: [w6.DEV, w6.DEV2, w6.BOUND].map((uid) => ({ uid, decision: 'approved' })) });
  use(w6);
  assert.equal((await post('dev', p6, 'approve')).json.write.state, 'written');
  const held = await get('dev', '/changes');
  assert.equal(held.status, 200, held.raw);
  assert.deepEqual([...new Set(held.json.changes.map((c) => c.planId))], [p6], 'the check they hold, and nothing else');
  assert.equal((await get('sita', '/changes')).json.changes.length, 5, 'and the SPOC of its Site reads it too');
  assert.equal((await get('meera', `/changes?planId=${p6}`)).json.changes.length, 0, 'the SPOC of another Site does not');

  // ================= 8. The rows go when the organization goes =================
  assert.ok(store.changesOf(p1).length > 0);
  await removeOrg(a.orgId);
  for (const id of [p1, p2, p4, p5, p6]) assert.equal(store.changesOf(id, { checks: true }).length, 0);
});
