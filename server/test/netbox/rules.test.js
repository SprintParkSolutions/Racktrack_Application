/**
 * The frozen drift workflow, held by the server.
 *
 * docs/design/drift-approval-workflow.md says who does what and what nobody
 * can do. These tests drive the real routes, booted the way org_remove does,
 * with NetBox, ServiceNow and the mail transport stubbed at the module
 * boundary, and check the rules hold at the HTTP layer:
 *
 *   - a technician (member) reaches exactly six routes and is refused the rest
 *   - a technician sees only the plans they raised
 *   - approve and reject are refused until the item has been assigned and
 *     has come back
 *   - the whole rack assigns as one move, one incident per item
 *   - the assignee is one NetBox contact: id and email stored, ambiguity refused
 *   - the assignee resolves their own ticket by email, not only by name
 *   - a write NetBox refused part of is write_failed, emailed, and retried
 *   - every step leaves an audit row
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
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-drift-rules';
process.env.RACKTRACK_SKIP_WORKER_POOL = '1';

// Its own data and outputs, away from the real ones. app.js honours both.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-rules-'));
process.env.RT_DATA_DIR = path.join(tmp, 'data', 'netbox');
process.env.RT_OUTPUTS_DIR = path.join(tmp, 'outputs');
// A NetBox "exists" for the env fallback; every call to it is stubbed below.
process.env.NETBOX_URL = 'http://netbox.test';
process.env.NETBOX_TOKEN = 'test-token';
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const RACK = 'RK-RULES0001';
const DEV = `dev:${RACK}:u12`;
const DEV2 = `dev:${RACK}:u15`;
const CHANGES = [
  { type: 'Manufacturer', uid: 'mfr:cisco', name: 'Cisco', action: 'create' },
  { type: 'Device', uid: DEV, name: 'SW-12', action: 'create' },
  { type: 'Interface', uid: `if:${DEV}:1`, name: 'Gi1/0/1', action: 'create' },
  { type: 'Interface', uid: `if:${DEV}:2`, name: 'Gi1/0/2', action: 'create' },
  { type: 'Device', uid: DEV2, name: 'FW-15', action: 'update', netboxId: 44,
    diff: { position: { from: 14, to: 15 } } },
];

// The comparison and the write, stubbed BEFORE the routes load: netbox.js
// takes { plan, push } off the module at require time.
const writer = require('../../lib/netbox/writer');
let pushResult = () => { throw new Error('push was not expected'); };
writer.plan = async (snap) => ({
  rackUid: snap.rackUid, netboxUrl: 'http://netbox.test', customField: 'present',
  counts: { create: 4, update: 1 }, warnings: [], orphans: [], changes: CHANGES,
});
writer.push = async () => pushResult();

// The mail transport: every notice lands here instead of going anywhere.
const auth = require('../../auth');
const mails = [];
auth.sendNotice = async (m) => { mails.push(m); return true; };

// The contacts NetBox knows. Two are named Sam Patel on purpose. The SPOC's
// email is also a RackTrack user's below, stamped so a run never collides
// with a row an earlier run, or a person, left in the shared auth.db.
const stamp = Date.now();
const MEERA = { name: 'Meera Raghavan', email: `drift.meera.${stamp}@sprintpark.test`, title: 'DC lead',
                phone: null, netboxId: 7 };
const SAM_A = { name: 'Sam Patel', email: 'sam.a@sprintpark.com', title: null, phone: null, netboxId: 8 };
const SAM_B = { name: 'Sam Patel', email: 'sam.b@sprintpark.com', title: null, phone: null, netboxId: 9 };
const spoc = require('../../lib/netbox/spoc');
const rackMatch = require('../../lib/netbox/rack_match');
rackMatch.resolveRack = async () => ({ name: 'RACK-01', rackKey: null, source: 'scan',
                                       confidence: 'none', why: 'stubbed for the test' });
spoc.forRack = async () => ({ spoc: { ...MEERA, via: 'rack', role: 'spoc' }, others: [],
                              rack: { id: 1, name: 'RACK-01' }, site: { id: 1, name: 'HQ' }, why: null });
spoc.everyone = async () => [MEERA, SAM_A, SAM_B];

const { app } = require('../../app');
const audit = require('../../audit');
const tenant = require('../../lib/tenant');

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

const db = auth.db;
function seedOwner() {
  const existing = db.prepare('SELECT * FROM users WHERE username = ?').get('drift-rules-owner');
  if (existing) return existing;
  const tenantId = db.prepare(`SELECT id FROM tenants WHERE slug = 'default'`).get()?.id
                ?? db.prepare('SELECT id FROM tenants ORDER BY id LIMIT 1').get()?.id;
  db.prepare(`INSERT INTO users (email, username, password_hash, role, tenant_id, active)
              VALUES (?, ?, ?, 'owner', ?, 1)`)
    .run('drift-rules-owner@example.com', 'drift-rules-owner', 'x', tenantId);
  return db.prepare('SELECT * FROM users WHERE username = ?').get('drift-rules-owner');
}
function seedUser({ username, email, role, tenantId, orgId }) {
  db.prepare(`INSERT INTO users (email, username, password_hash, role, tenant_id, organization_id, active)
              VALUES (?, ?, 'x', ?, ?, ?, 1)`).run(email, username, role, tenantId, orgId);
  return db.prepare('SELECT * FROM users WHERE username = ?').get(username);
}

// Plan ids start at 1 in this run's own data dir, while audit_log is the
// shared auth.db, so only rows written since this run began are this run's.
const since = db.prepare('SELECT COALESCE(MAX(id), 0) AS n FROM audit_log').get().n;
const rows = (action, planId) => audit
  .query({ action, targetType: 'drift_plan', targetId: planId })
  .filter((r) => r.id > since);

test('the drift workflow holds its rules at every route', async (t) => {
  const { server, port } = await listen();
  // Leave the shared auth.db as it was found: the org delete takes its Site,
  // its members and their rack claims with it. It has to run while the
  // server is still up, so one hook does both, in that order.
  let cleanup = async () => {};
  t.after(async () => {
    try { await cleanup(); } catch { /* best effort */ }
    await new Promise((r) => server.close(r));
  });

  // An organisation with a Site, an org admin, a member (the technician) and
  // two site managers: one whose email is the SPOC's, one who is nobody's assignee.
  const ownerTok = auth.makeToken(seedOwner());
  const created = await call(port, ownerTok, 'POST', '/api/orgs', {
    name: `Drift Rules ${stamp}`, adminUsername: `drift.admin.${stamp}`,
    adminEmail: `drift.admin.${stamp}@example.test`, adminPassword: 'Drift@2026!',
  });
  assert.equal(created.status, 200, created.raw);
  const orgId = created.json.organization.id;
  const site = await call(port, ownerTok, 'POST', `/api/orgs/${orgId}/sites`, { name: 'Drift Site' });
  assert.equal(site.status, 200, site.raw);
  const siteId = site.json.site.id;
  cleanup = async () => {
    const gone = await call(port, ownerTok, 'DELETE', `/api/orgs/${orgId}`);
    if (gone.status !== 200) throw new Error(`cleanup: ${gone.status} ${gone.raw}`);
  };

  const admin = db.prepare('SELECT * FROM users WHERE username = ?').get(`drift.admin.${stamp}`);
  const member = seedUser({ username: `drift.tech.${stamp}`, email: `drift.tech.${stamp}@example.test`,
                            role: 'member', tenantId: siteId, orgId });
  const meera = seedUser({ username: `drift.meera.${stamp}`, email: MEERA.email,
                           role: 'site_manager', tenantId: siteId, orgId });
  const other = seedUser({ username: `drift.other.${stamp}`, email: `drift.other.${stamp}@example.test`,
                           role: 'site_manager', tenantId: siteId, orgId });
  const adminTok = auth.makeToken(admin);
  const memberTok = auth.makeToken(member);
  const meeraTok = auth.makeToken(meera);
  const otherTok = auth.makeToken(other);

  // The rack: scanned under the member's Site, with a detection result on disk.
  tenant.claimRack(siteId, RACK, member.id);
  const dir = path.join(process.env.RT_OUTPUTS_DIR, RACK);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'device_unit_map.json'), JSON.stringify({
    devices: [
      { class_name: 'Switch', units: ['u12'], port_count: 24 },
      { class_name: 'Firewall', units: ['u15'], port_count: 8 },
    ],
  }));
  fs.writeFileSync(path.join(dir, 'scan_meta.json'), JSON.stringify({
    tenantId: siteId, timestamp: new Date().toISOString(),
  }));

  // ---- 1. The technician: adopt, compare, read their own plan, hand it over.
  const adopted = await call(port, memberTok, 'POST', `/api/nb/scans/adopt/${RACK}`, {});
  assert.ok([200, 201].includes(adopted.status), `adopt as a member: ${adopted.status} ${adopted.raw}`);
  const scanId = adopted.json.id;

  const preview = await call(port, memberTok, 'POST', `/api/nb/netbox/${scanId}/preview`, {});
  assert.equal(preview.status, 200, `preview as a member: ${preview.raw}`);
  const planId = preview.json.planId;
  assert.ok(planId, 'the comparison was filed as a plan');
  assert.equal(preview.json.summary.decidable, 2);
  assert.equal(preview.json.summary.following, 2, 'the two ports follow their switch');

  // The admin compares the same scan: a second plan, theirs.
  const adminPreview = await call(port, adminTok, 'POST', `/api/nb/netbox/${scanId}/preview`, {});
  assert.equal(adminPreview.status, 200, adminPreview.raw);
  const adminPlanId = adminPreview.json.planId;

  const memberList = await call(port, memberTok, 'GET', '/api/nb/plans');
  assert.equal(memberList.status, 200, memberList.raw);
  assert.deepEqual(memberList.json.plans.map((p) => p.id), [planId],
    'a technician lists only the plans they raised');
  assert.equal(memberList.json.mine, true);
  const adminList = await call(port, adminTok, 'GET', `/api/nb/plans?rackId=${RACK}`);
  assert.deepEqual(new Set(adminList.json.plans.map((p) => p.id)), new Set([planId, adminPlanId]),
    'an admin sees every plan in the organisation');
  const adminMine = await call(port, adminTok, 'GET', `/api/nb/plans?rackId=${RACK}&mine=1`);
  assert.deepEqual(adminMine.json.plans.map((p) => p.id), [adminPlanId], '?mine=1 narrows to theirs');

  const own = await call(port, memberTok, 'GET', `/api/nb/plans/${planId}`);
  assert.equal(own.status, 200, own.raw);
  assert.equal(own.json.createdBy, member.username);
  const items = Object.fromEntries(own.json.items.map((i) => [i.uid, i]));
  assert.equal(items[`if:${DEV}:1`].parentUid, DEV, 'a port names its device');
  assert.equal(items[`if:${DEV}:1`].following, true);
  assert.equal(own.json.summary.following, 2);
  const notOwn = await call(port, memberTok, 'GET', `/api/nb/plans/${adminPlanId}`);
  assert.equal(notOwn.status, 404, 'somebody else\'s plan is, to a technician, not there');

  const contacts = await call(port, memberTok, 'GET', `/api/nb/plans/${planId}/contacts`);
  assert.equal(contacts.status, 200, contacts.raw);
  assert.equal(contacts.json.spoc.name, MEERA.name);

  const submitted = await call(port, memberTok, 'POST', `/api/nb/plans/${planId}/submit`,
    { note: 'U15 looks wrong to me' });
  assert.equal(submitted.status, 200, submitted.raw);
  assert.equal(submitted.json.status, 'submitted');
  assert.equal(rows('drift.submit', planId).length, 1, 'the hand-over is on the audit trail');
  const submitOther = await call(port, memberTok, 'POST', `/api/nb/plans/${adminPlanId}/submit`, {});
  assert.equal(submitOther.status, 404, 'a technician cannot submit a plan that is not theirs');

  // ---- 2. The technician is refused everything else.
  const refused = [
    ['POST', `/api/nb/plans/${planId}/decide`, { decisions: [{ uid: DEV, decision: 'approved' }] }],
    ['POST', `/api/nb/netbox/${scanId}/export`, { planId }],
    ['GET', '/api/nb/plans/tickets/all'],
    ['POST', `/api/nb/plans/${planId}/tickets/${DEV}/resolve`, { finding: 'x' }],
    ['GET', `/api/nb/plans/${planId}/tickets`],
    ['GET', '/api/nb/connectors/types'],
    ['GET', '/api/nb/scans'],
    ['GET', `/api/nb/scans/${scanId}`],
    ['GET', '/api/nb/switches'],
    ['GET', '/api/nb/unmanaged'],
    ['GET', '/api/nb/netbox/health'],
    ['GET', `/api/nb/netbox/${scanId}/export.json`],
  ];
  for (const [method, p, body] of refused) {
    const r = await call(port, memberTok, method, p, body);
    assert.equal(r.status, 403, `${method} ${p} as a member: ${r.status} ${r.raw}`);
  }

  // ---- 2b. The phone reads a switch at the rack and files the reading, so a
  // technician lists, adds and files for THEIR rack - and nothing more.
  const SW = { label: 'Core', host: '10.9.9.9', port: 161, version: 'v2c', community: 'public' };
  const mine = await call(port, memberTok, 'POST', '/api/nb/switches', { rackId: RACK, ...SW });
  assert.equal(mine.status, 201, `a technician adds a switch to their rack: ${mine.raw}`);
  const listed = await call(port, memberTok, 'GET', `/api/nb/switches?rackId=${RACK}`);
  assert.equal(listed.status, 200, listed.raw);
  assert.deepEqual(listed.json.map((s) => s.id), [mine.json.id]);
  assert.equal(listed.json[0].community, undefined, 'no secret comes back');
  const reading = { system: { sysName: 'core-sw' }, interfaces: [{ ifIndex: 1, name: 'Gi1/0/1' }] };
  const filed = await call(port, memberTok, 'POST', `/api/nb/switches/${mine.json.id}/reading`, reading);
  assert.equal(filed.status, 200, `a technician files a phone reading: ${filed.raw}`);

  const ELSEWHERE = 'RK-RULES0002';
  const theirs = await call(port, adminTok, 'POST', '/api/nb/switches', { rackId: ELSEWHERE, ...SW });
  assert.equal(theirs.status, 201, theirs.raw);
  for (const [method, p, body] of [
    ['GET', `/api/nb/switches?rackId=${ELSEWHERE}`],
    ['POST', '/api/nb/switches', { rackId: ELSEWHERE, ...SW }],
    ['POST', `/api/nb/switches/${theirs.json.id}/reading`, reading],
    ['POST', '/api/nb/switches/99999/reading', reading],
  ]) {
    const r = await call(port, memberTok, method, p, body);
    assert.equal(r.status, 404, `${method} ${p} for a rack not theirs: ${r.status} ${r.raw}`);
  }
  for (const [method, p, body] of [
    ['PATCH', `/api/nb/switches/${mine.json.id}`, { label: 'x' }],
    ['DELETE', `/api/nb/switches/${mine.json.id}`],
    ['POST', `/api/nb/switches/${mine.json.id}/test`, {}],
    ['POST', `/api/nb/switches/${mine.json.id}/collect`, {}],
    ['GET', `/api/nb/switches/${mine.json.id}/credentials`],
    ['GET', `/api/nb/switches/${mine.json.id}/data`],
    ['POST', '/api/nb/switches/collect-all', { rackId: RACK }],
  ]) {
    const r = await call(port, memberTok, method, p, body);
    assert.equal(r.status, 403, `${method} ${p} as a member: ${r.status} ${r.raw}`);
    assert.match(r.json.error, /for an admin/);
  }

  // ---- 3. The admin cannot decide from a desk.
  const early = await call(port, adminTok, 'POST', `/api/nb/plans/${planId}/decide`,
    { decisions: [{ uid: DEV, decision: 'approved' }, { uid: DEV2, decision: 'rejected', note: 'no' }] });
  assert.equal(early.status, 200, early.raw);
  assert.equal(early.json.applied.length, 0);
  assert.deepEqual(early.json.refused, [{ uid: DEV, why: 'assign first' }, { uid: DEV2, why: 'assign first' }]);
  assert.equal(rows('drift.decide', planId).length, 0, 'nothing to audit: nothing was decided');

  // ---- 4. Assigning names one NetBox contact, or is refused.
  const nobody = await call(port, adminTok, 'POST', `/api/nb/plans/${planId}/decide`,
    { decisions: [{ uid: DEV, decision: 'ticketed', assignee: 'Nobody Here' }] });
  assert.equal(nobody.status, 400, nobody.raw);
  assert.match(nobody.json.error, /no NetBox contact is named "Nobody Here"/);
  const twoSams = await call(port, adminTok, 'POST', `/api/nb/plans/${planId}/decide`,
    { decisions: [{ uid: DEV, decision: 'ticketed', assignee: 'Sam Patel' }] });
  assert.equal(twoSams.status, 400, twoSams.raw);
  assert.match(twoSams.json.error, /more than one NetBox contact is named "Sam Patel"/);
  const untouched = await call(port, adminTok, 'GET', `/api/nb/plans/${planId}`);
  assert.ok(untouched.json.items.every((i) => !i.ticket), 'a refused assign wrote nothing');
  const byId = await call(port, adminTok, 'POST', `/api/nb/plans/${adminPlanId}/decide`,
    { decisions: [{ uid: DEV, decision: 'ticketed', assignee: 'Sam Patel', assigneeId: 9 }] });
  assert.equal(byId.status, 200, byId.raw);
  const adminPlan = await call(port, adminTok, 'GET', `/api/nb/plans/${adminPlanId}`);
  const sam = adminPlan.json.items.find((i) => i.uid === DEV).ticket;
  assert.equal(sam.assigneeId, 9, 'the contact id picks between two people with one name');
  assert.equal(sam.assigneeEmail, 'sam.b@sprintpark.com');

  // ---- 5. The whole rack in one move: every pending item, one incident each.
  mails.length = 0;
  const rack = await call(port, adminTok, 'POST', `/api/nb/plans/${planId}/decide`,
    { decisions: [{ uid: '*', decision: 'ticketed', assignee: MEERA.name, note: 'please check all of it' }] });
  assert.equal(rack.status, 200, rack.raw);
  assert.equal(rack.json.wholeRack, true);
  assert.deepEqual(rack.json.applied, [{ uid: DEV, decision: 'ticketed' }, { uid: DEV2, decision: 'ticketed' }]);
  const lead = rack.json.raised[0];
  assert.equal(lead.scope, 'rack');
  assert.equal(lead.uid, '*');
  assert.deepEqual(lead.items, [DEV, DEV2]);
  assert.equal(lead.count, 2);
  assert.equal(lead.ticket.system, 'none', 'no ServiceNow is configured for this org');
  assert.equal(lead.ticket.incidents.length, 2, 'one incident per item, not one for the rack');
  assert.deepEqual(rack.json.raised.slice(1).map((r) => [r.uid, r.ports]), [[DEV, 2], [DEV2, 0]],
    'the per-item entries follow, as before');
  assert.equal(rack.json.summary.ticketed, 2);
  assert.equal(rack.json.summary.pending, 0);

  const assigned = await call(port, adminTok, 'GET', `/api/nb/plans/${planId}`);
  const after = Object.fromEntries(assigned.json.items.map((i) => [i.uid, i]));
  for (const uid of [DEV, DEV2]) {
    assert.equal(after[uid].ticket.assignee, MEERA.name);
    assert.equal(after[uid].ticket.assigneeId, 7);
    assert.equal(after[uid].ticket.assigneeEmail, MEERA.email);
    assert.equal(after[uid].ticket.status, 'open');
    assert.equal(after[uid].ticket.scope, 'rack');
  }
  assert.equal(after[`if:${DEV}:1`].ticket.sharedWith, DEV, 'the ports share the switch ticket');
  assert.equal(after[`if:${DEV}:1`].ticket.assigneeId, 7);
  assert.equal(mails.length, 1, 'one email to the one person');
  assert.equal(mails[0].to, MEERA.email);
  assert.match(mails[0].subject, /rack RACK-01 \(2 items\)/);
  assert.match(mails[0].text, /SW-12/);
  assert.match(mails[0].text, /FW-15/);
  const assignRows = rows('drift.assign', planId);
  assert.equal(assignRows.length, 2, 'one audit row per item assigned');
  assert.deepEqual(new Set(assignRows.map((r) => r.payload.uid)), new Set([DEV, DEV2]));
  assert.ok(assignRows.every((r) => r.payload.assigneeId === 7 && r.payload.assignee === MEERA.name));

  const stillOpen = await call(port, adminTok, 'POST', `/api/nb/plans/${planId}/decide`,
    { decisions: [{ uid: DEV, decision: 'approved' }] });
  assert.deepEqual(stillOpen.json.refused, [{ uid: DEV, why: 'assign first' }],
    'an open ticket cannot be overridden by a direct approve');
  const again = await call(port, adminTok, 'POST', `/api/nb/plans/${planId}/decide`,
    { decisions: [{ uid: '*', decision: 'ticketed', assignee: MEERA.name }] });
  assert.equal(again.status, 409, 'nothing is pending any more, so the rack move has nothing to take');

  const all = await call(port, adminTok, 'GET', '/api/nb/plans/tickets/all');
  assert.equal(all.status, 200, all.raw);
  const mineTickets = all.json.tickets.filter((r) => r.planId === planId);
  assert.equal(mineTickets.length, 2);
  assert.ok(mineTickets.every((r) => r.assigneeId === 7 && r.assigneeEmail === MEERA.email));

  // ---- 6. The assignee resolves: matched by email, not only by name.
  const wrongPerson = await call(port, otherTok, 'POST', `/api/nb/plans/${planId}/tickets/${DEV}/resolve`,
    { finding: 'not mine to close' });
  assert.equal(wrongPerson.status, 403, `a site manager who is not the assignee: ${wrongPerson.raw}`);
  const byEmail = await call(port, meeraTok, 'POST', `/api/nb/plans/${planId}/tickets/${DEV}/resolve`,
    { finding: 'It is at U12. NetBox was wrong.', outcome: 'confirmed' });
  assert.equal(byEmail.status, 200, byEmail.raw);
  assert.equal(byEmail.json.decision, 'pending', 'a resolved ticket is not an approval');
  assert.equal(byEmail.json.ticket.status, 'resolved');
  const byAdmin = await call(port, adminTok, 'POST', `/api/nb/plans/${planId}/tickets/${DEV2}/resolve`,
    { finding: 'FW-15 is at U15 now.' });
  assert.equal(byAdmin.status, 200, byAdmin.raw);
  assert.equal(rows('drift.resolve', planId).length, 2);

  const back = await call(port, adminTok, 'GET', `/api/nb/plans/${planId}`);
  assert.equal(back.json.summary.resolved, 2, 'both items are back with the admin');
  assert.equal(back.json.summary.pending, 2);
  assert.equal(back.json.settled, false);

  // ---- 7. Now the admin decides, with the findings in hand.
  const decided = await call(port, adminTok, 'POST', `/api/nb/plans/${planId}/decide`,
    { decisions: [{ uid: DEV, decision: 'approved' }, { uid: DEV2, decision: 'rejected', note: 'leave it at 14' }] });
  assert.equal(decided.status, 200, decided.raw);
  assert.equal(decided.json.refused.length, 0);
  assert.equal(decided.json.settled, true);
  const decideRows = rows('drift.decide', planId);
  assert.equal(decideRows.length, 2);
  assert.deepEqual(decideRows.find((r) => r.payload.uid === DEV2).payload,
    { uid: DEV2, decision: 'rejected', note: 'leave it at 14' });
  const done = await call(port, adminTok, 'GET', `/api/nb/plans/${planId}`);
  const closed = done.json.items.find((i) => i.uid === DEV).ticket;
  assert.equal(closed.status, 'closed', 'the decision closes the resolved ticket');
  assert.equal(closed.closedWith, 'approved');
  assert.equal(closed.finding, 'It is at U12. NetBox was wrong.', 'the finding survives');

  // ---- 8. The write: NetBox refuses one object, the plan is write_failed and
  // the admin who ran it is told; the retry goes through the fingerprint again.
  mails.length = 0;
  pushResult = () => ({
    counts: { create: 3, fail: 1 },
    changes: [
      { type: 'Manufacturer', uid: 'mfr:cisco', name: 'Cisco', action: 'create' },
      { type: 'Device', uid: DEV, name: 'SW-12', action: 'create' },
      { type: 'Interface', uid: `if:${DEV}:1`, name: 'Gi1/0/1', action: 'create' },
      { type: 'Interface', uid: `if:${DEV}:2`, name: 'Gi1/0/2', action: 'fail',
        reason: 'lookup failed: "interface name already exists"' },
    ],
  });
  const failedWrite = await call(port, adminTok, 'POST', `/api/nb/netbox/${scanId}/export`, { planId });
  assert.equal(failedWrite.status, 200, failedWrite.raw);
  assert.equal(failedWrite.json.planStatus, 'write_failed');
  assert.equal(failedWrite.json.counts.fail, 1);
  assert.deepEqual(failedWrite.json.failures.map((f) => f.uid), [`if:${DEV}:2`]);
  assert.equal(failedWrite.json.emailed, true);
  assert.equal(mails.length, 1, 'one email, to the admin who ran the write');
  assert.equal(mails[0].to, admin.email);
  assert.match(mails[0].subject, /did not finish/);
  assert.match(mails[0].text, /Gi1\/0\/2/);
  assert.match(mails[0].text, /Nothing else was changed/);
  const halfWritten = await call(port, adminTok, 'GET', `/api/nb/plans/${planId}`);
  assert.equal(halfWritten.json.status, 'write_failed');
  assert.equal(halfWritten.json.summary.failed, 1);
  assert.equal(halfWritten.json.summary.written, 3);
  const inIndex = await call(port, adminTok, 'GET', `/api/nb/plans?rackId=${RACK}&status=write_failed`);
  assert.deepEqual(inIndex.json.plans.map((p) => p.id), [planId], 'the inbox can list a failed write');
  const writeRows = rows('drift.write', planId);
  assert.equal(writeRows.length, 1);
  assert.equal(writeRows[0].status, 'fail');
  assert.equal(writeRows[0].payload.failed, 1);

  pushResult = () => ({
    counts: { create: 4 },
    changes: CHANGES.filter((c) => c.uid !== DEV2).map((c) => ({ ...c })),
  });
  const retried = await call(port, adminTok, 'POST', `/api/nb/netbox/${scanId}/export`, { planId });
  assert.equal(retried.status, 200, `the retry is allowed on a write_failed plan: ${retried.raw}`);
  assert.equal(retried.json.planStatus, 'applied');
  assert.equal(mails.length, 1, 'a clean write sends no failure email');
  const written = await call(port, adminTok, 'GET', `/api/nb/plans/${planId}`);
  assert.equal(written.json.status, 'applied');
  assert.equal(written.json.appliedBy, admin.username);
  const writeRowsAfter = rows('drift.write', planId);
  assert.equal(writeRowsAfter.length, 2);
  assert.equal(writeRowsAfter[0].status, 'ok', 'newest first: the retry succeeded');

  const third = await call(port, adminTok, 'POST', `/api/nb/netbox/${scanId}/export`, { planId });
  assert.equal(third.status, 409, 'an applied plan is closed');

  // The audit rows carry the plan's own tenant, the Site the rack was scanned under.
  const anyRow = rows('drift.assign', planId)[0];
  assert.ok(anyRow, 'an assign row exists');
  const tenantOfRow = db.prepare('SELECT tenant_id FROM audit_log WHERE id = ?').get(anyRow.id);
  assert.equal(tenantOfRow.tenant_id, siteId);
});
